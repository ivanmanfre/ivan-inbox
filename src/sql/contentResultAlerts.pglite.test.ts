import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

// db/20261112c_content_result_alerts against a stand-in schema (the live columns these functions read, nothing more).
// cron.schedule and net.http_post are stand-ins: net.http_post records each call, so "one notification" is counted,
// never assumed. The boost view is the live definition.
const migration = readFileSync('db/20261112c_content_result_alerts.sql', 'utf8')
const rollback = readFileSync('db/20261112c_content_result_alerts_rollback.sql', 'utf8')
// The live LinkedIn identity helpers (db/057 _urldecode, db/059 li_member_id / li_member_key / li_slug, as applied).
const db057 = readFileSync('db/057_signal_orbit_identity.sql', 'utf8')
const db059 = readFileSync('db/059_signal_orbit_slug_fix.sql', 'utf8')
const identity = db057.slice(db057.indexOf('create or replace function public._urldecode'), db057.indexOf('create or replace function public.li_member_id'))
  + db059.slice(db059.indexOf('create or replace function public.li_member_id'), db059.indexOf('reindex index public.contacts_li_slug_idx'))

const schema = `
create role anon; create role authenticated; create role service_role;
create schema net; create schema cron;
create function public.content_plan_service_ok() returns boolean language sql stable as $$ select coalesce(current_setting('test.service', true), '1') = '1' $$;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, c) returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create table net.calls (id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language sql as $$
  insert into net.calls(url, headers, body) values (url, headers, body) returning id $$;
create table public.integration_config (key text primary key, value text);
insert into public.integration_config values ('inbox_notify_url', 'https://example.test/inbox-notify'), ('inbox_push_secret', 's'),
  ('unipile_linkedin_id', 'ACoIVAN');
create table public.own_posts (id uuid primary key default gen_random_uuid(), post_text text, post_type text, posted_at timestamptz,
  num_impressions int, num_likes int, num_comments int, social_id text, linkedin_url text, metrics_updated_at timestamptz);
create table public.own_post_boost_marks (mark_id bigserial primary key, client_id text, post_ref text, boosted boolean,
  marked_by text, marked_at timestamptz default now(), post_ref_input text);
create view public.own_post_boost_current_v as
  select distinct on (client_id, post_ref) client_id, post_ref, boosted, marked_by, marked_at, mark_id
    from own_post_boost_marks m order by client_id, post_ref, marked_at desc, mark_id desc;
create table public.post_engagers (id uuid primary key default gen_random_uuid(), post_social_id text, provider_id text, member_id text,
  name text, headline text, linkedin_url text, engagement_type text, comment_text text, reaction_type text, icp_score numeric,
  scored_at timestamptz, first_seen_at timestamptz default now(), last_seen_at timestamptz default now(), prospect_id uuid);
create table public.outreach_campaigns (id uuid primary key, client_id text);
insert into public.outreach_campaigns values ('00000000-0000-4000-8000-00000000c001', null), ('00000000-0000-4000-8000-00000000c002', 'ivan'),
  ('00000000-0000-4000-8000-00000000c003', 'risedtc');
create table public.outreach_prospects (id uuid primary key, campaign_id uuid default '00000000-0000-4000-8000-00000000c001', linkedin_url text,
  linkedin_profile_id text, name text, stage text, blacklisted boolean default false,
  call_booked_at timestamptz, skip_state text, skip_reason text, next_touch_after timestamptz, enrichment_data jsonb, solved_at timestamptz,
  needs_manual_reply boolean);
create table public.outreach_messages (id uuid primary key default gen_random_uuid(), prospect_id uuid, direction text, message_type text,
  sent_at timestamptz, created_at timestamptz default now(), reply_intent text, discard_mode text, email_sequence_stopped_at timestamptz,
  email_sequence_stopped_reason text, is_reaction boolean);
create table public.outreach_agent_threads (id uuid primary key default gen_random_uuid(), prospect_id uuid, state text, closed_at timestamptz);
create table public.inbox_notifications (id bigserial primary key, dedupe_key text, dismissed_at timestamptz);
`

const NOW = '2026-11-12T15:10:00Z'
const DAY = '2026-11-12'
const at = (daysAgo: number, from = NOW) => new Date(Date.parse(from) - daysAgo * 86400000).toISOString()
const RISE_CAMPAIGN = '00000000-0000-4000-8000-00000000c003'
const IVAN_LITERAL_CAMPAIGN = '00000000-0000-4000-8000-00000000c002'
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const nid = (n: number) => String(7500000000000000000n + BigInt(n))

async function setup() {
  const db = new PGlite()
  await db.exec(schema)
  await db.exec(identity)
  await db.exec(migration)
  return db
}
type Post = { n: number; daysAgo: number; imp: number; text?: string; sid?: string; url?: string | null; measured?: boolean }
async function post(db: PGlite, p: Post) {
  await db.query(`insert into own_posts (post_text, posted_at, num_impressions, social_id, linkedin_url, metrics_updated_at) values ($1, $2, $3, $4, $5, $6)`,
    [p.text ?? `Post ${p.n} first line\n\nPost ${p.n} body.`, at(p.daysAgo), p.imp, p.sid ?? `urn:li:activity:${nid(p.n)}`,
      p.url === undefined ? `https://www.linkedin.com/posts/ivan_post-${p.n}-activity-${p.sid ? p.sid.replace(/^.*:/, '') : nid(p.n)}-abcd` : p.url,
      p.measured === false ? null : NOW])
}
/** 12 measured organic posts, 4 to 40 days old, 100 impressions each: a median of 100. */
async function baseline(db: PGlite, n = 12, imp = 100) {
  for (let i = 0; i < n; i++) await post(db, { n: 100 + i, daysAgo: 4 + i * 3, imp })
}
const one = async <T,>(db: PGlite, sql: string, p: unknown[] = []) => (await db.query<{ v: T }>(sql, p)).rows[0].v
type Run = { off?: boolean; posts: { fired: boolean; why?: string; error?: string; post_key?: string; retried?: number }; people: { sent: { title: string }[]; retried?: number; error?: string } }
const run = (db: PGlite, when = NOW) => one<Run>(db, `select public.content_result_alerts_run($1::timestamptz) v`, [when])
const calls = async (db: PGlite) => (await db.query<{ body: Record<string, unknown>; headers: Record<string, string>; url: string }>(`select url, headers, body from net.calls order by id`)).rows
const calledFamily = async (db: PGlite, family: string) => (await calls(db)).filter(c => c.body.family === family).map(c => c.body)

describe('a post took off (content_result)', { timeout: 60_000 }, () => {
  it('fires at 5 times the median of the posts 3 to 63 days old, not below, with a clean figure and plain words', async () => {
    const db = await setup()
    await baseline(db)
    await post(db, { n: 1, daysAgo: 1, imp: 499, text: 'Almost there.' })   // 4.99x
    expect((await run(db)).posts).toMatchObject({ fired: false, why: 'none took off' })
    const s = await setup()
    await baseline(s)
    await post(s, { n: 1, daysAgo: 1, imp: 1654, text: 'Do people even speak English in Poland — really?\n\nSecond line.' })
    expect((await run(s)).posts).toMatchObject({ fired: true, post_key: nid(1) })
    const sent = await calledFamily(s, 'content_result')
    expect(sent).toEqual([{
      family: 'content_result', source: 'content-result-alerts', dedupe_key: `content-result:${nid(1)}`, group_key: `content-result:${nid(1)}`,
      severity: 'info', title: 'Your post passed 1,650 views', body: 'Do people even speak English in Poland, really? 16 times your usual 100.',
      url: './#exp/d/content/results?lane=ivan', push: true,
      media: { kind: 'content_result', post_key: nid(1), social_id: `urn:li:activity:${nid(1)}`, impressions: 1654, median: 100, baseline_posts: 12,
        multiple: 16, posted_at: expect.any(String), linkedin_url: expect.stringMatching(/^https:\/\/www\.linkedin\.com\//) },
    }])
    expect(JSON.stringify(sent)).not.toContain('—')
    expect((await calls(s))[0]).toMatchObject({ url: 'https://example.test/inbox-notify', headers: { 'x-inbox-secret': 's' } })
    expect(await one<number>(s, `select count(*)::int v from content_result_alerts where alert_day = $1`, [DAY])).toBe(1)
  })

  it('needs at least 10 baseline posts', async () => {
    const db = await setup()
    await baseline(db, 9)
    await post(db, { n: 1, daysAgo: 1, imp: 5000 })
    expect((await run(db)).posts).toMatchObject({ fired: false, why: 'none took off' })
    await post(db, { n: 120, daysAgo: 50, imp: 100 })            // a 10th post
    expect(await one<number>(db, `select baseline_posts v from content_result_candidates($1::timestamptz)`, [NOW])).toBe(10)
    expect((await run(db)).posts).toMatchObject({ fired: true, post_key: nid(1) })
  })

  it('leaves boosted, dead twin and unmeasured posts out of both the candidate and the baseline, and counts a post under two ids once', async () => {
    const db = await setup()
    await baseline(db, 10, 100)
    // Baseline noise that must not count: a boosted 10,000 (paid), a dead twin, two unmeasured rows. Were any of them
    // counted, the baseline would reach 11+ posts and its median would move.
    await post(db, { n: 50, daysAgo: 10, imp: 10000 })
    await db.query(`insert into own_post_boost_marks (client_id, post_ref, boosted) values ('ivan', $1, true)`, [`urn:li:activity:${nid(50)}`])
    await post(db, { n: 51, daysAgo: 11, imp: 9000, url: `unipile-${nid(51)}` })
    await post(db, { n: 52, daysAgo: 12, imp: 0 })
    await post(db, { n: 53, daysAgo: 13, imp: 8000, measured: false })
    // One post stored twice: ugcPost id X (its share URL carries activity id Y) and activity id Y.
    await post(db, { n: 54, daysAgo: 14, imp: 100, sid: `urn:li:ugcPost:${nid(54)}`, url: `https://www.linkedin.com/posts/x-activity-${nid(55)}-a` })
    await post(db, { n: 55, daysAgo: 14, imp: 100 })
    const base = await db.query<{ n: number; med: number }>(`select count(*)::int n, (percentile_cont(0.5) within group (order by impressions))::float8 med from content_alert_posts() where posted_at <= $1::timestamptz - interval '3 days'`, [NOW])
    expect(base.rows[0]).toEqual({ n: 11, med: 100 })
    // Candidates: a boosted one (marked by its share-URL id, prefixed), a dead twin, an unmeasured one: none fires.
    await post(db, { n: 1, daysAgo: 1, imp: 4000, sid: `urn:li:ugcPost:${nid(1)}`, url: `https://www.linkedin.com/posts/x-activity-${nid(2)}-a` })
    await db.query(`insert into own_post_boost_marks (client_id, post_ref, boosted) values ('ivan', $1, true)`, [`urn:li:activity:${nid(2)}`])
    await post(db, { n: 3, daysAgo: 1, imp: 4000, url: `unipile-${nid(3)}` })
    await post(db, { n: 4, daysAgo: 1, imp: 4000, measured: false })
    expect((await run(db)).posts).toMatchObject({ fired: false, why: 'none took off' })
    // A boost mark later set to false (the newest mark wins) makes the post organic again.
    await db.query(`insert into own_post_boost_marks (client_id, post_ref, boosted, marked_at) values ('ivan', $1, false, now() + interval '1 minute')`, [`urn:li:activity:${nid(2)}`])
    expect((await run(db, '2026-11-13T15:10:00Z')).posts).toMatchObject({ fired: true, post_key: nid(2) })
  })

  it('rings once per post ever and at most once a day: the biggest first, the next one the day after', async () => {
    const db = await setup()
    await baseline(db)
    await post(db, { n: 1, daysAgo: 1, imp: 900 })
    await post(db, { n: 2, daysAgo: 2, imp: 2000 })
    // every call lands (inbox-notify writes its feed row), so nothing is sent again
    const landed = () => db.exec(`insert into inbox_notifications (dedupe_key) select body ->> 'dedupe_key' from net.calls c where not exists (select 1 from inbox_notifications n where n.dedupe_key = c.body ->> 'dedupe_key')`)
    expect((await run(db)).posts).toMatchObject({ fired: true, post_key: nid(2) })
    await landed()
    expect((await run(db, '2026-11-12T18:00:00Z')).posts).toMatchObject({ fired: false, why: 'one already today' })
    expect((await run(db, '2026-11-13T15:10:00Z')).posts).toMatchObject({ fired: true, post_key: nid(1) })
    await landed()
    expect((await run(db, '2026-11-14T15:10:00Z')).posts).toMatchObject({ fired: false, why: 'none took off' })
    expect((await calledFamily(db, 'content_result')).map(b => b.dedupe_key)).toEqual([`content-result:${nid(2)}`, `content-result:${nid(1)}`])
  })

  it('looks at posts from the last 7 days only', async () => {
    const db = await setup()
    await baseline(db)
    await post(db, { n: 1, daysAgo: 7.5, imp: 5000 })
    expect((await run(db)).posts).toMatchObject({ fired: false, why: 'none took off' })
  })
})

describe('a good-fit person engaged (prospect_engaged)', { timeout: 60_000 }, () => {
  type Ev = { n: number; post?: number; score?: number; type?: 'reaction' | 'comment'; hoursAgo?: number; scoredLate?: number | null; provider?: string | null; url?: string | null; prospect?: number | null; name?: string; headline?: string }
  async function ev(db: PGlite, e: Ev, from = NOW) {
    const seen = new Date(Date.parse(from) - (e.hoursAgo ?? 1) * 3600000).toISOString()
    const scored = e.scoredLate === null ? null : new Date(Date.parse(seen) + (e.scoredLate ?? 0.01) * 3600000).toISOString()
    await db.query(`insert into post_engagers (id, post_social_id, provider_id, name, headline, linkedin_url, engagement_type, reaction_type, icp_score, scored_at, first_seen_at, prospect_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [pid(1000 + e.n), `urn:li:activity:${nid(e.post ?? 1)}`, e.provider === undefined ? `ACoP${e.n}` : e.provider, e.name ?? `Person ${e.n}`,
      e.headline ?? `Founder at Company ${e.n}`, e.url === undefined ? `https://www.linkedin.com/in/person-${e.n}` : e.url, e.type ?? 'reaction',
      e.type === 'comment' ? null : 'LIKE', e.score ?? 8, scored, seen, e.prospect === undefined ? null : e.prospect === null ? null : pid(e.prospect)])
  }
  async function prospect(db: PGlite, n: number, cols: Record<string, unknown> = {}, thread = true) {
    const row: Record<string, unknown> = { id: pid(n), stage: 'dm_sent', ...cols }
    const keys = Object.keys(row)
    const vals = Object.values(row).map(v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))
    await db.query(`insert into outreach_prospects (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, vals)
    if (thread) await db.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at) values ($1, 'outbound', 'dm', $2)`, [pid(n), at(5)])
  }
  async function posts(db: PGlite) { await post(db, { n: 1, daysAgo: 2, imp: 80, text: 'You can move to Warsaw.\n\nLand a job first.' }) }
  const sentTitles = async (db: PGlite) => (await calledFamily(db, 'prospect_engaged')).map(b => b.title)

  it('rings for a good fit on his own post, with the headline and the post line, and opens the DM thread when there is one', async () => {
    const db = await setup()
    await posts(db)
    await prospect(db, 1)
    await ev(db, { n: 1, type: 'comment', prospect: 1, name: '🔎 Jo Kaminska', headline: 'Head of Growth — Acme | B2B' })
    await ev(db, { n: 2, prospect: null, url: 'www.linkedin.com/in/person-2' })     // no prospect: the LinkedIn profile, made https
    await ev(db, { n: 3, score: 6 })                                                   // not a good fit
    await ev(db, { n: 4, scoredLate: null })                                           // not scored yet
    await ev(db, { n: 5, post: 999 })                                                  // someone else's post
    const r = await run(db)
    expect(r.people.sent.map(s => s.title)).toEqual(['Jo Kaminska commented on your post', 'Person 2 reacted to your post'])
    const [a, b] = await calledFamily(db, 'prospect_engaged')
    expect(a).toMatchObject({
      family: 'prospect_engaged', source: 'content-result-alerts', dedupe_key: `prospect-engaged:${pid(1001)}`, severity: 'info', push: true,
      body: 'Head of Growth, Acme | B2B\n“You can move to Warsaw.”', url: `./#exp/d/dms?thread=${pid(1)}`,
      media: { kind: 'prospect_engaged', engagement: 'comment', prospect_id: pid(1), icp_score: 8, post_key: nid(1) },
    })
    expect(b).toMatchObject({ url: 'https://www.linkedin.com/in/person-2', media: { engagement: 'reaction', prospect_id: null } })
    // a prospect with no thread at all: the LinkedIn profile, never a thread link that opens nothing
    const s = await setup()
    await posts(s)
    await prospect(s, 6, {}, false)
    await ev(s, { n: 6, prospect: 6 })
    await run(s)
    expect((await calledFamily(s, 'prospect_engaged'))[0]).toMatchObject({ url: 'https://www.linkedin.com/in/person-6' })
  })

  it('caps at 2 a day, highest score first, then the most recent, and one alert per person', async () => {
    const db = await setup()
    await posts(db)
    await ev(db, { n: 1, score: 7, hoursAgo: 1 })
    await ev(db, { n: 2, score: 9, hoursAgo: 5 })
    await ev(db, { n: 3, score: 8, hoursAgo: 4 })
    await ev(db, { n: 4, score: 8, hoursAgo: 2 })                      // same score as 3, more recent: wins
    await ev(db, { n: 5, score: 9.5, hoursAgo: 3, provider: 'ACoP2' })  // person 2 again (comment wins over reaction for one person, else score)
    expect((await run(db)).people.sent.map(s => s.title)).toEqual(['Person 5 reacted to your post', 'Person 4 reacted to your post'])
    expect(await one<number>(db, `select count(*)::int v from prospect_engaged_alerts`)).toBe(2)
    // a second run the same day has no room left
    await ev(db, { n: 6, score: 10, hoursAgo: 0.1 }, '2026-11-12T18:00:00Z')
    expect((await run(db, '2026-11-12T18:00:00Z')).people.sent).toEqual([])
  })

  it('never rings the same person twice in 90 days, by provider id, else by profile url', async () => {
    const db = await setup()
    await posts(db)
    await ev(db, { n: 1, provider: 'ACoAuke' })
    expect(await sentTitles(db)).toEqual([])
    await run(db)
    await post(db, { n: 2, daysAgo: 1, imp: 80 })
    await ev(db, { n: 2, post: 2, provider: 'ACoAuke', name: 'Auke again' }, '2026-11-20T15:10:00Z')
    await ev(db, { n: 3, provider: null, url: 'https://www.linkedin.com/in/no-provider' }, '2026-11-20T15:10:00Z')
    await run(db, '2026-11-20T15:10:00Z')
    expect(await sentTitles(db)).toEqual(['Person 1 reacted to your post', 'Person 3 reacted to your post'])
    const c = await db.query<{ suppressed: string }>(`select suppressed from prospect_engaged_candidates($1::timestamptz - interval '26 hours', $1::timestamptz) where engager_id = $2`, ['2026-11-20T15:10:00Z', pid(1002)])
    expect(c.rows[0].suppressed).toBe('alerted in the last 90 days')
    // 31 days later the same person still does not ring; 91 days later they may
    await ev(db, { n: 4, post: 2, provider: 'ACoAuke', name: 'Auke month' }, '2026-12-13T15:10:00Z')
    expect((await run(db, '2026-12-13T15:10:00Z')).people.sent.map(s => s.title)).toEqual([])
    await ev(db, { n: 5, post: 2, provider: 'ACoAuke', name: 'Auke later' }, '2027-02-11T15:10:00Z')
    expect((await run(db, '2027-02-11T15:10:00Z')).people.sent.map(s => s.title)).toEqual(['Auke later reacted to your post'])
  })

  it('never rings for a person whose thread is closed or stopped, and does for the automatic states that are not a stop', async () => {
    const db = await setup()
    await posts(db)
    const closed: [number, Record<string, unknown>][] = [
      [1, { blacklisted: true }],
      [2, { call_booked_at: at(3) }],
      [3, { skip_state: 'manual_skip', skip_reason: 'warm_signal:operator_skip' }],
      [4, { skip_reason: 'bizdev_nonbuyer' }],
      [5, { stage: 'archived' }],
      [6, { next_touch_after: at(-10) }],
      [7, { enrichment_data: { qualification_hold: true } }],
      [8, { enrichment_data: { followup_review: { verdict: { state: 'declined' } } } }],
      [9, {}],    // discard mode stop on a draft
      [10, {}],   // last reply negative
      [11, { solved_at: at(1) }],
      [12, {}],   // conversation agent stopped
      [13, {}],   // email sequence stopped by hand
    ]
    for (const [n, cols] of closed) await prospect(db, n, cols)
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, discard_mode) values ($1, 'outbound', 'dm', 'stop')`, [pid(9)])
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at, reply_intent) values ($1, 'inbound', 'dm', $2, 'negative')`, [pid(10), at(2)])
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at, reply_intent) values ($1, 'inbound', 'dm', $2, 'neutral')`, [pid(11), at(3)])
    await db.query(`insert into outreach_agent_threads (prospect_id, state) values ($1, 'stopped')`, [pid(12)])
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, email_sequence_stopped_at, email_sequence_stopped_reason) values ($1, 'outbound', 'email', $2, 'superseded_by_operator_coba_draft')`, [pid(13), at(4)])
    for (const [n] of closed) await ev(db, { n, prospect: n })
    // A person whose row has no prospect_id but whose provider id matches a closed prospect is suppressed too.
    await db.query(`insert into outreach_prospects (id, linkedin_profile_id, stage, blacklisted) values ($1, 'ACoAAFourteenPersonId123', 'archived', false)`, [pid(14)])
    await ev(db, { n: 14, prospect: null, provider: 'acoaafourteenpersonid123' })   // the member id compared case-insensitively
    // His own seat never rings.
    await ev(db, { n: 15, provider: 'ACoIVAN' })
    const reasons = (await db.query<{ n: string; suppressed: string | null }>(`select right(engager_id::text, 2) n, suppressed from prospect_engaged_candidates($1::timestamptz - interval '26 hours', $1::timestamptz) order by engager_id`, [NOW])).rows
    expect(reasons.map(r => r.suppressed)).toEqual([
      'blacklisted', 'call booked', 'skipped (manual_skip)', 'skipped (bizdev_nonbuyer)', 'stage archived', 'held until 2026-11-22', 'held',
      'thread closed (declined)', 'stopped in DMs', 'last reply negative', 'marked solved', 'contact stopped', 'email sequence stopped',
      'stage archived', 'own seat',
    ])
    expect((await run(db)).people.sent).toEqual([])
    expect(await calls(db)).toEqual([])
    // Not a stop: a withdrawn invite the system marked re-eligible, the one-email policy, a reply that came after
    // Mark as solved, a waiting reply.
    const s = await setup()
    await posts(s)
    await prospect(s, 1, { stage: 'connection_sent', skip_reason: 'invite_withdrawn_recyclable: re-eligible 2026-11-16' }, false)
    await prospect(s, 2)
    await s.query(`insert into outreach_messages (prospect_id, direction, message_type, email_sequence_stopped_at, email_sequence_stopped_reason) values ($1, 'outbound', 'email', $2, 'single_touch_policy_2026_04_26')`, [pid(2), at(4)])
    await prospect(s, 3, { solved_at: at(5), needs_manual_reply: true })
    await s.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at, reply_intent) values ($1, 'inbound', 'dm', $2, 'info_ask')`, [pid(3), at(2)])
    for (const n of [1, 2, 3]) await ev(s, { n, prospect: n, score: 10 - n })
    expect((await run(s)).people.sent.map(x => x.title)).toEqual(['Person 1 reacted to your post', 'Person 2 reacted to your post'])
    expect(await one<string | null>(s, `select public.prospect_engaged_closed($1::uuid, $2::timestamptz) v`, [pid(3), NOW])).toBeNull()
  })

  it('matches only prospects of Ivan\'s seat: a RISE twin neither suppresses nor gets the thread link', async () => {
    const db = await setup()
    await posts(db)
    const mid = 'ACoAATwinPersonIdABCDEF12'
    await prospect(db, 1, { linkedin_profile_id: mid, campaign_id: IVAN_LITERAL_CAMPAIGN })            // open, on Ivan's seat ('ivan')
    await prospect(db, 2, { linkedin_profile_id: mid, campaign_id: RISE_CAMPAIGN, stage: 'archived' })  // closed, on RISE
    await ev(db, { n: 1, provider: mid, prospect: 2 })                                                // the row links the RISE twin
    await run(db)
    expect((await calledFamily(db, 'prospect_engaged'))[0]).toMatchObject({ url: `./#exp/d/dms?thread=${pid(1)}`, media: { prospect_id: pid(1) } })
    // only a RISE prospect (with a thread): it rings, and the tap opens LinkedIn, never the RISE thread
    const s = await setup()
    await posts(s)
    await prospect(s, 2, { linkedin_profile_id: mid, campaign_id: RISE_CAMPAIGN, stage: 'archived' })
    await ev(s, { n: 1, provider: mid, prospect: 2 })
    await run(s)
    expect((await calledFamily(s, 'prospect_engaged'))[0]).toMatchObject({ url: 'https://www.linkedin.com/in/person-1', media: { prospect_id: null } })
    expect(await one<string | null>(s, `select prospect_id::text v from prospect_engaged_alerts`)).toBeNull()
  })

  it('finds a stopped Ivan prospect from the profile url alone (no prospect id, no provider id)', async () => {
    const db = await setup()
    await posts(db)
    await prospect(db, 1, { linkedin_url: 'https://www.linkedin.com/in/stopped-person' })
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, discard_mode) values ($1, 'outbound', 'dm', 'stop')`, [pid(1)])
    await ev(db, { n: 1, provider: null, prospect: null, url: 'https://linkedin.com/in/Stopped-Person/?utm=x' })
    expect(await one<string>(db, `select suppressed v from prospect_engaged_candidates($1::timestamptz - interval '26 hours', $1::timestamptz)`, [NOW])).toBe('stopped in DMs')
    expect((await run(db)).people.sent).toEqual([])
  })

  it('a reaction after a negative reply or after Mark as solved never reopens the thread', async () => {
    const db = await setup()
    await posts(db)
    await prospect(db, 1)
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at, reply_intent) values ($1, 'inbound', 'dm', $2, 'negative')`, [pid(1), at(3)])
    await prospect(db, 2, { solved_at: at(2) })
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at, reply_intent) values ($1, 'inbound', 'dm', $2, 'neutral')`, [pid(2), at(3)])
    for (const n of [1, 2]) await db.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at, is_reaction) values ($1, 'inbound', 'dm', $2, true)`, [pid(n), at(1)])
    expect(await one<string>(db, `select public.prospect_engaged_closed($1::uuid, $2::timestamptz) v`, [pid(1), NOW])).toBe('last reply negative')
    expect(await one<string>(db, `select public.prospect_engaged_closed($1::uuid, $2::timestamptz) v`, [pid(2), NOW])).toBe('marked solved')
  })

  it('a failed first run keeps its window: the next day picks up an engagement that is 44 h old by then', async () => {
    const db = await setup()
    await posts(db)
    await ev(db, { n: 1, hoursAgo: 20 })
    await db.exec(`delete from integration_config where key = 'inbox_notify_url'`)
    expect((await run(db)).people.error).toMatch(/inbox_notify_url/)
    await db.exec(`insert into integration_config values ('inbox_notify_url', 'https://example.test/inbox-notify')`)
    expect((await run(db, '2026-11-13T15:10:00Z')).people.sent.map(x => x.title)).toEqual(['Person 1 reacted to your post'])
  })

  it('first run starts 26 hours back (no flood); the next run reads only what came after; a late score still counts', async () => {
    const db = await setup()
    await posts(db)
    await ev(db, { n: 1, hoursAgo: 30 })                       // before the first mark: never rings
    await ev(db, { n: 2, hoursAgo: 25 })
    expect((await run(db)).people.sent.map(s => s.title)).toEqual(['Person 2 reacted to your post'])
    expect(await one<boolean>(db, `select hwm = $1::timestamptz v from content_alert_state where k = 'prospect_engaged'`, [NOW])).toBe(true)
    const next = '2026-11-13T15:10:00Z'
    await db.exec(`insert into inbox_notifications (dedupe_key) select body ->> 'dedupe_key' from net.calls`)   // it landed
    await ev(db, { n: 3, hoursAgo: 2 }, next)
    // first seen before the last run but scored only after it: ready when the score came
    await ev(db, { n: 4, hoursAgo: 25, scoredLate: 20 }, next)
    expect((await run(db, next)).people.sent.map(s => s.title).sort()).toEqual(['Person 3 reacted to your post', 'Person 4 reacted to your post'])
    // a rescore of an old event (first seen over 72 h ago) never rings
    const later = '2026-11-14T15:10:00Z'
    await db.query(`update post_engagers set scored_at = $2 where id = $1`, [pid(1001), at(0.05, later)])
    expect((await run(db, later)).people.sent).toEqual([])
  })
})

describe('both alerts: kill switch, delivery bookkeeping, service only', { timeout: 60_000 }, () => {
  async function both(db: PGlite) {
    await baseline(db)
    await post(db, { n: 1, daysAgo: 1, imp: 2000 })
    await db.query(`insert into post_engagers (post_social_id, provider_id, name, headline, linkedin_url, engagement_type, icp_score, scored_at, first_seen_at)
      values ($1, 'ACoX', 'Nilesh Sutaria', 'Founder', 'https://www.linkedin.com/in/nilesh', 'reaction', 7, $2, $2)`, [`urn:li:activity:${nid(1)}`, at(0.05)])
  }

  it('the kill switch stops both, and switching back on never replays the days it was off', async () => {
    const db = await setup()
    await both(db)
    await db.exec(`insert into integration_config values ('content_result_alerts', 'off')`)
    expect(await run(db)).toMatchObject({ off: true })
    expect(await calls(db)).toEqual([])
    expect(await one<number>(db, `select (select count(*) from content_result_alerts) + (select count(*) from prospect_engaged_alerts) v`)).toBe(0)
    await db.exec(`update integration_config set value = 'on' where key = 'content_result_alerts'`)
    const r = await run(db, '2026-11-13T15:10:00Z')
    expect(r.people.sent).toEqual([])                  // the engagement was read while off
    expect(r.posts).toMatchObject({ fired: true })     // the post still took off within its 7 days: it rings now
  })

  it('writes the ledger and the queued call together; no feed row a day later = one more try, then never again', async () => {
    const db = await setup()
    await both(db)
    await run(db)
    expect((await calls(db)).map(c => c.body.family)).toEqual(['content_result', 'prospect_engaged'])
    // the same day again: nothing new
    await run(db, '2026-11-12T16:00:00Z')
    expect(await calls(db)).toHaveLength(2)
    // inbox-notify was down: no feed row for either key. The next day sends each once more.
    const r = await run(db, '2026-11-13T15:10:00Z')
    expect(r.posts.retried).toBe(1)
    expect(r.people.retried).toBe(1)
    const engager = await one<string>(db, `select engager_id::text v from prospect_engaged_alerts`)
    const keys = [`content-result:${nid(1)}`, `prospect-engaged:${engager}`]
    expect((await calls(db)).map(c => c.body.dedupe_key)).toEqual([...keys, ...keys])
    expect(await one<number>(db, `select max(notify_attempts)::int v from content_result_alerts`)).toBe(2)
    // still no row: never a third try
    await run(db, '2026-11-14T15:10:00Z')
    expect(await calls(db)).toHaveLength(4)
  })

  it('a retry counts in the day\'s limit: 1 post and 2 people a day in all, retries first', async () => {
    const db = await setup()
    await baseline(db)
    await post(db, { n: 1, daysAgo: 1, imp: 2000 })
    const person = (n: number, from: string) => db.query(`insert into post_engagers (post_social_id, provider_id, name, linkedin_url, engagement_type, icp_score, scored_at, first_seen_at)
      values ($1, $2, $3, $4, 'reaction', 8, $5, $5)`, [`urn:li:activity:${nid(1)}`, `ACoQ${n}`, `Person ${n}`, `https://www.linkedin.com/in/q-${n}`, at(0.05, from)])
    await person(1, NOW); await person(2, NOW)
    const day1 = await run(db)
    expect(day1.posts).toMatchObject({ fired: true })
    expect(day1.people.sent).toHaveLength(2)
    // inbox-notify was down. Day 2: a second post took off and two new people engaged.
    const D2 = '2026-11-13T15:10:00Z'
    await post(db, { n: 2, daysAgo: 0.2, imp: 3000 })
    await person(3, D2); await person(4, D2)
    const day2 = await run(db, D2)
    expect(day2.posts).toMatchObject({ fired: false, why: 'one already today', retried: 1 })
    expect(day2.people).toMatchObject({ sent: [], retried: 2 })
    expect(await calls(db)).toHaveLength(6)   // 3 on day 1, the same 3 again on day 2, nothing new
    // Day 3: the second post rings now; the two people of day 2 were read and stay unrung.
    const day3 = await run(db, '2026-11-14T15:10:00Z')
    expect(day3.posts).toMatchObject({ fired: true, post_key: nid(2), retried: 0 })
    expect(await calls(db)).toHaveLength(7)
  })

  it('a people retry is read again first: a thread closed since yesterday drops it, recorded, and never sent', async () => {
    const db = await setup()
    await db.query(`insert into outreach_prospects (id, stage) values ($1, 'dm_sent')`, [pid(1)])
    await db.query(`insert into outreach_messages (prospect_id, direction, message_type, sent_at) values ($1, 'outbound', 'dm', $2)`, [pid(1), at(5)])
    await post(db, { n: 1, daysAgo: 2, imp: 80 })
    await db.query(`insert into post_engagers (post_social_id, provider_id, name, linkedin_url, engagement_type, icp_score, scored_at, first_seen_at, prospect_id)
      values ($1, 'ACoX', 'Jo', 'https://www.linkedin.com/in/jo', 'reaction', 8, $2, $2, $3)`, [`urn:li:activity:${nid(1)}`, at(0.05), pid(1)])
    expect((await run(db)).people.sent).toHaveLength(1)
    await db.query(`update outreach_prospects set solved_at = now() where id = $1`, [pid(1)])
    const r = await run(db, '2026-11-13T15:10:00Z')
    expect(r.people).toMatchObject({ retried: 0, dropped: 1 })
    expect(await one<string>(db, `select dropped v from prospect_engaged_alerts`)).toBe('marked solved')
    expect(await calls(db)).toHaveLength(1)
    expect((await run(db, '2026-11-13T18:00:00Z')).people).toMatchObject({ retried: 0, dropped: 0 })
  })

  it('a busy lock ends the run cleanly: lock_timeout is set, nothing is written, the mark does not move', async () => {
    const db = await setup()
    await both(db)
    expect(await one<string[]>(db, `select proconfig v from pg_proc where proname = 'content_result_alerts_run'`)).toEqual(expect.arrayContaining(['lock_timeout=5s', 'statement_timeout=60s']))
    await run(db)
    const mark = () => one<string>(db, `select hwm::text v from content_alert_state`)
    const before = await mark()
    // a lock that times out (SQLSTATE 55P03) inside the engager block: that block rolls back, the mark stays
    await db.exec(`create or replace function public.prospect_engaged_block(p_prospect uuid, p_provider text, p_url text, p_now timestamptz default now())
      returns text language plpgsql as $$ begin raise exception 'lock timeout' using errcode = 'lock_not_available'; end $$`)
    await db.query(`insert into post_engagers (post_social_id, provider_id, name, engagement_type, icp_score, scored_at, first_seen_at) values ($1, 'ACoY', 'Later', 'reaction', 9, $2, $2)`, [`urn:li:activity:${nid(1)}`, at(0.05, '2026-11-13T15:10:00Z')])
    const r = await run(db, '2026-11-13T15:10:00Z')
    expect(r.people.error).toMatch(/lock timeout/)
    expect(await mark()).toBe(before)
    // a lock that times out before either block (the run's own lock): the run returns busy and writes nothing
    await db.exec(`create or replace function public.content_alert_off() returns boolean language plpgsql as $$ begin raise exception 'lock timeout' using errcode = 'lock_not_available'; end $$`)
    const n = (await calls(db)).length
    expect(await run(db, '2026-11-14T15:10:00Z')).toMatchObject({ busy: true })
    expect(await mark()).toBe(before)
    expect(await calls(db)).toHaveLength(n)
  })

  it('never rings twice: a feed row for the key (even dismissed) means it landed', async () => {
    const db = await setup()
    await both(db)
    await run(db)
    const engager = await one<string>(db, `select engager_id::text v from prospect_engaged_alerts`)
    await db.query(`insert into inbox_notifications (dedupe_key, dismissed_at) values ($1, now()), ($2, null)`, [`content-result:${nid(1)}`, `prospect-engaged:${engager}`])
    const r = await run(db, '2026-11-13T15:10:00Z')
    expect(r.posts.retried).toBe(0)
    expect(r.people.retried).toBe(0)
    expect(await calls(db)).toHaveLength(2)
  })

  it('a missing notify url writes nothing, and the alert rings on the next run once it is back', async () => {
    const db = await setup()
    await both(db)
    await db.exec(`delete from integration_config where key = 'inbox_notify_url'`)
    const r = await run(db)
    expect(r.posts.error).toMatch(/inbox_notify_url/)
    expect(r.people.error).toMatch(/inbox_notify_url/)
    expect(await one<number>(db, `select (select count(*) from content_result_alerts) + (select count(*) from prospect_engaged_alerts) v`)).toBe(0)
    // the first mark is kept: the failed first run keeps its 26 h window
    expect(await one<boolean>(db, `select hwm = $1::timestamptz - interval '26 hours' v from content_alert_state`, [NOW])).toBe(true)
    await db.exec(`insert into integration_config values ('inbox_notify_url', 'https://example.test/inbox-notify')`)
    const again = await run(db, '2026-11-12T20:00:00Z')
    expect(again.posts).toMatchObject({ fired: true })
    expect(again.people.sent).toHaveLength(1)
  })

  it('refuses a signed-in browser', async () => {
    const db = await setup()
    await db.exec(`set test.service = '0'`)
    await expect(run(db)).rejects.toThrow(/service only/)
  })
})

describe('the migration', { timeout: 60_000 }, () => {
  it('schedules one cron job at 15:10 UTC, re-runs cleanly, and the rollback drops everything it added', async () => {
    const db = await setup()
    const before = await setup()
    await before.exec(rollback)
    await db.exec(migration)
    expect((await db.query(`select schedule, command from cron.job where jobname = 'content-result-alerts'`)).rows)
      .toEqual([{ schedule: '10 15 * * *', command: 'select public.content_result_alerts_run()' }])
    await db.exec(rollback)
    expect((await db.query(`select 1 from cron.job`)).rows).toEqual([])
    expect((await db.query(`select tablename from pg_tables where tablename in ('content_result_alerts', 'prospect_engaged_alerts', 'content_alert_state')`)).rows).toEqual([])
    expect((await db.query(`select proname from pg_proc where proname like 'content_alert_%' or proname like 'content_result_%' or proname like 'prospect_engaged_%'`)).rows).toEqual([])
    const objects = `select count(*)::int v from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public'`
    expect(await one<number>(db, objects)).toBe(await one<number>(before, objects))
  })
})
