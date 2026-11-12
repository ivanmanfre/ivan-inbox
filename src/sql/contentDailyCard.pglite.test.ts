import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

// db/20261112_content_daily_card against a stand-in schema. The Poland read is the real one (db/299p + db/299q run
// here too); cron.schedule, net.http_post and the live auth helpers are stand-ins. net.http_post records each call, so
// "one notification" is counted, never assumed.
const poland = readFileSync('db/299p_content_poland_read.sql', 'utf8') + '\n' + readFileSync('db/299q_content_poland_read_sol_r1.sql', 'utf8')
const migration = readFileSync('db/20261112_content_daily_card.sql', 'utf8')
const rollback = readFileSync('db/20261112_content_daily_card_rollback.sql', 'utf8')

const schema = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema net; create schema cron;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.content_plan_service_ok() returns boolean language sql stable as $$ select coalesce(current_setting('test.service', true), '1') = '1' $$;
create function public.cb34_p2_operator_lane_allowed(p text) returns boolean language sql stable as $$ select coalesce(current_setting('test.lane_ok', true), '1') = '1' $$;
create function public.cb34_p2_review_block(p_qa jsonb, p_taxonomy jsonb) returns text language sql immutable as $$
  select case when coalesce(p_qa ->> 'feedback', '') ~ '(^|\\n)GATE: BLOCKED' then 'qa_gate_not_met' end $$;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, c) returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create table net.calls (id bigserial primary key, url text, body jsonb);
create table net._http_response (id bigint primary key, status_code int);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language sql as $$
  insert into net.calls(url, body) values (url, body) returning id $$;
create table public.integration_config (key text primary key, value text);
insert into public.integration_config values ('inbox_notify_url', 'https://example.test/inbox-notify'), ('inbox_push_secret', 's');
create table public.carousel_drafts (
  id uuid primary key, client_id text, status text not null, type text, title text, post_body text, qa jsonb, taxonomy jsonb,
  source_label text, image_urls jsonb, video_url text, scheduled_at timestamptz, published_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.cb34_p2_members (draft_id uuid primary key, client_id text, state text, validation jsonb, body_sha256 text);
create table public.inbox_notifications (id bigserial primary key, dedupe_key text, dismissed_at timestamptz);
-- cb39_verdict_set stand-in: records the call and does the live function's Ivan-seat write (status 'approved').
create table public.verdict_calls (draft_id uuid, verdict text, ms int);
create function public.cb39_verdict_set(p_draft uuid, p_verdict text, p_reasons text[] default '{}', p_note text default null, p_invocation uuid default null, p_ms_to_verdict int default null)
returns jsonb language plpgsql as $$ begin
  insert into verdict_calls values (p_draft, p_verdict, p_ms_to_verdict);
  update carousel_drafts set status = 'approved' where id = p_draft and client_id is null;
  return jsonb_build_object('draft_id', p_draft, 'verdict', p_verdict);
end $$;
`

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
// Thursday 12 Nov 2026, winter time: Warsaw = UTC+1, so 11:00 Warsaw is 10:00 UTC.
const AT_11 = '2026-11-12T10:00:00Z'
const DAY = '2026-11-12'
const PASS = { verdict: 'PASS', score: 84 }

async function setup() {
  const db = new PGlite()
  await db.exec(schema)
  await db.exec(poland)
  await db.exec(migration)
  await db.exec(`set test.uid = '11111111-1111-1111-1111-111111111111'`)
  return db
}
type Draft = { n: number; client?: string | null; status?: string; type?: string; title?: string; body?: string; qa?: object | null; tax?: object | string | null; label?: string | null; daysAgo?: number; scheduled?: string | null; published?: string | null }
async function draft(db: PGlite, d: Draft) {
  await db.query(`insert into carousel_drafts (id, client_id, status, type, title, post_body, qa, taxonomy, source_label, scheduled_at, published_at, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz - ($13 || ' days')::interval)`,
  [id(d.n), d.client ?? null, d.status ?? 'review', d.type ?? 'text', d.title ?? `Post ${d.n}`, d.body ?? `Post ${d.n} first line\n\nPost ${d.n} body.`,
    d.qa === undefined ? JSON.stringify(PASS) : d.qa === null ? null : JSON.stringify(d.qa),
    d.tax == null ? null : typeof d.tax === 'string' ? JSON.stringify(d.tax) : JSON.stringify(d.tax),
    d.label ?? null, d.scheduled ?? null, d.published ?? null, AT_11, String(d.daysAgo ?? 1)])
}
/** The reasoned Poland read for the draft's current body (content_poland_reads, keyed by md5 of the body). */
const readPoland = (db: PGlite, n: number, yes: boolean) =>
  db.query(`insert into content_poland_reads (draft_id, is_poland, why, model, body_md5) select id, $2, 'test', 'test', md5(post_body) from carousel_drafts where id = $1`, [id(n), yes])
const one = async <T,>(db: PGlite, sql: string, p: unknown[] = []) => (await db.query<{ v: T }>(sql, p)).rows[0].v
const pick = (db: PGlite, at = AT_11) => one<{ fire: boolean; why: string; draft_id?: string; payload?: Record<string, unknown> }>(db, `select public.content_card_pick($1::timestamptz) v`, [at])
const cards = async (db: PGlite) => (await db.query<{ day: string; draft_id: string; state: string; why: string }>(`select day::text, draft_id::text, state, why from content_daily_cards order by day`)).rows
const calls = async (db: PGlite) => (await db.query<{ body: Record<string, unknown> }>(`select body from net.calls order by id`)).rows.map(r => r.body)

describe('content_card_candidates: who may become a card', { timeout: 60_000 }, () => {
  it('keeps only Ivan’s undated, unpublished, QA-passed text or image drafts in review from the last 30 days, never a fixture or a carded draft', async () => {
    const db = await setup()
    await draft(db, { n: 1 })                                                    // eligible text
    await draft(db, { n: 2, type: 'single_image' })                              // eligible image
    await draft(db, { n: 3, client: 'ivan' })                                    // editorial-native: no approve path takes it
    await draft(db, { n: 4, client: 'risedtc' })                                 // a client seat
    await draft(db, { n: 5, status: 'approved' })
    await draft(db, { n: 6, scheduled: '2026-11-20T09:45:00Z' })                 // dated
    await draft(db, { n: 7, published: '2026-11-10T09:45:00Z' })
    await draft(db, { n: 8, type: 'carousel' })
    await draft(db, { n: 9, qa: { verdict: 'FAIL' } })
    await draft(db, { n: 10, qa: null })
    await draft(db, { n: 11, daysAgo: 31 })
    await draft(db, { n: 12, tax: { internal_test: true } })                    // db/238 fixture marker
    await draft(db, { n: 13, tax: '{"internal_test":true}' })                   // the same marker stored as a JSON string
    await draft(db, { n: 14, title: '[new voice test] Example' })
    await draft(db, { n: 15, tax: { deleted_by_operator: true } })
    await draft(db, { n: 16, qa: { verdict: 'PASS', feedback: 'GATE: BLOCKED (no proof)' } })
    await draft(db, { n: 17 })                                                   // brain draft not released yet
    await db.query(`insert into cb34_p2_members values ($1, 'ivan', 'staged', '{"verdict":"PASS"}', null)`, [id(17)])
    await draft(db, { n: 18 })                                                   // brain draft released and validated
    await db.query(`insert into cb34_p2_members values ($1, 'ivan', 'released', '{"verdict":"PASS"}', null)`, [id(18)])
    await draft(db, { n: 19 })                                                   // carded on an earlier day
    await db.query(`insert into content_daily_cards (day, draft_id, body_sha256, why, state) values ('2026-11-01', $1, 'x', 'newest', 'skipped')`, [id(19)])
    await draft(db, { n: 20, tax: { internal_test: false } })                   // a post about tests is a real post
    await draft(db, { n: 21, body: '   ' })
    const got = (await db.query<{ draft_id: string }>(`select draft_id::text from content_card_candidates($1::timestamptz) order by draft_id`, [AT_11])).rows.map(r => r.draft_id)
    expect(got).toEqual([id(1), id(2), id(18), id(20)])
  })
})

describe('content_card_pick', { timeout: 60_000 }, () => {
  it('picks the newest eligible draft, writes one card and one ringing notification, and is idempotent for the day', async () => {
    const db = await setup()
    await draft(db, { n: 1, daysAgo: 3 })
    await draft(db, { n: 2, daysAgo: 1, body: 'Kraków taught me one thing about pricing.\n\nThe second line runs on. ' + 'x'.repeat(200) })
    const r = await pick(db)
    expect(r).toMatchObject({ fire: true, draft_id: id(2), why: 'newest' })
    expect(await cards(db)).toEqual([{ day: DAY, draft_id: id(2), state: 'shown', why: 'newest' }])
    const sent = await calls(db)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      family: 'content_card', source: 'content-card', dedupe_key: `content-card:${DAY}`, severity: 'info', push: true,
      title: 'Kraków taught me one thing about pricing.', url: './#exp/d/content/today',
      media: { kind: 'content_card', day: DAY, draft_id: id(2) },
    })
    expect(String(sent[0].body)).toMatch(/^The second line runs on\. x+…$/)
    expect(String(sent[0].body).length).toBe(120)
    // the same day again (another quarter of the hour, a manual call): nothing new
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ fire: false, why: 'already picked' })
    expect(await pick(db, '2026-11-12T10:45:00Z')).toMatchObject({ fire: false, why: 'already picked' })
    expect(await cards(db)).toHaveLength(1)
    expect(await calls(db)).toHaveLength(1)
  })

  it('acts only in Warsaw’s 11 o’clock hour, in winter and in summer time', async () => {
    const db = await setup()
    await draft(db, { n: 1 })
    expect(await pick(db, '2026-11-12T09:00:00Z')).toMatchObject({ fire: false, why: 'not 11 in Warsaw' }) // 10:00 Warsaw
    expect(await pick(db, '2026-11-12T11:00:00Z')).toMatchObject({ fire: false, why: 'not 11 in Warsaw' }) // 12:00 Warsaw
    expect(await cards(db)).toEqual([])
    expect(await pick(db, '2026-11-12T10:30:00Z')).toMatchObject({ fire: true })                           // 11:30 Warsaw
    // summer: 11:00 Warsaw is 09:00 UTC (the cron's other hour)
    const s = await setup()
    await s.query(`insert into carousel_drafts (id, client_id, status, type, title, post_body, qa, created_at) values ($1, null, 'review', 'text', 'S', 'Summer post', $2, '2026-07-01T08:00:00Z')`, [id(1), JSON.stringify(PASS)])
    expect(await pick(s, '2026-07-02T10:00:00Z')).toMatchObject({ fire: false, why: 'not 11 in Warsaw' })  // 12:00 Warsaw
    expect(await pick(s, '2026-07-02T09:00:00Z')).toMatchObject({ fire: true, draft_id: id(1) })           // 11:00 Warsaw
  })

  it('writes no card and no notification when nothing is eligible', async () => {
    const db = await setup()
    await draft(db, { n: 1, status: 'approved' })
    await draft(db, { n: 2, type: 'carousel' })
    expect(await pick(db)).toMatchObject({ fire: false, why: 'nothing eligible' })
    expect(await cards(db)).toEqual([])
    expect(await calls(db)).toEqual([])
  })

  it('takes the best Poland draft first while the week has fewer than 2 Poland posts, then the newest', async () => {
    const db = await setup()
    await draft(db, { n: 1, daysAgo: 1 })                                                        // newest, business
    await draft(db, { n: 2, daysAgo: 20, label: 'X outlier by @a (900 likes vs own median 10)' })  // Poland, older than 14 days
    await draft(db, { n: 3, daysAgo: 5, label: 'X outlier by @b (40 likes vs own median 10)' })    // Poland, fresh, lift 4
    await draft(db, { n: 4, daysAgo: 6, label: 'X outlier by @c (1,200 likes vs own median 20)' }) // Poland, fresh, lift 60: the best
    await draft(db, { n: 5, daysAgo: 2 })                                                        // Poland read on an older body: not Poland now
    for (const n of [2, 3, 4]) await readPoland(db, n, true)
    await readPoland(db, 1, false)
    await db.query(`insert into content_poland_reads (draft_id, is_poland, why, model, body_md5) values ($1, true, 'old', 'test', md5('an older body'))`, [id(5)])
    // one Poland post already dated this week (Mon 9 Nov to Sun 15 Nov): still short of 2
    await draft(db, { n: 6, status: 'scheduled', scheduled: '2026-11-13T09:45:00Z' })
    await readPoland(db, 6, true)
    expect(await one<number>(db, `select public.content_card_week_poland($1::timestamptz) v`, [AT_11])).toBe(1)
    expect(await pick(db)).toMatchObject({ fire: true, draft_id: id(4), why: 'poland' })
  })

  it('takes the newest draft once the week already has 2 Poland posts (dated or published), and the brain vote counts only on the released body', async () => {
    const db = await setup()
    await draft(db, { n: 1, daysAgo: 1 })
    await draft(db, { n: 2, daysAgo: 4 })
    await readPoland(db, 2, true)
    await draft(db, { n: 6, status: 'scheduled', scheduled: '2026-11-13T09:45:00Z' })
    await draft(db, { n: 7, status: 'published', published: '2026-11-10T09:45:00Z' })
    await draft(db, { n: 8, status: 'scheduled', scheduled: '2026-11-16T09:45:00Z' })   // next week: not counted
    await readPoland(db, 7, true); await readPoland(db, 8, true)
    // n6 is a brain draft whose released body carries the brain check's Poland vote
    await db.query(`update carousel_drafts set taxonomy = '{"content_brain":{"checks":{"invention":{"majority":{"poland":true}}}}}' where id = $1`, [id(6)])
    await db.query(`insert into cb34_p2_members select id, 'ivan', 'released', '{"verdict":"PASS"}', encode(sha256(convert_to(post_body, 'UTF8')), 'hex') from carousel_drafts where id = $1`, [id(6)])
    expect(await one<number>(db, `select public.content_card_week_poland($1::timestamptz) v`, [AT_11])).toBe(2)
    expect(await pick(db)).toMatchObject({ fire: true, draft_id: id(1), why: 'newest' })
    // the same brain draft edited after release: its vote no longer counts
    const s = await setup()
    await draft(s, { n: 1, daysAgo: 1 }); await draft(s, { n: 2, daysAgo: 4 }); await readPoland(s, 2, true)
    await draft(s, { n: 6, status: 'scheduled', scheduled: '2026-11-13T09:45:00Z', tax: { content_brain: { checks: { invention: { majority: { poland: true } } } } } })
    await s.query(`insert into cb34_p2_members values ($1, 'ivan', 'released', '{"verdict":"PASS"}', 'the released body hash')`, [id(6)])
    await draft(s, { n: 7, status: 'published', published: '2026-11-10T09:45:00Z' }); await readPoland(s, 7, true)
    expect(await one<number>(s, `select public.content_card_week_poland($1::timestamptz) v`, [AT_11])).toBe(1)
    expect(await pick(s)).toMatchObject({ fire: true, draft_id: id(2), why: 'poland' })
  })

  it('expires an earlier day’s card still shown, and never cards the same draft twice', async () => {
    const db = await setup()
    await draft(db, { n: 1, daysAgo: 1 })
    await draft(db, { n: 2, daysAgo: 2 })
    expect(await pick(db, '2026-11-11T10:00:00Z')).toMatchObject({ fire: true, draft_id: id(1) })
    expect(await pick(db)).toMatchObject({ fire: true, draft_id: id(2) })
    expect(await cards(db)).toEqual([
      { day: '2026-11-11', draft_id: id(1), state: 'expired', why: 'newest' },
      { day: DAY, draft_id: id(2), state: 'shown', why: 'newest' },
    ])
  })

  it('sends a failed notification again in a later quarter, 3 tries at most, and never a delivered one', async () => {
    const db = await setup()
    await draft(db, { n: 1 })
    await pick(db)
    await db.exec(`insert into net._http_response values (1, 503)`)
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ fire: true })
    await db.exec(`insert into net._http_response values (2, null)`)
    expect(await pick(db, '2026-11-12T10:30:00Z')).toMatchObject({ fire: true })
    await db.exec(`insert into net._http_response values (3, 500)`)
    expect(await pick(db, '2026-11-12T10:45:00Z')).toMatchObject({ fire: false, why: 'already picked' })
    expect(await calls(db)).toHaveLength(3)
    const ok = await setup()
    await draft(ok, { n: 1 })
    await pick(ok)
    await ok.exec(`insert into net._http_response values (1, 200)`)
    expect(await pick(ok, '2026-11-12T10:15:00Z')).toMatchObject({ fire: false, why: 'already picked' })
    expect(await calls(ok)).toHaveLength(1)
  })

  it('never rings twice: a retry finds the row inbox-notify already wrote (even dismissed) and does not call again', async () => {
    const db = await setup()
    await draft(db, { n: 1 })
    await pick(db)
    // the post landed (the row exists) but its answer timed out; Ivan dismissed the bell row before the next run
    await db.exec(`insert into net._http_response values (1, null)`)
    await db.exec(`insert into inbox_notifications (dedupe_key, dismissed_at) values ('content-card:${DAY}', now())`)
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ fire: false, why: 'already sent' })
    expect(await pick(db, '2026-11-12T10:30:00Z')).toMatchObject({ fire: false, why: 'already picked' })
    expect(await calls(db)).toHaveLength(1)
  })

  it('refuses a signed-in browser', async () => {
    const db = await setup()
    await db.exec(`set test.service = '0'`)
    await expect(pick(db)).rejects.toThrow(/service only/)
  })
})

describe('content_card_today, content_card_set, content_card_rebase', { timeout: 60_000 }, () => {
  type Today = { day: string; state: string; live: string; draft: { id: string; post_body: string; cb34_p2_member: boolean; qa_verdict: string } | null } | null
  const today = (db: PGlite) => one<Today>(db, `select public.content_card_today() v`)
  const set = (db: PGlite, state: string, draftN = 1, day: string | null = null) =>
    one<{ ok: boolean; state?: string; why?: string }>(db, `select public.content_card_set(coalesce($3::date, (now() at time zone 'Europe/Warsaw')::date), $1::uuid, $2) v`, [id(draftN), state, day])
  const rebase = (db: PGlite, body: string) => one<boolean>(db, `select public.content_card_rebase((now() at time zone 'Europe/Warsaw')::date, $1::uuid, $2) v`, [id(1), body])
  // A card for the real Warsaw today, made the way the pick makes it.
  async function carded() {
    const db = await setup()
    await db.query(`insert into carousel_drafts (id, client_id, status, type, title, post_body, qa) values ($1, null, 'review', 'text', 'T', 'Line one\n\nLine two', $2)`, [id(1), JSON.stringify(PASS)])
    await db.query(`insert into content_daily_cards (day, draft_id, body_sha256, why) select (now() at time zone 'Europe/Warsaw')::date, id, encode(sha256(convert_to(post_body, 'UTF8')), 'hex'), 'newest' from carousel_drafts where id = $1`, [id(1)])
    return db
  }

  it('reads today’s card with its draft; says plainly when it can no longer post', async () => {
    const db = await carded()
    expect(await today(db)).toMatchObject({ state: 'shown', live: 'ok', draft: { id: id(1), post_body: 'Line one\n\nLine two', cb34_p2_member: false, qa_verdict: 'PASS' } })
    await db.exec(`update carousel_drafts set post_body = 'Edited elsewhere'`)
    expect((await today(db))?.live).toBe('changed')
    await db.exec(`update carousel_drafts set status = 'approved'`)
    expect((await today(db))?.live).toBe('decided')
    await db.exec(`update carousel_drafts set status = 'archived'`)
    expect((await today(db))?.live).toBe('gone')
    await db.exec(`delete from content_daily_cards`)
    expect(await today(db)).toBeNull()
  })

  it('needs a signed-in user on Ivan’s lane', async () => {
    const db = await carded()
    await db.exec(`set test.uid = ''`)
    await expect(today(db)).rejects.toThrow(/unauthorized/)
    await db.exec(`set test.uid = '11111111-1111-1111-1111-111111111111'; set test.lane_ok = '0'`)
    await expect(set(db, 'skipped')).rejects.toThrow(/unauthorized/)
  })

  it('skip leaves the draft untouched and can be undone; posted is never written here', async () => {
    const db = await carded()
    expect(await set(db, 'skipped')).toMatchObject({ ok: true, state: 'skipped' })
    expect(await set(db, 'skipped')).toMatchObject({ ok: true, replayed: true })
    expect(await one<string>(db, `select status v from carousel_drafts`)).toBe('review')
    expect(await set(db, 'shown')).toMatchObject({ ok: true, state: 'shown' })
    expect(await set(db, 'skipped', 2)).toMatchObject({ ok: false, why: 'no such card' })
    await expect(set(db, 'posted')).rejects.toThrow(/bad state/)
    await expect(set(db, 'expired')).rejects.toThrow(/bad state/)
  })

  it('a fix from the card keeps it postable; a body that is not the stored one is refused', async () => {
    const db = await carded()
    await db.exec(`update carousel_drafts set post_body = 'Fixed text'`)
    expect((await today(db))?.live).toBe('changed')
    expect(await rebase(db, 'Not what is stored')).toBe(false)
    expect(await rebase(db, 'Fixed text')).toBe(true)
    expect((await today(db))?.live).toBe('ok')
  })
})

describe('the migration', { timeout: 60_000 }, () => {
  it('schedules one cron job, re-runs cleanly, and rolls back', async () => {
    const db = await setup()
    await db.exec(migration)
    expect((await db.query<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = 'content-daily-card'`)).rows)
      .toEqual([{ schedule: '*/15 9,10 * * *', command: 'select public.content_card_pick()' }])
    await db.exec(rollback)
    expect((await db.query(`select 1 from cron.job where jobname = 'content-daily-card'`)).rows).toEqual([])
    expect((await db.query(`select 1 from pg_tables where tablename = 'content_daily_cards'`)).rows).toEqual([])
    expect((await db.query(`select 1 from pg_proc where proname like 'content_card_%'`)).rows).toEqual([])
  })
})

describe('content_card_post: Post in one transaction', { timeout: 60_000 }, () => {
  const BODY = 'Line one\n\nLine two'
  async function carded(o: { client?: string | null; scheduled?: string | null; member?: string | null; qa?: object } = {}) {
    const db = await setup()
    await db.query(`insert into carousel_drafts (id, client_id, status, type, title, post_body, qa, scheduled_at) values ($1, $2, 'review', 'text', 'T', $3, $4, $5)`,
      [id(1), o.client ?? null, BODY, JSON.stringify(o.qa ?? PASS), o.scheduled ?? null])
    if (o.member) await db.query(`insert into cb34_p2_members values ($1, 'ivan', $2, '{"verdict":"PASS"}', null)`, [id(1), o.member])
    await db.query(`insert into content_daily_cards (day, draft_id, body_sha256, why) select (now() at time zone 'Europe/Warsaw')::date, id, encode(sha256(convert_to(post_body, 'UTF8')), 'hex'), 'newest' from carousel_drafts where id = $1`, [id(1)])
    return db
  }
  const shaOf = (db: PGlite, body: string) => one<string>(db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') v`, [body])
  const post = async (db: PGlite, o: { sha?: string; brain?: boolean; at?: string } = {}) =>
    one<{ ok: boolean; scheduled_at: string }>(db, `select public.content_card_post((now() at time zone 'Europe/Warsaw')::date, $1::uuid, $2, coalesce($3::timestamptz, now() + interval '2 days'), $4, 1200) v`,
      [id(1), o.sha ?? await shaOf(db, BODY), o.at ?? null, o.brain ?? false])
  const state = async (db: PGlite) => (await db.query<{ card: string; status: string; scheduled: boolean; verdicts: number }>(
    `select c.state card, d.status, d.scheduled_at is not null scheduled, (select count(*)::int from verdict_calls) verdicts from content_daily_cards c join carousel_drafts d on d.id = c.draft_id`)).rows[0]
  const untouched = { card: 'shown', status: 'review', scheduled: false, verdicts: 0 }

  it('happy path: approves (approveReviewDraft’s update), schedules (scheduleGuarded’s update), marks the card posted', async () => {
    const db = await carded()
    const r = await post(db)
    expect(r.ok).toBe(true)
    expect(r.scheduled_at).toBeTruthy()
    expect(await state(db)).toEqual({ card: 'posted', status: 'scheduled', scheduled: true, verdicts: 0 })
  })

  it('a brain draft approves through cb39_verdict_set keep, with the time to verdict', async () => {
    const db = await carded({ member: 'released' })
    await post(db, { brain: true })
    expect((await db.query(`select verdict, ms from verdict_calls`)).rows).toEqual([{ verdict: 'keep', ms: 1200 }])
    expect(await state(db)).toMatchObject({ card: 'posted', status: 'scheduled' })
  })

  it('refuses a body other than the one shown, also after another device fixed it and the card followed', async () => {
    const db = await carded()
    await expect(post(db, { sha: 'f'.repeat(64) })).rejects.toThrow('Not posted: the text changed.')
    expect(await state(db)).toEqual(untouched)
    await db.exec(`update carousel_drafts set post_body = 'Fixed'; update content_daily_cards set body_sha256 = encode(sha256(convert_to('Fixed', 'UTF8')), 'hex')`)
    await expect(post(db)).rejects.toThrow('Not posted: the text changed.')
    expect(await state(db)).toEqual(untouched)
  })

  it('refuses a skipped card, an already dated draft and a client seat draft, writing nothing', async () => {
    let db = await carded()
    await db.exec(`update content_daily_cards set state = 'skipped'`)
    await expect(post(db)).rejects.toThrow('Not posted: the card was skipped.')
    expect(await state(db)).toEqual({ ...untouched, card: 'skipped' })
    db = await carded({ scheduled: '2030-01-07T09:45:00Z' })
    await expect(post(db)).rejects.toThrow('Not posted: it was already decided in Review.')
    expect((await db.query(`select status, scheduled_at from carousel_drafts`)).rows[0]).toEqual({ status: 'review', scheduled_at: new Date('2030-01-07T09:45:00Z') })
    db = await carded({ client: 'risedtc' })
    await expect(post(db)).rejects.toThrow('Not posted: it was already decided in Review.')
    expect(await state(db)).toEqual(untouched)
  })

  it('refuses when QA or the brain release changed during the hold (send him to Review), and a time already past', async () => {
    for (const o of [{ qa: { verdict: 'FAIL' } }, { qa: { verdict: 'PASS', feedback: 'GATE: BLOCKED' } }, { member: 'staged' }]) {
      const db = await carded(o)
      await expect(post(db, { brain: !!o.member })).rejects.toThrow('Not posted: it needs a look in Review.')
      expect(await state(db)).toEqual(untouched)
    }
    const db = await carded()
    await expect(post(db, { at: '2026-01-01T09:45:00Z' })).rejects.toThrow(/already passed/)
    expect(await state(db)).toEqual(untouched)
  })

  it('two taps: the first posts, the second is told the card was already used', async () => {
    const db = await carded()
    await post(db)
    await expect(post(db)).rejects.toThrow('Not posted: the card was already used.')
    expect(await state(db)).toMatchObject({ card: 'posted', status: 'scheduled' })
  })

  it('needs a signed-in user on Ivan’s lane', async () => {
    const db = await carded()
    await db.exec(`set test.lane_ok = '0'`)
    await expect(post(db)).rejects.toThrow(/unauthorized/)
  })
})
