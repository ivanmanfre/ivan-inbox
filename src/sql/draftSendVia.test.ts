import { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

let pg: PGlite
const id = '11111111-1111-1111-1111-111111111111'
const email = 'Subject: ARCH x Outplay\n\nHi Doug,\n\nDid you see the details?'
const evidence = { research: 'keep', email_cc: ['copy@example.com'], send_via: 'email' }
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table outreach_messages (id uuid primary key, direction text, channel text, message_type text,
      message_text text, recipient_email text, email_mirror_text text, ai_model text, draft_evidence jsonb,
      approved_at timestamptz, sent_at timestamptz, unipile_message_id text, unipile_chat_id text,
      send_blocked_reason text, send_blocked_at timestamptz);
    alter table outreach_messages enable row level security;
    grant select,update on outreach_messages to authenticated,service_role;
    create policy owned on outreach_messages to authenticated using (id::text=current_setting('request.jwt.claim.sub',true));`)
  await pg.exec(`create schema auth; create function auth.uid() returns uuid language sql as $$select '${id}'::uuid$$;`)
  await pg.exec(readFileSync('db/20261013_inbox_email_approval_receipt.sql', 'utf8'))
  const migration = 'db/20261014_inbox_draft_send_via.sql'
  if (existsSync(migration)) await pg.exec(readFileSync(migration, 'utf8'))
}, 15000)
beforeEach(async () => {
  await pg.exec('reset role; delete from outreach_messages')
  await pg.query(`insert into outreach_messages(id,direction,channel,message_type,message_text,recipient_email,email_mirror_text,ai_model,draft_evidence)
    values($1,'outbound','linkedin','dm','Saved DM','doug@outplay.com',$2,'arch_stall_bump_v2',$3::jsonb)`, [id, email, JSON.stringify(evidence)])
})
afterAll(async () => { await pg.close() })
const row = async () => (await pg.query<Record<string, any>>('select * from outreach_messages where id=$1', [id])).rows[0]
const approve = async () => {
  const m = await row()
  return pg.query('select approve_inbox_pipeline_draft($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9)',
    [id, 'Reviewed DM', JSON.stringify(m.draft_evidence), 'linkedin-chat', m.email_mirror_text, m.recipient_email,
      m.draft_evidence.email_subject ?? null, JSON.stringify(m.draft_evidence.email_cc ?? []), m.draft_evidence.send_via ?? null])
}
const choose = async (mode: string, expected?: unknown) => {
  const m = await row()
  return pg.query('select set_inbox_draft_send_via($1,$2,$3::jsonb,$4)',
    [id, mode, JSON.stringify(expected ?? m.draft_evidence), m.recipient_email])
}

it('queues only the reviewed email on the existing email route, retaining the unused DM as evidence', async () => {
  await approve()
  const m = await row()
  expect(m).toMatchObject({ channel: 'email', message_type: 'email', message_text: email,
    email_mirror_text: null, recipient_email: 'doug@outplay.com', sent_at: null })
  expect(m.approved_at).toBeTruthy()
  expect(m.draft_evidence).toMatchObject({ research: 'keep', unsent_dm_text: 'Reviewed DM',
    operator_copy_approval: { text: email, email_mirror_text: '', recipient_email: 'doug@outplay.com', email_cc: ['copy@example.com'] } })
})
it.each(['dm', 'both', 'email'])('saves %s without approving or changing either copy', async mode => {
  await choose(mode)
  expect(await row()).toMatchObject({ message_text: 'Saved DM', email_mirror_text: email,
    approved_at: null, sent_at: null, channel: 'linkedin', draft_evidence: { research: 'keep', send_via: mode } })
})
it('DM-only approval has no recipient or CC for the sender to email', async () => {
  await choose('dm'); await approve()
  expect(await row()).toMatchObject({ channel: 'linkedin', message_type: 'dm', message_text: 'Reviewed DM',
    recipient_email: null, email_mirror_text: email, draft_evidence: { email_cc: [] } })
})
it('both preserves the DM and attached email sender contract', async () => {
  await choose('both'); await approve()
  expect(await row()).toMatchObject({ channel: 'linkedin', message_type: 'dm', message_text: 'Reviewed DM',
    recipient_email: 'doug@outplay.com', email_mirror_text: email })
})
it('restores the original email recipient after a DM-only choice', async () => {
  await choose('dm'); await choose('email')
  expect((await row()).recipient_email).toBe('doug@outplay.com')
})
it('refuses stale choices and invalid modes', async () => {
  await expect(choose('email', {})).rejects.toThrow(/changed|refresh/i)
  await expect(choose('fax')).rejects.toThrow(/channel|choice|mode/i)
  expect((await row()).approved_at).toBeNull()
})
it.each(['approved_at=now()', 'sent_at=now()', "send_blocked_reason='discarded_in_inbox'"])( 'refuses changing an ineligible draft: %s', async change => {
  await pg.exec(`update outreach_messages set draft_evidence=jsonb_set(draft_evidence,'{send_via}','"both"')`)
  await pg.exec(`update outreach_messages set ${change}`)
  await expect(choose('dm')).rejects.toThrow(/changed|refresh/i)
})
it('refuses an old browser approval without an independently reviewed send mode', async () => {
  const m = await row()
  await expect(pg.query('select approve_inbox_pipeline_draft($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb)',
    [id,'Reviewed DM',JSON.stringify(m.draft_evidence),null,email,'doug@outplay.com',null,JSON.stringify(['copy@example.com'])])).rejects.toThrow(/changed|refresh/i)
  expect((await row()).approved_at).toBeNull()
})
it('preserves follow-up lineage while changing its delivery contract to email', async () => {
  const followup = { v: 'conversation_followup_v1', channel: 'linkedin', chat_id: 'native-chat', latest_inbound_id: 'in', latest_outbound_id: 'out', input_message_ids: ['in','out'], due_at: '2026-10-14T09:00:00Z', native_latest: { id: 'native', text: 'Last turn' } }
  await pg.query('update outreach_messages set draft_evidence=draft_evidence || $1::jsonb',[JSON.stringify({ followup })])
  await approve()
  expect((await row()).draft_evidence.followup).toEqual({ ...followup, channel: 'email', chat_id: null })
})
it.each(['rise_dm2_scan_delivery_v1','rise_reply_softdecline_v2'])('keeps the saved mirror needed by the scan quality gate for %s', async model => {
  await pg.query('update outreach_messages set ai_model=$1',[model])
  await approve()
  expect(await row()).toMatchObject({ channel: 'email', message_text: email, email_mirror_text: email,
    draft_evidence: { operator_copy_approval: { text: email, email_mirror_text: email } } })
})
it('refuses a generic rejection override that would bypass the chosen email route', async () => {
  await expect(pg.exec('update outreach_messages set approved_at=now()')).rejects.toThrow(/Use Send email/)
  expect((await row()).approved_at).toBeNull()
})
it('requires a real email body for email-only approval', async () => {
  await pg.exec("update outreach_messages set email_mirror_text='Subject: Empty'")
  await expect(approve()).rejects.toThrow(/email.*draft|email.*body/i)
  expect((await row()).approved_at).toBeNull()
})
it('uses the saved subject when the mirror body has no Subject line', async () => {
  await pg.exec(`update outreach_messages set email_mirror_text='Hi Doug, checking in.',
    draft_evidence=draft_evidence || '{"email_subject":"ARCH follow-up"}'::jsonb`)
  await approve()
  expect((await row()).message_text).toBe('Subject: ARCH follow-up\n\nHi Doug, checking in.')
})
it('releases an email-only scheduled follow-up through the email route', async () => {
  await pg.exec(`update outreach_messages set message_type='manual_reply',send_blocked_reason='scheduled_in_inbox',
    draft_evidence=draft_evidence || '{"scheduled_send":{"state":"scheduled"}}'::jsonb`)
  await pg.exec('update outreach_messages set approved_at=now(),send_blocked_reason=null')
  const m = await row()
  expect(m).toMatchObject({ channel: 'email', message_text: email, email_mirror_text: null, unipile_chat_id: null })
  expect(m.draft_evidence.operator_copy_approval.text).toBe(email)
})
it('keeps operator RLS and anonymous permission checks on delivery choices', async () => {
  const request = () => pg.query('select set_inbox_draft_send_via($1,$2,$3::jsonb,$4)', [id, 'dm', JSON.stringify(evidence), 'doug@outplay.com'])
  await pg.exec("select set_config('request.jwt.claim.sub','another-owner',false); set role authenticated")
  await expect(request()).rejects.toThrow(/changed|refresh/i)
  await pg.exec('reset role; set role anon')
  await expect(request()).rejects.toThrow(/permission denied/i)
})
