import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const path = process.env.WRITER_SOURCE || new URL('./writer.js', import.meta.url);
const code = fs.readFileSync(path, 'utf8');
const prompt = 'Fixture rubric';
const source = {source_id:'founder-1',client_id:'ivan',kind:'authorized_call_transcript',writer_eligible:true,state:'approved',location:'permitted-transcript:12',excerpt:'We review every proposed reply before anyone can send it.',source_date:'2026-09-18',consent:{state:'approved',purpose:['drafting']}};
const registry = (id='ivan') => ({client_id:id,is_active:true,platform:{measurement:{writer_enabled:true,roster:[],pilot_limits:{recommendations_per_review:3}}}});
const candidate = (kind='founder',id='founder-1',date='2026-09-18') => ({client_id:'ivan',subject:'operations',title:'Review before sending',buyer_relevance:'Agency owners need control over outgoing replies.',original_angle:'Show the approval decision before the automation.',next_action:'Collect one approved example.',what_changed:'A founder describes requiring review before sending.',why_it_matters:'Agency owners can inspect the approval step.',could_publish:'Show the decision on a short screen recording.',proof_needed:'One redacted example.',asset_required:false,format:'screen-demo',roster_accounts:[],roster_role:null,founder_source_ids:kind==='founder'?[id]:[],evidence:{source_ids:[kind+':'+id],source_dates:[date],sample_n:1,unknowns:'No measured result supplied.'},weekly:{week_start:'2026-09-21',slot:'experiment',hook:'Who approves the next reply?',intended_response:'Ask readers which step they review.',why_now:'Use this week to test the approval walkthrough.',success_metric:'Count relevant replies after seven days.',evidence_confidence:'medium',confidence_reason:'One direct excerpt, no outcome measurement.',priority_reason:'Direct fit to the buyer problem.',learning:{recommendation_ids:[],explanation:'No relevant measured feedback yet.'},rank:1,topic_key:'review-before-send'}});
async function run({body={preview:true},items=[candidate()],sources=[source],own=[],rows=[],cycles=[],clients=[registry()],external=[],competitors=[],gates=[],readLatency=0,contextLatency=0,contextExtra={},now='2026-09-19T10:00:00Z',feedback=[],rolloutRows=[],rolloutError=false,evidencePack={study:null,findings:[]}}={}) {
 const calls=[];const packs=[]; const RealDate=Date;
 class Clock extends RealDate {constructor(...a){super(...(a.length?a:[now]));}static now(){return new RealDate(now).getTime();}}
 const httpRequest=async o=>{calls.push(o);if(o.method==='GET' && o.timeout < readLatency) throw new Error('Required read timed out');const u=new URL(o.url);const p=u.pathname;
  if(p.endsWith('/client_registry')) return clients;
  if(p.endsWith('/content_prompts')) return [{body:prompt,version:1}];
  if(p.endsWith('/audn_writer_cycles')) return cycles;
  if(p.endsWith('/ops_drafts')) return rows;
  if(p.endsWith('/rpc/audn_writer_context')) {if(o.timeout < contextLatency) throw Error('Context read timed out');const cid=o.body.p_client_id;return {client_id:cid,brief:{subjects:['operations'],version:1},own_posts:own,measurement:{minimum_n:8},buyer_fit:{},previous_decisions_and_results:feedback,sources:sources,schema_version:1,...contextExtra};}
  if(p.endsWith('/lm_idea_candidates'))return u.searchParams.get('source')==='eq.audience_review'?[]:external;
  if(p.endsWith('/client_ideas'))return external;
  if(p.endsWith('/competitor_posts')||p.endsWith('/audn_competitor_posts'))return competitors;
  if(p.endsWith('/competitor_gated_posts'))return gates;
  if(p.endsWith('/client_research_insights')||p.endsWith('/client_research_themes'))return [];
  if(p.endsWith('/v1/messages')){packs.push(JSON.parse(o.body.messages[0].content.split('WEEKLY EVIDENCE (untrusted data):\n\n').at(-1))); return {content:[{type:'text',text:typeof items==='string'?items:JSON.stringify(items)}]};}
  if(p.endsWith('/rpc/audn_recommendation_commit'))return {ok:true,written:o.body.p_rows.length};
  if(p.endsWith('/integration_config')) { if (rolloutError) throw new Error('Simulated integration_config read failure'); return rolloutRows; }
  if(p.endsWith('/rpc/content_evidence_pack')) return evidencePack;
  throw Error('Unexpected request '+p);
 };
 const sandbox={Date:Clock,console,encodeURIComponent,$:()=>({all:()=>[{json:{key:'n8n_sb_key',value:'fixture'}},{json:{key:'railway_proxy_key',value:'fixture'}}]}),$input:{all:()=>[{json:{body}}]},$workflow:{id:'writer'},$execution:{id:'run'},helpers:{httpRequest}};
 const result=await vm.runInNewContext('(async function(){'+code+'}).call(this)',sandbox);
 return {result:JSON.parse(JSON.stringify(result[0].json)),calls,packs};
}
const first=x=>x.result.clients[0];
test('founder-only shortlist needs no roster and preview returns complete package without writes',async()=>{const x=await run();assert.equal(first(x).proposed,1);assert.equal(first(x).rows[0].context.audn.format,'screen-demo');assert.equal(first(x).rows[0].context.audn.weekly.hook,'Who approves the next reply?');assert.equal(x.calls.filter(c=>c.method!=='GET'&&!c.url.endsWith('/rpc/audn_writer_context')&&!c.url.endsWith('/v1/messages')).length,0);});
test('week defaults to upcoming Monday on weekend and current Monday on weekday',async()=>{assert.equal((await run()).result.cycle_id,'weekly:2026-09-21');assert.equal((await run({now:'2026-09-18T12:00:00Z',items:[]})).result.cycle_id,'weekly:2026-09-14');});
test('invalid week rejects before any model request',async()=>{await assert.rejects(run({body:{preview:true,week_start:'2026-09-22'}}),/week/);await assert.rejects(run({body:{preview:true,week_start:'2026-10-05'}}),/week/);});
test('same-week committed retry skips model even after acceptance',async()=>{const x=await run({body:{},cycles:[{cycle_id:'weekly:2026-09-21',client_id:'ivan',written:3}]});assert.equal(first(x).already_committed,true);assert.equal(x.packs.length,0);});
test('prior backlog and prior decisions enter next cycle without reducing cap',async()=>{const rows=Array.from({length:4},(_,i)=>({id:'old'+i,body:'A different old topic '+i,context:{audn:{evidence:{source_ids:[]}}}}));const feedback=[{recommendation_id:'old0',decision:'reject',decision_reason:'Wrong buyer',linked_results:[]}];const x=await run({rows,feedback});assert.equal(first(x).proposed,1);assert.equal(x.packs[0].limit,3);assert.equal(x.packs[0].already_recommended.length,4);assert.deepEqual(x.packs[0].previous_decisions_and_results,feedback);});
test('revoked and wrong-client excerpts cannot enter evidence or model context',async()=>{const x=await run({sources:[{...source,revoked_at:'2026-09-19'},{...source,source_id:'other',client_id:'arch'}]});assert.equal(first(x).proposed,0);assert(!JSON.stringify(x.packs).includes(source.excerpt));});
test('source dates must match exactly, including nullable dates',async()=>{const it=candidate();it.evidence.source_dates=['2026-09-17'];const x=await run({items:[it]});assert.equal(first(x).dropped[0].reason,'source_dates_mismatch');});
test('unknown source and wrong tenant are rejected',async()=>{let a=candidate();a.evidence.source_ids=['founder:unknown'];let b=candidate();b.client_id='arch';const x=await run({items:[a,b]});assert.deepEqual(first(x).dropped.map(x=>x.reason),['source_id_not_in_pack','wrong_client']);});
test('own-only evidence is valid without claiming performance',async()=>{const it=candidate('own_post','post-1');const x=await run({items:[it],sources:[],own:[{post_social_id:'post-1',text:'An approval walkthrough I posted.',published_at:'2026-09-18T10:00:00Z',format:'text',url:'https://linkedin.com/posts/p1'}]});assert.equal(first(x).proposed,1);assert.equal(first(x).rows[0].context.source_rows[0].kind,'own_post');});
test('stale evidence cannot support timely pick',async()=>{const it=candidate('founder','founder-1','2026-08-01');it.weekly.slot='timely';const x=await run({items:[it],sources:[{...source,source_date:'2026-08-01'}]});assert.equal(first(x).dropped[0].reason,'timely_evidence_not_fresh');});
test('duplicate underlying topic rejected within shortlist',async()=>{const a=candidate(),b=candidate();b.title='Different title';b.weekly.rank=2;const x=await run({items:[a,b]});assert.equal(first(x).proposed,1);assert.equal(first(x).dropped[0].reason,'duplicate_topic');});
test('proxy refusal never writes or marks complete',async()=>{const x=await run({body:{},items:'Weekly limit reached'});assert.equal(first(x).writer_bail,true);assert.equal(first(x).reason,'proxy_no_json');assert(!x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')));});
test('only active enabled filtered tenants are modeled',async()=>{const x=await run({body:{preview:true,client_id:'arch'},clients:[registry(),registry('arch'),{...registry('gone'),is_active:false}],items:[],sources:[]});assert.deepEqual(x.result.clients.map(c=>c.client_id),['arch']);assert.equal(x.packs[0].client_id,'arch');});
test('all clients preview is read-only and scoped',async()=>{const x=await run({clients:[registry(),registry('arch')],items:[],sources:[]});assert.deepEqual(x.packs.map(p=>p.client_id),['ivan','arch']);assert(!x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')));});
test('live writes weekly cycle and same week metadata',async()=>{const x=await run({body:{}});const c=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));assert.equal(c.body.p_cycle_id,'weekly:2026-09-21');assert.equal(c.body.p_rows[0].context.cycle_id,'weekly:2026-09-21');assert.equal(c.body.p_rows[0].context.audn.weekly.week_start,'2026-09-21');});
test('external source requires excerpt and URL and does not date from ingestion',async()=>{const external=[{id:'ext1',source:'breaking_news',ingested_at:'2026-09-19T10:00:00Z',evidence:[{url:'https://example.org/news',quote:'An actual retained headline.'}]}];const it=candidate('news','ext1:0',null);it.weekly.slot='timely';const x=await run({external,items:[it]});assert.equal(x.packs[0].evidence_items.find(e=>e.kind==='news').source_date,null);assert.equal(first(x).dropped[0].reason,'timely_evidence_not_fresh');});
test('private mixed idea sources never become evidence',async()=>{const x=await run({external:[{id:'private',source:'calls',evidence:[{url:'https://example.org',quote:'PRIVATE SECRET'}]}]});assert(!JSON.stringify(x.packs).includes('PRIVATE SECRET'));});
test('saved weekly rejection remains learning feedback',async()=>{const rows=[{id:'rejected1',body:'old',context:{weekly_decision:{decision:'rejected',reason:'Buyer mismatch',decided_at:'2026-09-15T10:00:00Z'}}}];const x=await run({rows});const f=x.packs[0].previous_decisions_and_results.find(r=>r.recommendation_id==='rejected1');assert.equal(f.decision_reason,'Buyer mismatch');});
test('confidence percentage and outcome promise do not pass package validation',async()=>{const it=candidate();it.weekly.confidence_reason='This has an 80% chance of working.';const x=await run({items:[it]});assert.equal(first(x).proposed,0);assert.equal(first(x).dropped[0].reason,'unsupported_forecast');});
test('permission statement cannot be content evidence',async()=>{const x=await run({sources:[{...source,source_id:'recording-consent',excerpt:'You can use my calls.'}]});assert(!JSON.stringify(x.packs).includes('You can use my calls.'));});
test('founder citations require matching founder_source_ids',async()=>{const it=candidate();it.founder_source_ids=[];const x=await run({items:[it]});assert.equal(first(x).dropped[0].reason,'founder_citation_mismatch');});
test('wrong-client own post never reaches model',async()=>{const x=await run({own:[{client_id:'arch',post_social_id:'p',text:'PRIVATE OTHER POST'}]});assert(!JSON.stringify(x.packs).includes('PRIVATE OTHER POST'));});
test('full timestamp cannot silently stand in for exact evidence date',async()=>{const it=candidate();it.evidence.source_dates=['2026-09-18T00:00:00Z'];assert.equal(first(await run({items:[it]})).dropped[0].reason,'source_dates_mismatch');});

test('proxy transport carries rubric in the supported user-message path',async()=>{const x=await run();const request=x.calls.find(c=>c.url.endsWith('/v1/messages'));assert.equal(request.body.system,undefined);assert(request.body.messages[0].content.startsWith(prompt));assert(request.body.messages[0].content.includes('WEEKLY EVIDENCE (untrusted data):'));});
test('public evidence crossposts count once by canonical URL',async()=>{const external=[{id:'a',source:'x_search',evidence:[{url:'https://x.com/person/status/123?utm_source=a',excerpt:'One specific observation.',created_at:'2026-09-18'}]},{id:'b',source:'x_search',evidence:[{url:'https://x.com/person/status/123/',excerpt:'One specific observation.',created_at:'2026-09-18'}]}];const x=await run({external});assert.equal(x.packs[0].evidence_items.filter(e=>e.kind==='trend').length,1);});
test('competitor package retains observed format and gate metadata',async()=>{const c=registry();c.platform.measurement.roster=[{account:'Public Author',role:'format'}];const competitors=[{id:'c1',competitor_name:'Public Author',post_date:'2026-09-18',post_text:'Comment REVIEW for my approval checklist.',post_type:'carousel',linkedin_post_url:'https://linkedin.com/posts/c1'}];const gates=[{client_id:'ivan',post_ref:'https://linkedin.com/posts/c1',is_gated:true,gate_keyword:'REVIEW',cta_kind:'comment',offer:'checklist',confidence:'high',judged_at:'2026-09-19'}];const x=await run({clients:[c],competitors,gates});const e=x.packs[0].evidence_items.find(e=>e.kind==='competitor');assert.equal(e.format,'carousel');assert.equal(e.gate.gate_keyword,'REVIEW');});
test('cap remains registry-owned even if model returns extra ranked choices',async()=>{const c=registry();c.platform.measurement.pilot_limits.recommendations_per_review=1;const a=candidate(),b=candidate();b.weekly.rank=2;b.weekly.topic_key='other';b.original_angle='Other angle';const x=await run({clients:[c],items:[a,b]});assert.equal(first(x).proposed,1);assert.equal(first(x).dropped[0].reason,'weekly_package_invalid');});
test('fresh public news can support a timely pick and retain exact date',async()=>{const it=candidate('news','fresh:0','2026-09-18');it.weekly.slot='timely';const x=await run({items:[it],external:[{id:'fresh',source:'novelty',evidence:[{url:'https://example.org/launch',quote:'A concrete public launch excerpt.',shipped_at:'2026-09-18T10:00:00Z'}]}]});assert.equal(first(x).proposed,1);assert.equal(first(x).rows[0].context.source_rows[0].date,'2026-09-18');});
test('unknown client request fails closed',async()=>{await assert.rejects(run({body:{preview:true,client_id:'unknown'}}),/client_not_enabled/);});
test('competitor-only rows validate correct roster membership',async()=>{const c=registry();c.platform.measurement.roster=[{account:'Public Author',role:'format'}];const it=candidate('competitor','c1');it.roster_accounts=['Public Author'];it.roster_role='format';const competitors=[{id:'c1',competitor_name:'Public Author',post_date:'2026-09-18',post_text:'An actual post.',post_type:'text',linkedin_post_url:'https://linkedin.com/posts/c1'}];assert.equal(first(await run({clients:[c],items:[it],competitors})).proposed,1);it.roster_accounts=['Unknown'];assert.equal(first(await run({clients:[c],items:[it],competitors})).dropped[0].reason,'roster_account_not_in_roster');});
test('same public story cannot be repackaged twice under different topic keys',async()=>{const a=candidate('news','same:0'),b=candidate('news','same:0');b.weekly.topic_key='different-label';b.weekly.rank=2;b.original_angle='A differently worded angle on the same announcement.';const external=[{id:'same',source:'novelty',evidence:[{url:'https://example.org/launch',quote:'Launch of one product.',source_date:'2026-09-18'}]}];const x=await run({items:[a,b],external});assert.equal(first(x).proposed,1);assert.equal(first(x).dropped[0].reason,'duplicate_source_story');});
test('historical backlog is bounded and truncation is explicit',async()=>{const rows=Array.from({length:121},(_,i)=>({id:'older'+i,body:'Historical topic '+i,context:{}}));const x=await run({rows});assert.equal(x.packs[0].already_recommended.length,40);assert.equal(first(x).coverage.model_selection.dedup_omitted,80);assert.equal(first(x).coverage.recommendation_history.included,120);assert.equal(first(x).coverage.recommendation_history.omitted_at_least,1);assert.equal(first(x).coverage.recommendation_history.window_days,90);const q=x.calls.find(c=>c.url.includes('/ops_drafts?'));assert(q.url.includes('created_at=gte.'));});

test('required reads tolerate observed transient database latency without retry or empty fallback',async()=>{const x=await run({readLatency:25000});assert.equal(first(x).proposed,1);assert.equal(x.packs.length,1);});

test('realistic large context is represented under budget with recent and supported own evidence',async()=>{const own=Array.from({length:70},(_,i)=>({post_social_id:'p'+i,text:'Own source material '.repeat(90),published_at:new Date(Date.UTC(2026,8,19)-i*864e5).toISOString(),url:'https://linkedin.com/posts/p'+i}));const measurement={minimum_n:20,coverage:Array.from({length:500},(_,i)=>({canonical_post_id:'p'+i,collection_status:'captured',note:'coverage metadata '.repeat(12)})),classifications:Array.from({length:200},(_,i)=>({canonical_post_id:'p'+i,subject:'operations',taxonomy_version:'v1',note:'taxonomy data '.repeat(15)})),matched_age:[{canonical_post_id:'p69',standing_pct:95,eligible_n:30,minimum_n:20,metric:'engagement_count',target_age_days:7}]};const contextExtra={measurement,prompts:[{role:'voice',body:'Complete applicable voice rule. '.repeat(4000)}]};const c=registry();c.platform.measurement.roster=[{account:'Public Author',role:'format'}];const competitors=Array.from({length:200},(_,i)=>({id:'c'+i,competitor_name:'Public Author',post_date:'2026-09-18',post_text:'Public source excerpt '.repeat(85),linkedin_post_url:'https://linkedin.com/posts/c'+i}));const x=await run({own,contextExtra,clients:[c],competitors});assert(JSON.stringify(x.packs[0]).length<512000);assert(x.packs[0].evidence_items.some(e=>e.id==='own_post:p69'));assert(x.packs[0].evidence_items.some(e=>e.id==='own_post:p0'));assert(first(x).coverage.own_selection.omitted_n>0);assert(first(x).coverage.measurement_selection.coverage.omitted_n>0);assert.equal(x.packs[0].prompts[0].body,contextExtra.prompts[0].body);});
test('oversized indispensable instructions still fail closed',async()=>{await assert.rejects(run({contextExtra:{prompts:[{role:'voice',body:'x'.repeat(520000)}]}}),/input_budget_exceeded/);});
test('deliberate empty model result commits an immutable empty weekly cycle',async()=>{const x=await run({body:{},items:[]});const c=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));assert(c);assert.equal(c.body.p_rows.length,0);assert.equal(first(x).reason,'no_supported_candidates');});
test('all-invalid model output stays retryable and does not commit empty cycle',async()=>{const it=candidate();it.client_id='wrong';const x=await run({body:{},items:[it]});assert(!x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')));assert.equal(first(x).writer_bail,true);});
test('dense measured gate packages stay representative and within input budget',async()=>{const c=registry();c.platform.measurement.roster=[{account:'Author A',role:'format'},{account:'Author B',role:'format'}];const competitors=Array.from({length:200},(_,i)=>({id:'c'+i,competitor_name:i%2?'Author A':'Author B',post_date:'2026-09-18',post_text:'A useful source paragraph '.repeat(20),linkedin_post_url:'https://linkedin.com/posts/c'+i}));const gates=competitors.map(r=>({client_id:'ivan',post_ref:r.linkedin_post_url,is_gated:true,why:'Observed gate explanation '.repeat(50),offer:'A relevant checklist',cta_kind:'comment',gate_keyword:'CHECK'}));const x=await run({clients:[c],competitors,gates,contextExtra:{prompts:[{role:'voice',body:'Complete applicable rule. '.repeat(5300)}]}});assert(JSON.stringify(x.packs[0]).length<512000);const ev=x.packs[0].evidence_items.filter(e=>e.kind==='competitor');assert(ev.some(e=>e.competitor_name==='Author A'));assert(ev.some(e=>e.competitor_name==='Author B'));assert(first(x).coverage.source_selection.omitted_n>0);});

test('public discovery stays diverse and bounded instead of filling input with one feed',async()=>{const external=Array.from({length:50},(_,i)=>({id:'lead'+i,source:i<40?'x_search':'novelty',evidence:[{url:'https://example.org/source'+i,quote:'Public observation '+i,source_date:'2026-09-18'}]}));const x=await run({external});const publicRows=x.packs[0].evidence_items.filter(e=>['news','trend'].includes(e.kind));assert(publicRows.length<=24);assert(publicRows.some(e=>e.kind==='news'));assert(publicRows.some(e=>e.kind==='trend'));assert(first(x).coverage.discovery_selection.omitted_at_least>0);});

test('required context RPC tolerates the observed slow read without retry',async()=>{const x=await run({contextLatency:25000});assert.equal(first(x).proposed,1);});
function modelViewFromSource(pack) {
 const start=code.indexOf('function makeModelPack('),end=code.indexOf('// MODEL_VIEW_END',start);
 assert(start>=0 && end>start,'production model view is implemented');
 const compact=vm.runInNewContext('('+code.slice(start,end).trim()+')');
 return JSON.parse(JSON.stringify(compact(pack)));
}
test('recorded three-client production packs fit 200k including rubric with complete client prompts',(t)=>{
 const tracePath=new URL('../../out/weekly-topics-2026-09-19/all-preview.json.trace.json',import.meta.url);
 if(!fs.existsSync(tracePath)){t.skip('Private production trace is intentionally not distributed');return;}
 const trace=JSON.parse(fs.readFileSync(tracePath,'utf8'));assert.equal(trace.packs.length,3);
 const rubric=fs.readFileSync(new URL('./prompt.md',import.meta.url),'utf8');
 for(const original of trace.packs){const compact=modelViewFromSource(original);assert(JSON.stringify(compact).length+rubric.length+60<=200000,original.client_id+' exceeds total input budget');assert.deepEqual(compact.prompts,original.prompts);assert.deepEqual(compact.brief,original.brief);assert(compact.evidence_items.filter(e=>e.kind==='competitor').length<=12);assert(compact.evidence_items.filter(e=>e.kind==='own_post').length<=6);assert(compact.coverage.model_selection.omitted_evidence_n>0);assert.equal(compact.measurement.minimum_n,original.measurement.minimum_n);}
});
test('fresh appended weekly rejection survives the twelve-record feedback cap',async()=>{const feedback=Array.from({length:12},(_,i)=>({recommendation_id:'old'+i,decision:'accepted',decided_at:'2026-08-01T10:00:00Z',linked_results:[]}));const rows=[{id:'fresh-reject',body:'Prior topic',context:{weekly_decision:{decision:'rejected',reason:'Wrong buyer for this week',decided_at:'2026-09-19T10:00:00Z'}}}];const it=candidate();it.weekly.learning.recommendation_ids=['fresh-reject'];const x=await run({feedback,rows,items:[it]});assert.equal(x.packs[0].previous_decisions_and_results.length,12);assert.equal(x.packs[0].previous_decisions_and_results[0].recommendation_id,'fresh-reject');assert.equal(first(x).proposed,1);});
test('recommendation prose over250 words is rejected without rewriting the model output',async()=>{const it=candidate();it.what_changed='A source describes the approval process in a concrete example. '.repeat(30);const x=await run({items:[it]});assert.equal(first(x).proposed,0);assert.equal(first(x).dropped[0].reason,'package_word_budget_exceeded');});

// ---------------------------------------------------------------------------
// Evidence path (D6/D7/D8): selector-pack region, rollout switch, evidence_package.
// ---------------------------------------------------------------------------
import { sha256Hex, currentRegionSha } from './sync-selector.mjs';
const rolloutRow=(clientIds)=>[{key:'weekly_evidence_selector_clients',value:clientIds}];
const evidenceFinding=(overrides={})=>({client_id:'ivan',finding_id:'ef1',kind:'market',source_ids:['sp1'],observed_value:400,baseline_value:50,baseline_n:30,likes:90,metric_id:'likes_plus_reposts',...overrides});

test('the writer.js selector-pack region is not stale against selector-pack.mjs',()=>{
 const selectorSource=fs.readFileSync(new URL('../content-evidence/selector-pack.mjs',import.meta.url),'utf8');
 assert.equal(currentRegionSha(code),sha256Hex(selectorSource));
});

test('a rollout switch read error fails closed to the legacy path and is recorded on the run summary',async()=>{
 const x=await run({body:{},rolloutError:true});
 assert.equal(first(x).evidence_path,false);
 assert.equal(x.result.evidence_rollout.clients.length,0);
 assert.match(x.result.evidence_rollout.read_error,/Simulated/);
});

test('an absent rollout row keeps every client on the legacy path with no evidence_package and no content_evidence_pack read',async()=>{
 const x=await run({body:{}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(commit);
 assert.equal('evidence_package' in commit.body.p_rows[0].context,false);
 assert.equal(x.calls.some(c=>c.url.endsWith('/rpc/content_evidence_pack')),false);
 assert.equal(first(x).evidence_path,false);
});

test('a model-cited evidence_candidate_key is ignored entirely when the rollout switch is empty and this is not an evidence preview',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:ef1';
 const x=await run({body:{},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(commit);
 assert.equal('evidence_package' in commit.body.p_rows[0].context,false);
 assert.equal(x.calls.some(c=>c.url.endsWith('/rpc/content_evidence_pack')),false);
});

test('preview with evidence:true never reaches the commit RPC even when a candidate cites a valid evidence candidate',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:ef1';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).evidence_path,true);
 assert(x.calls.some(c=>c.url.endsWith('/rpc/content_evidence_pack')));
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
 assert.equal(first(x).rows[0].context.evidence_package.source_finding_ids[0],'ef1');
 assert.equal(first(x).rows[0].context.evidence_package.label,'evidence_backed');
});

test('a rollout-named client commits a row carrying evidence_package copied from the server-built candidate',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:ef1';
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(commit);
 assert.equal(commit.body.p_rows[0].context.evidence_package.source_finding_ids[0],'ef1');
 assert.equal(commit.body.p_rows[0].context.evidence_package.label,'evidence_backed');
});

test('an unknown evidence_candidate_key is dropped, never invented into a citation',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:does-not-exist';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_candidate_unknown');
});

test('a second item citing the same experiment-labeled candidate is dropped once the slot is filled',async()=>{
 const experimentFinding=evidenceFinding({finding_id:'ef-exp',observed_value:10,baseline_value:50,baseline_n:25,likes:undefined,experiment_reason:'Untested angle for this client.'});
 delete experimentFinding.likes;
 const a=candidate();a.evidence_candidate_key='ivan:2026-09-21:ef-exp';
 const b=candidate();b.evidence_candidate_key='ivan:2026-09-21:ef-exp';b.weekly.rank=2;b.weekly.topic_key='different-topic';b.original_angle='A different angle entirely.';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[a,b],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[experimentFinding]}});
 assert.equal(first(x).proposed,1);
 assert.equal(first(x).dropped[0].reason,'evidence_candidate_second_experiment');
});

test('prose that phrases a measured source\'s lift as the client\'s own achieved result is dropped',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:ef1';it.what_changed='We saw our reach jump after trying this approach.';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_package_relevance_as_performance');
});

test('an echoed evidence_package with source_finding_ids that differ from the server-built candidate is dropped',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:ef1';it.evidence_package={source_finding_ids:['not-the-real-id']};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_package_number_mismatch');
});

test('an echoed evidence_package citing a client fact the server-built candidate never authorized is dropped',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:ef1';it.evidence_package={source_finding_ids:['ef1'],client_fact_refs:['not-authorized']};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_package_unauthorized_client_fact');
});
