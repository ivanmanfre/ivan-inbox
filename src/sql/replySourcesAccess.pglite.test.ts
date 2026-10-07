import { afterEach, beforeEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { fixture,campaign,person,message,reply,id,OPERATOR,insert } from './replySources.fixture'
let db:PGlite
beforeEach(async()=>{
 db=await fixture();await campaign(db);await person(db)
 await insert(db,'client_boards',{slug:'fixture-ivan',client_id:'ivan',token:'fixture-token',mode:'live'})
 await insert(db,'client_board_sessions',{slug:'fixture-ivan',token_hash:createHash('sha256').update('fixture-session').digest('hex'),expires_at:'2099-01-01',last_seen_at:'2026-01-01'})
},30000)
afterEach(async()=>{await db?.close()})
async function role(name:string,uid:string|null=null) {
 await db.exec(`reset role; set role ${name}`)
 await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)",[name,uid??''])
}
const call=async(sql:string,args:unknown[]=[]) => (await db.query<{p:any}>('select '+sql+' p',args)).rows[0].p
it('uses actual SHA-256 rather than an auth stub',async()=>{
 for(const value of ['fixture-session','wrong-session','']) expect(await call("encode(extensions.digest($1,'sha256'),'hex')",[value])).toBe(createHash('sha256').update(value).digest('hex'))
})
it.each([null,id(999)])('denies an authenticated non-operator %s',async(uid)=>{
 await role('authenticated',uid)
 await expect(call("public.outreach_reply_sources('ivan',30,null)")).rejects.toMatchObject({code:'42501'})
 await expect(call('public.inbox_reply_source($1)',[id(10)])).rejects.toMatchObject({code:'42501'})
})
it('denies anonymous private helpers and operator wrappers despite broad defaults',async()=>{
 await role('anon')
 for(const sql of ["reply_source_private.purpose('dm',null,null,null,null)","reply_source_private.payload('ivan',30,null,now())","reply_source_private.detail('ivan',null,now())","public.outreach_reply_sources('ivan',30,null)","public.inbox_reply_source(null)"]) {
  await expect(call(sql)).rejects.toMatchObject({code:'42501'})
 }
})
it('revokes execute on every private helper for browser roles',async()=>{
 const r=await db.query<{ok:boolean}>(`select has_function_privilege(role,oid,'execute') ok from pg_proc cross join (values ('anon'),('authenticated')) roles(role) where pronamespace='reply_source_private'::regnamespace`)
 expect(r.rows.length).toBeGreaterThan(6);expect(r.rows.every(x=>!x.ok)).toBe(true)
})
it.each(['authenticated','service_role'])('permits %s with all registered client lanes',async(name)=>{
 await campaign(db,2,'risedtc');await campaign(db,3,'arch');for(const client of ['ivan','risedtc','arch'])await warm(client);await role(name,name==='authenticated'?OPERATOR:null)
 for(const client of ['ivan','risedtc','arch'])expect(await call('public.outreach_reply_sources($1,30,null)',[client])).toMatchObject({status:'ok',data:{client_id:client}})
})
it('rejects invalid days, clients, campaigns and the public gate',async()=>{
 await campaign(db,2,'arch');await role('authenticated',OPERATOR)
 await expect(call("public.outreach_reply_sources('ivan',8,null)")).rejects.toMatchObject({code:'22023'})
 for(const client of ['inactive','missing','clientops'])await expect(call('public.outreach_reply_sources($1,30,null)',[client])).rejects.toMatchObject({code:'42501'})
 await expect(call("public.outreach_reply_sources('ivan',30,$1)",[id(2)])).rejects.toMatchObject({code:'42501'})
 await expect(call("public.outreach_reply_sources('clientops','ivan',30,null)")).rejects.toMatchObject({code:'42883'})
})
it.each(['token','session'])('rejects wrong and empty %s credentials and another slug',async(kind)=>{
 await role('anon');const fn=kind==='token'?'client_board_reply_sources':'client_board_reply_sources_v2';const good=kind==='token'?'fixture-token':'fixture-session'
 for(const credential of ['',null,'wrong'])await expect(call(`public.${fn}('fixture-ivan',$1,30)`,[credential])).rejects.toMatchObject({code:'42501'})
 await expect(call(`public.${fn}('other-slug',$1,30)`,[good])).rejects.toMatchObject({code:'42501'})
})
it.each(['revoked','expired-session','expired-board','inactive-client'])('rejects %s',async(condition)=>{
 if(condition==='revoked')await db.exec("update client_board_sessions set revoked_at=now()")
 if(condition==='expired-session')await db.exec("update client_board_sessions set expires_at='2000-01-01'")
 if(condition==='expired-board')await db.exec("update client_boards set expires_at='2000-01-01'")
 if(condition==='inactive-client')await db.exec("update client_registry set is_active=false where client_id='ivan'")
 await role('anon');await expect(call("public.client_board_reply_sources_v2('fixture-ivan','fixture-session',30)")).rejects.toMatchObject({code:'42501'})
})
it.each(['preview','generating'])('authenticates before a %s response',async(mode)=>{
 await db.query('update client_boards set mode=$1',[mode]);await role('anon')
 expect(await call("public.client_board_reply_sources('fixture-ivan','fixture-token',30)")).toEqual({status:'preview',data:null})
 await expect(call("public.client_board_reply_sources('fixture-ivan','bad',30)")).rejects.toMatchObject({code:'42501'})
})
it('returns not configured for a null-client live board or a client without campaigns',async()=>{
 await db.exec('update client_boards set client_id=null');await role('anon')
 expect(await call("public.client_board_reply_sources('fixture-ivan','fixture-token',30)")).toEqual({status:'not_configured',data:null})
 await role('authenticated',OPERATOR);expect(await call("public.outreach_reply_sources('empty',30,null)")).toEqual({status:'not_configured',data:null})
})
it('returns zero counts and null rates for a configured client without events',async()=>{
 await warm();await role('anon');const r=await call("public.client_board_reply_sources('fixture-ivan','fixture-token',30)")
 expect(r.status).toBe('ok');expect(r.data.totals).toEqual({first_responders:0,recipients:0,reactions:0,followup_responders:0})
 expect(r.data.sources).toHaveLength(13);expect(r.data.touches.every((t:any)=>t.rate_pct===null)).toBe(true)
})
it('denies cross-client prospect detail and hides excluded people',async()=>{
 await campaign(db,2,'arch');await person(db,11,2);await db.exec("insert into audn_person_label_v(person_key,is_operator) values ('fixture-person-10',true)")
 await warm();await role('anon')
 for(const [fn,key] of [['client_board_reply_source','fixture-token'],['client_board_reply_source_v2','fixture-session']]) {
  await expect(call(`public.${fn}('fixture-ivan',$1,$2)`,[key,id(11)])).rejects.toMatchObject({code:'42501'})
  expect(await call(`public.${fn}('fixture-ivan',$1,$2)`,[key,id(10)])).toEqual({status:'not_found',data:null})
 }
})
it('returns only the narrow six-RPC contract and does not write last_seen_at',async()=>{
 await message(db,100,'2026-09-20T12:00:00Z');await reply(db,101,'2026-09-21T12:00:00Z')
 await warm();await role('authenticated',OPERATOR)
 for(const sql of ["public.outreach_reply_sources('ivan',30,null)",`public.inbox_reply_source('${id(10)}')`,"public.client_board_reply_sources('fixture-ivan','fixture-token',30)","public.client_board_reply_sources_v2('fixture-ivan','fixture-session',30)",`public.client_board_reply_source('fixture-ivan','fixture-token','${id(10)}')`,`public.client_board_reply_source_v2('fixture-ivan','fixture-session','${id(10)}')`]) {
  const r=await call(sql);expect(r.status).toBe('ok');const text=JSON.stringify(r)
  for(const secret of ['fixture text','fixture-token','fixture-session','fixture-receipt','fixture-chat','content_system_dm4_v1','profile:','provider_account','ai_model','draft_evidence'])expect(text).not.toContain(secret)
 }
 await db.exec('reset role');expect(await call("(select last_seen_at::date::text from client_board_sessions)")).toBe('2026-01-01')
})
it('keeps private history row types unavailable to browser roles',async()=>{
 const r=await db.query<{ok:boolean}>(`select has_type_privilege(role,oid,'usage') ok from pg_type cross join (values ('anon'),('authenticated')) roles(role) where typnamespace='reply_source_private'::regnamespace and typtype='c'`)
 expect(r.rows.length).toBeGreaterThan(0);expect(r.rows.every(x=>!x.ok)).toBe(true)
})

// Snapshot reads use current authorization but one complete historical calculation.
const warm = async (client='ivan',at?:string) => call('reply_source_private.refresh_one($1,coalesce($2::timestamptz,statement_timestamp()))',[client,at??null])
const board = () => call("public.client_board_reply_sources('fixture-ivan','fixture-token',30)")
it('snapshot: returns explicit unavailable before initial publication',async()=>{
 await role('anon');expect(await board()).toEqual({status:'unavailable',data:null})
})
it('snapshot: keeps every raw mirror ownership dependency and rejects a moved alias',async()=>{
 await campaign(db,2,'arch');await person(db,11,1,{linkedin_profile_id:'fixture-person-10'})
 await message(db,100,'2026-10-01',{prospect_id:id(11)})
 await message(db,101,'2026-10-01',{prospect_id:id(11),unipile_message_id:'fixture-receipt-100'})
 await warm();expect((await board()).status).toBe('ok')
 await db.query('update outreach_messages set prospect_id=$1 where id=$2',[id(10),id(101)])
 expect(await board()).toEqual({status:'unavailable',data:null})
 await warm();await db.query('update outreach_prospects set campaign_id=$1 where id=$2',[id(2),id(11)])
 expect(await board()).toEqual({status:'unavailable',data:null})
 expect(await call('public.client_board_reply_source($1,$2,$3)',['fixture-ivan','fixture-token',id(10)])).toEqual({status:'unavailable',data:null})
})
it('snapshot: calculates maturity at snapshot time and keeps full no-message coverage',async()=>{
 const at=(await call('statement_timestamp()')) as string
 await message(db,100,at)
 await person(db,11,1,{linkedin_profile_id:null})
 const expected=await call('reply_source_private.payload($1,30,null,$2)',['ivan',at])
 await warm('ivan',at)
 expect(await board()).toEqual({status:'ok',data:expected})
 expect(expected.coverage.record_identities).toBe(1)
 expect(expected.touches.find((x:any)=>x.touch==='dm4')).toMatchObject({sends:1,pending:1,mature:0,rate_pct:null})
 expect(await call('public.client_board_reply_source($1,$2,$3)',['fixture-ivan','fixture-token',id(11)])).toEqual({status:'ok',data:{schema_version:1,as_of:expected.as_of,first_reply:null,latest_reply:null}})
})
it('snapshot: denies service-role refresh and direct snapshot access',async()=>{
 await role('service_role')
 await expect(warm()).rejects.toMatchObject({code:'42501'})
 await expect(db.query('select * from reply_source_private.snapshots')).rejects.toMatchObject({code:'42501'})
})
it('snapshot: accepts exactly fifteen minutes and rejects older or future data',async()=>{
 await warm()
 const at=await call('(select as_of from reply_source_private.snapshots)')
 expect((await call('reply_source_private.read_result($1,30,null,null,false,$2::timestamptz+interval \'15 minutes\')',['ivan',at])).status).toBe('ok')
 expect(await call('reply_source_private.read_result($1,30,null,null,false,$2::timestamptz+interval \'15 minutes 0.001 seconds\')',['ivan',at])).toEqual({status:'unavailable',data:null})
 expect(await call('reply_source_private.read_result($1,30,null,null,false,$2::timestamptz-interval \'1 second\')',['ivan',at])).toEqual({status:'unavailable',data:null})
})
it.each(['prospect-delete','campaign-delete','campaign-client','same-client-campaign','message-delete','draft-move'])('snapshot: whole generation is unavailable after %s',async(change)=>{
 await campaign(db,2);await person(db,11)
 await message(db,100,'2026-10-01',{sent_at:null,unipile_message_id:null})
 await warm()
 if(change==='prospect-delete')await db.query('delete from outreach_prospects where id=$1',[id(10)])
 if(change==='campaign-delete')await db.query('delete from outreach_campaigns where id=$1',[id(1)])
 if(change==='campaign-client')await db.query("update outreach_campaigns set client_id='arch' where id=$1",[id(1)])
 if(change==='same-client-campaign')await db.query('update outreach_prospects set campaign_id=$1 where id=$2',[id(2),id(10)])
 if(change==='message-delete')await db.query('delete from outreach_messages where id=$1',[id(100)])
 if(change==='draft-move')await db.query('update outreach_messages set prospect_id=$1 where id=$2',[id(11),id(100)])
 expect(await board()).toEqual({status:'unavailable',data:null})
})
it('snapshot: incoming eligible detail is unavailable until the next generation',async()=>{
 await warm();await person(db,11)
 expect(await call('public.client_board_reply_source($1,$2,$3)',['fixture-ivan','fixture-token',id(11)])).toEqual({status:'unavailable',data:null})
 await warm();expect(await call('public.client_board_reply_source($1,$2,$3)',['fixture-ivan','fixture-token',id(11)])).toMatchObject({status:'ok',data:{first_reply:null,latest_reply:null}})
})
it('snapshot: retains identity metadata as of publication without mixing mappings',async()=>{
 await person(db,11);await message(db,100,'2026-10-01');await reply(db,101,'2026-10-02');await warm()
 await db.query('update outreach_prospects set linkedin_profile_id=$1 where id=$2',['fixture-person-10',id(11)])
 expect(await call('public.client_board_reply_source($1,$2,$3)',['fixture-ivan','fixture-token',id(11)])).toMatchObject({status:'ok',data:{first_reply:null,latest_reply:null}})
 await warm();expect(await call('public.client_board_reply_source($1,$2,$3)',['fixture-ivan','fixture-token',id(11)])).toMatchObject({status:'ok',data:{first_reply:{reply_id:id(101)}}})
})
it.each(['wrong-version','infinity','negative-infinity'])('snapshot: rejects %s without numeric data',async(change)=>{
 await warm()
 if(change==='wrong-version')await db.exec("update reply_source_private.snapshots set calculation_version='future-version'")
 else await db.query('update reply_source_private.snapshots set as_of=$1',[change==='infinity'?'infinity':'-infinity'])
 expect(await board()).toEqual({status:'unavailable',data:null})
})
it.each(['expired-board','expired-session','revoked','rotated-token','operator-removed','inactive'])('snapshot: current authorization rejects %s despite fresh data',async(change)=>{
 await warm()
 if(change==='expired-board')await db.exec("update client_boards set expires_at=statement_timestamp()-interval '1 second'")
 if(change==='expired-session')await db.exec("update client_board_sessions set expires_at=statement_timestamp()-interval '1 second'")
 if(change==='revoked')await db.exec('update client_board_sessions set revoked_at=statement_timestamp()')
 if(change==='rotated-token')await db.exec("update client_boards set token='rotated'")
 if(change==='operator-removed')await db.exec("update outreach_agent_accounts set operator_ids='{}'")
 if(change==='inactive')await db.exec("update client_registry set is_active=false where client_id='ivan'")
 await role(change==='operator-removed'?'authenticated':'anon',OPERATOR)
 const sql=change==='operator-removed'?"public.outreach_reply_sources('ivan',30,null)":change==='rotated-token'?"public.client_board_reply_sources('fixture-ivan','fixture-token',30)":"public.client_board_reply_sources_v2('fixture-ivan','fixture-session',30)"
 await expect(call(sql)).rejects.toMatchObject({code:'42501'})
})
it('snapshot: an older refresh cannot replace a newer complete generation',async()=>{
 await warm();const at=await call('(select as_of from reply_source_private.snapshots)')
 await message(db,100,'2026-10-01')
 expect(await warm('ivan','2026-01-01')).toBe(false)
 expect(await call('(select as_of from reply_source_private.snapshots)')).toEqual(at)
 expect((await board()).data.totals.recipients).toBe(0)
})
it('snapshot: dispatcher keeps the last complete client generation after a publication error and continues',async()=>{
 await campaign(db,2,'arch');await person(db,11,2);await warm();await warm('arch')
 const previous=await call('(select to_jsonb(s) from reply_source_private.snapshots s where client_id=\'ivan\')')
 await message(db,100,'2026-10-01');await message(db,101,'2026-10-01',{prospect_id:id(11)})
 await db.exec(`create function public.fixture_snapshot_failure() returns trigger language plpgsql as $$ begin if new.client_id='ivan' then raise exception 'fixture private content' using errcode='P0001'; end if; return new; end $$;
 create trigger fixture_snapshot_failure before insert or update on reply_source_private.snapshots for each row execute function public.fixture_snapshot_failure()`)
 await call('reply_source_private.refresh_all()')
 expect(await call('(select to_jsonb(s) from reply_source_private.snapshots s where client_id=\'ivan\')')).toEqual(previous)
 expect(await call('(select error_code from reply_source_private.refresh_status where client_id=\'ivan\')')).toBe('P0001')
 expect((await call("reply_source_private.read_result('arch',30,null,null,false,statement_timestamp())")).data.totals.recipients).toBe(1)
 expect(JSON.stringify(await call('(select jsonb_agg(to_jsonb(s)) from reply_source_private.refresh_status s)'))).not.toContain('fixture private content')
})
it('snapshot: dispatcher removes inactive client data and browser roles cannot refresh',async()=>{
 await warm();await db.exec("update client_registry set is_active=false where client_id='ivan'")
 await call('reply_source_private.refresh_all()')
 expect(await call('(select count(*)::int from reply_source_private.snapshots where client_id=\'ivan\')')).toBe(0)
 for(const name of ['anon','authenticated','service_role']) {
  await role(name,OPERATOR)
  for(const fn of ['refresh_all()','register_job()','unschedule_job()'])await expect(call('reply_source_private.'+fn)).rejects.toMatchObject({code:'42501'})
 }
})
it('snapshot: deleting the last cached campaign invalidates the snapshot instead of claiming no configuration',async()=>{
 await warm();await db.exec('delete from outreach_campaigns')
 expect(await board()).toEqual({status:'unavailable',data:null})
})
it('snapshot: a failed history calculation preserves the complete previous generation',async()=>{
 await campaign(db,2,'risedtc');await person(db,11,2);await warm('risedtc')
 const before=await call('(select to_jsonb(s) from reply_source_private.snapshots s where client_id=\'risedtc\')')
 await insert(db,'integration_config',{key:'rise_do_not_target',value:'fixture invalid JSON'})
 await expect(warm('risedtc')).rejects.toMatchObject({code:'22P02'})
 expect(await call('(select to_jsonb(s) from reply_source_private.snapshots s where client_id=\'risedtc\')')).toEqual(before)
})
it('snapshot: an empty full history is valid and public reads leave the generation unchanged',async()=>{
 await campaign(db,2,'risedtc');await warm('risedtc')
 const before=await call('(select to_jsonb(s) from reply_source_private.snapshots s where client_id=\'risedtc\')')
 await role('authenticated',OPERATOR)
 const p=await call("public.outreach_reply_sources('risedtc',90,null)")
 expect(p.status).toBe('ok');expect(p.data.totals).toEqual({first_responders:0,recipients:0,reactions:0,followup_responders:0})
 expect(p.data.coverage).toMatchObject({record_identities:0,excluded_people:0,identity_conflicts:0})
 expect(p.data.touches).toHaveLength(13);expect(p.data.touches.every((x:any)=>x.rate_pct===null)).toBe(true)
 await db.exec('reset role')
 expect(await call('(select to_jsonb(s) from reply_source_private.snapshots s where client_id=\'risedtc\')')).toEqual(before)
})
it('rollback: commits the disabled marker before object removal even without a registered job',async()=>{
 await db.exec('begin; select reply_source_private.unschedule_job(); commit;')
 expect(await call('(select disabled from reply_source_private.scheduler where singleton)')).toBe(true)
 // This separate transaction is the registration window between the inverse's two transactions.
 await expect(call('reply_source_private.register_job()')).rejects.toMatchObject({code:'55000',message:'scheduler_disabled'})
 expect(await call('(select job_id from reply_source_private.scheduler where singleton)')).toBeNull()
})
it.each([null,42])('rollback: disabled registration rejects stored job ID %s before cron access',async(jobId)=>{
 await db.query('update reply_source_private.scheduler set disabled=true,job_id=$1 where singleton',[jobId])
 // There is no cron substitute in this fixture. The disabled guard must reject before cron access.
 await expect(call('reply_source_private.register_job()')).rejects.toMatchObject({code:'55000',message:'scheduler_disabled'})
 expect(await call('(select disabled from reply_source_private.scheduler where singleton)')).toBe(true)
 expect(await call('(select job_id::int from reply_source_private.scheduler where singleton)')).toBe(jobId)
})
