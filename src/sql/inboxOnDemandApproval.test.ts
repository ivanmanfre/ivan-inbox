import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

let db: PGlite
const id = 'ff108ab7-ce03-40e8-ae48-fdc1cccc770b'
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role service_role;
    create table outreach_messages (
      id uuid primary key, prospect_id uuid, direction text, message_type text, ai_model text,
      message_text text, sent_at timestamptz, approved_at timestamptz, unipile_message_id text,
      unipile_chat_id text, send_blocked_reason text, send_blocked_at timestamptz, draft_evidence jsonb
    );
    create table guard_state (revision int, allowed boolean);
    insert into guard_state values (7,true);
    create function conversation_agent_before_manual_send(uuid) returns jsonb language plpgsql as $$
    declare r int; a boolean; begin
      update guard_state set revision=revision+1 returning revision,allowed into r,a;
      return jsonb_build_object('ok',a,'allow_send',a,'revision',r,'in_flight',false,'reason','test_guard');
    end $$;
    insert into outreach_messages (id,prospect_id,direction,message_type,ai_model,message_text,draft_evidence)
    values ('${id}','703501ad-405a-4ee5-acc5-67883fbbc417','outbound','dm','inbox_on_demand_reply','Draft',
      '{"v":"inbox_on_demand_reply_v1","generated_text":"Draft","model":"test-model"}');
  `)
  await db.exec(readFileSync('db/20260928_inbox_on_demand_approval.sql', 'utf8'))
})
afterEach(async () => { await db.close() })
const approve = () => db.query(`select approve_inbox_on_demand_reply($1,'Reviewed reply','chat-1')`, [id])
const row = async () => (await db.query<Record<string, unknown>>('select * from outreach_messages')).rows[0]

describe('operator approval of an on-demand draft', () => {
  it('takes ownership and approves the same row with honest AI provenance', async () => {
    await approve()
    expect(await row()).toMatchObject({ message_type: 'manual_reply', ai_model: 'inbox_on_demand_reply',
      message_text: 'Reviewed reply', unipile_chat_id: 'chat-1', sent_at: null,
      draft_evidence: { v: 'inbox_on_demand_reply_v1', generated_text: 'Draft', model: 'test-model', conversation_agent_manual_revision: 8 } })
    expect((await row()).approved_at).toBeTruthy()
    const approved = await row()
    expect(approved.draft_evidence).toMatchObject({ operator_copy_approval: { source: 'inbox', text: 'Reviewed reply' } })
    expect(Date.parse((approved.draft_evidence as { operator_copy_approval: { approved_at: string } }).operator_copy_approval.approved_at)).toBe(new Date(approved.approved_at as string).getTime())
  })
  it('rejects repeated approval before incrementing ownership again', async () => {
    await approve()
    await expect(approve()).rejects.toThrow(/changed|approved/i)
    expect((await db.query('select revision from guard_state')).rows).toEqual([{ revision: 8 }])
  })
  it('rolls back ownership when the guard refuses', async () => {
    await db.exec('update guard_state set allowed=false')
    await expect(approve()).rejects.toThrow(/ownership/i)
    expect((await row()).approved_at).toBeNull()
    expect((await db.query('select revision from guard_state')).rows).toEqual([{ revision: 7 }])
  })
  it.each(["send_blocked_reason='discarded_in_inbox'", "sent_at=now()", "unipile_message_id='delivered'", "ai_model='arch_reply_draft_v2'"])( 'refuses stale or unrelated rows: %s', async change => {
    await db.exec(`update outreach_messages set ${change}`)
    await expect(approve()).rejects.toThrow(/changed|approved|draft/i)
    expect((await db.query('select revision from guard_state')).rows).toEqual([{ revision: 7 }])
  })
})
