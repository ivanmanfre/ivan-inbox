import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, afterEach, expect, it } from 'vitest'
let db: PGlite
const pid = '703501ad-405a-4ee5-acc5-67883fbbc417'
const id = 'ff108ab7-ce03-40e8-ae48-fdc1cccc770b'
beforeEach(async () => {
 db = new PGlite()
 await db.exec(`
 create role authenticated; create role service_role;
 create table outreach_prospects(id uuid primary key,stage text,blacklisted boolean,skip_reason text,skip_state text,linkedin_profile_id text,linkedin_url text);
 create table outreach_agent_threads(id uuid,prospect_id uuid,person_key text,revision bigint,owner text,state text,pause_reason text);
 create table outreach_messages(id uuid primary key default gen_random_uuid(),prospect_id uuid,direction text,message_type text,ai_model text,message_text text,sent_at timestamptz,approved_at timestamptz,unipile_message_id text,unipile_chat_id text,send_blocked_reason text,send_blocked_at timestamptz,draft_evidence jsonb,channel text,created_at timestamptz default now());
 create function conversation_agent_before_manual_send(uuid) returns jsonb language sql as $$select '{"ok":true,"allow_send":true,"in_flight":false}'::jsonb$$;
 insert into outreach_prospects(id,stage,blacklisted) values('${pid}','replied',false);
 insert into outreach_messages(id,prospect_id,direction,message_type,ai_model,message_text) values('${id}','${pid}','outbound','dm','rise_reply_draft_v1','Draft');
 `)
 await db.exec(readFileSync('db/20261001_dm_scheduling.sql','utf8').split('-- CRON INSTALL')[0])
})
afterEach(async () => { await db.close() })
const schedule = () => db.query(`select schedule_inbox_dm($1,ARRAY[$2::uuid],ARRAY['Exact draft'],now()+interval '1 day','America/Los_Angeles','chat-1')`,[pid,id])
const row = async () => (await db.query<Record<string, unknown>>(`select * from outreach_messages where id='${id}'`)).rows[0]
const due = () => db.exec(`update outreach_messages set draft_evidence=jsonb_set(draft_evidence,'{scheduled_send,at}',to_jsonb((now()-interval '1 minute')::text)) where id='${id}'`)
it('holds until due, then releases exactly once to the existing sender',async()=>{
 await schedule(); expect(await row()).toMatchObject({approved_at:null,sent_at:null,send_blocked_reason:'scheduled_in_inbox',message_text:'Exact draft'})
 await db.query('select release_scheduled_inbox_dms()'); expect((await row()).approved_at).toBeNull()
 await due(); await db.query('select release_scheduled_inbox_dms()'); const approved=(await row()).approved_at; expect(approved).toBeTruthy(); expect((await row()).send_blocked_reason).toBeNull()
 await db.query('select release_scheduled_inbox_dms()'); expect((await row()).approved_at).toEqual(approved)
})
it('holds a changed conversation for review',async()=>{
 await schedule(); await due(); await db.exec(`insert into outreach_messages(prospect_id,direction,message_text,sent_at) values('${pid}','inbound','Actually, Friday?',now())`)
 await db.query('select release_scheduled_inbox_dms()'); expect((await row()).approved_at).toBeNull(); expect((await row()).send_blocked_reason).toBe('post_approval_race:scheduled_thread_changed')
})
it('cancels before release and refuses cancellation after release',async()=>{
 await schedule(); await db.query('select cancel_scheduled_inbox_dm($1)',[id]); await due(); await db.query('select release_scheduled_inbox_dms()'); expect((await row()).approved_at).toBeNull(); expect((await row()).send_blocked_reason).toBe('scheduled_send_cancelled')
 await db.exec(`update outreach_messages set send_blocked_reason=null where id='${id}'`); await schedule(); await due(); await db.query('select release_scheduled_inbox_dms()'); await expect(db.query('select cancel_scheduled_inbox_dm($1)',[id])).rejects.toThrow(/queue|changed/i)
})
it('rejects invalid dates, timezones, discarded rows and duplicate approvals',async()=>{
 await expect(db.query(`select schedule_inbox_dm($1,ARRAY[$2::uuid],ARRAY['text'],now()-interval '1 day','America/Los_Angeles',null)`,[pid,id])).rejects.toThrow(/future/i)
 await expect(db.query(`select schedule_inbox_dm($1,ARRAY[$2::uuid],ARRAY['text'],now()+interval '1 day','bogus',null)`,[pid,id])).rejects.toThrow(/timezone/i)
 await db.exec(`update outreach_messages set send_blocked_reason='discarded_in_inbox'`); await expect(schedule()).rejects.toThrow(/changed/i)
})
it('releases paired legs together and blocks both when one changes',async()=>{
 const other='aacd8ab7-ce03-40e8-ae48-fdc1cccc770b'
 await db.exec(`insert into outreach_messages(id,prospect_id,direction,message_type,message_text,channel) values('${other}','${pid}','outbound','dm','Email','email')`)
 await db.query(`select schedule_inbox_dm($1,ARRAY[$2::uuid,$3::uuid],ARRAY['DM','Email'],now()+interval '1 day','America/Los_Angeles',null)`,[pid,id,other])
 await db.exec(`update outreach_messages set send_blocked_reason='discarded_in_inbox' where id='${other}'`)
 await due(); await db.query('select release_scheduled_inbox_dms()'); expect((await row()).approved_at).toBeNull(); expect((await row()).send_blocked_reason).toContain('post_approval_race:')
})

it('routes scheduled drafts as manual replies and blocks later opt-outs or ownership changes',async()=>{
 await schedule(); expect((await row()).message_type).toBe('manual_reply'); await due();
 await db.exec(`update outreach_prospects set skip_state='opted_out'`); await db.query('select release_scheduled_inbox_dms()');
 expect((await row()).approved_at).toBeNull(); expect((await row()).send_blocked_reason).toContain('scheduled_thread_changed');
 await expect(schedule()).rejects.toThrow(/closed/i);
})
it('does not release when a different owner takes over, and permits explicit rescheduling for review',async()=>{
 await db.exec(`insert into outreach_agent_threads(id,prospect_id,revision,owner,state,pause_reason) values(gen_random_uuid(),'${pid}',7,'human','paused','manual_takeover')`);
 await schedule(); await due(); await db.exec('update outreach_agent_threads set revision=8'); await db.query('select release_scheduled_inbox_dms()');
 expect((await row()).approved_at).toBeNull(); await schedule(); expect((await row()).send_blocked_reason).toBe('scheduled_in_inbox');
})
it('a handwritten schedule replaces older pending drafts and cancellation never reapproves it',async()=>{
 const created=await db.query<{schedule_inbox_dm:string[]}>(`select schedule_inbox_dm($1,'{}',ARRAY['Handwritten'],now()+interval '1 day','America/Los_Angeles',null)`,[pid]);
 const newId=created.rows[0].schedule_inbox_dm[0]; expect((await row()).send_blocked_reason).toBe('discarded_in_inbox');
 await db.query('select cancel_scheduled_inbox_dm($1)',[newId]);
 expect((await db.query(`select approved_at,send_blocked_reason from outreach_messages where id=$1`,[newId])).rows[0]).toMatchObject({approved_at:null,send_blocked_reason:'scheduled_send_cancelled'});
})
