import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 180_000 })
import { PGlite } from '@electric-sql/pglite'

// db/20261106_bell_todo_alarm_incidents.sql: lane alarms ring on change only, draft notices close themselves,
// the liveness watchdog keeps one incident per failing check, post failures fold per day.
const lifecycle = readFileSync('db/219_inbox_notification_lifecycle.sql', 'utf8')
const unreachable = readFileSync('db/20261021_unreachable_not_failed.sql', 'utf8')
const migration = readFileSync('db/20261106_bell_todo_alarm_incidents.sql', 'utf8')
const rollback = readFileSync('db/20261106_bell_todo_alarm_incidents_rollback.sql', 'utf8')

const schema = `
create role anon; create role authenticated; create role service_role;
create table public.inbox_notifications (
 id uuid primary key default gen_random_uuid(), family text not null, source text,
 dedupe_key text, severity text not null default 'info', title text not null,
 body text, url text, media jsonb, group_key text, tenant text,
 count int not null default 1, first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(),
 read_at timestamptz, dismissed_at timestamptz, pushed_at timestamptz, push_result jsonb
);
create view public.inbox_notifications_v with (security_invoker = on) as
 select id, family, source, dedupe_key, severity, title, body, url, media, group_key,
 tenant, count, first_seen_at, last_seen_at, created_at, read_at, dismissed_at, pushed_at
 from public.inbox_notifications;
create table public.outreach_campaigns (id uuid primary key default gen_random_uuid(), client_id text);
create table public.outreach_prospects (id uuid primary key default gen_random_uuid(), name text, campaign_id uuid);
create table public.outreach_messages (id uuid primary key default gen_random_uuid(), prospect_id uuid, direction text,
  message_type text, channel text, message_text text, sent_at timestamptz, approved_at timestamptz,
  send_blocked_at timestamptz, send_blocked_reason text, created_at timestamptz not null default now());
create table public.outreach_message_revisions (id bigserial primary key, message_id uuid, old_send_blocked_reason text);
insert into outreach_campaigns(id, client_id) values ('00000000-0000-0000-0000-0000000000c1', 'ivan');
insert into outreach_prospects(id, name, campaign_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'Bojan Mitevski', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000a2', 'Kirilo Sztarcsak', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000a3', 'Patrick McKenna', '00000000-0000-0000-0000-0000000000c1');
`
const BOJAN = '00000000-0000-0000-0000-0000000000a1'
const KIRILO = '00000000-0000-0000-0000-0000000000a2'
const PATRICK = '00000000-0000-0000-0000-0000000000a3'

async function ready() {
  const db = new PGlite()
  await db.exec(schema); await db.exec(lifecycle); await db.exec(unreachable); await db.exec(migration)
  return db
}
type Claim = { id: string; created: boolean }
const claim = async (db: PGlite, a: Record<string, unknown>) => (await db.query<Claim>(
  'select * from public.claim_inbox_workflow_notification($1::jsonb)', [JSON.stringify(a)])).rows[0]
const row = async (db: PGlite, id: string) => (await db.query<{ count: number; severity: string; title: string; body: string; dismissed: boolean; read: boolean }>(
  'select count, severity, title, body, dismissed_at is not null as dismissed, read_at is not null as read from inbox_notifications where id=$1', [id])).rows[0]

// The relay's own key hashes the full text, so each run's numbers made a new key (live rows 10-30..11-06).
const arch = (n: number, severity = 'attention') => ({
  family: 'lane_supply_alarm', source: 'wa-relay:hXiFLvYt5b1TMrsH', tenant: null, severity,
  incident_key: `unknown:hXiFLvYt5b1TMrsH:lane_supply_alarm:${severity}:${n.toString(16)}`,
  title: `[ARCH] engager harvest output collapse: staged zero leads from ${n} resolved people.`,
  body: `[ARCH] engager harvest output collapse: staged zero leads from ${n} resolved people.`,
})

describe('lane supply alarms are incidents', () => {
  it('folds a repeat with different numbers into one row and never rings it again', async () => {
    const db = await ready()
    const first = await claim(db, arch(32))
    expect(first.created).toBe(true)
    await db.query(`update inbox_notifications set pushed_at=now() where id=$1`, [first.id])
    const repeat = await claim(db, arch(28))
    expect(repeat).toMatchObject({ id: first.id, created: false })
    // A daily watchdog fires 24h + seconds later: still the same incident.
    await db.query(`update inbox_notifications set last_seen_at=now()-interval '24 hours 30 seconds' where id=$1`, [first.id])
    expect(await claim(db, arch(25))).toMatchObject({ id: first.id, created: false })
    expect(await row(db, first.id)).toMatchObject({ count: 3, body: expect.stringContaining('25 resolved') })
    expect((await db.query<{ n: number }>('select count(*)::int n from inbox_notifications')).rows[0].n).toBe(1)
    await db.close()
  })

  it('rings once when it gets worse, at most once a day, and opens a new incident after a quiet gap', async () => {
    const db = await ready()
    const first = await claim(db, arch(32))
    await db.query(`update inbox_notifications set pushed_at=now()-interval '25 hours', dismissed_at=now() where id=$1`, [first.id])
    const worse = await claim(db, arch(30, 'error'))
    // A fresh row (new id + created_at, so the badge and the open tab both see it), the old one superseded.
    expect(worse.created).toBe(true)
    expect(worse.id).not.toBe(first.id)
    expect(await row(db, worse.id)).toMatchObject({ severity: 'error', dismissed: false, count: 2 })
    expect((await row(db, first.id)).dismissed).toBe(true)
    // Worse again inside the day it already rang: counted, not rung.
    await db.query(`update inbox_notifications set pushed_at=now(), severity='attention' where id=$1`, [worse.id])
    expect(await claim(db, arch(29, 'error'))).toMatchObject({ id: worse.id, created: false })
    // Silent for 37 hours means the lane recovered in between: a new incident rings.
    await db.query(`update inbox_notifications set last_seen_at=now()-interval '37 hours' where family='lane_supply_alarm'`)
    const next = await claim(db, arch(20))
    expect(next.created).toBe(true)
    expect(next.id).not.toBe(worse.id)
    await db.close()
  })

  it('keeps different alarms of one lane apart', async () => {
    const db = await ready()
    const base = { family: 'lane_supply_alarm', source: 'wa-relay:swishdm-supply-watchdog', severity: 'attention', incident_key: 'unknown:x:lane_supply_alarm:attention:1' }
    const low = await claim(db, { ...base, title: 'SwishDM outreach supply is low', body: 'a' })
    const out = await claim(db, { ...base, title: 'SwishDM invites will run out today', body: 'b' })
    expect(low.created && out.created).toBe(true)
    expect(low.id).not.toBe(out.id)
    await db.close()
  })

  it('records a runner `_busy` exit as skipped: read, dismissed, never rung, apart from real failures', async () => {
    const db = await ready()
    const busy = (run: string) => ({ family: 'lane_supply_alarm', source: 'runner', severity: 'error',
      incident_key: `auto:_:runner:lane_supply_alarm:error:${run}`, dedupe_key: `runner_lane:rise-anchor-scout:${run}`,
      title: 'rise-anchor-scout failed on the runner', body: `Run ${run} ended error (exit 1): rise_supply_busy` })
    const a = await claim(db, busy('20261106T040504Z-707a8e'))
    expect(a.created).toBe(false)
    expect(await row(db, a.id)).toMatchObject({ dismissed: true, read: true, title: 'rise-anchor-scout skipped: another run held the lock' })
    expect(await claim(db, busy('20261106T080504Z-1b2c3d'))).toMatchObject({ id: a.id, created: false })
    const real = await claim(db, { ...busy('x'), body: 'Run x ended error (exit 1): executor: TimeoutError' })
    expect(real.created).toBe(true)
    expect(real.id).not.toBe(a.id)
    // Same failure, next run id: folds. A different failure of the same lane: its own incident, rung.
    expect(await claim(db, { ...busy('y'), body: 'Run 20261106T120000Z-9f9f9f ended error (exit 1): executor: TimeoutError' })).toMatchObject({ id: real.id, created: false })
    const creds = await claim(db, { ...busy('z'), body: 'Run z ended error (exit 1): unipile 401 credentials revoked' })
    expect(creds.created).toBe(true)
    expect(creds.id).not.toBe(real.id)
    // Same words, different status code: two incidents.
    const m401 = await claim(db, { ...busy('m1'), body: 'Run m1 ended error (exit 1): media download 401' })
    const m503 = await claim(db, { ...busy('m2'), body: 'Run m2 ended error (exit 1): media download 503' })
    expect(m401.created && m503.created).toBe(true)
    expect(m401.id).not.toBe(m503.id)
    // Durations and counts are never codes: these fold into the 503 incident.
    const t1 = await claim(db, { ...busy('t1'), body: 'Run t1 ended error (exit 1): HTTP 503 after 120 seconds' })
    expect(await claim(db, { ...busy('t2'), body: 'Run t2 ended error (exit 1): HTTP 503 after 121 seconds' })).toMatchObject({ id: t1.id, created: false })
    expect(await claim(db, { ...busy('t3'), body: 'Run t3 ended error (exit 1): HTTP 503 after 451 seconds' })).toMatchObject({ id: t1.id, created: false })
    await db.close()
  })

  it('leaves the other incident families on the 24h fold, and rolls back cleanly', async () => {
    const db = await ready()
    const infra = { family: 'system_infra_alarm', source: 'wa-relay:w', severity: 'attention', incident_key: 'rise:w:step:failed:attention', title: 'Failed', body: 'x' }
    const a = await claim(db, infra)
    expect(await claim(db, infra)).toMatchObject({ id: a.id, created: false })
    await db.exec(rollback)
    const b = await claim(db, arch(32))
    expect(b.created).toBe(true)
    expect((await claim(db, arch(28))).created).toBe(true) // the old behaviour: a new key per number
    await db.close()
  })
})

const draftNotice = (name: string, extras: Record<string, unknown> = {}) => ({
  family: 'reply_draft_pending', source: 'wa-relay:X8woPv26UrC4Mnhz', severity: 'attention',
  title: `Warm reply drafted for ${name} (ICP 8):`, body: 'thanks', url: './#exp/brain-b/dms',
  group_key: 'reply_draft_pending:X8woPv26UrC4Mnhz', ...extras,
})
const insertNotice = async (db: PGlite, n: Record<string, unknown>) => (await db.query<{ id: string }>(
  `insert into inbox_notifications(family, source, severity, title, body, url, group_key)
   values ($1,$2,$3,$4,$5,$6,$7) returning id`,
  [n.family, n.source, n.severity, n.title, n.body, n.url, n.group_key])).rows[0].id
const draft = async (db: PGlite, prospect: string, extras = '') => (await db.query<{ id: string }>(
  `insert into outreach_messages(prospect_id, direction, message_type, message_text, sent_at${extras ? ',' + extras.split('=')[0] : ''})
   values ($1, 'outbound', 'dm', 'hi', null${extras ? ',' + extras.split('=')[1] : ''}) returning id`, [prospect])).rows[0].id
const notice = async (db: PGlite, id: string) => (await db.query<{ url: string; group_key: string; prospect: string | null; dismissed: boolean }>(
  `select url, group_key, media->>'prospect_id' prospect, dismissed_at is not null dismissed from inbox_notifications where id=$1`, [id])).rows[0]

const sweep = async (db: PGlite) => {
  // The sweep closes only notices older than 10 minutes.
  await db.exec(`update inbox_notifications set created_at = created_at - interval '11 minutes' where family='reply_draft_pending'`)
  await db.exec(`update outreach_messages set created_at = created_at - interval '11 minutes'`)
  return (await db.query<{ r: { linked: number; closed: number } }>('select public.inbox_sweep_draft_notices() r')).rows[0].r
}

describe('reply drafted notices close when the draft is resolved', () => {
  it('links the notice to the person and closes it only when nothing of theirs waits', async () => {
    const db = await ready()
    const d1 = await draft(db, BOJAN)
    const d2 = await draft(db, KIRILO)
    const nb = await insertNotice(db, draftNotice('Bojan Mitevski'))
    const nk = await insertNotice(db, draftNotice('Kirilo Sztarcsak'))
    expect(await notice(db, nb)).toEqual({ url: `./#exp/d/dms?thread=${BOJAN}`, group_key: `reply_draft_pending:${BOJAN}`, prospect: BOJAN, dismissed: false })
    // Bojan's draft is sent: his notice closes. Kirilo's draft still waits: his stays.
    await db.query(`update outreach_messages set sent_at=now() where id=$1`, [d1])
    await sweep(db)
    expect((await notice(db, nb)).dismissed).toBe(true)
    expect((await notice(db, nk)).dismissed).toBe(false)
    // An approval hold, or any reason with send_blocked_at still null (the UI shows both as drafts), waits.
    await db.query(`update outreach_messages set send_blocked_at=now(), send_blocked_reason='awaiting_client_review' where id=$1`, [d2])
    await sweep(db)
    expect((await notice(db, nk)).dismissed).toBe(false)
    await db.query(`update outreach_messages set send_blocked_at=null, send_blocked_reason='some_note' where id=$1`, [d2])
    await sweep(db)
    expect((await notice(db, nk)).dismissed).toBe(false)
    await db.query(`update outreach_messages set send_blocked_at=now(), send_blocked_reason='discarded_in_inbox' where id=$1`, [d2])
    await sweep(db)
    expect((await notice(db, nk)).dismissed).toBe(true)
    await db.close()
  })

  it('closes on approve and once the last bubble is gone, but not while a second bubble still waits', async () => {
    const db = await ready()
    const a = await draft(db, BOJAN)
    const b = await draft(db, BOJAN)
    const n = await insertNotice(db, draftNotice('Bojan Mitevski'))
    await db.query(`update outreach_messages set approved_at=now() where id=$1`, [a])
    await sweep(db)
    expect((await notice(db, n)).dismissed).toBe(false)
    await db.query(`DELETE FROM outreach_messages WHERE id=$1`, [b])
    await sweep(db)
    expect((await notice(db, n)).dismissed).toBe(true)
    await db.close()
  })

  it('never closes a notice in its first 10 minutes (its draft may not have committed yet)', async () => {
    const db = await ready()
    // An older reply to Bojan already went out; the new notice lands before the new draft commits.
    await db.query(`insert into outreach_messages(prospect_id, direction, message_text, sent_at, created_at) values ($1,'outbound','old',now(),now()-interval '30 minutes')`, [BOJAN])
    const n = await insertNotice(db, draftNotice('Bojan Mitevski'))
    await db.query('select public.inbox_sweep_draft_notices()')
    expect((await notice(db, n)).dismissed).toBe(false)
    await draft(db, BOJAN)
    await sweep(db)
    expect((await notice(db, n)).dismissed).toBe(false)
    await db.close()
  })

  it('files an already-approved auto-queued DM1 away on the sweep, and leaves an unmatched notice alone', async () => {
    const db = await ready()
    await draft(db, PATRICK, 'approved_at=now()')
    const auto = await insertNotice(db, draftNotice('x', { title: 'DM1 wins auto-queued for Patrick McKenna:' }))
    expect((await notice(db, auto)).dismissed).toBe(false)
    const stranger = await insertNotice(db, draftNotice('Someone Unknown'))
    await sweep(db)
    expect((await notice(db, auto)).dismissed).toBe(true)
    expect(await notice(db, stranger)).toMatchObject({ prospect: null, dismissed: false, url: './#exp/brain-b/dms' })
    await db.close()
  })

  it('links nobody when another prospect anywhere shares the name, even with no recent message', async () => {
    const db = await ready()
    await db.exec(`insert into outreach_prospects(id, name) values ('00000000-0000-0000-0000-0000000000a8', 'Kirilo Sztarcsak')`)
    await draft(db, KIRILO)
    const n = await insertNotice(db, draftNotice('Kirilo Sztarcsak'))
    expect(await notice(db, n)).toMatchObject({ prospect: null })
    await db.close()
  })

  it('links nobody when two prospects share the name', async () => {
    const db = await ready()
    await db.exec(`insert into outreach_prospects(id, name) values ('00000000-0000-0000-0000-0000000000a9', 'Bojan Mitevski')`)
    await db.query(`insert into outreach_messages(prospect_id, direction, message_text, sent_at) values ($1,'outbound','sent',now())`, [BOJAN])
    await draft(db, '00000000-0000-0000-0000-0000000000a9')
    const n = await insertNotice(db, draftNotice('Bojan Mitevski'))
    await sweep(db)
    expect(await notice(db, n)).toMatchObject({ prospect: null, dismissed: false })
    await db.close()
  })

  it('the sweep links a notice that landed before its draft, then closes it once handled', async () => {
    const db = await ready()
    const n = await insertNotice(db, draftNotice('Kirilo Sztarcsak'))
    expect((await notice(db, n)).prospect).toBe(null)
    const d = await draft(db, KIRILO)
    expect(await sweep(db)).toEqual({ linked: 1, closed: 0 })
    await db.query(`update outreach_messages set sent_at=now() where id=$1`, [d])
    expect(await sweep(db)).toEqual({ linked: 0, closed: 1 })
    await db.close()
  })

  it('adds no trigger to outreach_messages (a send never waits on the bell)', async () => {
    const db = await ready()
    const t = await db.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgrelid='public.outreach_messages'::regclass and not tgisinternal`)
    expect(t.rows[0].n).toBe(0)
    await db.close()
  })
})

const run = (lines: string[]) => ({
  family: 'useful_output_health', source: '90QRPEaXxcMmkJYK', severity: 'attention', title: 'Loop Liveness Watchdog',
  body: `Loop Liveness Watchdog — ${lines.length} check(s) failed\n${lines.map(l => '- ' + l).join('\n')}`,
})
const NEWS = (h: number) => `lm_idea_candidates(source=breaking_news) stale: last row ${h}h ago (threshold 72h)`
const SCHED = (n: number) => `scheduler workflows (S05kVGFB1BIlAjlm,V6u1ZPzNBmBlnJxp,LDoM5expFpIIR3Um) logged only ${n} execution(s) in last 26h (threshold >=3)`
const writeRun = (db: PGlite, lines: string[]) => {
  const r = run(lines)
  return db.query(`insert into inbox_notifications(family, source, severity, title, body, group_key, read_at, pushed_at, push_result)
    values ($1,$2,$3,$4,$5,'loop_liveness',now(),now(),'{"suppressed":true}')`, [r.family, r.source, r.severity, r.title, r.body])
}
const incidents = (db: PGlite) => db.query<{ title: string; count: number; body: string; open: boolean; read: boolean }>(
  `select title, count, body, dismissed_at is null open, read_at is not null read from inbox_notifications
    where family='useful_output_health' and incident_key like 'watchdog:%' order by title`).then(r => r.rows)

describe('the liveness watchdog keeps one incident per failing check', () => {
  it('opens one unread incident per check, counts repeats quietly, and closes a check that passes', async () => {
    const db = await ready()
    await writeRun(db, [NEWS(491), SCHED(2)])
    await writeRun(db, [NEWS(492), SCHED(1)])
    await writeRun(db, [NEWS(493), SCHED(2)])
    let rows = await incidents(db)
    expect(rows).toHaveLength(2)
    expect(rows.map(r => [r.count, r.open, r.read])).toEqual([[3, true, false], [3, true, false]])
    expect(rows.find(r => r.title.includes('breaking_news'))?.body).toContain('493h')
    // Every run row is a dismissed log.
    expect((await db.query<{ n: number }>(`select count(*)::int n from inbox_notifications where incident_key is null and dismissed_at is null`)).rows[0].n).toBe(0)
    // The scheduler check passes: only the news check stays open.
    await writeRun(db, [NEWS(494)])
    rows = await incidents(db)
    expect(rows.filter(r => r.open).map(r => r.title)).toEqual([expect.stringContaining('breaking_news')])
    await db.close()
  })

  it('a check that passed and fails again opens a new incident', async () => {
    const db = await ready()
    await writeRun(db, [NEWS(491), SCHED(2)])
    await writeRun(db, [NEWS(492)])
    await writeRun(db, [NEWS(493), SCHED(1)])
    const rows = await incidents(db)
    const sched = rows.filter(r => r.title.includes('scheduler'))
    expect(sched.map(r => r.open).sort()).toEqual([false, true])
    expect(rows.filter(r => r.title.includes('breaking_news')).map(r => [r.count, r.open])).toEqual([[3, true]])
    await db.close()
  })

  it('stays quiet after Ivan dismisses it while the check keeps failing, and the cron closes a silent check', async () => {
    const db = await ready()
    await writeRun(db, [NEWS(491)])
    await db.exec(`update inbox_notifications set dismissed_at=now() where incident_key like 'watchdog:%'`)
    await writeRun(db, [NEWS(492)])
    expect((await incidents(db)).map(r => [r.count, r.open])).toEqual([[2, false]])
    await db.exec(`update inbox_notifications set dismissed_at=null, last_seen_at=now()-interval '4 hours' where incident_key like 'watchdog:%'`)
    expect((await db.query<{ n: number }>('select public.inbox_close_quiet_watchdog_incidents() n')).rows[0].n).toBe(1)
    await db.close()
  })

  it('leaves a run row it cannot read untouched', async () => {
    const db = await ready()
    await db.query(`insert into inbox_notifications(family, source, title, body) values ('useful_output_health','90QRPEaXxcMmkJYK','Loop Liveness Watchdog','all good')`)
    expect((await db.query<{ open: boolean }>(`select dismissed_at is null open from inbox_notifications`)).rows).toEqual([{ open: true }])
    await db.close()
  })
})

describe('new reply notices open the thread', () => {
  it('links a notice naming one person, and leaves a digest naming two on the DMs list', async () => {
    const db = await ready()
    await db.query(`insert into outreach_messages(prospect_id, direction, message_text, sent_at) values ($1,'inbound','hi',now()), ($2,'inbound','yo',now())`, [BOJAN, KIRILO])
    const one = await insertNotice(db, { family: 'inbound_reply_notice', source: 's', severity: 'info', title: 'ARCH new inbound reply:', body: '• Bojan Mitevski: "hi"', url: './#exp/brain-b/dms', group_key: null })
    const two = await insertNotice(db, { family: 'inbound_reply_notice', source: 's', severity: 'info', title: 'Replies:', body: '• Bojan Mitevski\n• Kirilo Sztarcsak', url: './#exp/brain-b/dms', group_key: null })
    expect(await notice(db, one)).toMatchObject({ url: `./#exp/d/dms?thread=${BOJAN}`, dismissed: false })
    expect(await notice(db, two)).toMatchObject({ url: './#exp/brain-b/dms', prospect: null })
    await db.close()
  })
})

describe('post generation failures fold per day', () => {
  it('gives every failure of one Warsaw day the same group', async () => {
    const db = await ready()
    for (const src of ['wa-relay:aBjPr3m7RdHZNF2o', 'wa-relay:G50ohygdst5N578Z']) {
      await db.query(`insert into inbox_notifications(family, source, severity, title, group_key, created_at)
        values ('post_generation_failed', $1, 'error', 'Post generation FAILED', 'post_generation_failed:' || $1, '2026-11-03 12:20:00+00')`, [src])
    }
    const g = await db.query<{ group_key: string }>(`select distinct group_key from inbox_notifications`)
    expect(g.rows).toEqual([{ group_key: 'post_generation_failed:2026-11-03' }])
    await db.close()
  })
})
