// Round-1 cross-review reproducers (2026-11-17), ported as regression tests that assert the CORRECT behaviour.
// Source: the reviewer's reviewIndependent.test.ts. Each block names its finding.
import type { PGlite } from '@electric-sql/pglite'
import { PGlite as PG } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE, openDb } from './openTrackingSchema'

const EXTRA = `
create table public.scans (company_slug text, prospect_token text, report_json jsonb);
create table public.swishdm_comparison_pages (token text, prospect_id uuid, brand text, url text, status text);
create table public.profile_view_log (prospect_id uuid, seat text, viewed_at timestamptz, captured_at timestamptz default now());
create table public.post_engagers (prospect_id uuid, first_seen_at timestamptz, last_seen_at timestamptz, engagement_type text, comment_text text, post_social_id text);
create table public.client_post_metrics (title text, post_url text, social_id text, captured_at timestamptz);
create table public.booking_attributions (meeting_id text not null, client_id text not null default 'risedtc', slug text,
  booked_at timestamptz, prospect_id uuid, verdict text not null default 'attributed');
`
const CHROME = 'Mozilla/5.0 Chrome/142'
let db: PGlite
const q = async (s: string, a: unknown[] = []) => (await db.query(s, a)).rows as Array<Record<string, any>>
beforeAll(async () => { db = await openDb(7, EXTRA) }, 60_000)
afterAll(async () => { await db?.close() })

describe('round-1 review reproducers', () => {
  it('finding 3 (ruling P1/P5): an ordinary browser on AS8075 and a Microsoft-org page visitor are unresolved, a lookup timeout after a send is a person; none rings', async () => {
    const rows = await q(`select 'azure-no-referrer' s, * from scan_open_classify(false, $1, null, 'desktop', 8075, 'Microsoft Corporation', false, false, false, false, false, false)
      union all select 'lookup-timeout', * from scan_open_classify(false, $1, null, 'desktop', null, null, false, true, false, false, false, false)
      union all select 'azure-page', * from page_open_classify(true, 'Microsoft Corporation', $1, null, false, false, false, false, false, false, false)`, [CHROME])
    expect(rows.map(r => [r.s, r.open_class, r.class_reason])).toEqual([['azure-no-referrer', 'suspect', 'microsoft_uncorroborated'], ['lookup-timeout', 'human', 'network_unknown'], ['azure-page', 'suspect', 'microsoft_uncorroborated']])
    // none of them may ring or alert, even if eligible: suspect never, an unknown network never
    expect((await q(`select open_may_ring('suspect', true, true) a, open_may_ring('human', true, false) b`))[0]).toEqual({ a: false, b: false })
  })

  it('finding 8: a fresh desktop row with no ASN and organization "Microsoft Corporation" is never human:default', async () => {
    await q(`insert into scan_opens(company_slug, device_type, user_agent, ip_hash) values ('missing-asn', 'desktop', $1, 'new-microsoft')`, [CHROME])
    const r = (await q(`select scan_open_finalize(id, null, 'Microsoft Corporation', 'US', 'Boydton') result from scan_opens where company_slug = 'missing-asn'`))[0].result
    expect(r.class_reason).not.toBe('default')
    expect(r).toMatchObject({ open_class: 'suspect', class_reason: 'microsoft_uncorroborated', eligible: false, ring: false })
    // with a LinkedIn send carrying the link just before, the same network is suspect after a send (address unconfirmed)
    await q(`insert into outreach_messages(prospect_id, direction, channel, sent_at, message_text) values ('00000000-0000-0000-0000-0000000000f1', 'outbound', 'linkedin', now() - interval '50 seconds', 'https://inboundonsteroids.com/scan/missing-asn-2')`)
    await q(`insert into scan_opens(company_slug, device_type, user_agent, ip_hash) values ('missing-asn-2', 'desktop', $1, 'new-microsoft-2')`, [CHROME])
    expect((await q(`select scan_open_finalize(id, null, 'Microsoft Corporation', 'US', 'Boydton') r from scan_opens where company_slug = 'missing-asn-2'`))[0].r).toMatchObject({ open_class: 'suspect', class_reason: 'microsoft_after_send' })
  })

  it('finding 4: three LinkedIn visitors opening different scans through one office address stay people', async () => {
    await q(`insert into scan_opens(company_slug, opened_at, device_type, user_agent, referrer_host, ip_hash) values
      ('office-a', now() - interval '3 hours', 'desktop', $1, 'www.linkedin.com', 'office-ip'),
      ('office-b', now() - interval '1 hour', 'desktop', $1, 'www.linkedin.com', 'office-ip'),
      ('office-c', now(), 'desktop', $1, 'www.linkedin.com', 'office-ip')`, [CHROME])
    expect((await q(`select scan_open_finalize(id, 5089, 'Virgin Media', 'GB', 'London') result from scan_opens where company_slug = 'office-c'`))[0].result)
      .toMatchObject({ open_class: 'human', class_reason: 'linkedin_referrer' })
    // the nightly relabel does not take the earlier people away either
    await q(`select reclassify_opens('-infinity')`)
    expect((await q(`select open_class from scan_opens where ip_hash = 'office-ip' order by id`)).map(r => r.open_class)).toEqual(['human', 'human', 'human'])
  })

  it('finding 4: three unrelated visitors sharing Comcast + Denver on three pages, each with their own browser, are all people', async () => {
    for (const [page, ua] of [['shared-a', CHROME], ['shared-b', 'Mozilla/5.0 Safari/605'], ['shared-c', 'Mozilla/5.0 Firefox/140']])
      await q(`insert into page_opens(page, org, city, is_external, user_agent) values ($1, 'Comcast', 'Denver', true, $2)`, [page, ua])
    expect((await q(`select page, open_class from page_opens where page like 'shared-%' order by id`)).map(r => r.open_class)).toEqual(['human', 'human', 'human'])
  })
  it('finding 4 under ruling P3: the same browser string on three pages within 10 minutes and no address is never owner, only unresolved', async () => {
    for (const page of ['same-ua-a', 'same-ua-b', 'same-ua-c'])
      await q(`insert into page_opens(page, org, city, is_external, user_agent) values ($1, 'Comcast', 'Boulder', true, $2)`, [page, CHROME])
    const rows = await q(`select open_class, class_reason from page_opens where page like 'same-ua-%' order by id`)
    expect(rows.map(r => r.open_class)).not.toContain('owner')
    expect(rows.map(r => `${r.open_class}:${r.class_reason}`)).toEqual(['human:default', 'human:default', 'suspect:burst_no_address'])
  })

  it('finding 6: the classifiers are not callable with the public key', async () => {
    const acl = await q(`select proname, has_function_privilege('anon', oid, 'execute') anon_execute from pg_proc
      where proname in ('scan_open_classify', 'page_open_classify', 'scan_open_finalize', 'human_scan_opens', 'swishdm_report_opened', 'scan_reopen_ring_step', 'open_release_grant') order by proname`)
    expect(acl.every(r => r.anon_execute === false)).toBe(true)
    await db.exec(`set role anon`)
    try {
      await expect(db.query(`select * from public.page_open_classify(true, 'Comcast', $1, null, false, false, false, false, false, false, false)`, [CHROME])).rejects.toThrow(/permission denied/)
    } finally { await db.exec(`reset role`) }
  })

  it('finding 2: re-finalizing an existing recent row after a relabel never rings', async () => {
    await db.exec(`insert into outreach_campaigns values ('00000000-0000-0000-0000-00000000c001', null, 'Ivan');
      insert into outreach_prospects(id, campaign_id, name) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c001', 'Recent');
      insert into outreach_messages(prospect_id, direction, sent_at, message_text) values ('00000000-0000-0000-0000-000000000001', 'outbound', now() - interval '3 days', 'https://inboundonsteroids.com/scan/recent');
      insert into scan_opens(company_slug, opened_at, device_type, user_agent, referrer_host, open_class, eligible) values
        ('recent', now() - interval '1 day', 'mobile', 'Mobile', 'www.linkedin.com', 'human', true),
        ('recent', now() - interval '5 minutes', 'mobile', 'Mobile', 'www.linkedin.com', 'link_scanner', false);
      insert into integration_config(key, value) values ('scan_reopen_ring', 'on');
      select reclassify_opens('-infinity');`)
    const before = (await q(`select count(*)::int n from net.calls`))[0].n
    const rows = await q(`select scan_open_finalize(id, 25135, 'Vodafone UK', 'GB', 'London') result from scan_opens where company_slug = 'recent' and opened_at > now() - interval '10 minutes'`)
    expect(rows[0].result).toMatchObject({ open_class: 'human', eligible: false, ring: false })
    expect((await q(`select count(*)::int n from net.calls`))[0].n).toBe(before)
    // a genuinely fresh insert, labelled for the first time, still rings (the ring itself is not broken)
    await q(`insert into scan_opens(company_slug, device_type, user_agent, referrer_host) values ('recent', 'mobile', 'Mobile', 'www.linkedin.com')`)
    const fresh = await q(`select scan_open_finalize(max(id), 25135, 'Vodafone UK', 'GB', 'London') r from scan_opens where company_slug = 'recent'`)
    expect(fresh[0].r).toMatchObject({ open_class: 'human', eligible: true, ring: true })
    // and finalizing that same row again does not ring a second time
    expect((await q(`select scan_open_finalize(max(id), 25135, 'Vodafone UK', 'GB', 'London') r from scan_opens where company_slug = 'recent'`))[0].r.ring).toBe(false)
    await q(`delete from integration_config where key = 'scan_reopen_ring'`)
  })

  it('finding 1: opens before the first recorded link send never become came-back cards for a post-cutover email link', async () => {
    await db.exec(`insert into outreach_prospects(id, campaign_id, name) values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000c001', 'Pre-send');
      update integration_config set value = (now() - interval '2 hours')::text where key = 'open_class_cutover_at';
      insert into outreach_messages(prospect_id, direction, message_type, channel, sent_at, message_text) values
        ('00000000-0000-0000-0000-000000000002', 'outbound', 'dm', 'linkedin', now() - interval '4 days', 'Hello'),
        ('00000000-0000-0000-0000-000000000002', 'outbound', 'email', 'email', now() - interval '1 hour', 'https://inboundonsteroids.com/scan/pre-send');
      insert into scan_opens(company_slug, opened_at, device_type, user_agent, referrer_host, open_class, class_reason, eligible) values
        ('pre-send', now() - interval '3 days', 'mobile', 'Mobile', 'www.linkedin.com', 'human', 'linkedin_referrer', true),
        ('pre-send', now() - interval '2 days', 'mobile', 'Mobile', 'www.linkedin.com', 'human', 'linkedin_referrer', true);`)
    for (const f of ['came_back_cards', 'inbox_interest_cards'])
      expect((await q(`select count(*)::int n from ${f}() where name = 'Pre-send'`))[0].n).toBe(0)
    // a prospect whose link went out after the cutover and who reopened 1h+ after the first open still counts
    await db.exec(`insert into outreach_prospects(id, campaign_id, name) values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000c001', 'Post-send');
      insert into outreach_messages(prospect_id, direction, message_type, channel, sent_at, message_text) values
        ('00000000-0000-0000-0000-000000000003', 'outbound', 'dm', 'linkedin', now() - interval '95 minutes', 'Hello'),
        ('00000000-0000-0000-0000-000000000003', 'outbound', 'email', 'email', now() - interval '90 minutes', 'https://inboundonsteroids.com/scan/post-send');
      insert into scan_opens(company_slug, opened_at, device_type, user_agent, referrer_host, open_class, class_reason, eligible) values
        ('post-send', now() - interval '85 minutes', 'mobile', 'Mobile', 'www.linkedin.com', 'human', 'linkedin_referrer', true),
        ('post-send', now() - interval '10 minutes', 'mobile', 'Mobile', 'www.linkedin.com', 'human', 'linkedin_referrer', true);`)
    expect((await q(`select count(*)::int n from came_back_cards() where name = 'Post-send'`))[0].n).toBe(1)
  })
})

describe('finding 5: old schema during a rollback', () => {
  it('the new payload fails on the old schema and the legacy payload (no view) works: the edge function retries with it', async () => {
    const d = new PG()
    await d.exec(BASE)
    let error = ''
    try { await d.exec(`insert into scan_opens(company_slug, view) values ('during-rollback', 'main')`) } catch (e) { error = String(e) }
    expect(error).toContain('view')
    await d.exec(`insert into scan_opens(company_slug) values ('during-rollback')`)
    expect((await d.query<{ n: number }>('select count(*)::int n from scan_opens')).rows[0].n).toBe(1)
    await d.close()
  }, 60_000)
  it('every rollback file runs newest first and leaves the table the old edge function writes to', async () => {
    const d = await openDb(7, EXTRA)
    for (const f of ['309_open_daily_check', '308_scan_reopen_ring', '307_scan_page_events', '306_open_evidence_cutover', '305_open_readers', '304_open_finalize_backfill', '303_open_class'])
      await d.exec(readFileSync(`db/${f}_rollback.sql`, 'utf8'))
    await d.exec(`insert into scan_opens(company_slug, is_owner, device_type, referrer_host, ip_hash, user_agent) values ('after-rollback', false, 'mobile', null, 'h', 'ua')`)
    await d.exec(`insert into page_opens(page, org, city, is_external) values ('leading-social', 'Comcast', 'Denver', true)`)
    expect((await d.query<{ n: number }>(`select count(*)::int n from scan_opens where company_slug = 'after-rollback'`)).rows[0].n).toBe(1)
    await d.close()
  }, 60_000)
})
