// Round 5 (release stop 2026-11-17: the one-shot backfill in db/304 hit the 2-minute statement timeout).
// The backfill is now open_backfill_step(), called in a loop, each call its own transaction, then open_release_grant()
// once. These tests prove the loop gives the same labels and the same eligible rows as the one-shot pass, whatever the
// batch size, when a batch fails halfway, when it is re-run after done, and when rows arrive between batches; and
// that every rollback file runs on a partial state. All people, slugs and addresses below are invented.
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BASE, MIGRATIONS, migration, openDb } from './openTrackingSchema'
import { PGlite as PG } from '@electric-sql/pglite'

const EXTRA = `
create table public.scans (company_slug text, prospect_token text, report_json jsonb);
create table public.swishdm_comparison_pages (token text, prospect_id uuid, brand text, url text, status text);
create table public.profile_view_log (prospect_id uuid, seat text, viewed_at timestamptz, captured_at timestamptz default now());
create table public.post_engagers (prospect_id uuid, first_seen_at timestamptz, last_seen_at timestamptz, engagement_type text, comment_text text, post_social_id text);
create table public.client_post_metrics (title text, post_url text, social_id text, captured_at timestamptz);
create table public.booking_attributions (meeting_id text not null, client_id text not null default 'risedtc', slug text,
  booked_at timestamptz, prospect_id uuid, verdict text not null default 'attributed');
`
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.0.0'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) LinkedInApp'
const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
const TOKENS = ['abcdefghijklmnopqrst', 'bcdefghijklmnopqrstu', 'cdefghijklmnopqrstuv', 'defghijklmnopqrstuvw']

// Invented history with every rule in play: four Microsoft addresses (three reach 3+ recipients, one stays at 2), an
// office on a LinkedIn referrer, an owner address with visitors, a burst, an address on 8+ scans, tool agents, rows
// with no address, a send with no recipient, and SwishDM report pages.
async function seedHistory(d: PGlite) {
  const q = (s: string, p: unknown[] = []) => d.query(s, p)
  let seed = 5150
  const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % k }
  await q(`insert into open_networks(ip_hash, asn, org, source) values
    ('ms-one', 8075, 'Microsoft Corporation', 'test'), ('ms-two', 8075, 'Microsoft Limited', 'test'),
    ('ms-three', null, 'Microsoft Corporation', 'test'), ('ms-pair', 8075, 'Microsoft Corporation', 'test'),
    ('home-isp', 5089, 'Virgin Media', 'test'), ('rail', 400940, 'Railway', 'test') on conflict do nothing`)
  let slugN = 0, recip = 100
  const minutesAgo = (m: number) => new Date(Date.UTC(2026, 9, 20, 12) - m * 60_000).toISOString()
  for (const [hash, recipients] of [['ms-one', 6], ['ms-two', 4], ['ms-three', 3], ['ms-pair', 2]] as const) {
    for (let i = 0; i < recipients; i++) {
      const slug = `acme-${++slugN}`, at = 5000 - slugN * 37
      const to = recip++
      await q(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', 'linkedin', $2, $3)`,
        [uuid(to), minutesAgo(at), `Made this for you: https://inboundonsteroids.com/scan/${slug}`])
      // the checker opens 40-90 s later, sometimes twice; a person opens hours later from home with LinkedIn
      await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, ip_hash) values ($1, $2, 'desktop', $3, $4)`,
        [slug, new Date(Date.parse(minutesAgo(at)) + 40_000 + rnd(50) * 1000).toISOString(), CHROME, hash])
      if (rnd(2)) await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, ip_hash) values ($1, $2, 'desktop', $3, $4)`,
        [slug, new Date(Date.parse(minutesAgo(at)) + 120_000).toISOString(), CHROME, hash])
      await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, referrer_host, ip_hash) values ($1, $2, 'mobile', $3, $4, $5)`,
        [slug, minutesAgo(at - 300 - rnd(200)), IPHONE, rnd(3) ? 'www.linkedin.com' : null, `person-${slugN}`])
    }
  }
  // a send with no recipient, opened by a Microsoft address: counts for no recipient
  await q(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values (null, 'outbound', 'email', $1, 'https://inboundonsteroids.com/scan/acme-orphan')`, [minutesAgo(900)])
  await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, ip_hash) values ('acme-orphan', $1, 'desktop', $2, 'ms-pair')`, [minutesAgo(899), CHROME])
  // office on one address, LinkedIn referrer, three scans hours apart; owner address with two visitors; a burst; 8+ scans
  for (const [k, slug] of ['acme-1', 'acme-2', 'acme-3'].entries())
    await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, referrer_host, ip_hash) values ($1, $2, 'desktop', $3, 'www.linkedin.com', 'office')`, [slug, minutesAgo(800 - k * 120), CHROME])
  for (let i = 0; i < 6; i++)
    await q(`insert into scan_opens(company_slug, opened_at, is_owner, device_type, user_agent, ip_hash) values ($1, $2, $3, 'desktop', $4, 'home-isp')`, [`acme-${1 + (i % 4)}`, minutesAgo(700 - i * 30), i < 4, CHROME])
  for (let i = 0; i < 3; i++)
    await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, ip_hash) values ($1, $2, 'desktop', $3, 'burst-addr')`, [`acme-${5 + i}`, minutesAgo(600 - i * 3), CHROME])
  for (let i = 0; i < 9; i++)
    await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, ip_hash) values ($1, $2, 'desktop', $3, 'many-addr')`, [`acme-${1 + i}`, minutesAgo(500 - i * 40), CHROME])
  for (let i = 0; i < 5; i++)
    await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, ip_hash) values ($1, $2, 'desktop', 'HeadlessChrome/142', 'rail')`, [`acme-${2 + i}`, minutesAgo(400 - i)])
  for (let i = 0; i < 4; i++)
    await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, ip_hash) values ($1, $2, 'mobile', $3, null)`, [`acme-${3 + i}`, minutesAgo(300 - i * 7), 'Mozilla/5.0 (iPhone) Safari/604.1'])
  // SwishDM report pages: sends to four recipients, a Microsoft-org open after each, a person later, an owner open
  for (const [k, t] of TOKENS.entries()) {
    await q(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', 'linkedin', $2, $3)`,
      [uuid(900 + k), minutesAgo(2000 - k * 60), `Your report: https://swishdm.example/compare/${t}`])
    await q(`insert into page_opens(page, created_at, org, city, user_agent, is_external) values ($1, $2, 'Microsoft Corporation', 'Boydton', $3, true)`,
      [`swishdm/compare/${t}`, new Date(Date.parse(minutesAgo(2000 - k * 60)) + 50_000).toISOString(), CHROME])
    await q(`insert into page_opens(page, created_at, org, city, user_agent, referrer, is_external) values ($1, $2, 'Comcast', 'Denver', $3, $4, true)`,
      [`swishdm/compare/${t}`, minutesAgo(1500 - k * 60), IPHONE, k % 2 ? 'https://www.linkedin.com/' : null])
  }
  await q(`insert into page_opens(page, created_at, org, city, user_agent, is_external) values ('swishdm/compare/${TOKENS[0]}', $1, 'Orange Polska', 'Warsaw', $2, false)`, [minutesAgo(1400), CHROME])
}

const snapshot = async (d: PGlite) => ({
  scan: (await d.query<Record<string, any>>(`select id, open_class, class_reason, eligible, near_send, net_asn, net_org from scan_opens order by id`)).rows,
  page: (await d.query<Record<string, any>>(`select id, open_class, class_reason, eligible, near_send from page_opens order by id`)).rows,
})
const step = async (d: PGlite, n: number) => (await d.query<{ r: Record<string, any> }>(`select open_backfill_step($1) r`, [n])).rows[0].r
const loop = async (d: PGlite, n: number, between?: (i: number) => Promise<void>) => {
  for (let i = 0; i < 10_000; i++) {
    const r = await step(d, n)
    if (r.done) return i
    if (between) await between(i)
  }
  throw new Error('backfill never reported done')
}
const grant = async (d: PGlite) => (await d.query<{ r: Record<string, any> }>(`select open_release_grant() r`)).rows[0].r

// The one-shot pass as round 4 ran it: network from the seed, relabel everything, grant.
async function oneShot(d: PGlite) {
  await d.exec(`update scan_opens so set net_asn = n.asn, net_org = n.org from open_networks n
                 where n.ip_hash = so.ip_hash and (so.net_asn, so.net_org) is distinct from (n.asn, n.org);
                select reclassify_opens('-infinity');
                update open_backfill_state set done_at = now();`)
  return grant(d)
}
// A copy at "release time": history, then 303 and 304 applied (fast part only, no labels yet).
async function released(extra: (d: PGlite) => Promise<void> = async () => {}) {
  const d = new PG()
  await d.exec(BASE + EXTRA)
  await d.exec(migration('db/303_open_class.sql'))
  await seedHistory(d)
  await extra(d)
  await d.exec(migration('db/304_open_finalize_backfill.sql'))
  return d
}

describe('batched backfill (db/304 round 5)', () => {
  it('gives exactly the one-shot labels and eligible rows for batch sizes 1, 7 and 500', async () => {
    const ref = await released()
    expect((await oneShot(ref)).granted).toBe(true)
    const want = await snapshot(ref)
    expect(want.scan.filter(r => r.open_class === null)).toHaveLength(0)
    // the fixture really exercises the rules
    const kinds = new Set([...want.scan, ...want.page].map(r => `${r.open_class}:${r.class_reason}`))
    for (const k of ['link_scanner:confirmed_scanner_address', 'suspect:microsoft_after_send', 'human:linkedin_referrer', 'suspect:owner_address',
      'owner:owner_flag_or_ip', 'suspect:burst', 'suspect:many_scans', 'own_tool:tool_user_agent', 'human:network_unknown', 'owner:own_country'])
      expect(kinds, k).toContain(k)
    expect(want.scan.some(r => r.eligible)).toBe(true)
    await ref.close()
    for (const n of [1, 7, 500]) {
      const d = await released()
      const calls = await loop(d, n)
      expect((await grant(d)).granted).toBe(true)
      expect(await snapshot(d), `batch size ${n}`).toEqual(want)
      if (n === 1) expect(calls).toBeGreaterThan(want.scan.length)
      await d.close()
    }
  }, 120_000)

  it('a batch that fails halfway changes nothing; the next call redoes it and the end result is the same', async () => {
    const ref = await released()
    await oneShot(ref)
    const want = await snapshot(ref)
    await ref.close()
    const d = await released(async (x) => {
      await x.exec(`create function public.test_break() returns trigger language plpgsql as $$
        begin if current_setting('test.break', true) = '1' and new.open_class is not null then raise exception 'interrupted'; end if; return new; end $$;
        create trigger test_break before update on public.scan_opens for each row execute function public.test_break();`)
    })
    // the near_send batches and the first label batch pass, then the second label batch dies on its first row
    for (let i = 0; i < 50 && (await step(d, 20)).phase !== 'scan_label'; i++);
    const state0 = (await d.query(`select scan_cursor, batches, done_at from open_backfill_state`)).rows[0]
    const labelled0 = (await d.query<{ n: number }>(`select count(*)::int n from scan_opens where open_class is not null`)).rows[0].n
    await d.exec(`set test.break = '1'`)
    await expect(step(d, 20)).rejects.toThrow(/interrupted/)
    await d.exec(`set test.break = '0'`)
    expect((await d.query(`select scan_cursor, batches, done_at from open_backfill_state`)).rows[0]).toEqual(state0)
    expect((await d.query<{ n: number }>(`select count(*)::int n from scan_opens where open_class is not null`)).rows[0].n).toBe(labelled0)
    await loop(d, 20)
    expect((await grant(d)).granted).toBe(true)
    expect(await snapshot(d)).toEqual(want)
    await d.close()
  }, 120_000)

  it('re-running after done changes nothing, and the grant runs once', async () => {
    const d = await released()
    expect((await grant(d))).toEqual({ granted: false, reason: 'backfill_not_done' })
    expect((await d.query(`select count(*)::int n from integration_config where key = 'open_eligibility_granted_at'`)).rows[0]).toEqual({ n: 0 })
    await loop(d, 50)
    const g = await grant(d)
    expect(g.granted).toBe(true)
    const after = await snapshot(d)
    const stamps = (await d.query(`select id, classified_at from scan_opens order by id`)).rows
    for (let i = 0; i < 3; i++) expect((await step(d, 50)).done).toBe(true)
    expect(await grant(d)).toEqual({ granted: false, reason: 'already_ran' })
    expect(await snapshot(d)).toEqual(after)
    expect((await d.query(`select id, classified_at from scan_opens order by id`)).rows).toEqual(stamps)
    await d.close()
  }, 120_000)

  it('rows that arrive between batches end labelled once, with the one-shot labels, eligible only by a fresh first label or the grant', async () => {
    const d = await released()
    const q = (s: string, p: unknown[] = []) => d.query<Record<string, any>>(s, p)
    const fin = async (id: number, asn: number | null, org: string | null) =>
      (await q(`select scan_open_finalize($1, $2, $3, null, null) r`, [id, asn, org])).rows[0].r
    const arrivals: number[] = []
    const now = Date.now()
    await loop(d, 9, async (i) => {
      if (i === 2) {
        // a person opens a link sent last week: the edge function finalizes it, a fresh first label, eligible
        await q(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', 'linkedin', now() - interval '6 days', 'https://inboundonsteroids.com/scan/acme-late')`, [uuid(700)])
        const id = (await q(`insert into scan_opens(company_slug, device_type, user_agent, referrer_host, ip_hash) values ('acme-late', 'mobile', $1, 'www.linkedin.com', 'late-person') returning id`, [IPHONE])).rows[0].id
        arrivals.push(id)
        expect(await fin(id, 5089, 'Virgin Media')).toMatchObject({ open_class: 'human', eligible: true })
      }
      if (i === 4) {
        // the two-recipient Microsoft address gets its third recipient: every row of it becomes the scanner
        await q(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', 'linkedin', $2, 'https://inboundonsteroids.com/scan/acme-third')`, [uuid(701), new Date(now - 50_000).toISOString()])
        const id = (await q(`insert into scan_opens(company_slug, device_type, user_agent, ip_hash) values ('acme-third', 'desktop', $1, 'ms-pair') returning id`, [CHROME])).rows[0].id
        arrivals.push(id)
        await fin(id, 8075, 'Microsoft Corporation')
      }
      if (i === 6) {
        // an owner-flagged open on the office address: the office visitors become unresolved (owner_address)
        const id = (await q(`insert into scan_opens(company_slug, is_owner, device_type, user_agent, ip_hash) values ('acme-1', true, 'desktop', $1, 'office') returning id`, [CHROME])).rows[0].id
        arrivals.push(id)
        await fin(id, 5089, 'Virgin Media')
        // and a row whose finalizer failed: it stays unlabelled until the grant's final pass
        arrivals.push((await q(`insert into scan_opens(company_slug, device_type, user_agent, ip_hash) values ('acme-2', 'mobile', $1, 'no-finalize') returning id`, [IPHONE])).rows[0].id)
        await q(`insert into page_opens(page, org, city, user_agent, is_external) values ('swishdm/compare/${TOKENS[1]}', 'Comcast', 'Austin', $1, true)`, [IPHONE])
      }
    })
    expect(arrivals).toHaveLength(4)
    expect((await q(`select open_class from scan_opens where id = $1`, [arrivals[3]])).rows[0].open_class).toBeNull()
    const g = await grant(d)
    expect(g.granted).toBe(true)
    const got = await snapshot(d)
    expect(got.scan.filter(r => r.open_class === null)).toHaveLength(0)
    expect(got.page.filter(r => r.open_class === null)).toHaveLength(0)
    expect(got.scan.filter(r => r.id === arrivals[0])[0]).toMatchObject({ open_class: 'human', eligible: true })
    expect((await q(`select distinct open_class from scan_opens where ip_hash = 'ms-pair' and not open_from_linkedin(referrer_host, user_agent)`)).rows).toEqual([{ open_class: 'link_scanner' }])
    expect((await q(`select open_class, class_reason, eligible from scan_opens where ip_hash = 'office' and not is_owner`)).rows.every(r => r.class_reason === 'owner_address' && !r.eligible)).toBe(true)

    // the one-shot pass over the same final rows (inserted plainly, no finalizer) gives the same labels and eligibility
    const ref = await released()
    for (const m of (await q(`select prospect_id, direction, channel, sent_at, message_text from outreach_messages where message_text ~ 'acme-(late|third)'`)).rows)
      await ref.query(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, $2, $3, $4, $5)`, [m.prospect_id, m.direction, m.channel, m.sent_at, m.message_text])
    for (const r of (await q(`select id, company_slug, opened_at, is_owner, device_type, referrer_host, ip_hash, user_agent from scan_opens where id = any($1) order by id`, [arrivals])).rows)
      await ref.query(`insert into scan_opens(id, company_slug, opened_at, is_owner, device_type, referrer_host, ip_hash, user_agent) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [r.id, r.company_slug, r.opened_at, r.is_owner, r.device_type, r.referrer_host, r.ip_hash, r.user_agent])
    for (const r of (await q(`select id, page, created_at, org, city, user_agent, is_external from page_opens where id > (select page_high_water from open_backfill_state)`)).rows)
      await ref.query(`insert into page_opens(id, page, created_at, org, city, user_agent, is_external) values ($1, $2, $3, $4, $5, $6, $7)`, [r.id, r.page, r.created_at, r.org, r.city, r.user_agent, r.is_external])
    // the lookups the edge function stored for the new rows
    for (const n of (await q(`select ip_hash, asn, org, source from open_networks where source = 'edge_lookup'`)).rows)
      await ref.query(`insert into open_networks(ip_hash, asn, org, source) values ($1, $2, $3, $4) on conflict (ip_hash) do update set asn = excluded.asn, org = excluded.org`, [n.ip_hash, n.asn, n.org, n.source])
    await oneShot(ref)
    const want = await snapshot(ref)
    expect(got).toEqual(want)
    await ref.close()
    await d.close()
  }, 120_000)
})

describe('rollback files on partial states (round 5)', () => {
  const FILES = ['303_open_class', '304_open_finalize_backfill', '305_open_readers', '306_open_evidence_cutover', '307_scan_page_events', '308_scan_reopen_ring', '309_open_daily_check']
  it('each rollback runs whether its forward file applied or not, and twice in a row', async () => {
    for (let k = 0; k < FILES.length; k++) {
      // forward file NOT applied (only the ones before it), then applied
      for (const upTo of [k, k + 1]) {
        const d = await openDb(upTo, EXTRA)
        const rb = readFileSync(`db/${FILES[k]}_rollback.sql`, 'utf8')
        await d.exec(rb)
        await d.exec(rb)
        await d.close()
      }
    }
  }, 300_000)
  it('every rollback, newest first, runs on a release stopped halfway through the 304 backfill', async () => {
    const d = await released()
    await step(d, 7); await step(d, 7)
    for (const f of [...FILES].reverse()) await d.exec(readFileSync(`db/${f}_rollback.sql`, 'utf8'))
    expect((await d.query(`select count(*)::int n from information_schema.columns where table_name = 'scan_opens' and column_name = 'open_class'`)).rows[0]).toEqual({ n: 0 })
    expect((await d.query(`select to_regclass('public.open_backfill_state') t`)).rows[0]).toEqual({ t: null })
    expect((await d.query(`select count(*)::int n from cron.job`)).rows[0]).toEqual({ n: 0 })
    await d.exec(`insert into scan_opens(company_slug, is_owner, device_type, ip_hash, user_agent) values ('after-rollback', false, 'mobile', 'h', 'ua')`)
    await d.close()
  }, 120_000)
  it('re-applying 304 after its rollback keeps the grant marker, so the grant never runs twice', async () => {
    const d = await released()
    await loop(d, 500)
    expect((await grant(d)).granted).toBe(true)
    await d.exec(readFileSync('db/304_open_finalize_backfill_rollback.sql', 'utf8'))
    await d.exec(migration('db/304_open_finalize_backfill.sql'))
    await loop(d, 500)
    expect(await grant(d)).toEqual({ granted: false, reason: 'already_ran' })
    await d.close()
  }, 120_000)
})

describe('one migration list', () => {
  it('the step and grant helper files are not migrations', () => {
    expect(MIGRATIONS.some(m => m.includes('step') || m.includes('release_grant'))).toBe(false)
  })
})
