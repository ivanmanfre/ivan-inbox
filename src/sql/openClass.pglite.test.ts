import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './openTrackingSchema'

let db: PGlite
beforeAll(async () => { db = await openDb(1) }, 60_000)
afterAll(async () => { await db?.close() })

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.162 Safari/537.36'
const APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [LinkedInApp]/9.32.5383'
const c = async (a: unknown[]) => (await db.query(
  `select * from scan_open_classify($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, a)).rows[0]
const pc = async (a: unknown[]) => (await db.query(
  `select * from page_open_classify($1,$2,$3,$4,$5,$6,$7,$8)`, a)).rows[0]
// args: owner, ua, referrer, device, asn, org, burst, near_li_send, addr_scanner, addr_owner
describe('scan_open_classify (round 2: positive evidence only)', () => {
  it('owner flag wins', async () => expect(await c([true, WIN, null, 'desktop', 8075, 'Microsoft', true, true, true, false])).toEqual({ open_class: 'owner', class_reason: 'owner_flag_or_ip' }))
  it('headless is our own tool', async () => expect((await c([false, 'x HeadlessChrome/147', null, 'desktop', 400940, 'Railway', false, false, false, false])).class_reason).toBe('tool_user_agent'))
  it('an address that carried the owner flag elsewhere is the owner', async () => expect(await c([false, WIN, null, 'desktop', 5089, 'Virgin Media', false, false, false, true])).toEqual({ open_class: 'owner', class_reason: 'address_proven_ours' }))
  it('the Railway network alone is not our tool', async () => expect(await c([false, WIN, null, 'desktop', 400940, 'Railway', false, false, false, false])).toEqual({ open_class: 'human', class_reason: 'default' }))
  it('Microsoft network + no referrer + LinkedIn send just before = scanner', async () => expect(await c([false, WIN, null, 'desktop', 8075, 'Microsoft Limited', false, true, false, false])).toEqual({ open_class: 'link_scanner', class_reason: 'after_send' }))
  it('Microsoft network + no referrer + burst = scanner', async () => expect((await c([false, WIN, null, 'desktop', 8075, 'Microsoft Limited', true, false, false, false])).class_reason).toBe('burst'))
  it('Microsoft network + an address already proven a scanner = scanner', async () => expect((await c([false, WIN, null, 'desktop', 8075, 'Microsoft Limited', false, false, true, false])).class_reason).toBe('known_scanner_address'))
  it('finding 3: Microsoft network alone (corporate user, copied link) is a person who never rings', async () => expect(await c([false, WIN, null, 'desktop', 8075, 'Microsoft Corporation', false, false, false, false])).toEqual({ open_class: 'human', class_reason: 'microsoft_uncorroborated' }))
  it('finding 8: no ASN but a Microsoft organization is the Microsoft network', async () => expect((await c([false, WIN, null, 'desktop', null, 'Microsoft Corporation', false, true, false, false])).open_class).toBe('link_scanner'))
  it('a person on a Microsoft network who clicked from LinkedIn is human, even right after the send', async () => expect(await c([false, WIN, 'www.linkedin.com', 'desktop', 8075, 'Microsoft', false, true, false, false])).toEqual({ open_class: 'human', class_reason: 'linkedin_referrer' }))
  it('finding 3: lookup failed, desktop, no referrer, just after a send = person, network unknown', async () => expect(await c([false, WIN, null, 'desktop', null, null, false, true, false, false])).toEqual({ open_class: 'human', class_reason: 'network_unknown' }))
  it('known home network just after a send stays human', async () => expect(await c([false, WIN, null, 'desktop', 5089, 'Virgin Media', false, true, false, false])).toEqual({ open_class: 'human', class_reason: 'default' }))
  it('a burst off the Microsoft network (VPN user, 3 reports in a minute) is not a person', async () => expect(await c([false, WIN, null, 'desktop', 9009, 'Mullvad', true, false, false, false])).toEqual({ open_class: 'owner', class_reason: 'burst_3_plus_pages' }))
  it('finding 4: a LinkedIn visitor through a shared office address with no burst stays human', async () => expect(await c([false, WIN, 'www.linkedin.com', 'desktop', 5089, 'Virgin Media', false, false, false, false])).toEqual({ open_class: 'human', class_reason: 'linkedin_referrer' }))
  // page args: external, org, ua, referrer, burst, near, addr_scanner, addr_owner
  it('page: own country is the owner', async () => expect((await pc([false, 'PLAY', WIN, null, false, false, false, false])).class_reason).toBe('own_country'))
  it('page: bare user agent is our own tool', async () => expect((await pc([true, 'PLAY', 'Mozilla/5.0', null, false, false, false, false])).open_class).toBe('own_tool'))
  it('page: Microsoft org right after a send is the scanner', async () => expect(await pc([true, 'Microsoft Limited', WIN, null, false, true, false, false])).toEqual({ open_class: 'link_scanner', class_reason: 'after_send' }))
  it('finding 3: page visitor with a Microsoft organization and no behaviour is a person who never rings', async () => expect(await pc([true, 'Microsoft Corporation', WIN, null, false, false, false, false])).toEqual({ open_class: 'human', class_reason: 'microsoft_uncorroborated' }))
  it('page: no organization (lookup failed) is a person, network unknown', async () => expect((await pc([true, null, WIN, null, false, false, false, false])).class_reason).toBe('network_unknown'))
  it('page: a 10-minute burst from one address is not a person', async () => expect((await pc([true, 'Mullvad Vpn Ab', WIN, null, true, false, false, false])).class_reason).toBe('burst_3_plus_pages'))
  it('ring and signal helpers', async () => {
    const r = (await db.query(`select open_may_ring('human','default') a, open_may_ring('human','network_unknown') b, open_may_ring('human','microsoft_uncorroborated') c2,
      open_may_ring('link_scanner','after_send') d, open_is_signal('human','network_unknown') e, open_is_signal('human','microsoft_uncorroborated') f, open_may_ring(null,null) g`)).rows[0]
    expect(r).toEqual({ a: true, b: false, c2: false, d: false, e: true, f: false, g: false })
  })
  it('finding 6: no classifier or helper is callable with the public key', async () => {
    const rows = (await db.query<{ proname: string; anon: boolean; auth: boolean }>(`select proname, has_function_privilege('anon', oid, 'execute') anon,
      has_function_privilege('authenticated', oid, 'execute') auth from pg_proc
      where proname in ('scan_open_classify','page_open_classify','open_is_microsoft','open_may_ring','open_is_signal')`)).rows
    expect(rows).toHaveLength(5)
    for (const r of rows) expect([r.proname, r.anon, r.auth]).toEqual([r.proname, false, false])
  })
})

describe('context, finalize, relabel (304)', () => {
  let d: PGlite
  beforeAll(async () => { d = await openDb(2) }, 60_000)
  afterAll(async () => { await d?.close() })
  const ins = async (slug: string, at: string, o: { hash?: string | null; ua?: string; ref?: string | null; dev?: string; owner?: boolean } = {}) =>
    (await d.query<{ id: number }>(
      `insert into scan_opens(company_slug, opened_at, is_owner, device_type, referrer_host, ip_hash, user_agent)
       values ($1, $2::timestamptz, $3, $4, $5, $6, $7) returning id`,
      [slug, at, o.owner ?? false, o.dev ?? 'desktop', o.ref ?? null, o.hash === undefined ? 'H' : o.hash, o.ua ?? WIN])).rows[0].id
  const ctx = async (id: number) => (await d.query<{ burst: boolean; near_li_send: boolean; addr_scanner: boolean; addr_owner: boolean }>(`select * from scan_open_context($1)`, [id])).rows[0]
  const send = (slug: string, at: string, channel: string | null = 'linkedin') => d.query(
    `insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text)
     values ('00000000-0000-0000-0000-000000000001', 'outbound', $1, $2::timestamptz, $3)`,
    [channel, at, `Made this for you: https://inboundonsteroids.com/scan/${slug}`])
  const fin = async (id: number, asn: number | null = null, org: string | null = null, cc: string | null = null, city: string | null = null) =>
    (await d.query<{ r: Record<string, unknown> }>(`select scan_open_finalize($1,$2,$3,$4,$5) as r`, [id, asn, org, cc, city])).rows[0].r

  it('context: three distinct scans inside 10 minutes from one address is a burst', async () => {
    const a = await ins('ctx-a', '2026-11-01T10:00:00Z', { hash: 'F1' })
    const b = await ins('ctx-b', '2026-11-01T10:04:00Z', { hash: 'F1' })
    expect((await ctx(b)).burst).toBe(false)
    const c3 = await ins('ctx-c', '2026-11-01T10:09:00Z', { hash: 'F1' })
    expect((await ctx(c3)).burst).toBe(true)
    // the relabel sees the burst from the first row too
    expect((await ctx(a)).burst).toBe(true)
  })
  it('context (finding 4): three scans from one address spread over hours or days is never a burst', async () => {
    await ins('slow-a', '2026-11-01T10:00:00Z', { hash: 'F2' })
    await ins('slow-b', '2026-11-01T10:30:00Z', { hash: 'F2' })
    const c3 = await ins('slow-c', '2026-11-03T12:00:00Z', { hash: 'F2' })
    expect((await ctx(c3)).burst).toBe(false)
  })
  it('context: owner rows never make a burst', async () => {
    await ins('own-a', '2026-11-01T10:00:00Z', { hash: 'O1', owner: true })
    await ins('own-b', '2026-11-01T10:01:00Z', { hash: 'O1', owner: true })
    const c3 = await ins('own-c', '2026-11-01T10:02:00Z', { hash: 'O1' })
    expect((await ctx(c3)).burst).toBe(false)
    // but the address is proven ours
    expect((await ctx(c3)).addr_owner).toBe(true)
  })
  it('context: open 40 s after a LinkedIn message with the link is near a send; 16 minutes is not', async () => {
    await send('near-a', '2026-11-02T10:00:00Z')
    expect((await ctx(await ins('near-a', '2026-11-02T10:00:40Z', { hash: 'N1' }))).near_li_send).toBe(true)
    expect((await ctx(await ins('near-a', '2026-11-02T10:16:00Z', { hash: 'N1' }))).near_li_send).toBe(false)
    await send('near-e', '2026-11-02T10:00:00Z', 'email')
    expect((await ctx(await ins('near-e', '2026-11-02T10:00:40Z', { hash: 'N2' }))).near_li_send).toBe(false)
    // a longer slug that starts with this one is a different link
    await send('near-bb', '2026-11-02T10:00:00Z')
    expect((await ctx(await ins('near-b', '2026-11-02T10:00:40Z', { hash: 'N3' }))).near_li_send).toBe(false)
  })
  it('context: ARCH audit links match on the folder', async () => {
    await d.query(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text)
      values ('00000000-0000-0000-0000-000000000002','outbound','linkedin','2026-11-02T10:00:00Z','see https://madebyarch.com/acme-audit/')`)
    expect((await ctx(await ins('arch-acme-audit', '2026-11-02T10:01:00Z', { hash: 'N4' }))).near_li_send).toBe(true)
  })
  it('finalize (finding 3): lookup failed, 40 s after a LinkedIn send = a person whose network is unknown', async () => {
    const now = new Date()
    await send('fin-a', new Date(now.getTime() - 40_000).toISOString())
    const id = await ins('fin-a', now.toISOString(), { hash: 'NEWHASH' })
    expect(await fin(id)).toMatchObject({ open_class: 'human', class_reason: 'network_unknown', ring: false })
    const row = (await d.query<{ classified_at: string | null }>(`select classified_at from scan_opens where id=$1`, [id])).rows[0]
    expect(row.classified_at).not.toBeNull()
    // the next open of that address gets the network; the nightly relabel copies it back and relabels the first row
    const id2 = await ins('fin-a', new Date(now.getTime() + 1000).toISOString(), { hash: 'NEWHASH' })
    expect(await fin(id2, 8075, 'Microsoft Limited', 'US', 'Boydton')).toMatchObject({ open_class: 'link_scanner', class_reason: 'after_send' })
    await d.query(`select reclassify_opens('-infinity')`)
    expect((await d.query(`select net_asn, open_class, class_reason from scan_opens where id=$1`, [id])).rows[0]).toEqual({ net_asn: 8075, open_class: 'link_scanner', class_reason: 'after_send' })
  })
  it('finalize stores the network and reuses it for the next row of the same address', async () => {
    const now = Date.now()
    await send('fin-b', new Date(now - 30_000).toISOString())
    const id1 = await ins('fin-b', new Date(now).toISOString(), { hash: 'MS1' })
    expect(await fin(id1, 8075, 'Microsoft Limited', 'US', 'Boydton')).toMatchObject({ open_class: 'link_scanner', class_reason: 'after_send' })
    // days later, no send: the address is already a proven scanner
    const id2 = await ins('fin-c', '2026-11-03T11:00:00Z', { hash: 'MS1' })
    expect(await fin(id2)).toMatchObject({ open_class: 'link_scanner', class_reason: 'known_scanner_address' })
    expect((await d.query(`select * from open_networks where ip_hash='MS1'`)).rows).toHaveLength(1)
    expect((await d.query<{ net_asn: number; net_org: string }>(`select net_asn, net_org from scan_opens where id=$1`, [id2])).rows[0]).toEqual({ net_asn: 8075, net_org: 'Microsoft Limited' })
  })
  it('finalize with no hash and no lookup still classifies', async () => {
    const id = await ins('fin-d', '2026-11-03T10:00:00Z', { hash: null, dev: 'mobile' })
    expect(await fin(id)).toMatchObject({ open_class: 'human', class_reason: 'network_unknown' })
    expect((await d.query(`select count(*)::int n from open_networks where ip_hash is null`)).rows[0]).toEqual({ n: 0 })
  })
  it('finalize is for the service role only', async () => {
    for (const fn of ['scan_open_finalize', 'scan_open_label', 'scan_open_context', 'page_open_context', 'reclassify_opens']) {
      const acl = (await d.query<{ a: string }>(`select proacl::text a from pg_proc where proname=$1`, [fn])).rows[0].a
      expect(acl).toContain('service_role=X')
      expect(acl).not.toMatch(/(^|[{,])=X/)
      expect(acl).not.toContain('anon=X')
    }
  })
  it('reclassify relabels and touches nothing else', async () => {
    const id = await ins('rel-a', '2026-11-04T10:00:00Z', { hash: 'R1' })
    expect(await fin(id, 5089, 'Virgin Media', 'GB', 'London')).toMatchObject({ open_class: 'human' })
    await ins('rel-b', '2026-11-04T10:05:00Z', { hash: 'R1' })
    await ins('rel-c', '2026-11-04T10:06:00Z', { hash: 'R1' })
    const before = (await d.query<{ n: number }>(`select count(*)::int n from outreach_messages`)).rows[0].n
    const calls = (await d.query<{ n: number }>(`select count(*)::int n from net.calls`)).rows[0].n
    const r = (await d.query<{ r: { scan_changed: number; page_changed: number } }>(`select reclassify_opens('-infinity') r`)).rows[0].r
    expect(r.scan_changed).toBeGreaterThan(0)
    // three scans inside 10 minutes from one address: a burst, so not a person (not Microsoft, so not the scanner)
    expect((await d.query(`select open_class, class_reason from scan_opens where company_slug='rel-a'`)).rows[0]).toEqual({ open_class: 'owner', class_reason: 'burst_3_plus_pages' })
    expect((await d.query<{ n: number }>(`select count(*)::int n from outreach_messages`)).rows[0].n).toBe(before)
    expect((await d.query<{ n: number }>(`select count(*)::int n from net.calls`)).rows[0].n).toBe(calls)
    // a second run changes nothing, and every row now carries classified_at
    expect((await d.query<{ r: { scan_changed: number } }>(`select reclassify_opens('-infinity') r`)).rows[0].r.scan_changed).toBe(0)
    expect((await d.query(`select count(*)::int n from scan_opens where classified_at is null`)).rows[0]).toEqual({ n: 0 })
  })
  it('reclassify (finding 4): three unrelated visitors sharing an ISP and city on three pages all stay people', async () => {
    for (const p of ['swishdm/compare/aaaaaaaaaaaaaaaaaaaa', 'swishdm/compare/bbbbbbbbbbbbbbbbbbbb', 'swishdm/compare/cccccccccccccccccccc'])
      await d.query(`insert into page_opens(page, org, city, user_agent, is_external) values ($1, 'Sky', 'Brighton', $2, true)`, [p, WIN])
    await d.query(`insert into page_opens(page, org, city, user_agent, is_external) values ('leading-social', 'Microsoft Limited', 'Dublin', $1, true)`, [WIN])
    await d.query(`select reclassify_opens('-infinity')`)
    const rows = (await d.query<{ open_class: string; class_reason: string }>(`select open_class, class_reason from page_opens order by id`)).rows
    expect(rows.map(r => r.open_class + ':' + r.class_reason)).toEqual(['human:default', 'human:default', 'human:default', 'human:microsoft_uncorroborated'])
  })
  it('nightly relabel job is scheduled', async () => {
    expect((await d.query(`select schedule, command from cron.job where jobname='open-reclassify-nightly'`)).rows[0]).toEqual({ schedule: '15 3 * * *', command: 'select public.reclassify_opens()' })
  })
})

describe('304 backfill block', () => {
  it('runs end to end on a fresh copy and seeds 117 hashes with no raw IPs', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const { readFileSync } = await import('node:fs')
    const { BASE } = await import('./openTrackingSchema')
    const d = new PGlite()
    await d.exec(BASE)
    await d.exec(readFileSync('db/303_open_class.sql', 'utf8'))
    await d.exec(`insert into scan_opens(company_slug, ip_hash, user_agent, device_type) values
      ('x', '17016c70a8d4539e7a6e8b061e65888b337352d5883b36eefdd0b8a6778d8f98', 'Mozilla/5.0 (Windows NT 10.0)', 'desktop')`)
    await d.exec(readFileSync('db/304_open_finalize_backfill.sql', 'utf8'))
    expect((await d.query(`select count(*)::int n, count(*) filter (where asn = 8075)::int ms from open_networks`)).rows[0]).toEqual({ n: 117, ms: 9 })
    expect((await d.query(`select count(*)::int n from open_networks where ip_hash !~ '^[0-9a-f]{64}$' or org ~ '\\d+\\.\\d+\\.\\d+\\.\\d+'`)).rows[0]).toEqual({ n: 0 })
    // a lone Microsoft row with no send, burst or proven address is a person who never rings (ruling B)
    expect((await d.query(`select net_asn, open_class, class_reason from scan_opens`)).rows[0]).toEqual({ net_asn: 8075, open_class: 'human', class_reason: 'microsoft_uncorroborated' })
    await d.close()
  }, 60_000)
})

describe('known org without an ASN is a known network', () => {
  it('a seeded network with no ASN does not trip the lookup-failed rule', async () => {
    const d = await openDb(2)
    const now = Date.now()
    await d.query(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ('00000000-0000-0000-0000-000000000001','outbound','linkedin',$1,'https://inboundonsteroids.com/scan/seed-a')`, [new Date(now - 60_000).toISOString()])
    await d.query(`insert into open_networks(ip_hash, asn, org, source) values ('SEEDED', null, 'IP Pools', 'gateway_log_backfill')`)
    const id = (await d.query<{ id: number }>(`insert into scan_opens(company_slug, opened_at, device_type, ip_hash, user_agent) values ('seed-a', $1, 'desktop', 'SEEDED', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/142.0.0.0') returning id`, [new Date(now).toISOString()])).rows[0].id
    expect((await d.query<{ r: { open_class: string } }>(`select scan_open_finalize($1, null, null, null, null) r`, [id])).rows[0].r.open_class).toBe('human')
    expect((await d.query(`select net_asn, net_org from scan_opens where id=$1`, [id])).rows[0]).toEqual({ net_asn: null, net_org: 'IP Pools' })
    await d.query(`update scan_opens set open_class = null where id=$1`, [id])
    await d.query(`select reclassify_opens('-infinity')`)
    expect((await d.query(`select open_class from scan_opens where id=$1`, [id])).rows[0]).toEqual({ open_class: 'human' })
    await d.close()
  }, 60_000)
})
