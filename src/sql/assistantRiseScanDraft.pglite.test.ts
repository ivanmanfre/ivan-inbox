import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('rechecks the exact RISE request against pending work, delivery, and newer inbound messages', { timeout: 60_000 }, async () => {
  const db = new PGlite()
  try {
    await db.exec(`
create role anon;
create role authenticated;
create role service_role;
create table outreach_campaigns(id int, client_id text);
create table outreach_prospects(id uuid, campaign_id int, name text, company text, company_domain text, blacklisted bool, call_booked_at timestamptz, solved_at timestamptz, stage text, skip_state text);
create table outreach_messages(id uuid default gen_random_uuid(), prospect_id uuid, direction text, sent_at timestamptz, created_at timestamptz, message_text text, is_reaction bool, channel text, recipient_email text);
create table integration_config(key text, value text);
create table rise_scan_requests(board_slug text, status text, finished_at timestamptz, updated_at timestamptz, scan_url text, prospect_id uuid, domain text);
insert into outreach_campaigns values(1, 'risedtc');
insert into outreach_prospects (id,campaign_id,name,company,company_domain) values('00000000-0000-4000-8000-000000000001',1,'Mira Jones','Mira Shop','example.test');
insert into integration_config values('outreach_email_identities','{"risedtc":{"from":"sender@example.test"}}');
insert into rise_scan_requests (board_slug,status,finished_at,scan_url,prospect_id) values ('rise-reply','ready','2026-11-18','https://resources.risedtc.com/scan/mira-shop','00000000-0000-4000-8000-000000000001');
insert into outreach_messages (id,prospect_id,direction,sent_at,message_text) values
  ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','outbound','2026-11-19','Want a growth scan?'),
  ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','inbound','2026-11-20','Please email the scan to old@example.test.'),
  ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','outbound','2026-11-21','Here is the scan https://resources.risedtc.com/scan/mira-shop/');
    `)
    for (const file of ['20261125_assistant_rise_scan_email.sql', '20261125_assistant_rise_scan_draft_current.sql']) {
      await db.exec(readFileSync('db/' + file, 'utf8'))
    }
    const old = '00000000-0000-4000-8000-000000000011'
    const corrected = '00000000-0000-4000-8000-000000000013'
    const prospect = '00000000-0000-4000-8000-000000000001'
    const current = async (id: string, asOf = '2026-11-25') => (await db.query<{ evidence: { address: string } | null }>(
      'select assistant_rise_scan_draft_current($1, $2) as evidence', [id, asOf],
    )).rows[0].evidence?.address
    expect(await current(old)).toBe('old@example.test')
    await db.query("insert into outreach_messages (id,prospect_id,direction,sent_at,message_text) values ($1,$2,'inbound','2026-11-22','Please send the scan to corrected@example.test. The old address is closed.')", [corrected, prospect])
    expect(await current(old)).toBeUndefined()
    expect(await current(corrected)).toBe('corrected@example.test')
    await db.query("insert into outreach_messages (prospect_id,direction,created_at,message_text) values ($1,'outbound','2026-11-23','Let me send that over.')", [prospect])
    expect(await current(corrected)).toBeUndefined()
    await db.query("update outreach_messages set sent_at='2026-11-23' where sent_at is null")
    expect(await current(corrected)).toBe('corrected@example.test')
    await db.query("insert into outreach_messages (prospect_id,direction,sent_at,channel,recipient_email,message_text) values ($1,'outbound','2026-11-24 20:00Z','email','corrected@example.test','Here is the report.')", [prospect])
    expect(await current(corrected)).toBeUndefined()
    expect(await current(corrected, '2026-11-24 12:00Z')).toBe('corrected@example.test')
    await db.query("insert into outreach_messages (prospect_id,direction,sent_at,message_text) values ($1,'inbound','2026-11-24 09:00Z','Actually please pause.')", [prospect])
    expect(await current(corrected, '2026-11-24 12:00Z')).toBeUndefined()
    for (const role of ['anon','authenticated','service_role']) {
      const { rows } = await db.query<{ allowed: boolean }>("select has_function_privilege($1,'assistant_rise_scan_draft_current(uuid,timestamptz)','EXECUTE') as allowed", [role])
      expect(rows[0].allowed).toBe(role === 'service_role')
    }
  } finally {
    await db.close()
  }
})
