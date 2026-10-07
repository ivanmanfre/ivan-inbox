import { afterEach, beforeEach, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { fixture, campaign, person, message, reply, payload, row, source, detail, id, AS_OF } from './replySources.fixture'
let db:PGlite
beforeEach(async()=>{db=await fixture();await campaign(db);await person(db)},30000)
afterEach(async()=>{await db?.close()})
it('uses purpose before incidental step and keeps unknown models unknown',async()=>{
 for(const [type,model,step,want] of [['dm','recycle_60d_v2',4,'recycle'],['dm','content_system_dm4_v1',4,'dm4'],['dm','content_system_followup_v1',2,'dm2'],['dm','rise_dm2_scan_delivery_v1',2,'requested_delivery'],['dm',null,null,'unknown'],['dm','future_dm5_v1',5,'unknown']]) {
  const r=await db.query<{p:any}>('select reply_source_private.purpose($1,$2,$3,null,null) p',[type,model,step]);expect(r.rows[0].p.touch).toBe(want)
 }
})
it('uses the inclusive seven-day boundary and has a null DM5 rate',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-27T12:00:00Z',{created_at:'2026-10-01T12:00:00Z'})
 const p=await payload(db);expect(source(p,'dm4').responders).toBe(1)
 expect(row(p,'dm4')).toMatchObject({sends:1,recipients:1,mature:1,replies_7d:1,rate_pct:100});expect(row(p,'dm5').rate_pct).toBeNull()
})
it.each([
 ['manual mirror', {ai_model:'manual_mirror',sequence_step:null},1],
 ['different known purpose', {ai_model:'recycle_60d_v2'},0],
])('deduplicates a receipt with %s',async(_,extra,known)=>{
 await message(db,100,'2026-09-20T12:00:00Z');await message(db,102,'2026-09-20T12:00:00Z',{unipile_message_id:'fixture-receipt-100',...extra})
 await reply(db,101,'2026-09-21T12:00:00Z');const p=await payload(db)
 expect(p.touches.reduce((n:number,r:any)=>n+r.sends,0)).toBe(1);expect(p.coverage.duplicate_rows).toBe(1);expect(source(p,'dm4').responders).toBe(known)
 if(!known)expect(p.coverage.unknown_purpose).toBe(1)
})
it('counts unique manual mirrors but no drafts or counters',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'manual_mirror',sequence_step:null})
 await message(db,102,'2026-09-21T12:00:00Z',{sent_at:null,unipile_message_id:null})
 await db.exec("update outreach_prospects set dm_count=42,recycled_at='2026-10-01'")
 const p=await payload(db);expect(row(p,'unknown').sends).toBe(1);expect(row(p,'dm4').sends).toBe(0);expect(p.coverage.uncertain_sends).toBe(0)
})
it.each([
 ['no receipt',{unipile_message_id:null}],['no time',{sent_at:null}],
 ['blocked',{send_blocked_at:'2026-09-21T12:00:00Z'}],
 ['partial',{send_blocked_reason:'partial_send'}],
])('keeps %s as a barrier outside confirmed denominators',async(_,extra)=>{
 await message(db,100,'2026-09-20T12:00:00Z');await message(db,102,'2026-09-21T12:00:00Z',extra);await reply(db,101,'2026-09-22T12:00:00Z')
 const p=await payload(db);expect(row(p,'dm4').sends).toBe(1);expect(p.coverage.uncertain_sends).toBe(1);expect(source(p,'unknown').responders).toBe(1)
})
it('groups bubbles by action and uses the completed action for source order',async()=>{
 for(let i=0;i<3;i++)await message(db,100+i,`2026-09-20T12:0${i}:00Z`,{agent_action_id:id(800)})
 await reply(db,110,'2026-09-20T12:01:30Z');const p=await payload(db)
 expect(row(p,'dm4').sends).toBe(1);expect(source(p,'unknown').responders).toBe(1)
})
it('credits a completed three-bubble action once',async()=>{
 for(let i=0;i<3;i++)await message(db,100+i,`2026-09-20T12:0${i}:00Z`,{agent_action_id:id(800)})
 await reply(db,110,'2026-09-20T12:03:00Z');const p=await payload(db)
 expect(row(p,'dm4')).toMatchObject({sends:1,eligible:1,replies_7d:1});expect(source(p,'dm4').responders).toBe(1)
})
it('deduplicates an inbound receipt across aliases',async()=>{
 await person(db,11,1,{linkedin_profile_id:'fixture-person-10'});await message(db,100,'2026-09-20T12:00:00Z')
 await reply(db,101,'2026-09-21T12:00:00Z');await reply(db,102,'2026-09-21T12:00:00Z',{prospect_id:id(11),unipile_message_id:'fixture-receipt-101'})
 const p=await payload(db);expect(p.totals.first_responders).toBe(1);expect(source(p,'dm4').responders).toBe(1);expect(p.coverage.duplicate_rows).toBe(1)
})
it('conflicting identities or chats on a receipt cannot receive confident credit',async()=>{
 await person(db,11);await message(db,100,'2026-09-20T12:00:00Z');await message(db,102,'2026-09-20T12:00:00Z',{prospect_id:id(11),unipile_chat_id:'other-chat',unipile_message_id:'fixture-receipt-100'})
 await reply(db,101,'2026-09-21T12:00:00Z');const p=await payload(db)
 expect(source(p,'unknown').responders).toBe(1);expect(p.coverage.identity_conflicts).toBeGreaterThan(0);expect(row(p,'dm4').sends).toBe(0)
})
it('uses old event time before campaign and period filters',async()=>{
 await campaign(db,2);await person(db,11,2,{linkedin_profile_id:'fixture-person-10'})
 await reply(db,99,'2026-07-01T12:00:00Z',{created_at:'2026-10-01T12:00:00Z',prospect_id:id(11)})
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-21T12:00:00Z')
 const p=await payload(db,'ivan',id(1));expect(p.totals.first_responders).toBe(0);expect(row(p,'dm4').eligible).toBe(0)
})
it('merges a normalized LinkedIn URL with its single profile ID',async()=>{
 await db.exec("update outreach_prospects set linkedin_url='https://www.linkedin.com/in/FIXTURE/?x=1#frag'")
 await person(db,11,1,{linkedin_profile_id:null,linkedin_url:'http://linkedin.com/in/fixture'})
 await reply(db,99,'2026-07-01T12:00:00Z',{prospect_id:id(11)});await reply(db,101,'2026-09-21T12:00:00Z')
 expect((await payload(db)).totals.first_responders).toBe(0)
})
it('does not merge conflicting IDs on one URL or records without approved URLs',async()=>{
 await db.exec("update outreach_prospects set linkedin_url='https://linkedin.com/in/fixture'")
 await person(db,11,1,{linkedin_url:'https://linkedin.com/in/fixture'})
 await reply(db,99,'2026-07-01T12:00:00Z',{prospect_id:id(11)});await reply(db,101,'2026-09-21T12:00:00Z')
 const p=await payload(db);expect(p.totals.first_responders).toBe(1);expect(p.coverage.identity_conflicts).toBeGreaterThan(0)
})
it.each(['risedtc','arch'])('keeps %s without an account row and isolates identical IDs',async(client)=>{
 await campaign(db,2,client);await person(db,11,2,{linkedin_profile_id:'fixture-person-10'});await reply(db,99,'2026-07-01T12:00:00Z')
 await message(db,100,'2026-09-20T12:00:00Z',{prospect_id:id(11)});await reply(db,101,'2026-09-21T12:00:00Z',{prospect_id:id(11)})
 expect((await payload(db,client)).totals.first_responders).toBe(1)
})
it.each([
 ['no chat',{unipile_chat_id:null},{}],['conflicting channel',{}, {channel:'email'}],
 ['later missing chat',{unipile_chat_id:null},{}],['tied send',{},{}],
])('reports unknown for %s',async(name,extra,inbound)=>{
 await message(db,100,'2026-09-20T12:00:00Z',name==='no chat'?extra:{})
 if(name==='later missing chat')await message(db,102,'2026-09-21T12:00:00Z',extra)
 if(name==='tied send')await message(db,102,'2026-09-22T12:00:00Z')
 await reply(db,101,'2026-09-22T12:00:00Z',inbound);expect(source(await payload(db),'unknown').responders).toBe(1)
})
it('infers a null channel only with coherent full chat evidence',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-21T12:00:00Z')
 expect((await detail(db)).first_reply).toMatchObject({channel:'linkedin',channel_basis:'chat_inferred',method:'inferred_same_chat'})
 await message(db,102,'2026-09-23T12:00:00Z',{channel:'email'})
 const p=await payload(db);expect(source(p,'unknown').responders).toBe(1);expect(p.coverage.channel_conflicts).toBeGreaterThan(0)
})
it('retains the real later campaign source before filtering',async()=>{
 await campaign(db,2);await person(db,11,2,{linkedin_profile_id:'fixture-person-10'})
 await message(db,100,'2026-09-20T12:00:00Z');await message(db,102,'2026-09-21T12:00:00Z',{prospect_id:id(11)})
 await reply(db,101,'2026-09-22T12:00:00Z');expect((await payload(db,'ivan',id(1))).totals.first_responders).toBe(0)
 expect((await payload(db,'ivan',id(2))).totals.first_responders).toBe(1)
})
it('counts a seven-day-plus-one-second reply only as late',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-27T12:00:01Z')
 expect(row(await payload(db),'dm4')).toMatchObject({replies_7d:0,late:1,rate_pct:0})
})
it('keeps replied pending units out of mature rates',async()=>{
 await message(db,100,'2026-10-02T12:00:00Z');await reply(db,101,'2026-10-03T12:00:00Z')
 const p=await payload(db);expect(source(p,'dm4').responders).toBe(1);expect(row(p,'dm4')).toMatchObject({pending:1,mature:0,replies_7d:0,rate_pct:null})
})
it('anchors repeated purpose sends at the earliest eligible send',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');await message(db,102,'2026-09-26T12:00:00Z');await reply(db,101,'2026-09-28T12:00:00Z')
 expect(row(await payload(db),'dm4')).toMatchObject({sends:2,eligible:1,repeated:1,replies_7d:0,late:1})
})
it('counts distinct overall recipients across touches',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'content_system_hook_v1',sequence_step:1})
 await message(db,102,'2026-09-21T12:00:00Z',{ai_model:'content_system_followup_v1',sequence_step:2})
 expect((await payload(db)).totals.recipients).toBe(1)
})
it('keeps reactions separate and decline and null intent as responders',async()=>{
 await person(db,11);await person(db,12)
 await reply(db,100,'2026-09-20T12:00:00Z',{is_reaction:true});await reply(db,101,'2026-09-20T12:00:00Z',{prospect_id:id(11),reply_intent:'decline'})
 await reply(db,102,'2026-09-20T12:00:00Z',{prospect_id:id(12)})
 const p=await payload(db);expect(p.totals).toMatchObject({reactions:1,first_responders:2});expect(source(p,'unknown')).toMatchObject({positive:0,unclassified:1})
})
it('collapses earliest reply ties to one unknown responder and conflicting intent to null',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-21T12:00:00Z',{reply_intent:'positive'});await reply(db,102,'2026-09-21T12:00:00Z',{reply_intent:'decline'})
 const p=await payload(db);expect(p.totals.first_responders).toBe(1);expect(source(p,'unknown')).toMatchObject({responders:1,unclassified:1,positive:0})
})
it.each(['success','interrupted','uncertain','reaction'])('calculates %s follow-up episodes',async(mode)=>{
 await reply(db,90,'2026-08-01T12:00:00Z');await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'ivan_cameback_followup_v1'})
 if(mode==='uncertain')await message(db,103,'2026-09-20T14:00:00Z',{ai_model:null,sequence_step:null})
 if(mode==='reaction')await reply(db,103,'2026-09-20T14:00:00Z',{is_reaction:true})
 await message(db,102,'2026-09-21T12:00:00Z',{ai_model:mode==='interrupted'?'warm_reply_auto_v1':'ivan_cameback_followup_v1'})
 await reply(db,101,'2026-09-22T12:00:00Z');await reply(db,104,'2026-09-22T12:01:00Z')
 const p=await payload(db)
 if(mode==='success'||mode==='reaction') {
  expect(p.totals.followup_responders).toBe(1);expect(p.followups.find((r:any)=>r.ordinal===2)).toMatchObject({episodes:1,responders:1,replies_7d:1});expect(p.followups[0].responders).toBe(0)
 } else {expect(p.totals.followup_responders).toBe(0);expect(p.coverage[mode==='interrupted'?'interrupted_episodes':'unknown_episodes']).toBe(1)}
})
it('retains archived and declined history, but excludes a whole operator alias',async()=>{
 await db.exec("update outreach_campaigns set archived=true,is_active=false;update outreach_prospects set stage='declined'")
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-21T12:00:00Z');expect((await payload(db)).totals.first_responders).toBe(1)
 await person(db,11,1,{linkedin_profile_id:'fixture-person-10'});await db.exec("insert into audn_person_label_v(person_key,is_operator) values ('fixture-person-10',true)")
 expect((await payload(db)).coverage.excluded_people).toBe(1);expect((await payload(db)).totals.first_responders).toBe(0);expect(await detail(db)).toBeNull()
})
it('excludes vendor people unless any alias has a booked call',async()=>{
 await reply(db,100,'2026-09-20T12:00:00Z',{reply_intent:'vendor_pitch'});expect((await payload(db)).totals.first_responders).toBe(0)
 await person(db,11,1,{linkedin_profile_id:'fixture-person-10',call_booked_at:'2026-09-22T12:00:00Z'});expect((await payload(db)).totals.first_responders).toBe(1)
})
it('excludes client team aliases and ARCH inbound request campaigns',async()=>{
 await campaign(db,2,'arch',{name:'Inbound Request'});await person(db,11,2);await reply(db,100,'2026-09-20T12:00:00Z',{prospect_id:id(11)})
 expect((await payload(db,'arch')).coverage.excluded_people).toBe(1)
 await campaign(db,3,'risedtc');await person(db,12,3,{company_domain:'https://client.test/team'});await reply(db,101,'2026-09-20T12:00:00Z',{prospect_id:id(12)})
 await db.exec(`insert into integration_config(key,value) values ('rise_do_not_target','["client.test"]')`)
 expect((await payload(db,'risedtc')).totals.first_responders).toBe(0)
})
it('does not infer Ivan for a prospect without a campaign',async()=>{
 await person(db,11,null);await reply(db,100,'2026-09-20T12:00:00Z',{prospect_id:id(11)});expect((await payload(db)).totals.first_responders).toBe(0)
})
it('uses recorded current template purpose and rejects conflicting model purpose',async()=>{
 await db.exec("insert into outreach_templates(key,client_id,step) values ('fixture-dm5','ivan','dm5'),('fixture-recycle','ivan','recycle')")
 await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'future_dm5_v1',sequence_step:5,draft_evidence:{template_key:'fixture-dm5'}})
 await reply(db,101,'2026-09-21T12:00:00Z');const p=await payload(db)
 expect(row(p,'dm5').sends).toBe(1);expect(p.coverage.current_template_purpose).toBe(1)
 await message(db,102,'2026-09-22T12:00:00Z',{draft_evidence:{template_key:'fixture-recycle'}})
 const events=await db.query<{touch:string,purpose_basis:string}>('select touch,purpose_basis from reply_source_private.events($1,$2) where event_id=$3',['ivan',AS_OF,id(102)])
 expect(events.rows[0]).toEqual({touch:'unknown',purpose_basis:'purpose_conflict'})
})
it('deduplicates product variants of the same receipt and chat',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z',{message_type:'inmail'})
 await message(db,102,'2026-09-20T12:00:00Z',{ai_model:'manual_mirror',sequence_step:null,unipile_message_id:'fixture-receipt-100'})
 await reply(db,101,'2026-09-21T12:00:00Z');const p=await payload(db)
 expect(row(p,'dm4').sends).toBe(1);expect(p.coverage.duplicate_rows).toBe(1);expect((await detail(db)).first_reply.product).toBe('inmail')
})
it('marks missing intent in an earliest reply tie as unclassified',async()=>{
 await reply(db,101,'2026-09-21T12:00:00Z',{reply_intent:'positive'});await reply(db,102,'2026-09-21T12:00:00Z')
 expect(source(await payload(db),'unknown')).toMatchObject({responders:1,positive:0,unclassified:1})
})
it('counts an open follow-up episode with a later unknown send as uncertain',async()=>{
 await reply(db,90,'2026-08-01T12:00:00Z');await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'ivan_cameback_followup_v1'})
 await message(db,101,'2026-09-21T12:00:00Z',{ai_model:null,sequence_step:null})
 expect((await payload(db)).coverage.unknown_episodes).toBe(1)
})
it('rollback removes only the new functions and leaves source rows intact',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');const {readFileSync}=await import('node:fs')
 await db.exec(readFileSync('db/20261007_reply_sources_rollback.sql','utf8'))
 expect((await db.query<{n:number}>('select count(*)::int n from outreach_messages')).rows[0].n).toBe(1)
 expect((await db.query<{n:number}>("select count(*)::int n from pg_namespace where nspname='reply_source_private'")).rows[0].n).toBe(0)
 expect((await db.query<{n:number}>('select count(*)::int n from outreach_agent_accounts')).rows[0].n).toBe(1)
})
it('does not credit conflicted inbound receipt identities',async()=>{
 await person(db,11);await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-21T12:00:00Z')
 await reply(db,102,'2026-09-21T12:00:00Z',{prospect_id:id(11),unipile_message_id:'fixture-receipt-101'})
 expect(source(await payload(db),'dm4').responders).toBe(0)
})
it('a generic InMail manual mirror does not erase a reviewed purpose',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z',{message_type:'inmail'})
 await message(db,102,'2026-09-20T12:00:00Z',{message_type:'inmail',ai_model:'manual_mirror',sequence_step:null,unipile_message_id:'fixture-receipt-100'})
 expect(row(await payload(db),'dm4').sends).toBe(1)
})
it('does not restore a conflicted receipt purpose through another action bubble',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z',{agent_action_id:id(800)})
 await message(db,102,'2026-09-20T12:00:00Z',{agent_action_id:id(800),unipile_message_id:'fixture-receipt-100',ai_model:'recycle_60d_v2'})
 await message(db,103,'2026-09-20T12:01:00Z',{agent_action_id:id(800)})
 expect(row(await payload(db),'dm4').sends).toBe(0)
})
it('exports a real SQL payload contract with known DM4 and a follow-up episode',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-21T12:00:00Z',{reply_intent:'positive'})
 await message(db,102,'2026-09-22T12:00:00Z',{ai_model:'ivan_cameback_followup_v1',sequence_step:null})
 await reply(db,103,'2026-09-23T12:00:00Z',{reply_intent:'soft_yes'})
 const metrics=(await db.query<{p:any}>("select reply_source_private.read_result('ivan',30,null,null,false,$1) p",[AS_OF])).rows[0].p
 const narrow=(await db.query<{p:any}>("select reply_source_private.read_result('ivan',30,null,$1,true,$2) p",[id(10),AS_OF])).rows[0].p
 expect(metrics.data.sources).toHaveLength(13);expect(row(metrics.data,'dm5').rate_pct).toBeNull()
 expect(narrow.data.first_reply.touch).toBe('dm4');expect(narrow.data.latest_reply).toMatchObject({touch:'followup',followup_ordinal:1,episode_outcome:'replied'})
 if(process.env.REPLY_SOURCE_EXPORT_FIXTURE==='1') {
  const {writeFileSync}=await import('node:fs');writeFileSync('.superpowers/sdd/PLAN/reply-source-v1.fixture.json',JSON.stringify({metrics,detail:narrow},null,2)+'\n',{mode:0o600})
 }
})
it.each(['inmail','email'])('keeps a generic %s purpose from supplying a precise follow-up ordinal',async(type)=>{
 await reply(db,90,'2026-08-01T12:00:00Z');await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'ivan_cameback_followup_v1'})
 await message(db,101,'2026-09-21T12:00:00Z',{ai_model:null,sequence_step:null,message_type:type,channel:type})
 await message(db,102,'2026-09-22T12:00:00Z',{ai_model:'ivan_cameback_followup_v1'})
 const f=await db.query<{ordinal:number|null}>('select ordinal from reply_source_private.followup_events($1,$2) where event_id=$3',['ivan',AS_OF,id(102)])
 expect(f.rows[0].ordinal).toBeNull();expect((await payload(db)).coverage.unknown_episodes).toBe(1)
})
it('uses elapsed UTC days across DST even with a non-UTC session',async()=>{
 await db.exec("set timezone='America/New_York'")
 await message(db,100,'2026-10-31T12:00:00Z');await reply(db,101,'2026-11-07T12:00:00Z')
 const p=(await db.query<{p:any}>("select reply_source_private.payload('ivan',30,null,'2026-11-07T12:00:00Z') p")).rows[0].p
 expect(new Date(p.period.from).toISOString()).toBe('2026-10-08T12:00:00.000Z')
 expect(row(p,'dm4')).toMatchObject({mature:1,replies_7d:1,pending:0,rate_pct:100})
})
it('orders overlapping logical actions by their final bubble',async()=>{
 await message(db,100,'2026-09-20T10:00:00Z',{agent_action_id:id(800)})
 await message(db,102,'2026-09-20T12:00:00Z',{agent_action_id:id(800)})
 await message(db,103,'2026-09-20T11:00:00Z',{ai_model:'recycle_60d_v2'})
 await reply(db,101,'2026-09-20T13:00:00Z')
 expect((await detail(db)).first_reply).toMatchObject({touch:'dm4',source_id:id(100)})
})
it('does not skip an unfinished action after a different completed send',async()=>{
 await message(db,100,'2026-09-20T10:00:00Z',{agent_action_id:id(800)})
 await message(db,102,'2026-09-20T12:00:00Z',{agent_action_id:id(800)})
 await message(db,103,'2026-09-20T11:00:00Z',{ai_model:'recycle_60d_v2'})
 await reply(db,101,'2026-09-20T11:30:00Z')
 expect((await detail(db)).first_reply).toMatchObject({touch:'unknown',reason:'unfinished_action'})
})
it('does not turn a receipt mirror import time into a later send',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z')
 await message(db,102,'2026-10-01T12:00:00Z',{sent_at:null,ai_model:'manual_mirror',sequence_step:null,unipile_message_id:'fixture-receipt-100'})
 await reply(db,101,'2026-09-21T12:00:00Z')
 expect(source(await payload(db),'dm4').responders).toBe(1)
})
it('keeps conflicting template purpose unknown even when the template step cannot supply purpose',async()=>{
 await db.exec("insert into outreach_templates(key,client_id,step) values ('fixture-dm5','ivan','dm5')")
 await message(db,100,'2026-09-20T12:00:00Z',{draft_evidence:{template_key:'fixture-dm5'}})
 const events=await db.query<{touch:string,purpose_basis:string}>('select touch,purpose_basis from reply_source_private.events($1,$2)',['ivan',AS_OF])
 expect(events.rows[0]).toEqual({touch:'unknown',purpose_basis:'purpose_conflict'})
})
it('treats an empty intent as missing classification',async()=>{
 await reply(db,101,'2026-09-21T12:00:00Z',{reply_intent:' '})
 expect(source(await payload(db),'unknown').unclassified).toBe(1)
})
it('review 1 retains an explicit purpose conflict through duplicate receipts',async()=>{
 await db.exec("insert into outreach_templates(key,client_id,step) values ('fixture-recycle','ivan','recycle')")
 await message(db,100,'2026-09-20T12:00:00Z')
 await message(db,102,'2026-09-20T12:00:00Z',{unipile_message_id:'fixture-receipt-100',draft_evidence:{template_key:'fixture-recycle'}})
 await reply(db,101,'2026-09-21T12:00:00Z')
 const p=await payload(db);expect(row(p,'dm4')).toMatchObject({sends:0,replies_7d:0});expect(source(p,'dm4').responders).toBe(0)
 expect(p.coverage).toMatchObject({unknown_purpose:1,duplicate_rows:1})
 const e=await db.query<{touch:string,purpose_basis:string}>("select touch,purpose_basis from reply_source_private.events('ivan',$1) where direction='outbound'",[AS_OF])
 expect(e.rows).toEqual([{touch:'unknown',purpose_basis:'purpose_conflict'}]);expect((await detail(db)).first_reply.touch).toBe('unknown')
})
it('review 1 keeps a duplicate purpose conflict uncertain inside a multi-bubble action',async()=>{
 await db.exec("insert into outreach_templates(key,client_id,step) values ('fixture-recycle','ivan','recycle')")
 await message(db,100,'2026-09-20T12:00:00Z',{agent_action_id:id(800)})
 await message(db,102,'2026-09-20T12:00:00Z',{agent_action_id:id(800),unipile_message_id:'fixture-receipt-100',draft_evidence:{template_key:'fixture-recycle'}})
 await message(db,103,'2026-09-20T12:01:00Z',{agent_action_id:id(800)})
 await reply(db,101,'2026-09-21T12:00:00Z')
 const p=await payload(db);expect(row(p,'dm4').sends).toBe(0);expect(source(p,'dm4').responders).toBe(0);expect(p.coverage.uncertain_sends).toBe(1)
})
it('review 2 groups DM and InMail bubbles into one same-family action',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z',{agent_action_id:id(800)})
 await message(db,102,'2026-09-20T12:01:00Z',{agent_action_id:id(800),message_type:'inmail'})
 await reply(db,101,'2026-09-21T12:00:00Z')
 const p=await payload(db);expect(row(p,'dm4')).toMatchObject({sends:1,repeated:0,replies_7d:1});expect(p.coverage.uncertain_sends).toBe(0)
 const d=(await detail(db)).first_reply;expect(d).toMatchObject({source_id:id(100),touch:'dm4',product:'unknown',method:'inferred_same_chat'})
 expect(new Date(d.sent_at).toISOString()).toBe('2026-09-20T12:00:00.000Z')
})
it.each([
 ['missing channel',{channel:null}],['missing chat',{unipile_chat_id:null}],
 ['missing channel and chat',{channel:null,unipile_chat_id:null}],
])('review 3 merges a receipt alias with %s',async(_,extra)=>{
 await message(db,100,'2026-09-20T12:00:00Z')
 await message(db,102,'2026-09-20T12:00:00Z',{ai_model:'manual_mirror',sequence_step:null,unipile_message_id:'fixture-receipt-100',...extra})
 await reply(db,101,'2026-09-21T12:00:00Z')
 const p=await payload(db);expect(row(p,'dm4')).toMatchObject({sends:1,replies_7d:1});expect(source(p,'dm4').responders).toBe(1)
 expect(p.coverage).toMatchObject({duplicate_rows:1,uncertain_sends:0})
 expect((await detail(db)).first_reply).toMatchObject({method:'inferred_same_chat',touch:'dm4',channel:'linkedin',product:'dm'})
})
it.each([
 ['two known families',{channel:'email'}],['two known chats',{unipile_chat_id:'other-chat'}],
 ['two profile identities',{prospect_id:id(11)}],
])('review 3 does not reconcile receipt aliases with %s',async(_,extra)=>{
 await person(db,11);await message(db,100,'2026-09-20T12:00:00Z')
 await message(db,102,'2026-09-20T12:00:00Z',{ai_model:'manual_mirror',sequence_step:null,unipile_message_id:'fixture-receipt-100',...extra})
 await message(db,103,'2026-09-20T12:00:00Z',{ai_model:'manual_mirror',sequence_step:null,unipile_message_id:'fixture-receipt-100',channel:null,unipile_chat_id:null})
 await reply(db,101,'2026-09-21T12:00:00Z')
 const p=await payload(db);expect(row(p,'dm4').sends).toBe(0);expect(source(p,'dm4').responders).toBe(0);expect(p.coverage.uncertain_sends).toBeGreaterThan(0)
})
it('review 4 excludes an incompatible unlocated email from the outbound tie count',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z')
 await message(db,102,'2026-09-20T12:00:00Z',{message_type:'email',channel:'email',unipile_chat_id:null,ai_model:null,sequence_step:null})
 await reply(db,101,'2026-09-21T12:00:00Z',{channel:'linkedin'})
 expect(source(await payload(db),'dm4').responders).toBe(1);expect((await detail(db)).first_reply.method).toBe('inferred_same_chat')
})
it.each(['linkedin',null])('review 4 retains a possible unlocated %s-channel outbound as a tie',async(channel)=>{
 await message(db,100,'2026-09-20T12:00:00Z')
 await message(db,102,'2026-09-20T12:00:00Z',{channel,unipile_chat_id:null,ai_model:null,sequence_step:null})
 await reply(db,101,'2026-09-21T12:00:00Z',{channel:'linkedin'})
 expect(source(await payload(db),'unknown').responders).toBe(1)
})
it.each(['before','after'])('review 5 ignores an incompatible unlocated email %s a LinkedIn follow-up',async(position)=>{
 await reply(db,90,'2026-08-01T12:00:00Z',{channel:'linkedin'})
 await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'ivan_cameback_followup_v1'})
 await message(db,102,position==='before'?'2026-09-19T12:00:00Z':'2026-09-21T12:00:00Z',{message_type:'email',channel:'email',unipile_chat_id:null,ai_model:null,sequence_step:null})
 await reply(db,101,'2026-09-22T12:00:00Z',{channel:'linkedin'})
 const p=await payload(db);expect(p.coverage.unknown_episodes).toBe(0);expect(p.totals.followup_responders).toBe(1)
 expect(p.followups).toEqual([{ordinal:1,episodes:1,responders:1,mature:1,pending:0,replies_7d:1,rate_pct:100,late:0}])
 expect((await detail(db)).latest_reply).toMatchObject({touch:'followup',source_id:id(100),followup_ordinal:1,episode_outcome:'replied'})
})
it.each([
 ['before',null,null],['after',null,null],['before','linkedin',null],['after','linkedin',null],
 ['before','email','fixture-chat'],['after','email','fixture-chat'],
])('review 5 keeps a %s possible channel %s chat %s as an episode barrier',async(position,channel,chat)=>{
 await reply(db,90,'2026-08-01T12:00:00Z',{channel:'linkedin'})
 await message(db,100,'2026-09-20T12:00:00Z',{ai_model:'ivan_cameback_followup_v1'})
 await message(db,102,position==='before'?'2026-09-19T12:00:00Z':'2026-09-21T12:00:00Z',{channel,unipile_chat_id:chat,ai_model:null,sequence_step:null})
 await reply(db,101,'2026-09-22T12:00:00Z',{channel:'linkedin'})
 const p=await payload(db);expect(p.coverage.unknown_episodes).toBe(1);expect(p.totals.followup_responders).toBe(0)
 expect((await detail(db)).latest_reply.episode_outcome).toBe('unknown')
})
it('keeps all purpose inputs distinct when a read shares classifier results',async()=>{
 await db.exec("insert into outreach_templates(key,client_id,step) values ('fixture-recycle','ivan','recycle'),('fixture-dm5','ivan','dm5')")
 const variants=[{}, {draft_evidence:{template_key:'fixture-recycle'}}, {sequence_step:5},
  {message_type:'manual_reply'}, {ai_model:null}, {ai_model:null,sequence_step:5,draft_evidence:{template_key:'fixture-dm5'}}]
 for(let n=0;n<variants.length;n++)await message(db,200+n,`2026-09-20T12:0${n}:00Z`,variants[n])
 const e=await db.query<{touch:string,purpose_basis:string}>("select touch,purpose_basis from reply_source_private.events('ivan',$1) order by event_id",[AS_OF])
 expect(e.rows).toEqual([
  {touch:'dm4',purpose_basis:'reviewed_model'}, {touch:'unknown',purpose_basis:'purpose_conflict'},
  {touch:'unknown',purpose_basis:'unknown'}, {touch:'unknown',purpose_basis:'purpose_conflict'},
  {touch:'unknown',purpose_basis:'unknown'}, {touch:'dm5',purpose_basis:'recorded_template_current_metadata'},
 ])
})
it('keeps every sorted source ID across receipt mirrors and action bubbles',async()=>{
 await message(db,203,'2026-09-20T12:00:00Z',{agent_action_id:id(800)})
 await message(db,201,'2026-09-20T12:01:00Z',{agent_action_id:id(800)})
 await message(db,204,'2026-09-20T12:00:00Z',{unipile_message_id:'fixture-receipt-203',agent_action_id:id(800),ai_model:'manual_mirror'})
 await message(db,202,'2026-09-20T12:01:00Z',{unipile_message_id:'fixture-receipt-201',agent_action_id:id(800),ai_model:'manual_mirror'})
 const e=await db.query<{source_ids:string[],duplicate_rows:number}>("select source_ids,duplicate_rows from reply_source_private.events('ivan',$1)",[AS_OF])
 expect(e.rows).toEqual([{source_ids:[id(201),id(202),id(203),id(204)],duplicate_rows:2}])
})
it('keeps normalized roster comparisons and whole-person exclusions with shared person history',async()=>{
 await campaign(db,2,'risedtc')
 await db.exec(`insert into integration_config(key,value) values ('rise_do_not_target','["client.test","Acme Labs"]')`)
 const fields=[{company_domain:'HTTPS://WWW.CLIENT.TEST/team'}, {email:'PERSON@CLIENT.TEST'},
  {headline:'Founder at CLIENT.TEST'}, {company:'ACME, Labs!'}, {title:'Acme / Labs engineer'}, {company:'Other'}]
 for(let n=0;n<fields.length;n++)await person(db,20+n,2,fields[n])
 await person(db,30,2,{linkedin_profile_id:'fixture-person-20',company:'Other',call_booked_at:'2026-09-01'})
 const p=await db.query<{prospect_id:string,excluded:boolean}>("select prospect_id,excluded from reply_source_private.people('risedtc',$1) order by prospect_id",[AS_OF])
 expect(p.rows).toEqual([...fields.map((_,n)=>({prospect_id:id(20+n),excluded:n<5})),{prospect_id:id(30),excluded:true}])
})
it('keeps an unlocated compatible tie but ignores a different chat at the same time',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z')
 await message(db,102,'2026-09-20T12:00:00Z',{unipile_chat_id:'different-chat'})
 await reply(db,101,'2026-09-21T12:00:00Z')
 expect((await detail(db)).first_reply).toMatchObject({source_id:id(100),touch:'dm4'})
 await message(db,103,'2026-09-20T12:00:00Z',{unipile_chat_id:null})
 expect((await detail(db)).first_reply).toMatchObject({source_id:null,reason:'outbound_time_tie'})
})
it('treats every roster regex metacharacter as literal text',async()=>{
 await campaign(db,2,'risedtc')
 const pairs=[['dot.alpha.test','dotXalphaXtest'],['pipe|alpha.test','pipealpha.test'],
  ['left[alpha.test','leftalpha.test'],['right]alpha.test','rightalpha.test'],
  ['back\\alpha.test','backalpha.test'],['cash$alpha.test','cashalpha.test'],
  ['plus+alpha.test','plusalpha.test'],['question?alpha.test','questionalpha.test'],
  ['open(alpha.test','openalpha.test'],['close)alpha.test','closealpha.test'],
  ['brace{2}.test','bracee.test'],['caret^alpha.test','caretalpha.test'],
  ['star*alpha.test','staralpha.test'],['percent%alpha.test','percentXalpha.test'],
  ['under_alpha.test','underXalpha.test'],['café.test','cafe.test']]
 await db.query("insert into integration_config(key,value) values ('rise_do_not_target',$1)",[JSON.stringify(pairs.map(x=>x[0]))])
 const expected=[]
 for(let n=0;n<pairs.length;n++)for(let side=0;side<2;side++) {
  const prospect=1000+n*2+side
  await person(db,prospect,2,{headline:`Prefix ${pairs[n][side]} suffix`})
  expected.push({prospect_id:id(prospect),excluded:side===0})
 }
 const p=await db.query<{prospect_id:string,excluded:boolean}>("select prospect_id,excluded from reply_source_private.people('risedtc',$1) order by prospect_id",[AS_OF])
 expect(p.rows).toEqual(expected)
})
it('keeps team and operator exclusions despite booking while a booked vendor stays included',async()=>{
 await campaign(db,2,'risedtc')
 await db.exec(`insert into integration_config(key,value) values ('rise_do_not_target','["client.test"]')`)
 for(const n of [40,41,42,43])await person(db,n,2,{call_booked_at:n===43?null:'2026-09-01T12:00:00Z',headline:n===40?'Works at client.test':null})
 await db.exec("insert into audn_person_label_v(person_key,is_operator) values ('fixture-person-41',true)")
 for(const n of [40,41,42,43])await reply(db,200+n,'2026-09-20T12:00:00Z',{prospect_id:id(n),reply_intent:'vendor_pitch'})
 const p=await db.query<{prospect_id:string,excluded:boolean}>("select prospect_id,excluded from reply_source_private.people('risedtc',$1) order by prospect_id",[AS_OF])
 expect(p.rows).toEqual([40,41,42,43].map(n=>({prospect_id:id(n),excluded:n!==42})))
})
it('keeps empty roster, null fields, and ARCH employee slug rules',async()=>{
 await campaign(db,2,'risedtc');await person(db,40,2,{linkedin_url:null,headline:null,company:null,email:null,company_domain:null})
 expect((await db.query<{excluded:boolean}>("select excluded from reply_source_private.people('risedtc',$1)",[AS_OF])).rows).toEqual([{excluded:false}])
 await campaign(db,3,'arch',{name:null});await person(db,41,3,{linkedin_url:null})
 await campaign(db,4,'arch');await person(db,42,4,{linkedin_url:'https://linkedin.com/in/fixture-employee',call_booked_at:'2026-09-01T12:00:00Z'})
 await db.exec(`insert into integration_config(key,value) values ('arch_person_exclusions','{"people":[{"slug":"FIXTURE-EMPLOYEE","reason":"arch_own_employee"},{"reason":"arch_own_employee"}]}')`)
 const p=await db.query<{prospect_id:string,excluded:boolean|null}>("select prospect_id,excluded from reply_source_private.people('arch',$1) order by prospect_id",[AS_OF])
 expect(p.rows).toEqual([{prospect_id:id(41),excluded:null},{prospect_id:id(42),excluded:true}])
})
it('keeps combined LIKE wildcard and escape characters literal in roster substrings',async()=>{
 await campaign(db,2,'risedtc')
 const pairs=[['literal\\%_.test','literal\\AB.test'],['escape\\\\%.test','escape\\\\X.test'],
  ['edge_.test','edgeX.test'],['edge%.test','edgeExtra.test']]
 await db.query("insert into integration_config(key,value) values ('rise_do_not_target',$1)",[JSON.stringify(pairs.map(x=>x[0]))])
 const expected=[]
 for(let n=0;n<pairs.length;n++)for(let side=0;side<2;side++) {
  const prospect=1100+n*2+side
  await person(db,prospect,2,{headline:null,title:`before\n${pairs[n][side]}\nafter`,company:null})
  expected.push({prospect_id:id(prospect),excluded:side===0})
 }
 const p=await db.query<{prospect_id:string,excluded:boolean}>("select prospect_id,excluded from reply_source_private.people('risedtc',$1) order by prospect_id",[AS_OF])
 expect(p.rows).toEqual(expected)
})
