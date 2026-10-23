import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

// approve_swishdm_reply_draft: Ivan's approval of ONE held SwishDM reply. Everything the sender needs stays the
// sender's job; this only stamps approved_at, clears this row's hold and writes the receipt.
let db: PGlite
const msg = 'a1111111-1111-4111-8111-111111111111'
const other = 'a2222222-2222-4222-8222-222222222222'
const inbound = 'b1111111-1111-4111-8111-111111111111'
const prospect = 'c1111111-1111-4111-8111-111111111111'
const token = 'abcdefghijklmnopqrst'
const url = `https://madebyswishdm.com/compare/${token}/`
const plain = { lane: 'swishdm_reply', kind: 'writer', client: 'swishdm', replies_to_inbound: inbound }
const paged = { lane: 'swishdm_reply', kind: 'yes_page', client: 'swishdm', replies_to_inbound: inbound, page_token: token, page_url: url }

async function seed(evidence: object, text = 'Draft text') {
  await db.query(`update outreach_messages set draft_evidence=$1::jsonb, message_text=$2 where id=$3`, [JSON.stringify(evidence), text, msg])
}
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role service_role; create role anon;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select '99999999-9999-4999-8999-999999999999'::uuid $$;
    create table operator_state (allowed boolean); insert into operator_state values (true);
    create function public.cb34_p2_operator_lane_allowed(c text) returns boolean language sql as $$ select c = 'ivan' and (select allowed from operator_state) $$;
    create table outreach_campaigns (id uuid primary key, client_id text);
    create table outreach_prospects (id uuid primary key, campaign_id uuid);
    create table outreach_messages (
      id uuid primary key, prospect_id uuid, direction text, message_type text, channel text, ai_model text,
      message_text text, sent_at timestamptz, approved_at timestamptz, unipile_message_id text,
      recipient_email text, email_mirror_text text, send_blocked_reason text, send_blocked_at timestamptz, draft_evidence jsonb, created_at timestamptz default now()
    );
    create table swishdm_comparison_pages (token text primary key, prospect_id uuid, url text, status text);
    insert into outreach_campaigns values ('d1111111-1111-4111-8111-111111111111','swishdm'), ('d2222222-2222-4222-8222-222222222222','arch');
    insert into outreach_prospects values ('${prospect}','d1111111-1111-4111-8111-111111111111');
    insert into outreach_messages (id,prospect_id,direction,message_type,channel,message_text,sent_at)
      values ('${inbound}','${prospect}','inbound','dm','linkedin','sure send them', now());
    insert into outreach_messages (id,prospect_id,direction,message_type,channel,ai_model,message_text,send_blocked_reason,send_blocked_at,draft_evidence)
      values ('${msg}','${prospect}','outbound','dm','linkedin','swishdm_reply_writer_v1','Draft text','awaiting_client_review',now(),'${JSON.stringify(plain)}'::jsonb);
    insert into swishdm_comparison_pages values ('${token}','${prospect}','${url}','held');
  `)
  await db.exec(readFileSync('db/20261017_swishdm_reply_approval.sql', 'utf8'))
  await db.exec(readFileSync('db/20261023_swishdm_email_leg_approval.sql', 'utf8'))
})
afterEach(async () => { await db.close() })

const ev = async (id = msg) => (await db.query<{ draft_evidence: object }>('select draft_evidence from outreach_messages where id=$1', [id])).rows[0].draft_evidence
const approve = async (text = 'Draft text', evidence?: object) => db.query(`select approve_swishdm_reply_draft($1,$2,$3::jsonb)`, [msg, text, JSON.stringify(evidence ?? await ev())])
const row = async () => (await db.query<Record<string, unknown>>('select * from outreach_messages where id=$1', [msg])).rows[0]

describe('approve_swishdm_reply_draft', () => {
  it('approves one row, clears only its hold and writes the inbox receipt', async () => {
    await approve('Edited reply text')
    const r = await row()
    expect(r.approved_at).toBeTruthy()
    expect(r).toMatchObject({ message_text: 'Edited reply text', send_blocked_reason: null, send_blocked_at: null, sent_at: null })
    const d = r.draft_evidence as { original_text: string; operator_copy_approval: { source: string; text: string; approved_at: string } }
    expect(d.original_text).toBe('Draft text')
    expect(d.operator_copy_approval).toMatchObject({ source: 'inbox', text: 'Edited reply text' })
    expect(Date.parse(d.operator_copy_approval.approved_at)).toBe(new Date(r.approved_at as string).getTime())
  })
  it('keeps the draft untouched when the text is unchanged (no original_text noise)', async () => {
    await approve('Draft text')
    expect(((await row()).draft_evidence as Record<string, unknown>).original_text).toBeUndefined()
  })
  it('touches no other row', async () => {
    await db.query(`insert into outreach_messages (id,prospect_id,direction,message_type,channel,ai_model,message_text,send_blocked_reason,send_blocked_at,draft_evidence)
      values ($1,$2,'outbound','dm','linkedin','swishdm_reply_writer_v1','Other','awaiting_client_review',now(),$3::jsonb)`, [other, prospect, JSON.stringify(plain)])
    await approve()
    const o = (await db.query<Record<string, unknown>>('select * from outreach_messages where id=$1', [other])).rows[0]
    expect(o).toMatchObject({ approved_at: null, send_blocked_reason: 'awaiting_client_review' })
  })
  it('refuses a second approval', async () => {
    await approve()
    await expect(approve()).rejects.toThrow(/changed/i)
  })
  it.each([
    ["sent_at=now()"], ["approved_at=now()"], ["unipile_message_id='x'"], ["send_blocked_reason='discarded_in_inbox'"],
    ["send_blocked_reason=null"], ["ai_model='swishdm_first_list_v1'"], ["ai_model='arch_reply_draft_v2'"], ["message_type='connection_note'"],
    ["draft_evidence=draft_evidence||'{\"stopped\":{\"reason\":\"replied_stop\"}}'::jsonb"],
  ])('refuses a row that is not a held SwishDM reply: %s', async change => {
    const evidence = await ev()
    await db.exec(`update outreach_messages set ${change} where id='${msg}'`)
    const keep = change.startsWith('draft_evidence') ? evidence : await ev()
    const before = await row()
    await expect(approve('Draft text', keep)).rejects.toThrow(/changed/i)
    expect(await row()).toEqual(before)      // refused means untouched
  })
  it('refuses a draft from another client campaign', async () => {
    await db.exec(`update outreach_prospects set campaign_id='d2222222-2222-4222-8222-222222222222'`)
    await expect(approve()).rejects.toThrow(/changed/i)
  })
  it('refuses when the evidence moved since the card was read', async () => {
    await expect(approve('Draft text', { ...plain, kind: 'other' })).rejects.toThrow(/changed/i)
  })
  it('refuses a draft that no longer answers their newest message', async () => {
    await db.exec(`insert into outreach_messages (id,prospect_id,direction,message_type,channel,message_text,sent_at)
      values ('b2222222-2222-4222-8222-222222222222','${prospect}','inbound','dm','linkedin','one more thing', now() + interval '1 minute')`)
    await expect(approve()).rejects.toThrow(/wrote again/i)
    expect((await row()).approved_at).toBeNull()
  })
  it('refuses empty and oversize text', async () => {
    await expect(approve('   ')).rejects.toThrow(/between 1 and 1900/)
    await expect(approve('x'.repeat(1901))).rejects.toThrow(/between 1 and 1900/)
  })
  it('refuses anyone who is not the operator', async () => {
    await db.exec('update operator_state set allowed=false')
    await expect(approve()).rejects.toThrow(/unauthorized/)
    expect((await row()).approved_at).toBeNull()
  })
  describe('page-link reply', () => {
    beforeEach(async () => { await seed(paged, `Here you go: ${url}\n\nWould it be a bad idea to look?`) })
    it('approves with the link kept, leaves the page unpublished (publishing is a separate gated step)', async () => {
      await approve(`Here you go: ${url}\n\nWould it be a bad idea to look?`)
      expect((await row()).approved_at).toBeTruthy()
      expect((await db.query('select status from swishdm_comparison_pages')).rows).toEqual([{ status: 'held' }])
    })
    it('refuses an edit that drops the link', async () => {
      await expect(approve('Here you go, no link')).rejects.toThrow(/page link/i)
      expect((await row()).approved_at).toBeNull()
    })
    it('refuses when the page row is gone or withdrawn', async () => {
      await db.exec(`update swishdm_comparison_pages set status='withdrawn'`)
      await expect(approve(`Here: ${url}`)).rejects.toThrow(/page for this reply is missing/i)
    })
  })
})

it('requires the exact reviewed email snapshot and records it with approval', async () => {
  await db.query('update outreach_messages set recipient_email=$1,email_mirror_text=$2 where id=$3', ['sue@biatchtequila.com','Reviewed email',msg])
  for (const snapshot of [undefined,{recipient_email:'other@brand.com',email_mirror_text:'Reviewed email'},{recipient_email:'sue@biatchtequila.com',email_mirror_text:'Stale email'}]) {
    await expect(approve('Draft text',{...plain,...(snapshot?{_reviewed_email:snapshot}:{})})).rejects.toThrow(/changed/i)
    expect((await row()).approved_at).toBeNull()
  }
  await approve('Draft text',{...plain,_reviewed_email:{recipient_email:'sue@biatchtequila.com',email_mirror_text:'Reviewed email'}})
  expect((await row()).draft_evidence).toMatchObject({operator_copy_approval:{recipient_email:'sue@biatchtequila.com',email_mirror_text:'Reviewed email'}})
})
