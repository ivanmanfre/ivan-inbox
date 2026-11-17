import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './openTrackingSchema'

const EXTRA = `
create table public.scans (company_slug text, prospect_token text, report_json jsonb);
create table public.swishdm_comparison_pages (token text, prospect_id uuid, brand text, url text, status text);
create table public.profile_view_log (prospect_id uuid, seat text, viewed_at timestamptz, captured_at timestamptz default now());
create table public.post_engagers (prospect_id uuid, first_seen_at timestamptz, last_seen_at timestamptz, engagement_type text, comment_text text, post_social_id text);
create table public.client_post_metrics (title text, post_url text, social_id text, captured_at timestamptz);
create table public.booking_attributions (meeting_id text not null, client_id text not null default 'risedtc', slug text,
  booked_at timestamptz, prospect_id uuid, verdict text not null default 'attributed');
`
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.162 Safari/537.36'

describe('read-only readers count people (305)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await openDb(3, EXTRA)
    for (const c of ['human', 'link_scanner', 'owner'])
      await db.query(`insert into scan_opens(company_slug, opened_at, is_owner, user_agent, open_class) values ('three-rows', now() - interval '1 day', $1, $2, $3)`, [c === 'owner', WIN, c])
  }, 20_000)
  afterAll(async () => { await db?.close() })

  it('scan_open_stats counts only human opens as real', async () => {
    expect((await db.query(`select real_opens::int, total_opens::int, scanner_opens::int, own_tool_opens::int, real_open_days::int from scan_open_stats where company_slug='three-rows'`)).rows[0])
      .toEqual({ real_opens: 1, total_opens: 3, scanner_opens: 1, own_tool_opens: 0, real_open_days: 1 })
  })
  it('scan_open_stats keeps its first four columns in order', async () => {
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='scan_open_stats' order by ordinal_position`)).rows.map(r => r.column_name)
    expect(cols).toEqual(['company_slug', 'real_opens', 'total_opens', 'last_real_open', 'real_open_days', 'scanner_opens', 'own_tool_opens'])
  })
  it('inbox tile counts only human opens', async () => {
    expect((await db.query(`select client_id, opens_total::int, opens_30d::int, distinct_prospects::int from inbox_scan_opens_v`)).rows).toEqual([{ client_id: 'ivan', opens_total: 1, opens_30d: 1, distinct_prospects: 1 }])
  })
  it('inbox tile keeps its six columns', async () => {
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='inbox_scan_opens_v' order by ordinal_position`)).rows.map(r => r.column_name)
    expect(cols).toEqual(['client_id', 'opens_7d', 'opens_30d', 'opens_total', 'distinct_prospects', 'last_open'])
  })
})

describe('page open alerts only for people (305, Task 6)', () => {
  let db: PGlite
  const TOK = 'abcdefghijklmnopqrst'
  const PID = '00000000-0000-0000-0000-0000000000a1'
  beforeAll(async () => {
    db = await openDb(3, EXTRA)
    await db.exec(`
      insert into outreach_prospects(id, name, company) values ('${PID}', 'Pat Prospect', 'Acme');
      insert into swishdm_comparison_pages values ('${TOK}', '${PID}', 'Acme', 'https://madebyswishdm.com/compare/${TOK}/', 'published');
      insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text, unipile_message_id)
        values ('${PID}', 'outbound', 'linkedin', now() - interval '3 hours', 'here: https://madebyswishdm.com/compare/${TOK}/', 'u1');`)
  }, 20_000)
  afterAll(async () => { await db?.close() })
  const calls = async () => (await db.query<{ n: number }>(`select count(*)::int n from net.calls`)).rows[0].n
  const insert = async (page: string, org: string, city = 'Des Moines', ext = true) =>
    (await db.query<{ open_class: string; class_reason: string; alerted: boolean; classified_at: string | null }>(
      `insert into page_opens(page, org, city, country, user_agent, is_external) values ($1, $2, $3, 'United States', $4, $5)
       returning open_class, class_reason, alerted, classified_at`, [page, org, city, WIN, ext])).rows[0]
  const opened = async () => (await db.query<{ o: boolean }>(`select swishdm_report_opened($1, now() - interval '1 day') o`, [TOK])).rows[0].o

  it('a SwishDM report opened from the Microsoft network is the scanner and never rings', async () => {
    const r = await insert(`swishdm/compare/${TOK}`, 'Microsoft Corporation')
    expect(r).toMatchObject({ open_class: 'link_scanner', class_reason: 'scanner_network', alerted: false })
    expect(r.classified_at).not.toBeNull()
    expect(await calls()).toBe(0)
  })
  it('swishdm_report_opened is false with only scanner rows', async () => expect(await opened()).toBe(false))
  it('a person on a home network rings once', async () => {
    const r = await insert(`swishdm/compare/${TOK}`, 'Comcast Cable Communications, LLC', 'Denver')
    expect(r).toMatchObject({ open_class: 'human', alerted: true })
    expect(await calls()).toBe(1)
    expect(await opened()).toBe(true)
  })
  it('a shared page from Microsoft is labelled the scanner', async () => {
    expect((await insert('leading-social', 'Microsoft Limited', 'Dublin')).open_class).toBe('link_scanner')
  })
  it('our own country is the owner on every page', async () => {
    expect((await insert('tracker-test-ext', 'PLAY', 'Warsaw', false))).toMatchObject({ open_class: 'owner', class_reason: 'own_country' })
  })
  it('one network on three report pages is the owner and does not ring', async () => {
    const before = await calls()
    await insert('swishdm/compare/bbbbbbbbbbbbbbbbbbbb', 'Metranet Communications Ltd.', 'Brighton')
    await insert('swishdm/compare/cccccccccccccccccccc', 'Metranet Communications Ltd.', 'Brighton')
    const r = await insert(`swishdm/compare/${TOK}`, 'Metranet Communications Ltd.', 'Brighton')
    expect(r).toMatchObject({ open_class: 'owner', class_reason: 'network_on_3_plus_pages', alerted: false })
    expect(await calls()).toBe(before)
  })
  it('a classifier failure never drops the insert', async () => {
    await db.exec(`alter function public.page_open_classify(boolean, text, text, boolean) rename to page_open_classify_off`)
    try {
      const r = await insert('leading-social', 'Comcast', 'Austin')
      expect(r.open_class).toBeNull()
    } finally {
      await db.exec(`alter function public.page_open_classify_off(boolean, text, text, boolean) rename to page_open_classify`)
    }
  })
  it('swishdm_report_opened is for the service role only', async () => {
    const acl = (await db.query<{ a: string }>(`select proacl::text a from pg_proc where proname='swishdm_report_opened'`)).rows[0].a
    expect(acl).toContain('service_role=X')
    expect(acl).not.toContain('anon=X')
  })
})

describe('draft readers move to the human class behind a cutover (306, Task 7)', () => {
  let db: PGlite
  const IVAN_C = '00000000-0000-0000-0000-00000000c001', RISE_C = '00000000-0000-0000-0000-00000000c002'
  let n = 0
  const pid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  beforeAll(async () => {
    db = await openDb(4, EXTRA)
    await db.exec(`insert into outreach_campaigns values ('${IVAN_C}', null, 'Ivan'), ('${RISE_C}', 'risedtc', 'RISE');
      update integration_config set value = (now() - interval '1 day')::text where key = 'open_class_cutover_at';`)
  }, 20_000)
  afterAll(async () => { await db?.close() })
  // a prospect with one link message sent `sentAgo` ago; opens are [minutes after the send, class, ua?, referrer?]
  async function person(lane: 'ivan' | 'rise', sentAgo: string, opens: Array<[number, string, string?, string?]>) {
    const id = pid(), slug = 'slug-' + n
    const host = lane === 'rise' ? 'resources.risedtc.com' : 'inboundonsteroids.com'
    await db.query(`insert into outreach_prospects(id, campaign_id, name, stage) values ($1, $2, 'P', 'dm_sent')`, [id, lane === 'rise' ? RISE_C : IVAN_C])
    await db.query(`insert into outreach_messages(prospect_id, direction, channel, message_type, sent_at, message_text)
      values ($1, 'outbound', 'linkedin', 'dm', now() - $2::interval, $3)`, [id, sentAgo, `here https://${host}/scan/${slug}`])
    for (const [min, cls, ua, ref] of opens)
      await db.query(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, referrer_host, open_class)
        values ($1, now() - $2::interval + $3 * interval '1 minute', 'desktop', $4, $5, $6)`, [slug, sentAgo, min, ua ?? 'Mozilla/5.0 (iPhone) Mobile', ref ?? null, cls])
    return { id, slug }
  }
  const evidence = async (fn: string, id: string) => (await db.query<{ real_opens: number; open_days: number }>(`select * from ${fn}() where prospect_id = $1`, [id])).rows[0]

  it('links sent before the cutover keep the old rule', async () => {
    const old = await person('ivan', '2 days', [[2, 'human']])
    expect(await evidence('ivan_scan_open_evidence', old.id)).toBeUndefined()
    const fresh = await person('ivan', '2 hours', [[2, 'human']])
    expect((await evidence('ivan_scan_open_evidence', fresh.id))?.real_opens).toBe(1)
    const oldLater = await person('ivan', '2 days', [[60, 'human']])
    expect((await evidence('ivan_scan_open_evidence', oldLater.id))?.real_opens).toBe(1)
  })
  it('scanner open 20 minutes after a second link message is never evidence', async () => {
    const old = await person('ivan', '2 days', [[20, 'link_scanner', 'Mozilla/5.0 (Windows NT 10.0) Chrome/142.0.7444.162']])
    const fresh = await person('ivan', '2 hours', [[20, 'link_scanner', 'Mozilla/5.0 (Windows NT 10.0) Chrome/142.0.7444.162']])
    expect(await evidence('ivan_scan_open_evidence', old.id)).toBeUndefined()
    expect(await evidence('ivan_scan_open_evidence', fresh.id)).toBeUndefined()
    const rise = await person('rise', '2 hours', [[20, 'link_scanner']])
    expect(await evidence('rise_scan_open_evidence', rise.id)).toBeUndefined()
  })
  it('RISE old links also keep the full-version Chrome filter', async () => {
    const old = await person('rise', '2 days', [[60, 'human', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.7444.162 Safari/537.36']])
    expect(await evidence('rise_scan_open_evidence', old.id)).toBeUndefined()
    const fresh = await person('rise', '2 hours', [[60, 'human', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.7444.162 Safari/537.36']])
    expect((await evidence('rise_scan_open_evidence', fresh.id))?.real_opens).toBe(1)
  })
  it('lanes stay apart', async () => {
    const r = await person('rise', '2 hours', [[30, 'human']])
    expect(await evidence('ivan_scan_open_evidence', r.id)).toBeUndefined()
    expect((await evidence('rise_scan_open_evidence', r.id))?.real_opens).toBe(1)
  })
  it('evidence RPC columns unchanged', async () => {
    for (const fn of ['ivan_scan_open_evidence', 'rise_scan_open_evidence'])
      expect((await db.query<{ r: string }>(`select pg_get_function_result('public.${fn}()'::regprocedure) r`)).rows[0].r)
        .toBe('TABLE(prospect_id uuid, scan_slug text, scan_sent_at timestamp with time zone, open_days integer, real_opens integer, first_open_at timestamp with time zone, last_open_at timestamp with time zone, replied_after_scan boolean)')
  })
  it('came back card needs a human reopen 1 hour after the first human open', async () => {
    const p = await person('ivan', '5 hours', [[10, 'human', 'Mozilla/5.0 (Windows NT 10.0) Chrome/142', undefined], [180, 'human', 'Mozilla/5.0 (Windows NT 10.0) Chrome/142', undefined]])
    for (const fn of ['came_back_cards', 'inbox_interest_cards']) {
      const card = (await db.query<{ signals: Array<{ kind: string }> }>(`select signals from ${fn}() where prospect_id = $1`, [p.id])).rows[0]
      expect(card?.signals.map(s => s.kind)).toEqual(['scan_open'])
    }
    const q = await person('ivan', '5 hours', [[10, 'human'], [180, 'link_scanner']])
    for (const fn of ['came_back_cards', 'inbox_interest_cards'])
      expect((await db.query(`select 1 from ${fn}() where prospect_id = $1`, [q.id])).rows).toHaveLength(0)
  })
  it('the cutover row is written once and kept on re-apply', async () => {
    const before = (await db.query<{ v: string }>(`select value v from integration_config where key='open_class_cutover_at'`)).rows[0].v
    const { migration } = await import('./openTrackingSchema')
    await db.exec(migration('db/306_open_evidence_cutover.sql'))
    expect((await db.query<{ v: string }>(`select value v from integration_config where key='open_class_cutover_at'`)).rows[0].v).toBe(before)
  })
})

describe('page events and the booking link (307, Task 8)', () => {
  let db: PGlite
  const P1 = '00000000-0000-0000-0000-0000000000b1', P2 = '00000000-0000-0000-0000-0000000000b2'
  beforeAll(async () => { db = await openDb(5, EXTRA) }, 20_000)
  afterAll(async () => { await db?.close() })
  const open = async (slug: string, at: string, cls: string) => (await db.query<{ id: number }>(
    `insert into scan_opens(company_slug, opened_at, open_class) values ($1, $2::timestamptz, $3) returning id`, [slug, at, cls])).rows[0].id
  const ev = (id: number, slug: string, kind: string, name: string, at: string) => db.query(
    `insert into scan_page_events(open_id, company_slug, kind, name, at) values ($1, $2, $3, $4, $5::timestamptz)`, [id, slug, kind, name, at])

  it('one event per open, kind and name', async () => {
    const id = await open('evt-a', '2026-11-10T10:00:00Z', 'human')
    await ev(id, 'evt-a', 'section_view', 'buyers', '2026-11-10T10:00:05Z')
    await expect(ev(id, 'evt-a', 'section_view', 'buyers', '2026-11-10T10:00:09Z')).rejects.toThrow()
    await expect(ev(id, 'evt-a', 'scroll', 'x', '2026-11-10T10:00:09Z')).rejects.toThrow()
  })
  it('events go with their open', async () => {
    const id = await open('evt-b', '2026-11-10T10:00:00Z', 'human')
    await ev(id, 'evt-b', 'section_view', 'close', '2026-11-10T10:00:05Z')
    await db.query(`delete from scan_opens where id = $1`, [id])
    expect((await db.query(`select * from scan_page_events where open_id = $1`, [id])).rows).toHaveLength(0)
  })
  it('a booking shows the last human click in the hour before it, never a scanner one', async () => {
    const h = await open('evt-c', '2026-11-10T10:00:00Z', 'human')
    await ev(h, 'evt-c', 'section_view', 'buyers', '2026-11-10T10:01:00Z')
    await ev(h, 'evt-c', 'section_view', 'close', '2026-11-10T10:03:00Z')
    await ev(h, 'evt-c', 'cta_click', 'book-close', '2026-11-10T10:04:00Z')
    const s = await open('evt-c', '2026-11-10T10:30:00Z', 'link_scanner')
    await ev(s, 'evt-c', 'cta_click', 'book-header', '2026-11-10T10:31:00Z')
    await db.query(`insert into booking_attributions(meeting_id, slug, booked_at, prospect_id) values ('m1', 'evt-c', '2026-11-10T10:40:00Z', '${P1}')`)
    expect((await db.query(`select meeting_id, slug, last_click_name, deepest_section from scan_booking_page_link where meeting_id='m1'`)).rows[0])
      .toEqual({ meeting_id: 'm1', slug: 'evt-c', last_click_name: 'book-close', deepest_section: 'close' })
  })
  it('a booking with no click in the hour before reads null', async () => {
    const h = await open('evt-d', '2026-11-10T08:00:00Z', 'human')
    await ev(h, 'evt-d', 'cta_click', 'book-close', '2026-11-10T08:01:00Z')
    await db.query(`insert into booking_attributions(meeting_id, slug, booked_at, prospect_id) values ('m2', 'evt-d', '2026-11-10T10:40:00Z', '${P2}')`)
    expect((await db.query(`select last_click_at, last_click_name from scan_booking_page_link where meeting_id='m2'`)).rows[0]).toEqual({ last_click_at: null, last_click_name: null })
  })
  it('bookings without a prospect are not listed; the slug falls back to the link we sent', async () => {
    await db.query(`insert into booking_attributions(meeting_id, slug, booked_at, prospect_id) values ('m3', 'evt-c', '2026-11-10T10:40:00Z', null)`)
    expect((await db.query(`select 1 from scan_booking_page_link where meeting_id='m3'`)).rows).toHaveLength(0)
    const P3 = '00000000-0000-0000-0000-0000000000b3'
    await db.query(`insert into outreach_messages(prospect_id, direction, sent_at, message_text) values ('${P3}', 'outbound', '2026-11-09T10:00:00Z', 'https://inboundonsteroids.com/scan/Evt-E')`)
    await db.query(`insert into booking_attributions(meeting_id, slug, booked_at, prospect_id) values ('m4', null, '2026-11-10T10:40:00Z', '${P3}')`)
    expect((await db.query(`select slug from scan_booking_page_link where meeting_id='m4'`)).rows[0]).toEqual({ slug: 'evt-e' })
  })
  it('events and the view are closed to the public key', async () => {
    for (const rel of ['scan_page_events', 'scan_booking_page_link'])
      expect((await db.query<{ a: string | null }>(`select relacl::text a from pg_class where relname = $1`, [rel])).rows[0].a ?? '').not.toMatch(/anon=|authenticated=/)
  })
})
