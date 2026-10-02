import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

let db: PGlite
const id = 'ff108ab7-ce03-40e8-ae48-fdc1cccc770b'
const evidence = { generated_text: 'Original', research: 'x'.repeat(90000) }
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role service_role; create role anon;
    create table outreach_messages (
      id uuid primary key, direction text, message_type text, ai_model text,
      message_text text, sent_at timestamptz, approved_at timestamptz,
      unipile_message_id text, unipile_chat_id text, send_blocked_reason text,
      send_blocked_at timestamptz, draft_evidence jsonb
    );
    grant usage on schema public to authenticated, anon;
    grant select, update on outreach_messages to authenticated;
    alter table outreach_messages enable row level security;
    create policy operator on outreach_messages to authenticated using (true) with check (true);
  `)
  await db.query(`insert into outreach_messages (id,direction,message_type,ai_model,message_text,unipile_chat_id,draft_evidence)
    values ($1,'outbound','dm','arch_reply_draft_v2','Original','existing-chat',$2::jsonb)`, [id, JSON.stringify(evidence)])
  const path = 'db/20261002_inbox_pipeline_approval.sql'
  if (existsSync(path)) await db.exec(readFileSync(path, 'utf8'))
})
afterEach(async () => { await db.close() })
const approve = (expected: unknown = evidence, chat: string | null = null) => db.query(
  'select approve_inbox_pipeline_draft($1,$2,$3::jsonb,$4)', [id, 'Reviewed PC games reply', expected == null ? null : JSON.stringify(expected), chat])
const row = async () => (await db.query<Record<string, any>>('select * from outreach_messages')).rows[0]

it('approves large evidence atomically under the existing authenticated RLS policy', async () => {
  await db.exec('set role authenticated')
  await approve(evidence, 'chat-1')
  const m = await row()
  expect(m).toMatchObject({ message_type: 'dm', ai_model: 'arch_reply_draft_v2', message_text: 'Reviewed PC games reply', unipile_chat_id: 'chat-1', sent_at: null })
  expect(m.draft_evidence).toMatchObject(evidence)
  expect(m.draft_evidence.operator_copy_approval).toMatchObject({ source: 'inbox', text: 'Reviewed PC games reply' })
  expect(Date.parse(m.draft_evidence.operator_copy_approval.approved_at)).toBe(new Date(m.approved_at).getTime())
})
it('refuses stale metadata without overwriting concurrent evidence', async () => {
  await db.exec(`update outreach_messages set draft_evidence=draft_evidence || '{"new_context":"keep"}'::jsonb`)
  await expect(approve()).rejects.toThrow(/changed|refresh/i)
  expect((await row()).draft_evidence.new_context).toBe('keep')
  expect((await row()).approved_at).toBeNull()
})
it('handles null evidence and retains the existing chat when no chat is supplied', async () => {
  await db.exec('update outreach_messages set draft_evidence=null')
  await approve(null)
  expect(await row()).toMatchObject({ unipile_chat_id: 'existing-chat', draft_evidence: { operator_copy_approval: { source: 'inbox' } } })
})
it.each(['post_approval_race:outbound', 'lint_copy'])('allows reviewed recovery of %s', async reason => {
  await db.query('update outreach_messages set send_blocked_reason=$1,send_blocked_at=now()', [reason])
  await approve()
  expect(await row()).toMatchObject({ send_blocked_reason: null, send_blocked_at: null })
})
it.each(["send_blocked_reason='discarded_in_inbox'", "send_blocked_reason='lintXother'", "sent_at=now()", "approved_at=now()", "unipile_message_id='delivered'", "direction='inbound'", "ai_model='inbox_on_demand_reply'"])( 'fails closed on a changed or ineligible draft: %s', async change => {
  await db.exec(`update outreach_messages set ${change}`)
  await expect(approve()).rejects.toThrow(/changed|refresh/i)
  expect((await row()).message_text).toBe('Original')
})
it('refuses repeated approvals without replacing the first receipt', async () => {
  await approve()
  const approved = await row()
  await expect(approve()).rejects.toThrow(/changed|refresh/i)
  expect(await row()).toEqual(approved)
})
it('does not bypass row-level security', async () => {
  await db.exec('drop policy operator on outreach_messages; set role authenticated')
  await expect(approve()).rejects.toThrow(/changed|refresh/i)
  await db.exec('reset role')
  expect((await row()).approved_at).toBeNull()
})
it('does not allow anonymous approval', async () => {
  await db.exec('set role anon')
  await expect(approve()).rejects.toThrow(/permission denied/i)
})
