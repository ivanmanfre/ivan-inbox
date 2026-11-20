// Round-3 cross-review reproducers (2026-11-17), ported as regression tests that assert the CORRECT behaviour under
// rulings R1 (owner only from the owner flag on that request) and R2 (a scanner address is confirmed by 3+ different
// recipients, each open within 15 minutes after a message to that recipient carrying the link). All people,
// companies, links and addresses are invented.
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
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36'
const CAMPAIGN = '00000000-0000-0000-0000-00000000c001'
let db: PGlite
let n = 0
const q = async (s: string, a: unknown[] = []) => (await db.query(s, a)).rows as Array<Record<string, any>>
const calls = async () => (await q(`select count(*)::int n from net.calls`))[0].n as number
const rings = async () => (await q(`select count(*)::int n from scan_reopen_rings`))[0].n as number
async function person(name: string) {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  await q(`insert into outreach_prospects(id, campaign_id, name) values ($1, $2, $3)`, [id, CAMPAIGN, name])
  return id
}
const send = (to: string | null, link: string, ago: string, channel = 'email') => q(
  `insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', $2, now() - $3::interval, $4)`,
  [to, channel, ago, `Made this for you: ${link}`])
const scanOpen = async (slug: string, hash: string, o: { ago?: string; ref?: string | null; owner?: boolean } = {}) =>
  (await q(`insert into scan_opens(company_slug, opened_at, is_owner, ip_hash, user_agent, referrer_host)
    values ($1, now() - coalesce($2, '0 seconds')::interval, $3, $4, $5, $6) returning id`,
    [slug, o.ago ?? null, o.owner ?? false, hash, UA, o.ref ?? null]))[0].id as number
const fin = async (id: number, asn: number | null, org: string | null) =>
  (await q(`select scan_open_finalize($1, $2, $3, 'GB', 'London') r`, [id, asn, org]))[0].r as Record<string, any>
const pageOpen = async (token: string, hash: string, ago: string) =>
  (await q(`insert into page_opens(page, created_at, org, city, country, user_agent, is_external, ip_hash, alerted)
    values ($1, now() - $2::interval, 'Microsoft Corporation', 'Dublin', 'Ireland', $3, true, $4, true)
    returning open_class, class_reason, eligible, alerted`, [`swishdm/compare/${token}`, ago, UA, hash]))[0]

beforeAll(async () => {
  db = await openDb(7, EXTRA)
  await q(`insert into outreach_campaigns values ($1, null, 'Ivan')`, [CAMPAIGN])
  await q(`insert into integration_config(key, value) values ('scan_reopen_ring', 'on') on conflict (key) do update set value = 'on'`)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('round-3 review reproducers, correct behaviour', () => {
  it('R2 (reviewer case): one recipient with three portfolio reports on Microsoft egress stays suspect, never a confirmed scanner', async () => {
    const owner = await person('Pia Portfolio')
    const before = await calls()
    const results: Array<Record<string, any>> = []
    for (let i = 1; i <= 3; i++) {
      await send(owner, `https://example.test/scan/portfolio-${i}`, '1 minute')
      results.push(await fin(await scanOpen(`portfolio-${i}`, 'azure-vpn'), 8075, 'Microsoft Corporation'))
    }
    expect(results.map(r => `${r.open_class}:${r.class_reason}`)).toEqual(Array(3).fill('suspect:microsoft_after_send'))
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select company_slug, open_class, class_reason, eligible from scan_opens where ip_hash = 'azure-vpn' order by id`)).toEqual(
      [1, 2, 3].map(i => ({ company_slug: `portfolio-${i}`, open_class: 'suspect', class_reason: 'microsoft_after_send', eligible: false })))
    expect(await calls()).toBe(before)
  })

  it('R1 (reviewer case): five owner clicks on shared office Wi-Fi never make a LinkedIn visitor on it the owner', async () => {
    for (let i = 0; i < 5; i++) await scanOpen(`owner-review-${i}`, 'coworking-wifi', { ago: '1 hour', owner: true })
    const id = await scanOpen('real-office-visitor', 'coworking-wifi', { ref: 'www.linkedin.com' })
    expect(await fin(id, 5089, 'Virgin Media')).toEqual({ open_class: 'suspect', class_reason: 'owner_address', eligible: false, ring: false })
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select open_class, class_reason, eligible from scan_opens where id = $1`, [id])).toEqual([{ open_class: 'suspect', class_reason: 'owner_address', eligible: false }])
    // only the five rows with the owner flag on their own request are owner
    expect(await q(`select open_class || ':' || class_reason c, count(*)::int n from scan_opens where ip_hash = 'coworking-wifi' group by 1 order by 1`)).toEqual([
      { c: 'owner:owner_flag_or_ip', n: 5 }, { c: 'suspect:owner_address', n: 1 }])
  })
})

describe('R2: a scanner address is confirmed by three different recipients', () => {
  it('opens whose link has no known recipient count for none', async () => {
    for (const s of ['anon-a', 'anon-b', 'anon-c']) {
      await send(null, `https://example.test/scan/${s}`, '2 minutes', 'linkedin')
      await fin(await scanOpen(s, 'ms-anon', { ago: '1 minute' }), 8075, 'Microsoft Corporation')
    }
    await q(`select reclassify_opens('-infinity')`)
    expect((await q(`select distinct open_class || ':' || class_reason c from scan_opens where ip_hash = 'ms-anon'`)).map(r => r.c)).toEqual(['suspect:microsoft_after_send'])
  })

  it('two recipients stay suspect; a third recipient after their own send confirms the address and relabels the earlier rows, granting nothing', async () => {
    const [a, b, c] = [await person('Ann Alpha'), await person('Bo Beta'), await person('Cal Gamma')]
    // each recipient also opened their own scan from LinkedIn yesterday (eligible people)
    for (const s of ['r2-a', 'r2-b', 'r2-c'])
      await q(`insert into scan_opens(company_slug, opened_at, user_agent, referrer_host, open_class, class_reason, classified_at, eligible)
        values ($1, now() - interval '1 day', $2, 'www.linkedin.com', 'human', 'linkedin_referrer', now(), true)`, [s, UA])
    const before = { calls: await calls(), rings: await rings(), elig: (await q(`select count(*)::int n from scan_opens where eligible`))[0].n }
    await send(a, 'https://example.test/scan/r2-a', '41 minutes', 'linkedin')
    await send(b, 'https://example.test/scan/r2-b', '26 minutes')
    const r1 = await fin(await scanOpen('r2-a', 'ms-checker', { ago: '40 minutes' }), 8075, 'Microsoft Limited')
    const r2 = await fin(await scanOpen('r2-b', 'ms-checker', { ago: '25 minutes' }), null, null)
    // a second link to recipient b is still recipient b
    await send(b, 'https://example.test/scan/r2-b2', '19 minutes')
    const r2b = await fin(await scanOpen('r2-b2', 'ms-checker', { ago: '18 minutes' }), null, null)
    expect([r1, r2, r2b].map(r => `${r.open_class}:${r.class_reason}`)).toEqual(Array(3).fill('suspect:microsoft_after_send'))
    await send(c, 'https://example.test/scan/r2-c', '10 minutes')
    const r3 = await fin(await scanOpen('r2-c', 'ms-checker', { ago: '9 minutes' }), null, null)
    expect(r3).toEqual({ open_class: 'link_scanner', class_reason: 'confirmed_scanner_address', eligible: false, ring: false })
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select open_class, class_reason, eligible from scan_opens where ip_hash = 'ms-checker' order by id`)).toEqual(
      Array(4).fill({ open_class: 'link_scanner', class_reason: 'confirmed_scanner_address', eligible: false }))
    expect(await calls()).toBe(before.calls)
    expect(await rings()).toBe(before.rings)
    expect((await q(`select count(*)::int n from scan_opens where eligible`))[0].n).toBe(before.elig)
  })

  it('page rows: one recipient with three reports stays suspect; three recipients confirm, and no row is eligible or alerted', async () => {
    const one = await person('Dee Single')
    const t1 = ['aaaaaaaaaaaaaaaaaaa2', 'aaaaaaaaaaaaaaaaaaa3', 'aaaaaaaaaaaaaaaaaaa4']
    for (const [i, t] of t1.entries()) await send(one, `https://example.test/compare/${t}`, `${41 - i * 15} minutes`)
    const before = await calls()
    const single = [] as Array<Record<string, any>>
    for (const [i, t] of t1.entries()) single.push(await pageOpen(t, 'ms-page-one', `${40 - i * 15} minutes`))
    expect(single).toEqual(Array(3).fill({ open_class: 'suspect', class_reason: 'microsoft_after_send', eligible: false, alerted: false }))

    const t3 = ['bbbbbbbbbbbbbbbbbbb2', 'bbbbbbbbbbbbbbbbbbb3', 'bbbbbbbbbbbbbbbbbbb4']
    const many = [] as Array<Record<string, any>>
    for (const [i, t] of t3.entries()) {
      await send(await person(`Page Reader ${i}`), `https://example.test/compare/${t}`, `${41 - i * 15} minutes`)
      many.push(await pageOpen(t, 'ms-page-many', `${40 - i * 15} minutes`))
    }
    expect(many.map(r => `${r.open_class}:${r.class_reason}`)).toEqual(['suspect:microsoft_after_send', 'suspect:microsoft_after_send', 'link_scanner:confirmed_scanner_address'])
    await q(`select reclassify_opens('-infinity')`)
    expect(await q(`select ip_hash, open_class, class_reason, eligible, alerted from page_opens where ip_hash like 'ms-page-%' order by id`)).toEqual([
      ...Array(3).fill({ ip_hash: 'ms-page-one', open_class: 'suspect', class_reason: 'microsoft_after_send', eligible: false, alerted: false }),
      ...Array(3).fill({ ip_hash: 'ms-page-many', open_class: 'link_scanner', class_reason: 'confirmed_scanner_address', eligible: false, alerted: false })])
    expect(await calls()).toBe(before)
  })
})
