// Round-2 cross-review reproducers (2026-11-17), ported as regression tests that assert the CORRECT behaviour under
// rulings P1-P7, plus the round-3 cases the orchestrator asked for. All people, companies and addresses are invented.
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
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.7444.162 Safari/537.36'
const IVAN_C = '00000000-0000-0000-0000-00000000a001'
let db: PGlite
let n = 0
const q = async (s: string, a: unknown[] = []) => (await db.query(s, a)).rows as Array<Record<string, any>>
const pid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
const calls = async () => (await q(`select count(*)::int n from net.calls`))[0].n as number
const fin = async (id: number, asn: number | null, org: string | null) =>
  (await q(`select scan_open_finalize($1, $2, $3, 'US', 'Somewhere') r`, [id, asn, org]))[0].r as Record<string, any>
const insOpen = async (slug: string, o: { ago?: string; ref?: string | null; hash?: string | null; ua?: string; owner?: boolean; dev?: string } = {}) =>
  (await q(`insert into scan_opens(company_slug, opened_at, is_owner, device_type, referrer_host, ip_hash, user_agent)
    values ($1, now() - coalesce($2, '0 seconds')::interval, $3, $4, $5, $6, $7) returning id`,
    [slug, o.ago ?? null, o.owner ?? false, o.dev ?? 'desktop', o.ref ?? null, o.hash === undefined ? null : o.hash, o.ua ?? CHROME]))[0].id as number
async function prospect(name: string, slug: string, sentAgo: string, channel = 'linkedin') {
  const id = pid()
  await q(`insert into outreach_prospects(id, campaign_id, name, stage) values ($1, $2, $3, 'dm_sent')`, [id, IVAN_C, name])
  await q(`insert into outreach_messages(prospect_id, direction, channel, message_type, sent_at, message_text)
    values ($1, 'outbound', $2, case when $2 = 'email' then 'email' else 'dm' end, now() - $3::interval, $4)`,
    [id, channel, sentAgo, `Made this for you: https://inboundonsteroids.com/scan/${slug}`])
  return id
}
const lists = async () => ({
  ivan: (await q(`select prospect_id::text p from ivan_scan_open_evidence() order by 1`)).map(r => r.p),
  cards: (await q(`select prospect_id::text p from came_back_cards() order by 1`)).map(r => r.p),
  interest: (await q(`select prospect_id::text p from inbox_interest_cards() order by 1`)).map(r => r.p),
})

beforeAll(async () => {
  db = await openDb(7, EXTRA)
  await db.exec(`insert into outreach_campaigns values ('${IVAN_C}', null, 'Ivan');
    insert into integration_config(key, value) values ('scan_reopen_ring', 'on');
    update integration_config set value = (now() - interval '4 days')::text where key = 'open_class_cutover_at';`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('round-2 review reproducers, correct behaviour', () => {
  it('finding 2 / P4: three office visitors on one address opening three scans inside two minutes from LinkedIn all stay people', async () => {
    const ids = [await insOpen('office-rapid-a', { ago: '2 minutes', ref: 'www.linkedin.com', hash: 'shared-office' }),
                 await insOpen('office-rapid-b', { ago: '1 minute', ref: 'www.linkedin.com', hash: 'shared-office' }),
                 await insOpen('office-rapid-c', { ref: 'www.linkedin.com', hash: 'shared-office' })]
    for (const id of ids) expect(await fin(id, 5089, 'Virgin Media')).toMatchObject({ open_class: 'human', class_reason: 'linkedin_referrer', eligible: true })
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select company_slug, open_class, class_reason, eligible from scan_opens where ip_hash = 'shared-office' order by id`)).toEqual([
      { company_slug: 'office-rapid-a', open_class: 'human', class_reason: 'linkedin_referrer', eligible: true },
      { company_slug: 'office-rapid-b', open_class: 'human', class_reason: 'linkedin_referrer', eligible: true },
      { company_slug: 'office-rapid-c', open_class: 'human', class_reason: 'linkedin_referrer', eligible: true }])
  })

  it('finding 2 / P3 / R1: one owner click twenty days earlier makes a stranger on that wifi unresolved, never owner; so do 5 owner clicks within a week', async () => {
    await insOpen('owner-hotel', { ago: '20 days', owner: true, hash: 'hotel-nat' })
    const stranger = await insOpen('prospect-hotel', { hash: 'hotel-nat' })
    expect(await fin(stranger, 5089, 'Virgin Media')).toMatchObject({ open_class: 'suspect', class_reason: 'owner_address', eligible: false, ring: false })
    for (let i = 0; i < 5; i++) await insOpen(`owner-office-${i}`, { ago: `${i + 1} days`, owner: true, hash: 'our-egress' })
    const ours = await insOpen('prospect-egress', { hash: 'our-egress' })
    expect(await fin(ours, 5089, 'Virgin Media')).toMatchObject({ open_class: 'suspect', class_reason: 'owner_address', eligible: false, ring: false })
  })

  it('finding 4 / P5: a LinkedIn referral whose network lookup failed never rings (and a known network still does)', async () => {
    const p = await prospect('Una Known', 'unknown-li', '3 days')
    await q(`insert into scan_opens(company_slug, opened_at, user_agent, referrer_host, open_class, class_reason, classified_at, eligible)
      values ('unknown-li', now() - interval '1 day', $1, 'www.linkedin.com', 'human', 'linkedin_referrer', now(), true)`, [CHROME])
    const before = await calls()
    const id = await insOpen('unknown-li', { ref: 'www.linkedin.com', hash: 'lookup-timeout' })
    expect(await fin(id, null, null)).toMatchObject({ open_class: 'human', class_reason: 'linkedin_referrer', eligible: true, ring: false })
    expect(await calls()).toBe(before)
    expect(await q(`select 1 from scan_reopen_rings where prospect_id = $1`, [p])).toHaveLength(0)
  })

  it('finding 1 / P6: relabelling history never creates draft evidence for a post-cutover link', async () => {
    const p = await prospect('Hal Story', 'retry-history', '3 days')
    await q(`insert into scan_opens(company_slug, opened_at, user_agent, referrer_host, open_class, class_reason, classified_at, eligible)
      values ('retry-history', now() - interval '2 days', $1, 'www.linkedin.com', 'human', 'linkedin_referrer', now(), true)`, [CHROME])
    // yesterday's open: the finalizer failed, the row was never labelled
    await q(`insert into scan_opens(company_slug, opened_at, user_agent, referrer_host) values ('retry-history', now() - interval '1 day', $1, 'www.linkedin.com')`, [CHROME])
    const before = await lists()
    expect(before.cards).not.toContain(p)
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select open_class, eligible from scan_opens where company_slug = 'retry-history' order by opened_at`)).toEqual([
      { open_class: 'human', eligible: true }, { open_class: 'human', eligible: false }])
    expect((await lists()).cards).not.toContain(p)
    expect(await lists()).toEqual(before)
  })

  it('finding 3 / P3: a Microsoft corporate user opening a fresh link twenty seconds after delivery on a new address is kept as suspect, never eligible', async () => {
    const p = await prospect('Cora Copied', 'ms-fast', '20 seconds', 'email')
    const before = await calls()
    const id = await insOpen('ms-fast', { hash: 'ms-new-address' })
    expect(await fin(id, 8075, 'Microsoft Corporation')).toMatchObject({ open_class: 'suspect', class_reason: 'microsoft_after_send', eligible: false, ring: false })
    expect(await q(`select count(*)::int n from scan_opens where id = $1`, [id])).toEqual([{ n: 1 }])
    expect(await calls()).toBe(before)
    expect((await q(`select count(*)::int n from human_scan_opens('ivan') where prospect_id = $1`, [p]))[0].n).toBe(0)
  })

  it('point K / P2: one Microsoft row alone is never the scanner; three different scans after sends confirm the address and relabel the first', async () => {
    await q(`insert into open_networks(ip_hash, asn, org, source) values ('email-only', 8075, 'Microsoft Corporation', 'edge_lookup')`)
    const first = await insOpen('k-email-only', { ago: '1 day', hash: 'email-only' })
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select open_class, class_reason from scan_opens where id = $1`, [first])).toEqual([{ open_class: 'suspect', class_reason: 'microsoft_uncorroborated' }])
    for (const s of ['k-proven-a', 'k-proven-b', 'k-proven-c']) {
      await prospect('K ' + s, s, '1 minute', s.endsWith('a') ? 'email' : 'linkedin')
      await fin(await insOpen(s, { hash: 'email-only' }), 8075, 'Microsoft Corporation')
    }
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select open_class, class_reason from scan_opens where id = $1`, [first])).toEqual([{ open_class: 'link_scanner', class_reason: 'confirmed_scanner_address' }])
  })
})

describe('round-3 cases', () => {
  it('one Microsoft address on three different links, each within 15 minutes of a send: confirmed scanner; its earlier suspect rows become scanner with no ring, alert or eligibility', async () => {
    const people = [await prospect('Ada One', 'msx-one', '40 minutes'), await prospect('Ben Two', 'msx-two', '25 minutes'), await prospect('Cy Three', 'msx-three', '10 minutes', 'email')]
    // each prospect also opened their own scan from LinkedIn yesterday (eligible people)
    for (const s of ['msx-one', 'msx-two', 'msx-three'])
      await q(`insert into scan_opens(company_slug, opened_at, user_agent, referrer_host, open_class, class_reason, classified_at, eligible)
        values ($1, now() - interval '1 day', $2, 'www.linkedin.com', 'human', 'linkedin_referrer', now(), true)`, [s, CHROME])
    const before = { calls: await calls(), rings: (await q(`select count(*)::int n from scan_reopen_rings`))[0].n, lists: await lists() }
    const r1 = await fin(await insOpen('msx-one', { ago: '39 minutes', hash: 'ms-checker' }), 8075, 'Microsoft Limited')
    const r2 = await fin(await insOpen('msx-two', { ago: '24 minutes', hash: 'ms-checker' }), null, null)
    const r3 = await fin(await insOpen('msx-three', { ago: '9 minutes', hash: 'ms-checker' }), null, null)
    expect([r1, r2, r3].map(r => `${r.open_class}:${r.class_reason}`)).toEqual(['suspect:microsoft_after_send', 'suspect:microsoft_after_send', 'link_scanner:confirmed_scanner_address'])
    expect([r1, r2, r3].every(r => r.eligible === false && r.ring === false)).toBe(true)
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select open_class, class_reason, eligible from scan_opens where ip_hash = 'ms-checker' order by id`)).toEqual(
      Array(3).fill({ open_class: 'link_scanner', class_reason: 'confirmed_scanner_address', eligible: false }))
    expect(await calls()).toBe(before.calls)
    expect((await q(`select count(*)::int n from scan_reopen_rings`))[0].n).toBe(before.rings)
    expect(await lists()).toEqual(before.lists)
    for (const p of people) expect(before.lists.cards).not.toContain(p)
  })

  it('an address on eight different scans is suspect many_scans, even from LinkedIn on a home network', async () => {
    const ids: number[] = []
    for (let i = 0; i < 8; i++) ids.push(await insOpen(`many-${i}`, { ago: `${8 - i} days`, ref: 'www.linkedin.com', hash: 'carrier-nat' }))
    expect(await fin(ids[7], 5089, 'Virgin Media')).toMatchObject({ open_class: 'suspect', class_reason: 'many_scans', eligible: false })
    await q(`select reclassify_opens('-infinity')`)
    expect((await q(`select distinct open_class || ':' || class_reason c from scan_opens where ip_hash = 'carrier-nat'`)).map(r => r.c)).toEqual(['suspect:many_scans'])
    // seven scans is not enough
    for (let i = 0; i < 7; i++) await insOpen(`seven-${i}`, { ago: `${7 - i} days`, ref: 'www.linkedin.com', hash: 'seven-nat' })
    await q(`select reclassify_opens('-infinity')`)
    expect((await q(`select distinct open_class from scan_opens where ip_hash = 'seven-nat'`)).map(r => r.open_class)).toEqual(['human'])
  })

  it('unknown network with a LinkedIn referrer never rings, however many days it reopens', async () => {
    const p = await prospect('Uma Nonet', 'nonet-li', '5 days')
    await q(`insert into scan_opens(company_slug, opened_at, user_agent, referrer_host, open_class, class_reason, classified_at, eligible)
      values ('nonet-li', now() - interval '3 days', $1, 'www.linkedin.com', 'human', 'linkedin_referrer', now(), true)`, [CHROME])
    const before = await calls()
    for (const dev of ['mobile', 'desktop', 'tablet']) {
      const id = (await q(`insert into scan_opens(company_slug, device_type, referrer_host, user_agent) values ('nonet-li', $1, 'www.linkedin.com', $2) returning id`, [dev, CHROME]))[0].id
      expect(await fin(id, null, null)).toMatchObject({ open_class: 'human', ring: false })
    }
    expect(await calls()).toBe(before)
    expect(await q(`select 1 from scan_reopen_rings where prospect_id = $1`, [p])).toHaveLength(0)
  })

  it('P6: a relabel never grants eligibility, in any ordering of failures we can construct', async () => {
    // A seeded pseudo-random walk over every operation that can touch a label once a row is no longer fresh:
    // relabel (all history / default window), re-finalize with or without a network, a lookup arriving later,
    // a sibling row disappearing (a burst dissolving), an owner row appearing, a send appearing, the release grant
    // called again, a finalizer failure leaving a row unlabelled. After every step, the set of eligible rows may
    // only shrink.
    let seed = 20261117
    const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % k }
    await q(`select open_release_grant()`)   // the one release grant is spent before the walk
    const slugs = ['walk-a', 'walk-b', 'walk-c', 'walk-d', 'walk-e']
    for (const s of slugs) await prospect('Walker ' + s, s, '6 days')
    const hashes = ['w-ms', 'w-home', 'w-vpn', null]
    for (let i = 0; i < 24; i++) {
      const h = hashes[i % 4]
      const id = await insOpen(slugs[i % 5], { ago: `${2 + (i % 3)} days ${i * 3} minutes`, hash: h, ref: i % 6 === 0 ? 'www.linkedin.com' : null })
      if (i % 5 !== 4) await fin(id, h === 'w-ms' ? 8075 : h === 'w-home' ? 5089 : null, h === 'w-ms' ? 'Microsoft Limited' : h === 'w-home' ? 'Virgin Media' : null)
    }
    // some history rows were eligible people before the walk (the release grant's job)
    await q(`update scan_opens set eligible = true where company_slug like 'walk-%' and open_class = 'human' and id % 2 = 0`)
    const eligible = async () => new Set((await q(`select id from scan_opens where eligible`)).map(r => r.id as number))
    const ops: Array<[string, () => Promise<unknown>]> = [
      ['relabel all', () => q(`select reclassify_opens('-infinity')`)],
      ['relabel default', () => q(`select reclassify_opens()`)],
      ['refinalize no network', async () => { const r = await q(`select id from scan_opens where company_slug like 'walk-%' order by id offset $1 limit 1`, [rnd(24)]); if (r[0]) await fin(r[0].id, null, null) }],
      ['refinalize home', async () => { const r = await q(`select id from scan_opens where company_slug like 'walk-%' order by id offset $1 limit 1`, [rnd(24)]); if (r[0]) await fin(r[0].id, 5089, 'Virgin Media') }],
      ['lookup arrives', () => q(`insert into open_networks(ip_hash, asn, org, source) values ('w-vpn', 9009, 'Mullvad', 'edge_lookup') on conflict (ip_hash) do update set asn = 9009`)],
      ['sibling vanishes', () => q(`delete from scan_opens where id = (select max(id) from scan_opens where ip_hash = 'w-vpn' and not eligible)`)],
      ['owner row appears', () => q(`insert into scan_opens(company_slug, opened_at, is_owner, ip_hash, user_agent, open_class, class_reason, classified_at) values ('walk-owner', now() - interval '3 days', true, 'w-home', $1, 'owner', 'owner_flag_or_ip', now())`, [CHROME])],
      ['send appears', () => q(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', 'linkedin', now() - interval '2 days 1 minute', 'https://inboundonsteroids.com/scan/walk-b')`, [pid()])],
      ['release grant again', () => q(`select open_release_grant()`)],
      ['finalizer failure', () => q(`update scan_opens set open_class = null, class_reason = null, classified_at = null where id = (select min(id) from scan_opens where company_slug like 'walk-%' and open_class is not null)`)],
    ]
    let prev = await eligible()
    const trace: string[] = []
    for (let step = 0; step < 60; step++) {
      const [name, op] = ops[rnd(ops.length)]
      await op()
      trace.push(name)
      const now = await eligible()
      const gained = [...now].filter(x => !prev.has(x))
      expect(gained, `step ${step} (${trace.join(' > ')}) granted ${gained}`).toEqual([])
      prev = now
    }
    expect(new Set(trace).size).toBe(ops.length)   // every kind of step ran at least once
    expect((await q(`select open_release_grant() r`))[0].r).toEqual({ granted: false, reason: 'already_ran' })
  }, 60_000)
})
