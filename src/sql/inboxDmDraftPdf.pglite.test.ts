import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, test } from 'vitest'

test('attach, replace and approve the exact reviewed PDF on the Ivan seat', async () => {
  const db = new PGlite()
  const id = '91fcf498-551f-46e5-b43a-a3ee7f80e8a8'
  const other = '91fcf498-551f-46e5-b43a-a3ee7f80e8a9'
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public bool, file_size_limit int, allowed_mime_types text[]);
      create table public.outreach_agent_accounts (client_id text, provider_account_id text);
      insert into public.outreach_agent_accounts values ('ivan','account'), ('arch','other-account');
      create table public.outreach_messages (
        id uuid primary key, prospect_id uuid, direction text default 'outbound', channel text default 'linkedin',
        message_type text default 'dm', ai_model text default 'inbox_on_demand_reply',
        draft_evidence jsonb default '{"v":"inbox_on_demand_reply_v1","generated_text":"Original"}',
        unipile_chat_id text default 'chat', unipile_message_id text,
        approved_at timestamptz, sent_at timestamptz, send_blocked_at timestamptz, send_blocked_reason text,
        message_text text, email_mirror_text text, recipient_email text
      );
      create table public.outreach_prospects (id uuid primary key, blacklisted boolean default false, stage text, skip_state text);
      insert into public.outreach_prospects (id, stage) values ('${id}', 'positive_reply'), ('${other}', 'positive_reply');
      create table public.outreach_agent_threads (id uuid primary key, prospect_id uuid);
      create function public.inbox_schedule_snapshot(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
      insert into public.outreach_messages (id, prospect_id) values ('${id}', '${id}'), ('${other}', '${other}');
      create view public.inbox_messages_v as select id,
        case when id = '${id}'::uuid then 'ivan' else 'arch' end as client_id,
        'positive_reply'::text as prospect_stage from public.outreach_messages;
      create function public.approve_inbox_on_demand_reply(p_id uuid, p_text text, p_chat text) returns void
        language sql as $$ update public.outreach_messages set approved_at = now(), message_text = p_text, message_type = 'manual_reply',
          draft_evidence = draft_evidence || jsonb_build_object('operator_copy_approval', jsonb_build_object('text',p_text))
          where id = p_id $$;
    `)
    await db.exec(readFileSync('db/20261119_inbox_dm_draft_pdf.sql', 'utf8'))
    await db.exec(readFileSync('db/20261119b_inbox_pdf_scheduling.sql', 'utf8'))
    await db.exec(readFileSync('db/20261119c_inbox_pdf_delivery.sql', 'utf8'))
    const set = (draft: string, previous: string | null, file: { id: string } | null) =>
      db.query('select public.set_inbox_dm_draft_file($1,$2,$3) as evidence', [draft, previous, file])
    expect((await set(other, null, { id: 'first' })).rows).toEqual([{ evidence: null }])
    const evidence = { v: 'inbox_on_demand_reply_v1', generated_text: 'Original', dm_attachment: { id: 'first' } }
    expect((await set(id, null, { id: 'first' })).rows).toEqual([{ evidence }])
    await expect(db.query("select public.schedule_inbox_dm($1,array[$1]::uuid[],array['Hi'],now()+interval '1 day','UTC')", [id])).rejects.toThrow('PDF attachments need to be sent from the draft')
    await db.query("update public.outreach_messages set send_blocked_reason = 'scheduled_in_inbox', send_blocked_at = now(), draft_evidence = draft_evidence || jsonb_build_object('scheduled_send', jsonb_build_object('at',now() - interval '1 hour','group',id,'ids',jsonb_build_array(id),'baseline','{}'::jsonb,'state','scheduled'))")
    expect((await db.query('select public.release_scheduled_inbox_dms() as count')).rows).toEqual([{ count: 1 }])
    expect((await db.query("select id, approved_at is not null as approved, send_blocked_reason as hold from public.outreach_messages order by id")).rows).toEqual([
      { id, approved: false, hold: 'post_approval_race:scheduled_pdf_requires_review' },
      { id: other, approved: true, hold: null },
    ])
    expect((await db.query('select public.release_scheduled_inbox_dms() as count')).rows).toEqual([{ count: 0 }])
    expect((await set(id, 'first', null)).rows[0]).toMatchObject({ evidence: { v: 'inbox_on_demand_reply_v1' } })
    expect((await set(id, null, { id: 'first' })).rows[0]).toMatchObject({ evidence: { dm_attachment: { id: 'first' } } })
    await db.query("update public.outreach_messages set send_blocked_at=null, send_blocked_reason=null, draft_evidence=draft_evidence-'scheduled_send' where id=$1", [id])
    expect((await set(id, null, { id: 'racing-tab' })).rows).toEqual([{ evidence: null }])
    await expect(db.query('select public.approve_inbox_on_demand_reply($1,$2,$3)', [id, 'Hi', 'chat'])).rejects.toThrow('Review the attached PDF')
    await set(id, 'first', { id: 'second' })
    const approve = (text: string, chat: string, file: string) =>
      db.query('select public.approve_inbox_on_demand_reply_with_file($1,$2,$3,$4)', [id, text, chat, file])
    await expect(approve('Hi', 'chat', 'first')).rejects.toThrow('attached PDF changed')
    await expect(approve('Hi', 'other-chat', 'second')).rejects.toThrow('one message')
    await expect(approve('Hi\n---\nNext', 'chat', 'second')).rejects.toThrow('one message')
    const exact = 'Hi\u00a0\u2028\f'
    await approve(exact, 'chat', 'second')
    expect((await set(id, 'second', null)).rows).toEqual([{ evidence: null }])
    const { rows } = await db.query('select draft_evidence from public.outreach_messages where id = $1', [id])
    expect(rows).toEqual([{ draft_evidence: {
      ...evidence, dm_attachment: { id: 'second' },
      operator_copy_approval: { text: exact, attachment_id: 'second', attachment_chat: 'chat' },
    } }])
    const claim = '2026-11-19T18:00:00Z'
    await db.query('update public.outreach_messages set sent_at = $1 where id = $2', [claim, id])
    const useTransport = async (account: string) =>
      (await db.query('select public.claim_inbox_dm_pdf_transport($1,$2,$3,$4,$5,$6) as ok',
        [id, claim, 'second', account, 'chat', exact])).rows
    expect(await useTransport('other-account')).toEqual([{ ok: false }])
    expect(await useTransport('account')).toEqual([{ ok: true }])
    expect(await useTransport('account')).toEqual([{ ok: false }])
    await db.query("update public.outreach_messages set sent_at=null, approved_at=null, send_blocked_at=now(), send_blocked_reason='lint_pdf_file_unavailable' where id=$1", [id])
    expect((await set(id, 'second', { id: 'replacement' })).rows).toEqual([{ evidence: null }])
  } finally { await db.close() }
})
