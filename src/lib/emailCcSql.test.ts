import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
let pg: PGlite
const id = '11111111-1111-1111-1111-111111111111'
const evidence = { generated_text: 'Original', research: 'x'.repeat(90000), email_cc: [] }
const call = (cc: unknown, expected: unknown = evidence) => pg.query(
  'select public.save_inbox_draft_email_cc($1,$2::jsonb,$3::jsonb)',
  [id, cc == null ? null : JSON.stringify(cc), expected == null ? null : JSON.stringify(expected)],
)
const row = async () => (await pg.query<{ draft_evidence: unknown; approved_at: string | null; sent_at: string | null }>('select * from outreach_messages where id=$1', [id])).rows[0]
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table outreach_messages (
      id uuid primary key, direction text, draft_evidence jsonb,
      approved_at timestamptz, sent_at timestamptz, unipile_message_id text, send_blocked_reason text
    );
    alter table outreach_messages enable row level security;
    grant select,update on outreach_messages to authenticated,service_role;
    create policy owned on outreach_messages to authenticated using (id::text=current_setting('request.jwt.claim.sub',true));
  `)
  await pg.exec(readFileSync(new URL('../../db/20261007_inbox_email_cc_save.sql', import.meta.url), 'utf8'))
}, 15000)
beforeEach(async () => {
  await pg.exec('reset role; delete from outreach_messages')
  await pg.query('insert into outreach_messages(id,direction,draft_evidence) values($1,\'outbound\',$2::jsonb)', [id, JSON.stringify(evidence)])
})
afterAll(async () => { await pg.close() })
it('updates CC on large evidence while preserving every unrelated fact and pending state', async () => {
  await call(['creator@example.com'])
  expect(await row()).toMatchObject({ draft_evidence: { ...evidence, email_cc: ['creator@example.com'] }, approved_at: null, sent_at: null })
})
it('supports empty CC and null evidence', async () => {
  await pg.exec('update outreach_messages set draft_evidence=null')
  await call([], null)
  expect((await row()).draft_evidence).toEqual({ email_cc: [] })
})
it('refuses stale evidence without overwriting the newer evidence', async () => {
  await expect(call(['creator@example.com'], { ...evidence, generated_text: 'Stale' })).rejects.toThrow(/draft changed/)
  expect((await row()).draft_evidence).toEqual(evidence)
})
it.each(['approved_at', 'sent_at'])('refuses a draft with %s set', async field => {
  await pg.exec(`update outreach_messages set ${field}=now()`)
  await expect(call([])).rejects.toThrow(/draft changed/)
  expect((await row()).draft_evidence).toEqual(evidence)
})
it.each(['discarded', 'owner_confirmation_hold'])('refuses the blocked state %s', async reason => {
  await pg.query('update outreach_messages set send_blocked_reason=$1', [reason])
  await expect(call([])).rejects.toThrow(/draft changed/)
})
it.each(['post_approval_race:new_inbound', 'lint_copy'])('allows the established recoverable hold %s without clearing it', async reason => {
  await pg.query('update outreach_messages set send_blocked_reason=$1', [reason])
  await call([])
  expect((await pg.query<{ send_blocked_reason: string }>('select send_blocked_reason from outreach_messages')).rows[0].send_blocked_reason).toBe(reason)
})
it.each([null, {}, ['bad'], [1], [' a@example.com'], ['a@example.com\n']])('rejects malformed CC %j without changing evidence', async cc => {
  await expect(call(cc)).rejects.toThrow(/CC email/)
  expect((await row()).draft_evidence).toEqual(evidence)
})
it('refuses an inbound message', async () => {
  await pg.exec("update outreach_messages set direction='inbound'")
  await expect(call([])).rejects.toThrow(/draft changed/)
})
it('allows authenticated edits only through the caller’s row policy', async () => {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await pg.exec('set role authenticated')
  await call(['creator@example.com'])
  await pg.exec('reset role')
  expect((await row()).draft_evidence).toEqual({ ...evidence, email_cc: ['creator@example.com'] })
})
it('fails closed for an authenticated caller without row access', async () => {
  await pg.query("select set_config('request.jwt.claim.sub','another-owner',false)")
  await pg.exec('set role authenticated')
  await expect(call([])).rejects.toThrow(/draft changed/)
  await pg.exec('reset role')
  expect((await row()).draft_evidence).toEqual(evidence)
})
it('does not grant anonymous callers execute permission', async () => {
  await pg.exec('set role anon')
  await expect(call([])).rejects.toThrow(/permission denied/)
})
