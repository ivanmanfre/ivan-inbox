import { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

let pg: PGlite
const id = '11111111-1111-1111-1111-111111111111'
const source = 'Subject: Re: Intro\n\nHello'
const composition = { version: 1, source_text: source, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }] }] }, signature: null }
const evidence = { research: 'keep', email_cc: ['copy@example.com'] }
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table outreach_messages(id uuid primary key,direction text,channel text,message_type text,ai_model text,
      message_text text,email_mirror_text text,draft_evidence jsonb,approved_at timestamptz,sent_at timestamptz,
      unipile_message_id text,send_blocked_reason text);
    alter table outreach_messages enable row level security;
    grant select,update on outreach_messages to authenticated,service_role;
    create policy owned on outreach_messages to authenticated using(id::text=current_setting('request.jwt.claim.sub',true));`)
  const migration = 'db/20261026_inbox_email_composition.sql'
  if (existsSync(migration)) await pg.exec(readFileSync(migration, 'utf8'))
}, 15_000)
beforeEach(async () => {
  await pg.exec('reset role; delete from outreach_messages')
  await pg.query(`insert into outreach_messages(id,direction,channel,message_type,message_text,email_mirror_text,draft_evidence)
    values($1,'outbound','email','email',$2,$2,$3::jsonb)`, [id, source, JSON.stringify(evidence)])
})
afterAll(async () => { await pg.close() })
const row = async () => (await pg.query<Record<string, any>>('select * from outreach_messages where id=$1', [id])).rows[0]
const save = (mirror = false, expected: unknown = evidence, text = source, rich: unknown = composition) => pg.query(
  'select save_inbox_email_composition($1,$2,$3::jsonb,$4,$5,$6::jsonb)',
  [id, text, JSON.stringify(rich), mirror, source, JSON.stringify(expected)])

it('saves formatting-only changes while retaining unrelated research and CC', async () => {
  await save()
  expect(await row()).toMatchObject({ message_text: source, approved_at: null, sent_at: null,
    draft_evidence: { ...evidence, email_composition: composition } })
})
it('saves the mirror independently and can clear its formatting without touching the main copy', async () => {
  await save(true)
  let m = await row()
  expect(m.draft_evidence.email_mirror_composition).toEqual(composition)
  await save(true, m.draft_evidence, source, null)
  m = await row()
  expect(m.message_text).toBe(source)
  expect(m.draft_evidence).toEqual(evidence)
})
it('refuses concurrent evidence or source changes', async () => {
  await pg.exec(`update outreach_messages set draft_evidence=draft_evidence || '{"new_context":"keep"}'::jsonb`)
  await expect(save()).rejects.toThrow(/changed|refresh/i)
  expect((await row()).draft_evidence.new_context).toBe('keep')
  await pg.query('update outreach_messages set message_text=$1,draft_evidence=$2::jsonb', ['Changed', JSON.stringify(evidence)])
  await expect(save()).rejects.toThrow(/changed|refresh/i)
})
it.each(["approved_at=now()", "sent_at=now()", "unipile_message_id='sent'", "send_blocked_reason='discarded_in_inbox'", "direction='inbound'"])( 'refuses an ineligible row: %s', async change => {
  await pg.exec(`update outreach_messages set ${change}`)
  await expect(save()).rejects.toThrow(/changed|refresh/i)
  expect((await row()).draft_evidence.email_composition).toBeUndefined()
})
it('rejects a composition bound to different text', async () => {
  await expect(save(false, evidence, source, { ...composition, source_text: 'Different' })).rejects.toThrow(/format|text|composition/i)
})
it('promotes an email-only mirror and snapshots the exact reviewed composition on approval', async () => {
  await save(true)
  await pg.query(`update outreach_messages set channel='email',approved_at=now(),draft_evidence=draft_evidence || $1::jsonb`,
    [JSON.stringify({ send_via: 'email', operator_copy_approval: { source: 'inbox', text: source } })])
  const m = await row()
  expect(m.draft_evidence.email_composition).toEqual(composition)
  expect(m.draft_evidence.operator_copy_approval.email_composition).toEqual(composition)
})
it('retains authenticated RLS and denies anonymous access', async () => {
  await pg.exec("select set_config('request.jwt.claim.sub','another-owner',false); set role authenticated")
  await expect(save()).rejects.toThrow(/changed|refresh/i)
  await pg.exec('reset role; set role anon')
  await expect(save()).rejects.toThrow(/permission denied/i)
})
