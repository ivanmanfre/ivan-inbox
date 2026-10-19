import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let db: PGlite
const id = 'ff108ab7-ce03-40e8-ae48-fdc1cccc770b'
const evidence = { generated_text: 'Original', research: 'x'.repeat(90000) }
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role service_role; create role anon;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$; grant usage on schema auth to authenticated;
    create table outreach_messages (
      id uuid primary key, prospect_id uuid, direction text, message_type text, ai_model text,
      message_text text, sent_at timestamptz, approved_at timestamptz,
      unipile_message_id text, unipile_chat_id text, send_blocked_reason text,
      send_blocked_at timestamptz, draft_evidence jsonb
    );
    create table outreach_campaigns (id uuid primary key, client_id text);
    create table outreach_prospects (id uuid primary key, campaign_id uuid);
    grant usage on schema public to authenticated, anon;
    grant select, update on outreach_messages to authenticated;
    grant select on outreach_campaigns, outreach_prospects to authenticated;
    alter table outreach_messages enable row level security;
    create policy operator on outreach_messages to authenticated using (true) with check (true);
  `)
  await db.query(`insert into outreach_messages (id,direction,message_type,ai_model,message_text,unipile_chat_id,draft_evidence)
    values ($1,'outbound','dm','arch_reply_draft_v2','Original','existing-chat',$2::jsonb)`, [id, JSON.stringify(evidence)])
  await db.exec("update outreach_messages set send_blocked_reason='arch_market_claim_unratified:Israel',send_blocked_at='2026-10-01T10:22:00Z'")
  for (const path of ['db/20261010_send_rejected_inbox_draft.sql', 'db/294_swishdm_send_anyways_guard.sql'])
    if (existsSync(path)) await db.exec(readFileSync(path, 'utf8'))
})
afterEach(async () => { await db.close() })
const approve = (expected: unknown = evidence) => db.query(
  'select send_rejected_inbox_draft($1,$2,$3,$4,$5,$6::jsonb,$7)', [id, 'Original', 'arch_market_claim_unratified:Israel', '2026-10-01T10:22:00Z', null, JSON.stringify(expected), 'chat-1'])
const row = async () => (await db.query<Record<string, any>>('select * from outreach_messages')).rows[0]


it('requeues only the rejected row and preserves its rejection and original evidence', async () => {
  await db.exec('set role authenticated'); await approve()
  const m = await row()
  expect(m).toMatchObject({ message_text: 'Original', sent_at: null, send_blocked_reason: null, send_blocked_at: null, unipile_chat_id: 'chat-1' })
  expect(m.draft_evidence).toMatchObject(evidence)
  expect(m.draft_evidence.operator_send_anyways).toMatchObject({ message_id: id, source: 'inbox', text: 'Original', rejected_reason: 'arch_market_claim_unratified:Israel', operator_id: '11111111-1111-4111-8111-111111111111' })
  expect(Date.parse(m.draft_evidence.operator_send_anyways.approved_at)).toBe(new Date(m.approved_at).getTime())
  expect((await db.query('select count(*)::int n from outreach_messages')).rows[0]).toEqual({ n: 1 })
  await expect(approve()).rejects.toThrow(/changed/)
  expect(await row()).toEqual(m)
})
it.each(["message_text='Changed'", "send_blocked_reason='discarded_in_inbox'", "send_blocked_at=now()", "sent_at=now()", "approved_at=now()", "unipile_message_id='delivered'", "direction='inbound'", "draft_evidence='{\"new_context\":true}'::jsonb"])( 'refuses stale, delivered or discarded state: %s', async change => {
  await db.exec(`update outreach_messages set ${change}`)
  await expect(approve()).rejects.toThrow(/changed/)
})
it('enforces RLS', async () => {
  await db.exec('drop policy operator on outreach_messages; set role authenticated')
  await expect(approve()).rejects.toThrow(/changed/)
})
it('refuses anonymous calls', async () => {
  await db.exec('set role anon'); await expect(approve()).rejects.toThrow(/permission denied/)
})
it('refuses resending an email whose timeout may have delivered', async () => {
  await db.exec("update outreach_messages set send_blocked_reason='native_email_send_failed: timeout'")
  await expect(db.query('select send_rejected_inbox_draft($1,$2,$3,$4,$5,$6::jsonb,$7)',
    [id,'Original','native_email_send_failed: timeout','2026-10-01T10:22:00Z',null,JSON.stringify(evidence),'chat-1'])).rejects.toThrow(/changed/)
})

describe('SwishDM rows (db/294)', () => {
  const swishEvidence = (extra: Record<string, unknown>) => ({ ...evidence, ...extra })
  it.each([[{ client: 'swishdm' }], [{ lane: 'swishdm_inmail' }], [{ lane: 'swishdm_first_list' }]])('refuses a row whose evidence says %j and leaves it untouched', async extra => {
    const ev = swishEvidence(extra)
    await db.query('update outreach_messages set draft_evidence=$1::jsonb', [JSON.stringify(ev)])
    const before = await row()
    await db.exec('set role authenticated')
    await expect(approve(ev)).rejects.toThrow(/SwishDM messages are sent only by the SwishDM senders/)
    expect(await row()).toEqual(before)
  })
  it('refuses a row whose prospect sits on a SwishDM campaign, whatever the evidence says', async () => {
    const camp = '22222222-2222-4222-8222-222222222222', pros = '33333333-3333-4333-8333-333333333333'
    await db.query("insert into outreach_campaigns values ($1,'swishdm')", [camp])
    await db.query('insert into outreach_prospects values ($1,$2)', [pros, camp])
    await db.query('update outreach_messages set prospect_id=$1', [pros])
    await db.exec('set role authenticated')
    await expect(approve()).rejects.toThrow(/SwishDM/)
    expect((await row()).approved_at).toBeNull()
  })
  it('still requeues a row on another seat campaign', async () => {
    const camp = '22222222-2222-4222-8222-222222222222', pros = '33333333-3333-4333-8333-333333333333'
    await db.query("insert into outreach_campaigns values ($1,'arch')", [camp])
    await db.query('insert into outreach_prospects values ($1,$2)', [pros, camp])
    await db.query('update outreach_messages set prospect_id=$1', [pros])
    await db.exec('set role authenticated'); await approve()
    expect((await row()).send_blocked_reason).toBeNull()
  })
})
