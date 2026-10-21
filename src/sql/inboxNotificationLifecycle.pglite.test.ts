import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync('db/219_inbox_notification_lifecycle.sql', 'utf8')
const rollback = readFileSync('db/219_inbox_notification_lifecycle.rollback.sql', 'utf8')
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
`

async function setup() { const db = new PGlite(); await db.exec(schema); return db }
const alert = (key: string, extras: Record<string, unknown> = {}) => JSON.stringify({
  family: 'system_infra_alarm', source: 'wa-relay:workflow', tenant: 'rise',
  incident_key: key, severity: 'attention', title: 'Failed', body: 'step A', ...extras,
})
const claim = (db: PGlite, input: string) => db.query<{ id: string; created: boolean; expires_at: string }>(
  'select * from public.claim_inbox_workflow_notification($1::jsonb)', [input])

describe('inbox notification lifecycle migration', () => {
  it('backfills only operational rows from creation, retains rows and does not alter task state', async () => {
    const db = await setup()
    await db.exec(`insert into inbox_notifications(family,title,created_at) values
      ('system_infra_alarm','old',now()-interval '7 hours'),
      ('claude_turn','answer',now()-interval '7 hours'),
      ('booking_notice','booking',now()-interval '7 hours')`)
    await db.exec(migration)
    const rows = await db.query<{ family: string; expired: boolean; expires_at: string | null }>(
      `select family, expires_at <= now() as expired, expires_at from inbox_notifications order by family`)
    expect(rows.rows.find(r => r.family === 'system_infra_alarm')?.expired).toBe(true)
    expect(rows.rows.filter(r => r.family !== 'system_infra_alarm').every(r => r.expires_at === null)).toBe(true)
    expect(rows.rows).toHaveLength(3)
    await db.close()
  })

  it('claims one row for concurrent/repeated delivery, including after dismiss and expiry', async () => {
    const db = await setup(); await db.exec(migration)
    const key = 'rise:workflow:step:failed:attention'
    const results = await Promise.all([claim(db, alert(key)), claim(db, alert(key))])
    expect(results.flatMap(r => r.rows).filter(r => r.created)).toHaveLength(1)
    const id = results[0].rows[0].id
    await db.query('update inbox_notifications set dismissed_at=now(), expires_at=now()-interval \'1 second\' where id=$1', [id])
    const repeat = (await claim(db, alert(key))).rows[0]
    expect(repeat).toMatchObject({ id, created: false })
    const row = (await db.query<{ count: number; dismissed_at: string; expires_at: string }>('select count,dismissed_at,expires_at from inbox_notifications where id=$1', [id])).rows[0]
    expect(row.count).toBe(3)
    expect(row.dismissed_at).toBeTruthy()
    expect(Date.parse(row.expires_at)).toBeLessThan(Date.now())
    await db.close()
  })

  it('keeps a 24-hour quiet-gap episode and distinct same-workflow conditions separate', async () => {
    const db = await setup(); await db.exec(migration)
    const a = (await claim(db, alert('rise:w:step-a:failed:attention'))).rows[0]
    const b = (await claim(db, alert('rise:w:step-b:failed:attention'))).rows[0]
    const c = (await claim(db, alert('rise:w:step-a:failed:error', { severity: 'error' }))).rows[0]
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    await db.query(`update inbox_notifications set last_seen_at=now()-interval '25 hours' where id=$1`, [a.id])
    const episode = (await claim(db, alert('rise:w:step-a:failed:attention'))).rows[0]
    expect(episode.created).toBe(true)
    expect(episode.id).not.toBe(a.id)
    await db.close()
  })

  it('denies authenticated execution and keeps suppression rows through rollback', async () => {
    const db = await setup(); await db.exec(migration)
    const first = (await claim(db, alert('rise:w:step:failed:error'))).rows[0]
    const grant = await db.query<{ authed: boolean; anonymous: boolean; service: boolean }>(
      `select has_function_privilege('authenticated', 'public.claim_inbox_workflow_notification(jsonb)', 'EXECUTE') as authed,
              has_function_privilege('anon', 'public.claim_inbox_workflow_notification(jsonb)', 'EXECUTE') as anonymous,
              has_function_privilege('service_role', 'public.claim_inbox_workflow_notification(jsonb)', 'EXECUTE') as service`)
    expect(grant.rows[0]).toEqual({ authed: false, anonymous: false, service: true })
    await db.exec(rollback)
    const repeat = (await claim(db, alert('rise:w:step:failed:error'))).rows[0]
    expect(repeat).toMatchObject({ id: first.id, created: false })
    await db.close()
  })

  it('permits only one transition alert from a coarse legacy row, then suppresses repeats', async () => {
    const db = await setup()
    await db.exec(`insert into inbox_notifications(family,source,dedupe_key,title,body,created_at,last_seen_at)
      values ('system_infra_alarm','wa-relay:workflow','workflow:daily','Old failure','Step A failed',
        now()-interval '1 hour',now()-interval '1 hour')`)
    await db.exec(migration)
    const key = 'rise:workflow:step-a:failed:attention'
    const first = (await claim(db, alert(key))).rows[0]
    const repeat = (await claim(db, alert(key))).rows[0]
    expect(first.created).toBe(true)
    expect(repeat).toMatchObject({ id: first.id, created: false })
    const rows = await db.query<{ incident_key: string | null }>('select incident_key from inbox_notifications')
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.filter(r => r.incident_key === null)).toHaveLength(1)
    await db.close()
  })
})

// Ivan 10-21 (Ben Chehebar on RISE, Toby Hart on Ivan): a recipient LinkedIn will not deliver to (blocked us, cannot
// receive messages) never rings and never counts as blocked, on every seat.
describe('unreachable recipients are not failures (db/20261021_unreachable_not_failed.sql)', () => {
  const unreachable = readFileSync('db/20261021_unreachable_not_failed.sql', 'utf8')
  const unreachableRollback = readFileSync('db/20261021_unreachable_not_failed_rollback.sql', 'utf8')
  const outreach = `
    create table public.outreach_campaigns (id uuid primary key default gen_random_uuid(), client_id text);
    create table public.outreach_prospects (id uuid primary key default gen_random_uuid(), name text, campaign_id uuid);
    create table public.outreach_messages (id uuid primary key default gen_random_uuid(), prospect_id uuid, direction text,
      message_type text, channel text, message_text text, sent_at timestamptz, send_blocked_at timestamptz, send_blocked_reason text);
    create table public.outreach_message_revisions (id bigserial primary key, message_id uuid, old_send_blocked_reason text);
    insert into outreach_campaigns(id, client_id) values ('00000000-0000-0000-0000-0000000000c1', 'risedtc'), ('00000000-0000-0000-0000-0000000000c2', 'ivan');
    insert into outreach_prospects(id, name, campaign_id) values
      ('00000000-0000-0000-0000-0000000000b1', 'Ben Chehebar', '00000000-0000-0000-0000-0000000000c1'),
      ('00000000-0000-0000-0000-0000000000b2', 'Toby Hart', '00000000-0000-0000-0000-0000000000c2'),
      ('00000000-0000-0000-0000-0000000000b3', 'Nora Connect', '00000000-0000-0000-0000-0000000000c2');`
  const sendAlert = (name: string, reason = 'hard error: Request failed with status code 422') => {
    const title = `Send FAILED (verified not delivered) to ${name}. Row reset + blocked. Reason: ${reason}`
    return JSON.stringify({ family: 'send_failed_alert', source: 'wa-relay:kFYlfnWd98YaiErH', severity: 'error',
      incident_key: `unknown:kFYlfnWd98YaiErH:send_failed_alert:error:${(name + reason).replace(/[^a-zA-Z0-9]/g, '')}`, title, body: title })
  }
  async function ready() {
    const db = await setup(); await db.exec(outreach); await db.exec(migration); await db.exec(unreachable); return db
  }
  const block = (db: PGlite, prospect: string, reason: string, at = "now()") => db.exec(`insert into outreach_messages
    (prospect_id, direction, message_type, message_text, send_blocked_at, send_blocked_reason)
    values ('${prospect}', 'outbound', 'dm', 'hi', ${at}, '${reason}')`)

  it('records a 422 alert for a known-unreachable recipient dismissed and unrung, on every seat', async () => {
    const db = await ready()
    // Ben: the dispatcher reset his relabelled row and re-blocked it with the bare 422; the revision kept the label.
    await block(db, '00000000-0000-0000-0000-0000000000b1', 'send_failed_verified: hard error: Request failed with status code 422')
    await db.exec(`insert into outreach_message_revisions(message_id, old_send_blocked_reason)
      select id, 'provider_invalid_recipient: LinkedIn 422 errors/blocked_recipient' from outreach_messages`)
    // Toby: the row itself carries the provider type.
    await block(db, '00000000-0000-0000-0000-0000000000b2', 'send_failed_verified: hard error: Request failed with status code 422 [errors/invalid_recipient]')
    for (const name of ['Ben Chehebar', 'Toby Hart']) {
      const r = (await claim(db, sendAlert(name))).rows[0]
      expect(r.created, name).toBe(false)
      const row = (await db.query<{ dismissed: boolean; read: boolean }>('select dismissed_at is not null as dismissed, read_at is not null as read from inbox_notifications where id=$1', [r.id])).rows[0]
      expect(row, name).toEqual({ dismissed: true, read: true })
    }
    // The provider type in the alert itself is enough, whoever it names.
    expect((await claim(db, sendAlert('Someone Else', 'errors/blocked_recipient'))).rows[0].created).toBe(false)
    await db.close()
  })

  it('still rings a fixable 422, an old unreachable row, and other failures', async () => {
    const db = await ready()
    await block(db, '00000000-0000-0000-0000-0000000000b3', 'send_failed_verified: chat create failed: Request failed with status code 422 [errors/no_connection_with_recipient]')
    expect((await claim(db, sendAlert('Nora Connect'))).rows[0].created).toBe(true)
    // An unreachable label from a day ago does not explain a new 422 for a row blocked now.
    await block(db, '00000000-0000-0000-0000-0000000000b2', 'provider_invalid_recipient', "now() - interval '1 day'")
    expect((await claim(db, sendAlert('Toby Hart'))).rows[0].created).toBe(true)
    expect((await claim(db, sendAlert('Ben Chehebar', 'inmail_failed_422: limit_exceeded'))).rows[0].created).toBe(true)
    const open = await db.query<{ n: number }>('select count(*)::int as n from inbox_notifications where dismissed_at is null')
    expect(open.rows[0].n).toBe(3)
    await db.close()
  })

  it('leaves unreachable recipients out of the blocked count, and dismisses the open alerts they raised', async () => {
    const db = await setup(); await db.exec(outreach); await db.exec(migration)
    await block(db, '00000000-0000-0000-0000-0000000000b1', 'provider_invalid_recipient: LinkedIn 422 errors/blocked_recipient')
    await block(db, '00000000-0000-0000-0000-0000000000b3', 'send_failed_verified: chat create failed: Request failed with status code 422 [errors/no_connection_with_recipient]')
    const before = (await claim(db, sendAlert('Ben Chehebar'))).rows[0]
    expect(before.created).toBe(true)
    const nora = (await claim(db, sendAlert('Nora Connect'))).rows[0]
    await db.exec(unreachable)
    const blocked = await db.query<{ client_id: string; blocked: number }>('select client_id, blocked::int from inbox_sends_v order by client_id')
    expect(blocked.rows).toEqual([{ client_id: 'ivan', blocked: 1 }, { client_id: 'risedtc', blocked: 0 }])
    const open = await db.query<{ id: string }>('select id from inbox_notifications where dismissed_at is null')
    expect(open.rows.map(r => r.id)).toEqual([nora.id])
    await db.exec(unreachableRollback)
    expect((await db.query<{ blocked: number }>(`select blocked::int from inbox_sends_v where client_id='risedtc'`)).rows[0].blocked).toBe(1)
    expect((await claim(db, sendAlert('Someone Else', 'errors/blocked_recipient'))).rows[0].created).toBe(true)
    await db.close()
  })
})
