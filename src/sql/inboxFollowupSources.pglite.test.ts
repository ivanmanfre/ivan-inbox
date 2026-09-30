import { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('follow-up forecast is read only and restricted to the existing operator', async () => {
 const db = new PGlite()
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create schema auth;
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('test.role',true),''),'authenticated')$$;
   create table outreach_agent_accounts(client_id text,operator_ids uuid[]);
   insert into outreach_agent_accounts values('ivan',array['11111111-1111-4111-8111-111111111111'::uuid]);
   create table outreach_campaigns(id uuid,client_id text);
   create table outreach_prospects(id uuid,campaign_id uuid,name text,company text,stage text,icp_score int,reply_count int,blacklisted boolean,call_booked_at timestamptz,needs_manual_reply boolean,skip_state text,skip_reason text,next_touch_after timestamptz,enrichment_data jsonb,operator_note text);
   create table outreach_messages(id uuid,prospect_id uuid,direction text,message_type text,message_text text,sent_at timestamptz,created_at timestamptz,send_blocked_at timestamptz,send_blocked_reason text,is_reaction boolean,snoozed_until timestamptz,ai_model text,channel text,unipile_message_id text);
   insert into outreach_campaigns values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','arch');
   insert into outreach_prospects(id,campaign_id,stage,icp_score,reply_count,blacklisted) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','replied',8,1,false);
   insert into outreach_messages(id,prospect_id,direction,message_type,message_text,sent_at,created_at) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','inbound','dm','Yes',now(),now());`)
  const path='db/20260930_inbox_followup_sources.sql'
  if(existsSync(path))await db.exec(readFileSync(path,'utf8'))
  await expect(db.query('select inbox_followup_sources()')).rejects.toThrow(/operator_denied/)
  await db.exec("set test.uid='11111111-1111-4111-8111-111111111111'")
  const r=await db.query<{seat:string,rows:unknown[]}>('select * from inbox_followup_sources()')
  expect(r.rows[0].seat).toBe('arch');expect(r.rows[0].rows).toHaveLength(1)
  expect((await db.query<{n:number}>('select count(*)::int n from outreach_messages')).rows[0].n).toBe(1)
  expect((await db.query<{ok:boolean}>("select has_function_privilege('anon','public.inbox_followup_sources()','execute') ok")).rows[0].ok).toBe(false)
  expect((await db.query<{ok:boolean}>("select has_function_privilege('authenticated','public.record_followup_review(uuid,uuid,uuid,jsonb)','execute') ok")).rows[0].ok).toBe(false)
  await db.exec(`update outreach_prospects set enrichment_data='{"person_hold":false,"keep":"existing"}'::jsonb;
   insert into outreach_messages(id,prospect_id,direction,message_type,message_text,sent_at,created_at) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','outbound','dm','Sent report',now()+interval '1 second',now()+interval '1 second');`)
  const record = (inId:string) => db.query<{ok:boolean}>(`select record_followup_review('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${inId}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','{"follow_up":false,"state":"closed_loop"}'::jsonb) ok`)
  expect((await record('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).rows[0].ok).toBe(true)
  expect((await db.query<{value:string}>("select enrichment_data->>'keep' value from outreach_prospects")).rows[0].value).toBe('existing')
  await db.exec(`insert into outreach_messages(id,prospect_id,direction,message_type,message_text,sent_at,created_at) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','inbound','dm','New reply',now()+interval '2 seconds',now()+interval '2 seconds');`)
  expect((await record('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).rows[0].ok).toBe(false)

 }finally{await db.close()}
},30_000)
