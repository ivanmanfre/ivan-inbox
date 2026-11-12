import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

// db/20261112b_content_card_question on top of db/20261112_content_daily_card, against the same stand-in schema as
// contentDailyCard.pglite.test.ts. net.http_post records each call with its url, so "one ask" is counted, never assumed;
// net._http_response is filled by hand to play pg_net's answers.
const poland = readFileSync('db/299p_content_poland_read.sql', 'utf8') + '\n' + readFileSync('db/299q_content_poland_read_sol_r1.sql', 'utf8')
const card = readFileSync('db/20261112_content_daily_card.sql', 'utf8')
const migration = readFileSync('db/20261112b_content_card_question.sql', 'utf8')
const rollback = readFileSync('db/20261112b_content_card_question_rollback.sql', 'utf8')
const prompts = readFileSync('db/20261112b_content_card_question_prompt.sql', 'utf8')
const promptsRollback = readFileSync('db/20261112b_content_card_question_prompt_rollback.sql', 'utf8')

const ASK_URL = 'https://example.test/functions/v1/content-card-ask'
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
create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create table net._http_response (id bigint primary key, status_code int);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language plpgsql as $$
declare v bigint;
begin
  if url like '%content-card-ask%' and current_setting('test.ask_breaks', true) = '1' then raise exception 'pg_net is down'; end if;
  insert into net.calls(url, body, headers) values (url, body, headers) returning id into v;
  return v;
end $$;
create table public.integration_config (key text primary key, value text);
insert into public.integration_config values ('inbox_notify_url', 'https://example.test/inbox-notify'), ('inbox_push_secret', 's'), ('content_card_ask_url', '${ASK_URL}');
create table public.carousel_drafts (
  id uuid primary key, client_id text, status text not null, type text, title text, post_body text, qa jsonb, taxonomy jsonb,
  source_label text, source_detail jsonb, image_urls jsonb, video_url text, scheduled_at timestamptz, published_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.cb34_p2_members (draft_id uuid primary key, client_id text, state text, validation jsonb, body_sha256 text);
create table public.inbox_notifications (id bigserial primary key, dedupe_key text, dismissed_at timestamptz);
create table public.verdict_calls (draft_id uuid, verdict text, ms int);
create function public.cb39_verdict_set(p_draft uuid, p_verdict text, p_reasons text[] default '{}', p_note text default null, p_invocation uuid default null, p_ms_to_verdict int default null)
returns jsonb language plpgsql as $$ begin
  insert into verdict_calls values (p_draft, p_verdict, p_ms_to_verdict);
  update carousel_drafts set status = 'approved' where id = p_draft and client_id is null;
  return jsonb_build_object('draft_id', p_draft, 'verdict', p_verdict);
end $$;
create table public.content_prompts (id bigserial primary key, slug text, title text, body text, kind text, category text, scope text,
  updated_by text, is_active boolean default true, version int default 1, updated_at timestamptz default now());
`

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const AT_11 = '2026-11-12T10:00:00Z'
const DAY = '2026-11-12'
const PASS = { verdict: 'PASS', score: 84 }
const BODY = 'Most expert posts only reach your followers.\n\nI told a client exactly that.\n\nReach comes from strangers.'
const ANCHOR = 'I told a client exactly that.'

async function setup() {
  const db = new PGlite()
  await db.exec(schema)
  await db.exec(poland)
  await db.exec(card)
  await db.exec(migration)
  await db.exec(`set test.uid = '11111111-1111-1111-1111-111111111111'`)
  return db
}
const one = async <T,>(db: PGlite, sql: string, p: unknown[] = []) => (await db.query<{ v: T }>(sql, p)).rows[0].v
async function draft(db: PGlite, n: number, o: { body?: string; status?: string; client?: string | null; qa?: object; tax?: object; detail?: object; label?: string } = {}) {
  await db.query(`insert into carousel_drafts (id, client_id, status, type, title, post_body, qa, taxonomy, source_detail, source_label, created_at)
    values ($1, $2, $3, 'text', 'T', $4, $5, $6, $7, $8, $9::timestamptz - interval '1 day')`,
  [id(n), o.client ?? null, o.status ?? 'review', o.body ?? BODY, JSON.stringify(o.qa ?? PASS), o.tax ? JSON.stringify(o.tax) : null,
    o.detail ? JSON.stringify(o.detail) : null, o.label ?? null, AT_11])
}
const pick = (db: PGlite, at = AT_11) => one<Record<string, unknown>>(db, `select public.content_card_pick($1::timestamptz) v`, [at])
const askCalls = async (db: PGlite) => (await db.query<{ id: number; body: Record<string, unknown>; headers: Record<string, unknown> }>(`select id::int, body, headers from net.calls where url = $1 order by id`, [ASK_URL])).rows
const allCalls = async (db: PGlite) => (await db.query<{ url: string }>(`select url from net.calls order by id`)).rows.map(r => r.url)
const row = async (db: PGlite) => (await db.query<Record<string, unknown>>(`select * from content_daily_cards order by day desc limit 1`)).rows[0]
const answerFor = (db: PGlite, reqId: number, status: number | null) => db.query(`insert into net._http_response values ($1, $2)`, [reqId, status])
const shaOf = (db: PGlite, body: string) => one<string>(db, `select public.content_card_sha($1) v`, [body])
const save = async (db: PGlite, result: object, o: { day?: string; sha?: string; n?: number } = {}) =>
  one<{ ok: boolean; why?: string; state?: string }>(db, `select public.content_card_ask_save($1::date, $2::uuid, $3, $4::jsonb) v`,
    [o.day ?? DAY, id(o.n ?? 1), o.sha ?? await shaOf(db, BODY), JSON.stringify(result)])
const asked = { state: 'asked', question: 'You told the client that. What did they say back?', anchor: ANCHOR, kind: 'own_words', why: 'No reply given.' }

describe('content_card_pick queues the ask', { timeout: 60_000 }, () => {
  it('one ask per card, after the notification, with the day and the draft and the push secret; later quarters wait for it', async () => {
    const db = await setup()
    await draft(db, 1)
    const r = await pick(db)
    expect(r).toMatchObject({ fire: true, draft_id: id(1), ask: 'queued', attempt: 1 })
    expect(await allCalls(db)).toEqual(['https://example.test/inbox-notify', ASK_URL])
    const [a] = await askCalls(db)
    expect(a.body).toEqual({ day: DAY, draft_id: id(1) })
    expect(a.headers).toMatchObject({ 'x-inbox-secret': 's' })
    expect(await row(db)).toMatchObject({ ask_state: 'queued', ask_attempts: 1, ask_request_id: a.id })
    // still running (no pg_net answer yet), and a quick second run: nothing new
    expect(await pick(db, '2026-11-12T10:01:00Z')).toMatchObject({ why: 'already picked', ask: 'waiting' })
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ why: 'already picked', ask: 'waiting' })
    expect(await askCalls(db)).toHaveLength(1)
    // the function stored its question: done for the day
    await answerFor(db, a.id, 200)
    expect(await save(db, asked)).toEqual({ ok: true, state: 'asked' })
    expect(await pick(db, '2026-11-12T10:30:00Z')).toMatchObject({ ask: 'asked' })
    expect(await askCalls(db)).toHaveLength(1)
    // outside the 11:00 hour: no ask at all
    expect(await pick(db, '2026-11-12T11:00:00Z')).toEqual({ fire: false, why: 'not 11 in Warsaw', expired: 0 })
  })

  it('a failed ask is retried at most twice within the hour: pg_net errors, timeouts and failures the function recorded', async () => {
    const db = await setup()
    await draft(db, 1)
    await pick(db)
    let calls = await askCalls(db)
    await answerFor(db, calls[0].id, 500)                                       // the function crashed
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ ask: 'queued', attempt: 2 })
    calls = await askCalls(db)
    await answerFor(db, calls[1].id, 200)
    expect(await save(db, { state: 'failed', error: 'http_503' })).toEqual({ ok: true, state: 'failed' })  // proxy down, recorded
    expect(await row(db)).toMatchObject({ ask_state: 'failed', ask_error: 'http_503' })
    expect(await pick(db, '2026-11-12T10:30:00Z')).toMatchObject({ ask: 'queued', attempt: 3 })
    calls = await askCalls(db)
    await answerFor(db, calls[2].id, null)                                      // timed out
    expect(await pick(db, '2026-11-12T10:45:00Z')).toMatchObject({ ask: 'gave up' })
    expect(await askCalls(db)).toHaveLength(3)
    expect(await row(db)).toMatchObject({ ask_attempts: 3, state: 'shown' })
    // the notification went out once and the card is untouched by all of it
    expect((await allCalls(db)).filter(u => u.includes('inbox-notify'))).toHaveLength(1)
  })

  it('a 2xx answer that stored nothing (nothing to ask about) is not retried', async () => {
    const db = await setup()
    await draft(db, 1)
    await pick(db)
    await answerFor(db, (await askCalls(db))[0].id, 200)
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ ask: 'settled' })
    expect(await askCalls(db)).toHaveLength(1)
  })

  it('never blocks the card: no URL = no ask, a broken pg_net = the card and its notification still go out', async () => {
    let db = await setup()
    await db.exec(`delete from integration_config where key = 'content_card_ask_url'`)
    await draft(db, 1)
    expect(await pick(db)).toMatchObject({ fire: true, ask: 'not configured' })
    expect(await allCalls(db)).toEqual(['https://example.test/inbox-notify'])
    expect(await row(db)).toMatchObject({ ask_state: null, ask_attempts: 0 })

    db = await setup()
    await db.exec(`set test.ask_breaks = '1'`)
    await draft(db, 1)
    expect(await pick(db)).toMatchObject({ fire: true, draft_id: id(1), ask: 'error' })
    expect(await allCalls(db)).toEqual(['https://example.test/inbox-notify'])
    // the ask's own writes rolled back with its block: no attempt counted
    expect(await row(db)).toMatchObject({ state: 'shown', ask_state: null, ask_attempts: 0, notify_attempts: 1 })
    await db.exec(`set test.ask_breaks = '0'`)
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ why: 'already picked', ask: 'queued', attempt: 1 })
  })

  it('a notification retry does not ask twice', async () => {
    const db = await setup()
    await draft(db, 1)
    await pick(db)
    const notifyId = (await db.query<{ id: number }>(`select id::int from net.calls where url like '%inbox-notify%'`)).rows[0].id
    await answerFor(db, notifyId, 503)
    expect(await pick(db, '2026-11-12T10:15:00Z')).toMatchObject({ fire: true, ask: 'waiting' })
    expect(await askCalls(db)).toHaveLength(1)
  })
})

describe('content_card_ask_input and content_card_ask_save', { timeout: 60_000 }, () => {
  it('dry: any of Ivan’s own drafts in review, no card needed; never a client draft or one out of review', async () => {
    const db = await setup()
    await draft(db, 1, { tax: { source: 'x_tracked_outlier' }, label: 'X outlier by @kevin', qa: { verdict: 'PASS', line_flags: { lines: [
      { text: ANCHOR, kind: 'personal' }, { text: 'Not in the body', kind: 'personal' }, { text: 'Reach comes from strangers.', kind: 'dated' }] } } })
    await draft(db, 2, { client: 'risedtc' })
    await draft(db, 3, { status: 'approved' })
    await draft(db, 4, { tax: { source: 'take_screenshot' } })
    const input = (n: number, dry: boolean, day: string | null = null) => one<Record<string, unknown>>(db, `select public.content_card_ask_input($1::date, $2::uuid, $3) v`, [day, id(n), dry])
    expect(await input(1, true)).toEqual({ ok: true, body: BODY, sha: await shaOf(db, BODY), source: 'x_copy', source_label: 'X outlier by @kevin', hints: [ANCHOR] })
    expect(await input(4, true)).toMatchObject({ ok: true, source: 'take', hints: [] })
    expect(await input(2, true)).toEqual({ ok: false, why: 'not an own draft' })
    expect(await input(3, true)).toEqual({ ok: false, why: 'not in review' })
    // not dry: the day's shown card only
    expect(await input(1, false, DAY)).toEqual({ ok: false, why: 'not a shown card' })
    await pick(db)
    expect(await input(1, false, DAY)).toMatchObject({ ok: true })
    await db.exec(`update carousel_drafts set post_body = 'Edited' where id = '${id(1)}'`)
    expect(await input(1, false, DAY)).toEqual({ ok: false, why: 'text changed' })
    await db.exec(`set test.service = '0'`)
    await expect(input(1, true)).rejects.toThrow(/service only/)
  })

  it('stores the first result only, on the body it was asked about; a question whose anchor is not in the text is stored as failed', async () => {
    const db = await setup()
    await draft(db, 1)
    await pick(db)
    expect(await save(db, asked, { sha: 'f'.repeat(64) })).toEqual({ ok: false, why: 'text changed' })
    expect(await save(db, { ...asked, anchor: 'Not in the text.' })).toEqual({ ok: true, state: 'failed' })
    expect(await row(db)).toMatchObject({ ask_state: 'failed', question: null })
    expect(await save(db, { ...asked, kind: 'own_story' })).toEqual({ ok: true, state: 'failed' })
    expect(await save(db, asked)).toEqual({ ok: true, state: 'asked' })
    expect(await row(db)).toMatchObject({ ask_state: 'asked', question: asked.question, question_anchor: ANCHOR, question_kind: 'own_words', question_sha256: await shaOf(db, BODY) })
    // a late second call never overwrites it
    expect(await save(db, { state: 'none', why: 'x' })).toEqual({ ok: false, why: 'already asked' })
    expect(await save(db, { state: 'failed', error: 'late' })).toEqual({ ok: false, why: 'already asked' })
    await expect(save(db, { state: 'weird' }, { day: '2026-11-13' })).resolves.toEqual({ ok: false, why: 'not a shown card' })
  })

  it('"none": the post already has his detail, no question', async () => {
    const db = await setup()
    await draft(db, 1)
    await pick(db)
    expect(await save(db, { state: 'none', why: 'He names the call.' })).toEqual({ ok: true, state: 'none' })
    expect(await row(db)).toMatchObject({ ask_state: 'none', question: null, question_why: 'He names the call.' })
  })
})

describe('content_card_today, content_card_answer, content_card_weave_input', { timeout: 60_000 }, () => {
  type Q = { text: string; anchor: string; kind: string; sha: string; answer: string | null } | null
  const today = (db: PGlite) => one<{ live: string; question: Q }>(db, `select public.content_card_today() v`)
  const TODAY = `(now() at time zone 'Europe/Warsaw')::date`
  async function carded(withQuestion = true) {
    const db = await setup()
    await draft(db, 1)
    await db.query(`insert into content_daily_cards (day, draft_id, body_sha256, why) select ${TODAY}, id, public.content_card_sha(post_body), 'newest' from carousel_drafts where id = $1`, [id(1)])
    if (withQuestion) {
      const day = await one<string>(db, `select ${TODAY}::text v`)
      expect(await save(db, asked, { day })).toEqual({ ok: true, state: 'asked' })
    }
    return db
  }
  const answer = (db: PGlite, text: string, saved = false) => one<boolean>(db, `select public.content_card_answer(${TODAY}, $1::uuid, $2, $3) v`, [id(1), text, saved])
  const weaveInput = async (db: PGlite, sha?: string) => one<Record<string, unknown>>(db, `select public.content_card_weave_input(${TODAY}, $1::uuid, $2) v`, [id(1), sha ?? await shaOf(db, BODY)])

  it('the question shows only while it was asked on the current text', async () => {
    const db = await carded()
    const sha = await shaOf(db, BODY)
    expect((await today(db)).question).toEqual({ text: asked.question, anchor: ANCHOR, kind: 'own_words', sha, answer: null })
    // he fixed the text from the card (the card follows it): the question was about the old text, so it hides
    await db.exec(`update carousel_drafts set post_body = 'New text'`)
    expect(await one<boolean>(db, `select public.content_card_rebase(${TODAY}, $1::uuid, 'New text') v`, [id(1)])).toBe(true)
    const t = await today(db)
    expect(t.live).toBe('ok')
    expect(t.question).toBeNull()
    // and back to the exact text it was asked on: it shows again
    await db.exec(`update carousel_drafts set post_body = '${BODY.replace(/'/g, "''")}'`)
    await one<boolean>(db, `select public.content_card_rebase(${TODAY}, $1::uuid, $2) v`, [id(1), BODY])
    expect((await today(db)).question?.text).toBe(asked.question)
  })

  it('no question for a card without one, nor for a skipped card', async () => {
    let db = await carded(false)
    expect((await today(db)).question).toBeNull()
    db = await carded()
    await db.exec(`update content_daily_cards set state = 'skipped'`)
    expect((await today(db)).question).toBeNull()
  })

  it('his answer is kept (even if he cancels the edit) and the question is answered once he saves', async () => {
    const db = await carded()
    expect(await answer(db, '  He said "so who do we write for then?"  ')).toBe(true)
    expect(await row(db)).toMatchObject({ answer: 'He said "so who do we write for then?"', ask_state: 'asked' })
    expect((await row(db)).answered_at).toBeTruthy()
    expect((await today(db)).question?.answer).toBe('He said "so who do we write for then?"')
    expect(await answer(db, 'He said who do we write for', true)).toBe(true)
    expect(await row(db)).toMatchObject({ answer: 'He said who do we write for', ask_state: 'answered' })
    expect((await today(db)).question).toBeNull()
    await expect(answer(db, '   ')).rejects.toThrow(/bad answer/)
    await expect(answer(db, 'x'.repeat(2001))).rejects.toThrow(/bad answer/)
  })

  it('no answer for a card without a question; needs a signed-in user on Ivan’s lane', async () => {
    const db = await carded(false)
    expect(await answer(db, 'Something')).toBe(false)
    await db.exec(`set test.lane_ok = '0'`)
    await expect(answer(db, 'Something')).rejects.toThrow(/unauthorized/)
    await db.exec(`set test.lane_ok = '1'; set test.uid = ''`)
    await expect(answer(db, 'Something')).rejects.toThrow(/unauthorized/)
  })

  it('the weave reads only today’s shown card with a live question on the same text', async () => {
    const db = await carded()
    expect(await weaveInput(db)).toEqual({ ok: true, body: BODY, question: asked.question, anchor: ANCHOR, kind: 'own_words', source: 'own', source_label: null })
    expect(await weaveInput(db, 'f'.repeat(64))).toEqual({ ok: false, why: 'text changed' })
    await db.exec(`update carousel_drafts set post_body = 'Edited'`)
    expect(await weaveInput(db)).toEqual({ ok: false, why: 'text changed' })
    await db.exec(`update carousel_drafts set post_body = '${BODY.replace(/'/g, "''")}', status = 'approved'`)
    expect(await weaveInput(db)).toEqual({ ok: false, why: 'not in review' })
    const n = await carded(false)
    expect(await weaveInput(n)).toEqual({ ok: false, why: 'no question' })
    await n.exec(`set test.service = '0'`)
    await expect(weaveInput(n)).rejects.toThrow(/service only/)
  })
})

describe('the migrations', { timeout: 60_000 }, () => {
  it('re-run cleanly; the rollback drops every column and function it added and puts the old pick and today back', async () => {
    const db = await setup()
    await db.exec(migration)
    await db.exec(rollback)
    const cols = (await db.query<{ c: string }>(`select column_name c from information_schema.columns where table_name = 'content_daily_cards' order by ordinal_position`)).rows.map(r => r.c)
    expect(cols).toEqual(['day', 'draft_id', 'body_sha256', 'why', 'state', 'picked_at', 'resolved_at', 'notified_at', 'request_id', 'notify_attempts', 'payload'])
    const fns = (await db.query<{ p: string }>(`select proname p from pg_proc where proname like 'content_card_%' order by proname`)).rows.map(r => r.p)
    expect(fns).toEqual(['content_card_candidates', 'content_card_jstrim', 'content_card_payload', 'content_card_pick', 'content_card_poland',
      'content_card_post', 'content_card_rebase', 'content_card_set', 'content_card_sha', 'content_card_tax', 'content_card_today', 'content_card_week_poland'])
    // the old pick: one card, one notification, no ask; the old today: no question field
    await draft(db, 1)
    const r = await pick(db)
    expect(r).toMatchObject({ fire: true })
    expect(r).not.toHaveProperty('ask')
    expect(await allCalls(db)).toEqual(['https://example.test/inbox-notify'])
    await db.exec(`update content_daily_cards set day = (now() at time zone 'Europe/Warsaw')::date`)
    expect(await one<object>(db, `select public.content_card_today() v`)).not.toHaveProperty('question')
    // and forward again
    await db.exec(migration)
    expect(await one<object>(db, `select public.content_card_today() v`)).toHaveProperty('question', null)
  })

  it('the prompt rows: inserted once on client:ivan, re-run safe, switched off by their rollback', async () => {
    const db = await setup()
    await db.exec(prompts)
    await db.exec(prompts)
    const rows = async () => (await db.query<{ slug: string; scope: string; is_active: boolean; kind: string; category: string }>(`select slug, scope, is_active, kind, category from content_prompts order by slug`)).rows
    expect(await rows()).toEqual([
      { slug: 'ivan-card-question', scope: 'client:ivan', is_active: true, kind: 'prompt', category: 'Post pipeline' },
      { slug: 'ivan-card-weave', scope: 'client:ivan', is_active: true, kind: 'prompt', category: 'Post pipeline' },
    ])
    const body = await one<string>(db, `select body v from content_prompts where slug = 'ivan-card-question'`)
    for (const ph of ['{{SOURCE}}', '{{HINTS}}', '{{DRAFT}}']) expect(body).toContain(ph)
    const weave = await one<string>(db, `select body v from content_prompts where slug = 'ivan-card-weave'`)
    for (const ph of ['{{SOURCE}}', '{{QUESTION}}', '{{ANCHOR}}', '{{ANSWER}}', '{{DRAFT}}']) expect(weave).toContain(ph)
    await db.exec(promptsRollback)
    expect((await rows()).map(r => r.is_active)).toEqual([false, false])
  })
})
