import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
let pg: PGlite
const id = '11111111-1111-1111-1111-111111111111'
const evidence = { research: 'x'.repeat(90000), email_cc: ['cc@example.com'] }
const call = (enabled: boolean, expected: unknown = evidence, recipient: string | null = 'anthony@example.com') => pg.query(
  'select public.set_inbox_draft_email_delivery($1,$2,$3::jsonb,$4)',
  [id, enabled, expected == null ? null : JSON.stringify(expected), recipient],
)
const row = async () => (await pg.query<Record<string, unknown>>('select * from outreach_messages where id=$1', [id])).rows[0]
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table outreach_messages (id uuid primary key, direction text, channel text, message_type text,
      recipient_email text, email_mirror_text text, ai_model text, draft_evidence jsonb,
      approved_at timestamptz, sent_at timestamptz, unipile_message_id text, send_blocked_reason text);
    alter table outreach_messages enable row level security;
    grant select,update on outreach_messages to authenticated,service_role;
    create policy owned on outreach_messages to authenticated using (id::text=current_setting('request.jwt.claim.sub',true));`)
  await pg.exec(readFileSync(new URL('../../db/20261011_inbox_email_delivery.sql', import.meta.url), 'utf8'))
}, 15000)
beforeEach(async () => {
  await pg.exec('reset role; delete from outreach_messages')
  await pg.query(`insert into outreach_messages(id,direction,channel,message_type,recipient_email,email_mirror_text,draft_evidence)
    values($1,'outbound','linkedin','dm','anthony@example.com','Subject: Call',$2::jsonb)`, [id, JSON.stringify(evidence)])
})
afterAll(async () => { await pg.close() })
it('disables the email without approving or losing copy, address, or unrelated evidence', async () => {
  await call(false)
  expect(await row()).toMatchObject({ recipient_email: null, email_mirror_text: 'Subject: Call', approved_at: null, sent_at: null,
    draft_evidence: { ...evidence, email_cc: [], email_delivery_recipient: 'anthony@example.com' } })
})
it('restores the exact attached address and keeps CC empty', async () => {
  await call(false)
  const saved = (await row()).draft_evidence
  await call(true, saved, null)
  expect(await row()).toMatchObject({ recipient_email: 'anthony@example.com', email_mirror_text: 'Subject: Call', draft_evidence: { email_cc: [] } })
})
it.each(['approved_at','sent_at'])('rejects an already %s draft', async field => {
  await pg.exec(`update outreach_messages set ${field}=now()`)
  await expect(call(false)).rejects.toThrow(/draft changed/)
  expect((await row()).recipient_email).toBe('anthony@example.com')
})
it.each(['email','email_failed'])('does not turn off a standalone %s', async channel => {
  await pg.query('update outreach_messages set channel=$1', [channel])
  await expect(call(false)).rejects.toThrow(/draft changed/)
})
it('refuses a stale evidence or recipient snapshot', async () => {
  await expect(call(false, {}, 'anthony@example.com')).rejects.toThrow(/draft changed/)
  await expect(call(false, evidence, 'wrong@example.com')).rejects.toThrow(/draft changed/)
  expect((await row()).recipient_email).toBe('anthony@example.com')
})
it('rejects discarded drafts', async () => {
  await pg.exec("update outreach_messages set send_blocked_reason='discarded_in_inbox'")
  await expect(call(false)).rejects.toThrow(/draft changed/)
})
it('fails closed without row access', async () => {
  await pg.exec("select set_config('request.jwt.claim.sub','another-owner',false); set role authenticated")
  await expect(call(false)).rejects.toThrow(/draft changed/)
})
it('refuses anonymous execution', async () => {
  await pg.exec('set role anon')
  await expect(call(false)).rejects.toThrow(/permission denied/)
})
