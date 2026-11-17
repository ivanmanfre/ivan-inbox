import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './openTrackingSchema'

const EXTRA = `
create table public.scans (company_slug text, prospect_token text, report_json jsonb);
create table public.swishdm_comparison_pages (token text, prospect_id uuid, brand text, url text, status text);
create table public.profile_view_log (prospect_id uuid, seat text, viewed_at timestamptz, captured_at timestamptz default now());
create table public.post_engagers (prospect_id uuid, first_seen_at timestamptz, last_seen_at timestamptz, engagement_type text, comment_text text, post_social_id text);
create table public.client_post_metrics (title text, post_url text, social_id text, captured_at timestamptz);
create table public.booking_attributions (meeting_id text not null, client_id text not null default 'risedtc', slug text, booked_at timestamptz, prospect_id uuid, verdict text not null default 'attributed');
`
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [LinkedInApp]/9.32.5383'
const C = { ivan: '00000000-0000-0000-0000-00000000c001', risedtc: '00000000-0000-0000-0000-00000000c002', arch: '00000000-0000-0000-0000-00000000c003' }

let db: PGlite
let n = 0
beforeAll(async () => {
  db = await openDb(6, EXTRA)
  await db.exec(`insert into outreach_campaigns values ('${C.ivan}', null, 'Ivan'), ('${C.risedtc}', 'risedtc', 'RISE'), ('${C.arch}', 'arch', 'ARCH')`)
}, 60_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec(`insert into integration_config(key, value) values ('scan_reopen_ring', 'on') on conflict (key) do update set value = 'on'`) })

const calls = async () => (await db.query<{ n: number }>(`select count(*)::int n from net.calls`)).rows[0].n
// a prospect who got the link 3 days ago and opened it (human) 2 days ago
async function person(lane: keyof typeof C = 'ivan', o: { host?: string; slugPrefix?: string } = {}) {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  const slug = (o.slugPrefix ?? 'ring-') + n
  const host = o.host ?? (lane === 'risedtc' ? 'resources.risedtc.com/scan' : 'inboundonsteroids.com/scan')
  await db.query(`insert into outreach_prospects(id, campaign_id, name, company) values ($1, $2, 'Pat Prospect', 'Acme Ltd')`, [id, C[lane]])
  await db.query(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', 'linkedin', now() - interval '3 days', $2)`, [id, `Made this: https://${host}/${slug}`])
  await db.query(`insert into scan_opens(company_slug, opened_at, device_type, referrer_host, user_agent, open_class, class_reason, classified_at, eligible)
    values ($1, now() - interval '2 days', 'mobile', 'www.linkedin.com', $2, 'human', 'linkedin_referrer', now() - interval '2 days', true)`, [slug, PHONE])
  return { id, slug }
}
// a fresh open from a known mobile network (ruling P5: an unknown network never rings); net: null = lookup failed
async function openNow(slug: string, o: { at?: string; ua?: string; ref?: string | null; view?: string; net?: [number | null, string | null] } = {}) {
  const id = (await db.query<{ id: number }>(`insert into scan_opens(company_slug, opened_at, device_type, referrer_host, user_agent, view)
    values ($1, coalesce($2::timestamptz, now()), 'mobile', $3, $4, coalesce($5, 'main')) returning id`,
    [slug, o.at ?? null, o.ref === undefined ? 'www.linkedin.com' : o.ref, o.ua ?? PHONE, o.view ?? null])).rows[0].id
  const [asn, org] = o.net ?? [25135, 'Vodafone UK']
  return (await db.query<{ r: { open_class: string; class_reason: string; ring: boolean; eligible: boolean } }>(`select scan_open_finalize($1, $2, $3, 'GB', 'London') r`, [id, asn, org])).rows[0].r
}

describe('second-day reopen ring (308)', () => {
  it('second-day human reopen rings once', async () => {
    const p = await person()
    const before = await calls()
    expect(await openNow(p.slug)).toMatchObject({ open_class: 'human', ring: true })
    expect(await calls()).toBe(before + 1)
    const body = (await db.query<{ body: Record<string, unknown> }>(`select body from net.calls order by id desc limit 1`)).rows[0].body
    expect(body).toMatchObject({ family: 'page_open_notice', source: 'db:scan_reopen', severity: 'attention', push: true,
      title: 'Pat Prospect reopened the scan', media: { kind: 'scan_reopen', lane: 'ivan', prospect_id: p.id, slug: p.slug } })
    expect(String(body.dedupe_key)).toMatch(new RegExp(`^scan_reopen:${p.slug}:\\d{4}-\\d{2}-\\d{2}$`))
    expect(String(body.body)).toMatch(/^Pat Prospect \(Acme Ltd\) opened the scan again today\. First opened \d{1,2} [A-Z][a-z]{2}, 2 days with an open\. No reply since the link went out on \d{1,2} [A-Z][a-z]{2}\. Nothing was sent to them\.$/)
    expect(String(body.body)).not.toMatch(/—/)
    expect((await db.query(`select lane from scan_reopen_rings where slug = $1`, [p.slug])).rows).toEqual([{ lane: 'ivan' }])
    expect(await openNow(p.slug)).toMatchObject({ ring: false })
    expect(await calls()).toBe(before + 1)
  })
  it('first-day reopen does not ring', async () => {
    const p = await person()
    await db.query(`update scan_opens set opened_at = now() - interval '1 minute' where company_slug = $1`, [p.slug])
    expect(await openNow(p.slug)).toMatchObject({ ring: false })
  })
  it('scanner reopen does not ring', async () => {
    const p = await person()
    // the link checker right after a LinkedIn resend of the link (a new checker address: suspect until confirmed)
    await db.query(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ($1, 'outbound', 'linkedin', now() - interval '30 seconds', $2)`, [p.id, `again: https://inboundonsteroids.com/scan/${p.slug}`])
    const id = (await db.query<{ id: number }>(`insert into scan_opens(company_slug, device_type, user_agent, ip_hash) values ($1, 'desktop', 'Mozilla/5.0 (Windows NT 10.0)', 'MSFT') returning id`, [p.slug])).rows[0].id
    expect((await db.query<{ r: { open_class: string; ring: boolean } }>(`select scan_open_finalize($1, 8075, 'Microsoft Corporation', 'US', 'Des Moines') r`, [id])).rows[0].r).toMatchObject({ open_class: 'suspect', class_reason: 'microsoft_after_send', eligible: false, ring: false })
    expect((await db.query(`select 1 from scan_reopen_rings where slug = $1`, [p.slug])).rows).toHaveLength(0)
    // the same person reopening right after still rings: the scanner row did not use up the day
    expect((await openNow(p.slug)).ring).toBe(true)
  })
  it('a Microsoft-network open with no behaviour is unresolved and never rings', async () => {
    const p = await person()
    const before = await calls()
    const id = (await db.query<{ id: number }>(`insert into scan_opens(company_slug, device_type, user_agent, ip_hash) values ($1, 'desktop', 'Mozilla/5.0 (Windows NT 10.0)', 'AZURE-VDI') returning id`, [p.slug])).rows[0].id
    expect((await db.query<{ r: { open_class: string; class_reason: string; ring: boolean } }>(`select scan_open_finalize($1, 8075, 'Microsoft Corporation', 'US', 'Des Moines') r`, [id])).rows[0].r).toMatchObject({ open_class: 'suspect', class_reason: 'microsoft_uncorroborated', eligible: false, ring: false })
    expect(await calls()).toBe(before)
    expect((await db.query(`select 1 from scan_reopen_rings where slug = $1`, [p.slug])).rows).toHaveLength(0)
  })
  it('a person whose network lookup failed counts but never rings', async () => {
    const p = await person()
    const before = await calls()
    expect(await openNow(p.slug, { ref: null, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Mobile/15E148', net: [null, null] })).toMatchObject({ open_class: 'human', class_reason: 'network_unknown', eligible: true, ring: false })
    expect(await calls()).toBe(before)
  })
  it('P5 (round-2 finding 4): a LinkedIn referral whose network lookup failed never rings', async () => {
    const p = await person()
    const before = await calls()
    expect(await openNow(p.slug, { net: [null, null] })).toMatchObject({ open_class: 'human', class_reason: 'linkedin_referrer', ring: false })
    expect(await calls()).toBe(before)
    expect((await db.query(`select 1 from scan_reopen_rings where slug = $1`, [p.slug])).rows).toHaveLength(0)
  })
  it('replied or booked prospect does not ring', async () => {
    const a = await person()
    await db.query(`insert into outreach_messages(prospect_id, direction, created_at, message_text) values ($1, 'inbound', now() - interval '1 day', 'thanks, will look')`, [a.id])
    expect(await openNow(a.slug)).toMatchObject({ ring: false })
    const r = await person()
    await db.query(`insert into outreach_messages(prospect_id, direction, created_at, message_text, is_reaction) values ($1, 'inbound', now() - interval '1 day', '👍', true)`, [r.id])
    expect(await openNow(r.slug)).toMatchObject({ ring: true })
    const b = await person()
    await db.query(`update outreach_prospects set call_booked_at = now() - interval '1 day' where id = $1`, [b.id])
    expect(await openNow(b.slug)).toMatchObject({ ring: false })
  })
  it('switch off means no ring', async () => {
    const p = await person()
    await db.exec(`delete from integration_config where key = 'scan_reopen_ring'`)
    expect(await openNow(p.slug)).toMatchObject({ open_class: 'human', ring: false })
    await db.exec(`insert into integration_config(key, value) values ('scan_reopen_ring', 'off')`)
    expect(await openNow(p.slug)).toMatchObject({ ring: false })
  })
  it('an updated old row does not ring', async () => {
    const p = await person()
    const id = (await db.query<{ id: number }>(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, open_class)
      values ($1, now() - interval '1 day', 'mobile', $2, 'link_scanner') returning id`, [p.slug, PHONE])).rows[0].id
    await db.query(`select reclassify_opens('-infinity')`)
    expect((await db.query(`select open_class, eligible from scan_opens where id = $1`, [id])).rows[0]).toEqual({ open_class: 'human', eligible: false })
    expect((await db.query<{ r: { ring: boolean } }>(`select scan_open_finalize($1, null, null, null, null) r`, [id])).rows[0].r.ring).toBe(false)
    expect((await db.query(`select 1 from scan_reopen_rings where slug = $1`, [p.slug])).rows).toHaveLength(0)
  })
  it('fourth ring of the day for a lane is skipped', async () => {
    await db.exec(`delete from scan_reopen_rings`)
    const ps = [await person('risedtc'), await person('risedtc'), await person('risedtc'), await person('risedtc')]
    const rings = []
    for (const p of ps) rings.push((await openNow(p.slug)).ring)
    expect(rings).toEqual([true, true, true, false])
    const other = await person('ivan')
    expect((await openNow(other.slug)).ring).toBe(true)
  })
  it('ARCH and SwishDM slugs do not ring here', async () => {
    const a = await person('arch', { host: 'madebyarch.com', slugPrefix: 'arch-acme-audit-' })
    expect((await openNow(a.slug)).ring).toBe(false)
    const s = await person('ivan', { host: 'madebyswishdm.com/compare' })
    expect((await openNow(s.slug)).ring).toBe(false)
  })
  it('a team page has its own title', async () => {
    const p = await person()
    expect((await openNow(p.slug, { view: 'team' })).ring).toBe(true)
    expect((await db.query<{ t: string }>(`select body->>'title' t from net.calls order by id desc limit 1`)).rows[0].t).toBe("Pat Prospect's team page was opened")
  })
  it('a notify failure never fails the open', async () => {
    const p = await person()
    await db.exec(`set test.net_breaks = '1'`)
    try {
      expect(await openNow(p.slug)).toMatchObject({ open_class: 'human', ring: false })
    } finally { await db.exec(`set test.net_breaks = '0'`) }
    expect((await db.query(`select 1 from scan_reopen_rings where slug = $1`, [p.slug])).rows).toHaveLength(0)
  })
  it('the migration does not switch the ring on', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('db/308_scan_reopen_ring.sql', 'utf8')).not.toMatch(/insert into public\.integration_config/i)
  })
})
