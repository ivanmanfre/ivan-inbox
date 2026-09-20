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
// Run 4: a measured source post as the live table returns it, keyed by canonical_source_id.
const STUDY_POST_DATE='2026-09-16';
// D11: the default body is a substantive post, because a source with nothing to adapt is now
// refused before it can become a candidate. Keep it above SOURCE_BODY_FLOOR (80 characters after
// links, tags and pictographs are removed); the caption-only and bare-quote cases are their own
// named fixtures below.
const studyPost=(id,overrides={})=>({canonical_source_id:id,source_url:'https://linkedin.com/posts/'+id,author_id:'Source Author',author_role:'peer',published_at:STUDY_POST_DATE+'T09:00:00Z',post_text:'A measured source post that opens on the approval decision. It sets out the step where someone reads the draft before it leaves, then shows what that step caught last month.',format_evidence:{},age_comparability:'age_unmatched',...overrides});
// Cite a candidate the way the repaired contract requires: the candidate key PLUS its own
// measured source post, in citation order, with that post's exact date.
const citing=(it,key,sourceIds=['sp1'])=>{
 it.evidence_candidate_key=key;
 it.evidence.source_ids=[...it.evidence.source_ids,...sourceIds.map(s=>'evidence_source:'+s)];
 it.evidence.source_dates=[...it.evidence.source_dates,...sourceIds.map(()=>STUDY_POST_DATE)];
 it.evidence.sample_n=it.evidence.source_ids.length;
 return it;
};
async function run({body={preview:true},items=[candidate()],sources=[source],own=[],rows=[],cycles=[],clients=[registry()],external=[],competitors=[],gates=[],readLatency=0,contextLatency=0,contextExtra={},now='2026-09-19T10:00:00Z',feedback=[],rolloutRows=[],rolloutError=false,evidencePack={study:null,findings:[]},studyPosts=null,proxyBehaviour=null}={}) {
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
  if(p.endsWith('/v1/messages')){packs.push(JSON.parse(o.body.messages[0].content.split('WEEKLY EVIDENCE (untrusted data):\n\n').at(-1)));
   // Run 4: proxyBehaviour models transport weather. Throwing is a transport failure; returning
   // a non-null value replaces the reply; returning null falls through to the usual fixture reply.
   if(proxyBehaviour){const forced=proxyBehaviour(o);if(forced!==null&&forced!==undefined)return forced;}
   return {content:[{type:'text',text:typeof items==='string'?items:JSON.stringify(items)}]};}
  if(p.endsWith('/rpc/audn_recommendation_commit'))return {ok:true,written:o.body.p_rows.length};
  if(p.endsWith('/integration_config')) { if (rolloutError) throw new Error('Simulated integration_config read failure'); return rolloutRows; }
  if(p.endsWith('/rpc/content_evidence_pack')) return typeof evidencePack==='function' ? evidencePack(o.body.p_client_id) : evidencePack;
  // Run 4 TRACE C1: the writer resolves a candidate's measured source posts by primary key,
  // because content_evidence_pack's own `posts` array is capped at the 200 newest market posts
  // and resolved 0 of 12 live candidates. Default here: answer with exactly the ids asked for,
  // which is the real table's behaviour. Pass `studyPosts` to model a partial or empty answer.
  if(p.endsWith('/client_research_study_posts')){
   if(typeof studyPosts==='function') return studyPosts(o);
   if(Array.isArray(studyPosts)) return studyPosts;
   const inClause=/^in\.\((.*)\)$/.exec(u.searchParams.get('canonical_source_id')||'');
   const ids=inClause?inClause[1].split(',').map(decodeURIComponent):[];
   return ids.map(id=>studyPost(id));
  }
  throw Error('Unexpected request '+p);
 };
 const sandbox={Date:Clock,console,encodeURIComponent,setTimeout:(fn)=>setTimeout(fn,0),$:()=>({all:()=>[{json:{key:'n8n_sb_key',value:'fixture'}},{json:{key:'railway_proxy_key',value:'fixture'}}]}),$input:{all:()=>[{json:{body}}]},$workflow:{id:'writer'},$execution:{id:'run'},helpers:{httpRequest}};
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
// Live integration_config.value is a `text` column: PostgREST returns the JSON array literally
// as a JSON STRING ('["ivan"]'), never as a parsed array (audit F1). This is the realistic mock.
const rolloutRow=(clientIds)=>[{key:'weekly_evidence_selector_clients',value:JSON.stringify(clientIds)}];
const rolloutRowRaw=(clientIds)=>[{key:'weekly_evidence_selector_clients',value:clientIds}];
const rolloutRowText=(text)=>[{key:'weekly_evidence_selector_clients',value:text}];
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

// ---------------------------------------------------------------------------
// F1: integration_config.value is TEXT live; PostgREST returns a JSON string, not an array.
// ---------------------------------------------------------------------------

test('F1: a text-column rollout value (\'["ivan"]\') is parsed and enables that client',async()=>{
 const x=await run({body:{client_id:'ivan'},rolloutRows:rolloutRowText('["ivan"]')});
 assert.equal(x.result.evidence_rollout.clients.length,1);
 assert.equal(x.result.evidence_rollout.clients[0],'ivan');
 assert.equal(x.result.evidence_rollout.read_error,null);
});

test('F1: a genuinely already-parsed array value is still accepted (not text-only)',async()=>{
 const x=await run({body:{client_id:'ivan'},rolloutRows:rolloutRowRaw(['ivan'])});
 assert.equal(x.result.evidence_rollout.clients.length,1);
 assert.equal(x.result.evidence_rollout.clients[0],'ivan');
});

test('F1: malformed JSON text fails closed to [] and records a read_error',async()=>{
 const x=await run({body:{},rolloutRows:rolloutRowText('["ivan"')});
 assert.equal(x.result.evidence_rollout.clients.length,0);
 assert.equal(typeof x.result.evidence_rollout.read_error,'string');
 assert(x.result.evidence_rollout.read_error.length>0);
 assert.equal(first(x).evidence_path,false);
});

test('F1: the text \'null\' fails closed to [] and records a read_error',async()=>{
 const x=await run({body:{},rolloutRows:rolloutRowText('null')});
 assert.equal(x.result.evidence_rollout.clients.length,0);
 assert(x.result.evidence_rollout.read_error);
});

test('F1: the text \'{}\' fails closed to [] and records a read_error',async()=>{
 const x=await run({body:{},rolloutRows:rolloutRowText('{}')});
 assert.equal(x.result.evidence_rollout.clients.length,0);
 assert(x.result.evidence_rollout.read_error);
});

test('F1: an absent row stays [] with no read_error (not malformed, just unset)',async()=>{
 const x=await run({body:{}});
 assert.equal(x.result.evidence_rollout.clients.length,0);
 assert.equal(x.result.evidence_rollout.read_error,null);
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
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).evidence_path,true);
 assert(x.calls.some(c=>c.url.endsWith('/rpc/content_evidence_pack')));
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
 assert.equal(first(x).rows[0].context.evidence_package.source_finding_ids[0],'ef1');
 // D15: a single market source post supports the SOURCE's result, never that the mechanism
 // transfers, so the saved label (and the reader's Experiment badge) says experiment.
 assert.equal(first(x).rows[0].context.evidence_package.label,'experiment');
 assert.equal(first(x).rows[0].context.evidence_package.floor_label,'evidence_backed');
 assert.equal(first(x).rows[0].context.evidence_package.mechanism_support,'source_only');
 assert.equal(first(x).rows[0].context.evidence_package.is_experiment,true);
});

test('a rollout-named client commits a row carrying evidence_package copied from the server-built candidate',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(commit);
 assert.equal(commit.body.p_rows[0].context.evidence_package.source_finding_ids[0],'ef1');
 assert.equal(commit.body.p_rows[0].context.evidence_package.label,'experiment'); // D15
 assert.equal(commit.body.p_rows[0].context.evidence_package.floor_label,'evidence_backed');
});

test('an unknown evidence_candidate_key is dropped, never invented into a citation',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:does-not-exist';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_candidate_unknown');
});

test('a second experiment choice is dropped once the single slot is filled, whichever route it takes',async()=>{
 // Two distinct experiment candidates, so the guard under test is the one-experiment slot and
 // not the D8 already-cited rule, which has its own control.
 // The selector offers at most one experiment candidate, so the second experiment here is the
 // freeform slot. Both routes into the one-experiment cap are covered by this one assertion.
 const experimentFinding=evidenceFinding({finding_id:'ef-exp',observed_value:10,baseline_value:50,baseline_n:25,experiment_reason:'Untested angle for this client.'});
 delete experimentFinding.likes;
 const a=citing(candidate(),'ivan:2026-09-21:ef-exp');
 const b=candidate();b.experiment=true;b.experiment_reason='A second untested opening.';b.test_metric='Weighted reactions at 7 days.';
 b.weekly.rank=2;b.weekly.topic_key='different-topic';b.original_angle='A different angle entirely.';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[a,b],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[experimentFinding]}});
 assert.equal(first(x).proposed,1);
 assert.equal(first(x).dropped[0].reason,'evidence_candidate_second_experiment');
});

test('prose that phrases a measured source\'s lift as the client\'s own achieved result is dropped',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');it.what_changed='We saw our reach jump after trying this approach.';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_package_relevance_as_performance');
});

test('an echoed evidence_package with source_finding_ids that differ from the server-built candidate is dropped',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');it.evidence_package={source_finding_ids:['not-the-real-id']};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_package_number_mismatch');
});

test('an echoed evidence_package citing a client fact the server-built candidate never authorized is dropped',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');it.evidence_package={source_finding_ids:['ef1'],client_fact_refs:['not-authorized']};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'evidence_package_unauthorized_client_fact');
});

// ---------------------------------------------------------------------------
// Fix pass (Sol review, PHASE-1-REVIEW.md must-fix 2/7/8; D10)
// ---------------------------------------------------------------------------

test('must-fix 7: a legacy (evidence-inactive) model pack never carries an evidence_candidates key at all',async()=>{
 const x=await run({body:{}});
 assert.equal('evidence_candidates' in x.packs[0],false);
});

test('must-fix 2: previousTests for the evidence path is built from openRows, not left empty',async()=>{
 const priorRow={id:'prior-evidence-row',body:'Prior topic',context:{evidence_package:{source_finding_ids:['ef1']},weekly_decision:{decision:'rejected',reason:'Timing was off'}}};
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{},items:[it],rows:[priorRow],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(commit);
 const history=commit.body.p_rows[0].context.evidence_package.adaptation_history;
 assert.equal(history.length,1);
 assert.equal(history[0].recommendation_id,'prior-evidence-row');
 assert.equal(history[0].status,'rejected');
});

test('must-fix 8 (D7): a preview carrying evidence:true may target the first uncommitted Monday up to NEXT_WEEK+7',async()=>{
 const it=candidate();it.weekly.week_start='2026-09-28';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true,week_start:'2026-09-28'},items:[it]});
 assert.equal(x.result.cycle_id,'weekly:2026-09-28');
});

test('must-fix 8 (D7): the same +7 week is still rejected for a non-evidence preview',async()=>{
 await assert.rejects(run({body:{preview:true,client_id:'ivan',week_start:'2026-09-28'}}),/week/);
});

test('must-fix 8 (D7): the same +7 week is still rejected for a live (non-preview) request even with evidence:true',async()=>{
 await assert.rejects(run({body:{client_id:'ivan',evidence:true,week_start:'2026-09-28'}}),/week/);
});

test('D10: the evidence pool passed to buildEvidencePack is capped at EVIDENCE_POOL_LIMIT (12), not the registry weekly cap',async()=>{
 const findings=['p1','p2','p3','p4'].map((id,i)=>evidenceFinding({finding_id:'ef-pool-'+id,source_ids:['sp-pool-'+id],observed_value:400-i*10}));
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},evidencePack:{study:{study_id:'s1',state:'validated'},findings}});
 assert.equal(first(x).evidence_coverage.candidates_selected,4);
});

// ---------------------------------------------------------------------------
// F3 (PRELEASE-AUDIT.md): the saved package's exact shape -- client_fact_refs as
// {source_id,kind,label} objects (never a raw id for display), needs_material, and
// experiment_reason when the candidate is an experiment.
// ---------------------------------------------------------------------------

test('F3: the saved evidence_package carries client_fact_refs as {source_id,kind,label} objects and needs_material',async()=>{
 const finding=evidenceFinding({client_fact_ids:['founder-1']});
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[finding]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 const pkg=commit.body.p_rows[0].context.evidence_package;
 assert.equal(pkg.label,'experiment'); // D15: mechanism class, floor result kept at floor_label
 assert.equal(pkg.floor_label,'evidence_backed');
 assert.equal(pkg.needs_material,null);
 // D15: the row IS an experiment now, so it carries the reason the reader shows.
 assert.equal(typeof pkg.experiment_reason,'string');
 assert(pkg.experiment_reason.length>20);
 assert.equal(pkg.client_fact_refs.length,1);
 assert.equal(pkg.client_fact_refs[0].source_id,'founder-1');
 assert.equal(pkg.client_fact_refs[0].kind,'authorized_call_transcript');
 assert.equal(typeof pkg.client_fact_refs[0].label,'string');
 assert(pkg.client_fact_refs[0].label.length>0);
 assert.notEqual(pkg.client_fact_refs[0].label,'founder-1');
});

test('F3: a needs_material candidate saves the reason string, not null',async()=>{
 const finding=evidenceFinding();
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[finding]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 const pkg=commit.body.p_rows[0].context.evidence_package;
 assert.equal(typeof pkg.needs_material,'string');
 assert(pkg.needs_material.length>0);
 assert.equal(pkg.client_fact_refs.length,0);
});

test('F3: an experiment-labeled saved evidence_package carries experiment_reason',async()=>{
 const finding=evidenceFinding({finding_id:'ef-exp',observed_value:10,baseline_value:50,baseline_n:25,experiment_eligible:true});
 delete finding.likes;
 const it=citing(candidate(),'ivan:2026-09-21:ef-exp');
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[finding]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 const pkg=commit.body.p_rows[0].context.evidence_package;
 assert.equal(pkg.label,'experiment');
 assert.equal(typeof pkg.experiment_reason,'string');
 assert(pkg.experiment_reason.length>0);
});

// ---------------------------------------------------------------------------
// Budget fix (S7 rollout live finding, $OUT/RELEASE-RECEIPTS/S7-rollout.json). Measured on this
// exact fixture shape (own=70 posts, competitors=200, a tuned voice-prompt repeat count): the
// synthetic legacy-only pack crosses 200,000 chars at repeat~5324. A `repeat` just under that
// puts the LEGACY input alone near the ceiling -- exactly the "ivan scale" condition the live
// failure reproduced.
// ---------------------------------------------------------------------------
function nearCeilingFixtureArgs(repeat) {
  const own=Array.from({length:70},(_,i)=>({post_social_id:'p'+i,text:'Own source material '.repeat(90),published_at:new Date(Date.UTC(2026,8,19)-i*864e5).toISOString(),url:'https://linkedin.com/posts/p'+i}));
  const measurement={minimum_n:20,coverage:Array.from({length:500},(_,i)=>({canonical_post_id:'p'+i,collection_status:'captured',note:'coverage metadata '.repeat(12)})),classifications:Array.from({length:200},(_,i)=>({canonical_post_id:'p'+i,subject:'operations',taxonomy_version:'v1',note:'taxonomy data '.repeat(15)})),matched_age:[{canonical_post_id:'p69',standing_pct:95,eligible_n:30,minimum_n:20,metric:'engagement_count',target_age_days:7}]};
  const contextExtra={measurement,prompts:[{role:'voice',body:'Complete applicable voice rule. '.repeat(repeat)}]};
  const c=registry();c.platform.measurement.roster=[{account:'Public Author',role:'format'}];
  const competitors=Array.from({length:200},(_,i)=>({id:'c'+i,competitor_name:'Public Author',post_date:'2026-09-18',post_text:'Public source excerpt '.repeat(85),linkedin_post_url:'https://linkedin.com/posts/c'+i}));
  return {own,contextExtra,clients:[c],competitors};
}
const poolFindings=(n)=>Array.from({length:n},(_,i)=>evidenceFinding({finding_id:'ef-pool-'+i,source_ids:['sp-pool-'+i],observed_value:400-i}));

test('regression: aggregate-input-overflow -- near-ceiling legacy input trims the evidence pool from the end (lowest-ranked first), commits nothing extra, and fits',async()=>{
 const x=await run({...nearCeilingFixtureArgs(5700),items:[],body:{preview:true,client_id:'ivan',evidence:true},evidencePack:{study:{study_id:'s1',state:'validated'},findings:poolFindings(12)}});
 const rec=first(x);
 assert.equal(rec.evidence_pool_offered,12);
 assert(rec.evidence_pool_dropped_for_budget.length>=1);
 assert(rec.evidence_pool_dropped_for_budget.every(d=>d.code==='input_budget'));
 const survivors=x.packs[0].evidence_candidates;
 assert.equal(survivors.length,12-rec.evidence_pool_dropped_for_budget.length);
 const droppedKeys=new Set(rec.evidence_pool_dropped_for_budget.map(d=>d.draft_key));
 assert(survivors.every(c=>!droppedKeys.has(c.draft_key)));
 // dropped from the END of the lift-ranked pool: the lowest-ranked (last) findings go first.
 assert(droppedKeys.has('ivan:2026-09-21:ef-pool-11'));
 const totalChars=prompt.length+128+JSON.stringify(x.packs[0]).length;
 assert(totalChars<=200000);
});

test('budget fix: a legacy input that already exceeds the ceiling on its own still throws exactly as before (item 2, unchanged)',async()=>{
 await assert.rejects(run({...nearCeilingFixtureArgs(6200),items:[],body:{preview:true,client_id:'ivan',evidence:true},evidencePack:{study:{study_id:'s1',state:'validated'},findings:poolFindings(12)}}),/audn_input_budget_exceeded:ivan/);
 // Unchanged: the SAME legacy-only pack, with no evidence path at all, throws identically.
 await assert.rejects(run({...nearCeilingFixtureArgs(6200),items:[]}),/audn_input_budget_exceeded:ivan/);
});

test('budget fix: an evidence-path failure for one client is isolated and does not abort or affect another client',async()=>{
 const clients=[registry('ivan'),registry('arch')];
 const evidencePackFn=(cid)=>{
  if(cid==='ivan') throw new Error('Simulated content_evidence_pack RPC failure');
  return {study:{study_id:'s1',state:'validated'},findings:[evidenceFinding({client_id:'arch',finding_id:'ef-arch'})]};
 };
 const x=await run({body:{},items:[],clients,rolloutRows:rolloutRow(['ivan','arch']),evidencePack:evidencePackFn});
 assert.equal(x.packs.length,2);
 const ivanRec=x.result.clients.find(c=>c.client_id==='ivan');
 const archRec=x.result.clients.find(c=>c.client_id==='arch');
 assert(ivanRec);assert(archRec);
 assert.equal(typeof ivanRec.evidence_error,'string');
 assert(ivanRec.evidence_error.includes('Simulated'));
 assert.equal(ivanRec.skipped,false);
 assert.equal('evidence_error' in archRec,false);
 assert.equal(archRec.evidence_coverage.candidates_selected,1);
});

test('budget fix: an evidence-path failure inside the budget-fitting loop itself is also isolated (defense in depth)',async()=>{
 // The evidence pool build succeeds, but the SAVED committed row shape (not the fitting loop)
 // is unaffected either way -- this proves the fitting stage's own try/catch is reachable and
 // falls back cleanly rather than only ever being dead code.
 const x=await run({body:{},items:[],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:poolFindings(1)}});
 const rec=first(x);
 assert.equal(rec.evidence_pool_offered,1);
 assert.deepEqual(rec.evidence_pool_dropped_for_budget,[]);
 assert.equal('evidence_error' in rec,false);
});

// ---------------------------------------------------------------------------
// Measured-source requirement (second live finding). Native evidence previews proved the model
// can propose a choice that cites nothing: on an evidence-active client every normal choice must
// cite a surviving pool candidate or be the one explicit experiment -- never neither.
// ---------------------------------------------------------------------------

test('an evidence-active client drops an uncited choice as no_measured_source, never pads with it',async()=>{
 const it=candidate(); // plain founder citation, no evidence_candidate_key, no experiment:true
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'no_measured_source');
 assert.equal(first(x).evidence_selection.dropped_no_measured_source,1);
 assert.equal(first(x).evidence_selection.cited,0);
});

test('audit C: the model writing choices that all fail measured-source validation bails retryable, never commits an empty cycle',async()=>{
 const it=candidate();
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
 assert.equal(first(x).writer_bail,true);
 assert.equal(first(x).reason,'no_measured_source');
 assert.equal('coverage_gap' in first(x),false);
 assert.equal(first(x).evidence_selection.dropped_no_measured_source,1);
});

test('audit C, superseded by DECISIONS D8: a deliberate model [] on a client with a real measured pool no longer commits an empty week',async()=>{
 // Run 3 accepted an immutable empty cycle here. D8 (M5b) reverses that on the evidence path
 // only: audn_recommendation_commit has no delete path, so an empty commit would burn the week
 // for a client that has a measured pool waiting. The legacy half of the original assertion is
 // kept intact by the legacy-path control below it.
 const x=await run({body:{},items:[],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
 assert.equal(first(x).writer_bail,true);
 assert.equal(first(x).retryable,true);
 assert.equal(first(x).reason,'no_choices_returned');
 assert.equal(first(x).coverage_gap,'no_candidate_fit_this_week');
});

test('the identical uncited choice is kept unchanged on the legacy path (switch empty, no evidence:true)',async()=>{
 const it=candidate();
 const x=await run({items:[it]});
 assert.equal(first(x).proposed,1);
 assert.equal('evidence_selection' in first(x),false);
});

test('exactly one freeform experiment (experiment:true) is kept; a second is dropped',async()=>{
 const a=candidate();a.experiment=true;a.experiment_reason='Untested angle for this client.';a.test_metric='replies at 7 days';
 const b=candidate();b.experiment=true;b.experiment_reason='A second untested angle.';b.test_metric='replies at 7 days';b.weekly.rank=2;b.weekly.topic_key='other';b.original_angle='Other angle';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[a,b],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,1);
 assert.equal(first(x).rows[0].context.evidence_package.label,'experiment');
 assert.equal(first(x).rows[0].context.evidence_package.source_finding_ids.length,0);
 assert.equal(first(x).rows[0].context.evidence_package.limitations[0],'No measured source supports this choice; it is a test.');
 assert.equal(first(x).rows[0].context.evidence_package.experiment_reason,a.experiment_reason);
 assert.equal(first(x).dropped[0].reason,'evidence_candidate_second_experiment');
 assert.equal(first(x).evidence_selection.experiments,1);
});

test('a freeform experiment missing experiment_reason or test_metric is dropped as no_measured_source',async()=>{
 const it=candidate();it.experiment=true;it.experiment_reason='';it.test_metric='replies at 7 days';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.equal(first(x).dropped[0].reason,'no_measured_source');
});

test('a cited row\'s saved numbers still come from the server-built candidate, not the model',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding({observed_value:900,baseline_value:60,baseline_n:40,likes:150})]}});
 const pkg=first(x).rows[0].context.evidence_package;
 assert.equal(pkg.source_finding_ids[0],'ef1');
 assert.match(pkg.test_metric,/reactions|reposts|likes/i);
 assert.equal(pkg.label,'experiment'); // D15: mechanism class, floor result kept at floor_label
 assert.equal(pkg.floor_label,'evidence_backed');
 assert.equal(first(x).evidence_selection.cited,1);
});

// ---------------------------------------------------------------------------
// M1 fix (PRELEASE-AUDIT.md section 7): evidenceActive alone is "the switch is on", not "there is
// a pool to cite". An empty pool (RPC error, budget-trimmed to zero, or no findings) must fall
// back to ordinary legacy validation for that client, never require a citation nobody can supply.
// The auditor's own two probes, reproduced as tests.
// ---------------------------------------------------------------------------

test('M1 probe 1: content_evidence_pack throwing on a live enabled run still commits the ordinary row, no evidence_package',async()=>{
 const it=candidate();
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:()=>{throw new Error('Simulated RPC failure');}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(commit);
 assert.equal(commit.body.p_rows.length,1);
 assert.equal('evidence_package' in commit.body.p_rows[0].context,false);
 assert.equal(first(x).proposed,1);
 assert.match(first(x).evidence_error,/Simulated/);
 assert.equal(first(x).writer_bail,false);
 assert.equal('coverage_gap' in first(x),false);
 assert.equal('evidence_selection' in first(x),false);
});

test('M1 probe 2: empty findings (no RPC error, empty pool) on a live enabled run still commits the ordinary row, no evidence_package',async()=>{
 const it=candidate();
 const x=await run({body:{},items:[it],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[]}});
 const commit=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(commit);
 assert.equal(commit.body.p_rows.length,1);
 assert.equal('evidence_package' in commit.body.p_rows[0].context,false);
 assert.equal(first(x).proposed,1);
 assert.equal('evidence_error' in first(x),false);
 assert.equal('evidence_selection' in first(x),false);
});

// ---------------------------------------------------------------------------
// D: stable client_registry order.
// ---------------------------------------------------------------------------

test('D: the client_registry read requests a stable order (client_id.asc)',async()=>{
 const x=await run({body:{}});
 const req=x.calls.find(c=>c.url.includes('/client_registry?'));
 assert(req);
 assert(req.url.includes('order=client_id.asc'));
});

// ---------------------------------------------------------------------------
// Run 4 regression controls. Each name carries a `regression: <slug>` a checker can find.
// Boundary types are the REAL ones: the rollout value is TEXT holding JSON, and a saved
// evidence package lives at context.evidence_package.
// ---------------------------------------------------------------------------

test('regression: text-rollout-parsing -- the switch value is a TEXT column holding JSON, parsed as text, never as an array',async()=>{
 const x=await run({body:{},items:[citing(candidate(),'ivan:2026-09-21:ef1')],rolloutRows:[{key:'weekly_evidence_selector_clients',value:'["ivan"]'}],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(x.result.evidence_rollout.clients,['ivan']);
 assert.equal(first(x).evidence_path,true);
 // a genuine array (the shape the writer wrongly tested for before) must still parse
 const y=await run({body:{},items:[],rolloutRows:[{key:'weekly_evidence_selector_clients',value:['ivan']}]});
 assert.deepEqual(y.result.evidence_rollout.clients,['ivan']);
});

test('regression: writer-reader-package-path -- a saved evidence package is written at context.evidence_package, the path the reader and the history read use',async()=>{
 const x=await run({body:{},items:[citing(candidate(),'ivan:2026-09-21:ef1')],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const row=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit')).body.p_rows[0];
 assert.equal(typeof row.context.evidence_package,'object');
 assert.equal('evidence_package' in row.context.audn,false);
 assert.equal(JSON.stringify(row.context.evidence_package.source_finding_ids),'["ef1"]');
});

test('regression: uncited-ordinary-choice -- an evidence-active client refuses an uncited non-experiment choice',async()=>{
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[candidate()],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,0);
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['no_measured_source']);
});

test('regression: empty-week-poisoning -- every model row dropped leaves a retryable bail and never commits an empty cycle',async()=>{
 const x=await run({body:{},items:[candidate()],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).writer_bail,true);
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
});

test('regression: honest-bail-reason -- a drop by another validator reports no_valid_candidates with the real reasons, not no_measured_source',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 it.weekly.learning.recommendation_ids=['not-a-real-recommendation'];
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['learning_reference_invalid']);
 assert.equal(first(x).reason,'no_valid_candidates');
 assert.deepEqual(first(x).drop_reasons,{learning_reference_invalid:1});
 // and the honest label is still claimed when that validator really did the dropping
 const y=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[candidate()],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(y).reason,'no_measured_source');
});

test('regression: incompatible-learning-reference -- an empty learning list is valid on the evidence path and never drops a correctly cited row',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 it.weekly.learning={recommendation_ids:[],explanation:'No measured learning exists for this source yet.'};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(first(x).dropped,[]);
 assert.equal(first(x).proposed,1);
});

test('regression: unknown-citation -- a candidate key that was never offered is refused, never invented',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:never-offered');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['evidence_candidate_unknown']);
});

test('regression: stale-citation -- a key minted for another week is refused',async()=>{
 const it=citing(candidate(),'ivan:2026-09-14:ef1');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['evidence_candidate_unknown']);
});

test('regression: cross-client-citation -- one client can never cite a key minted for another',async()=>{
 const it=citing(candidate(),'arch:2026-09-21:ef1');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['evidence_candidate_unknown']);
 // and the minted key is always scoped to the client and week that asked for it
 assert.equal(x.packs[0].evidence_candidates[0].draft_key,'ivan:2026-09-21:ef1');
});

test('regression: source-citation-binding -- a cited choice must cite its own candidate measured source post',async()=>{
 const it=candidate();it.evidence_candidate_key='ivan:2026-09-21:ef1'; // key copied, source post not cited
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['evidence_source_not_cited']);
});

test('regression: source-arithmetic-mismatch -- an echoed evidence package that disagrees with the trusted candidate is refused',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 it.evidence_package={source_finding_ids:['ef1'],objective:'a_different_objective'};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['evidence_package_number_mismatch']);
});

test('regression: missing-client-permission -- an unapproved client fact never reaches the model and never becomes a client_fact_ref',async()=>{
 const denied={...source,source_id:'fact-denied',excerpt:'DENIED CLIENT MATERIAL',consent:{state:'denied',purpose:[]},writer_eligible:false,state:'denied'};
 const finding=evidenceFinding({client_fact_ids:['fact-denied']});
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[],sources:[denied],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[finding]}});
 // the excerpt never reaches the model, and the candidate says plainly that material is missing
 assert(!JSON.stringify(x.packs).includes('DENIED CLIENT MATERIAL'));
 assert.equal(x.packs[0].founder_sources.some(f=>f.source_id==='fact-denied'),false);
 const cand=x.packs[0].evidence_candidates[0];
 assert.equal('client_fact_refs' in cand,false,'the model view never carries a fact reference it may not use');
 assert(cand,'the candidate is still offered, never silently dropped');
 assert.equal(typeof cand.needs_material,'string');
 assert(cand.needs_material.length>0);
 // and a choice that tries to use it is refused by a permission validator, never written
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 it.evidence_package={source_finding_ids:['ef1'],client_fact_refs:['fact-denied']};
 const y=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],sources:[denied],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[finding]}});
 assert.equal(first(y).proposed,0);
 assert.deepEqual(first(y).dropped.map(d=>d.reason),['founder_source_not_approved']);
 // the same refusal when the unapproved fact is smuggled only through the echoed package
 const z=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[(()=>{const q=citing(candidate(),'ivan:2026-09-21:ef1');q.evidence_package={source_finding_ids:['ef1'],client_fact_refs:['fact-denied']};return q;})()],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[finding]}});
 assert.deepEqual(first(z).dropped.map(d=>d.reason),['evidence_package_unauthorized_client_fact']);
});

test('regression: evidence-source-resolution -- a candidate whose measured source post cannot be resolved is refused, never allowed through on an unrelated citation',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],studyPosts:[],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 // the unresolvable source id is not in the pack at all, so the legacy citation check fires first
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['source_id_not_in_pack']);
 assert.equal(first(x).evidence_source_posts_resolved,0);
 assert.equal(x.packs[0].evidence_items.some(e=>e.kind==='evidence_source'),false);
});

test('regression: evidence-source-visible -- the measured source post reaches the model with its author, url, date and text',async()=>{
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const item=x.packs[0].evidence_items.find(e=>e.kind==='evidence_source');
 assert(item,'the measured source post is published as an evidence item');
 assert.equal(item.id,'evidence_source:sp1');
 assert.equal(item.source_date,STUDY_POST_DATE);
 assert.equal(item.competitor_name,'Source Author');
 assert(item.excerpt.length>0);
 assert.deepEqual(x.packs[0].evidence_candidates[0].source_evidence_ids,['evidence_source:sp1']);
 assert.equal(x.packs[0].evidence_candidates[0].source_summary[0].evidence_id,'evidence_source:sp1');
 assert.equal(first(x).evidence_source_posts_resolved,1);
});

test('regression: legacy-path-unchanged -- a switch-empty run publishes no evidence_source item and reads no study posts',async()=>{
 const x=await run({body:{}});
 assert.equal(x.packs[0].evidence_items.some(e=>e.kind==='evidence_source'),false);
 assert.equal('evidence_candidates' in x.packs[0],false);
 assert.equal(x.calls.some(c=>c.url.includes('/client_research_study_posts')),false);
 assert.equal(first(x).proposed,1);
 assert.equal('evidence_package' in x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit')).body.p_rows[0].context,false);
});

test('regression: cap-three-choices -- the weekly cap holds on the evidence path',async()=>{
 // D15: the weekly cap is a separate cap from the one-experiment cap, so this control uses
 // SUPPORTED mechanisms (a predeclared pattern comparison that passed) -- otherwise the
 // experiment cap would bind first and the weekly cap would never be exercised at all.
 const supported=(o)=>evidenceFinding({kind:'pattern',predeclared:true,validation_state:'passed',...o});
 const findings=[supported({}),supported({finding_id:'ef2',source_ids:['sp2'],observed_value:390}),supported({finding_id:'ef3',source_ids:['sp3'],observed_value:380}),supported({finding_id:'ef4',source_ids:['sp4'],observed_value:370})];
 const mk=(n,key,sid)=>{const it=citing(candidate(),key,[sid]);it.weekly.rank=n;it.weekly.topic_key='topic-'+n;it.original_angle='Angle number '+n;return it;};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[mk(1,'ivan:2026-09-21:ef1','sp1'),mk(2,'ivan:2026-09-21:ef2','sp2'),mk(3,'ivan:2026-09-21:ef3','sp3'),mk(4,'ivan:2026-09-21:ef4','sp4')],evidencePack:{study:{study_id:'s1',state:'validated'},findings}});
 assert.equal(first(x).proposed,3,'never more than the registry cap');
 assert.equal(first(x).dropped.length,1,'the fourth choice is refused, never squeezed in');
 assert.equal(first(x).evidence_selection.cited,3);
 assert.equal(first(x).evidence_selection.experiments,0);
});

test('regression: cap-one-experiment -- a second experiment-flagged choice is refused once the single slot is filled',async()=>{
 const findings=[evidenceFinding()];
 const e1=candidate();e1.experiment=true;e1.experiment_reason='An untested opening for this buyer.';e1.test_metric='Weighted reactions at 7 days.';
 const e2=candidate();e2.experiment=true;e2.experiment_reason='A second untested opening.';e2.test_metric='Weighted reactions at 7 days.';e2.weekly.rank=2;e2.weekly.topic_key='second-topic';e2.original_angle='A second angle entirely.';
 const y=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[e1,e2],evidencePack:{study:{study_id:'s1',state:'validated'},findings}});
 assert.equal(first(y).proposed,1);
 assert.deepEqual(first(y).dropped.map(d=>d.reason),['evidence_candidate_second_experiment']);
 assert.equal(first(y).evidence_selection.experiments,1);
});

test('regression: proxy-timeout -- transport failures retry a bounded number of times, then bail retryable without committing',async()=>{
 let attempts=0;
 const x=await run({body:{},items:[],proxyBehaviour:()=>{attempts++;throw new Error('Simulated proxy transport failure');}});
 assert.equal(attempts,3);
 assert.equal(first(x).proxy_attempts,3);
 assert.equal(first(x).writer_bail,true);
 assert.equal(first(x).reason,'proxy_error');
 assert.equal(first(x).retryable,true);
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
});

test('regression: proxy-timeout-recovers -- a transport failure followed by a good reply still produces the week',async()=>{
 let attempts=0;
 const x=await run({body:{},proxyBehaviour:()=>{attempts++;if(attempts===1) throw new Error('Simulated proxy transport failure');return null;}});
 assert.equal(attempts,2);
 assert.equal(first(x).proxy_attempts,2);
 assert.equal(first(x).proposed,1);
});

test('regression: per-client-isolation -- one client bailing on the proxy never stops the next client',async()=>{
 const x=await run({body:{},clients:[registry('ivan'),registry('arch')],items:[],proxyBehaviour:(o)=>{if(o.body.messages[0].content.includes('"client_id":"ivan"')) throw new Error('Simulated proxy transport failure');return null;}});
 const ivanRec=x.result.clients.find(c=>c.client_id==='ivan');
 const archRec=x.result.clients.find(c=>c.client_id==='arch');
 assert.equal(ivanRec.reason,'proxy_error');
 assert.equal(ivanRec.retryable,true);
 assert.equal(archRec.writer_bail,false);
 assert.equal(archRec.skipped,false);
});

test('regression: reserved-evidence-budget -- context is slimmed in a stated order before any candidate is dropped, and constraint material is never trimmed',async()=>{
 const x=await run({...nearCeilingFixtureArgs(5150),items:[],body:{preview:true,client_id:"ivan",evidence:true},evidencePack:{study:{study_id:'s1',state:'validated'},findings:poolFindings(12)}});
 const rec=first(x);
 assert.equal(rec.evidence_pool_survivors,12,'the full pool survives once context is slimmed first');
 assert.deepEqual(rec.evidence_pool_dropped_for_budget,[]);
 assert(rec.evidence_budget.slim_stage>0,'a slim stage was actually applied');
 assert(rec.evidence_budget.context_lost.length>0,'what was lost is recorded');
 // constraint material is byte-identical: the voice prompt body is never shortened
 assert.equal(x.packs[0].prompts[0].body.length,'Complete applicable voice rule. '.repeat(5150).length);
 assert(prompt.length+128+JSON.stringify(x.packs[0]).length<=200000);
});

// ---------------------------------------------------------------------------
// Pre-release audit fixes (DECISIONS D8). M1, M5a, M5b.
// ---------------------------------------------------------------------------

test('regression: proxy-4xx-not-retried -- a 401 is the provider answering, so it is never retried',async()=>{
 let attempts=0;
 const x=await run({body:{},items:[],proxyBehaviour:()=>{attempts++;const e=new Error('Request failed with status code 401');e.httpCode=401;throw e;}});
 assert.equal(attempts,1,'a 4xx must not burn the client\'s whole share being refused three times');
 assert.equal(first(x).proxy_attempts,1);
 assert.equal(first(x).proxy_status,401);
 assert.equal(first(x).reason,'proxy_error');
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
 // a 5xx is still weather and is still retried to the bound
 let five=0;
 const y=await run({body:{},items:[],proxyBehaviour:()=>{five++;const e=new Error('Bad gateway');e.httpCode=502;throw e;}});
 assert.equal(five,3);
 assert.equal(first(y).proxy_attempts,3);
});

test('regression: evidence-candidate-reused -- a second choice citing an already-cited candidate is dropped',async()=>{
 const a=citing(candidate(),'ivan:2026-09-21:ef1');
 const b=citing(candidate(),'ivan:2026-09-21:ef1');
 b.weekly.rank=2;b.weekly.topic_key='a-different-story';b.original_angle='A different angle entirely.';
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[a,b],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).proposed,1);
 assert.deepEqual(first(x).dropped.map(d=>d.reason),['evidence_candidate_already_cited']);
 assert.equal(first(x).evidence_selection.cited,1);
});

test('regression: empty-reply-on-evidence-path -- a deliberate [] for a client with a real pool is a retryable bail, never an empty committed week',async()=>{
 const x=await run({body:{},items:[],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 assert.equal(first(x).reason,'no_choices_returned');
 assert.equal(first(x).writer_bail,true);
 assert.equal(first(x).retryable,true);
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
});

test('regression: empty-reply-on-legacy-path-unchanged -- a deliberate [] still completes the week off the evidence path',async()=>{
 const x=await run({body:{},items:[]});
 const c=x.calls.find(c=>c.url.endsWith('/audn_recommendation_commit'));
 assert(c,'the legacy path still commits the empty cycle exactly as before');
 assert.equal(c.body.p_rows.length,0);
 assert.equal(first(x).reason,'no_supported_candidates');
 assert.equal(first(x).writer_bail,false);
 // and the same holds for an evidence-active client whose pool came back empty: that run is
 // legacy for this week, so it keeps legacy behaviour.
 const y=await run({body:{},items:[],rolloutRows:rolloutRow(['ivan']),evidencePack:{study:{study_id:'s1',state:'validated'},findings:[]}});
 assert.equal(first(y).reason,'no_supported_candidates');
 assert(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')));
});

test('regression: single-client-gets-run-budget -- one client gets a fair share of the whole run, three clients split it',async()=>{
 // D10, renumbered for the defect A budget. The fixture clock is frozen, so elapsed is 0 and
 // every share is exact:
 //   share = floor((BUDGET_MS 1800000 - elapsed - RESERVE_MS 60000) / clients still to run)
 const one=await run({body:{preview:true,client_id:'ivan'},items:[]});
 assert.equal(first(one).client_share_ms,1740000,'a single-client preview gets ~the whole node budget, never a fixed slice');
 const three=await run({body:{preview:true},items:[],clients:[registry('arch'),registry('ivan'),registry('risedtc')]});
 assert.equal(three.result.clients.length,3);
 assert.equal(three.result.clients[0].client_share_ms,580000,'the first of three clients takes a third, protecting the two queued behind it');
 // Defect A: the share a three-client run gives each client must hold the slowest evidence call
 // ever measured (293s) AND a retry, which the old 900s budget could not do (273s each).
 for(const c of three.result.clients) assert(c.client_share_ms>=293000+250000,'a three-client share holds the slowest measured call plus a retry window');
 for(const c of three.result.clients) assert.equal(c.skipped,false,'every client still runs');
});

test('regression: proxy-timeout-no-useful-window -- a client that cannot get a minimum window is skipped retryable, never aborting the run',async()=>{
 // Squeeze the share below MIN_ATTEMPT_MS by queueing more clients than the budget can serve.
 const many=Array.from({length:8},(_,i)=>registry('c'+i));
 const x=await run({body:{preview:true},items:[],clients:many});
 const squeezed=x.result.clients.filter(c=>c.skipped);
 assert(squeezed.length>0,'at least one client is squeezed below the minimum useful window');
 for(const c of squeezed){
  assert.equal(c.reason,'run_budget_exhausted');
  assert.equal(c.retryable,true,'a squeezed client is retryable, never a silent loss');
  assert.equal(c.writer_bail,false,'being skipped is not a bail');
 }
 assert.equal(x.result.clients.length,8,'the run never aborts: every client still gets a record');
 assert.equal(x.calls.some(c=>c.url.endsWith('/audn_recommendation_commit')),false);
});

// D15 (DECISIONS.md): classification happens in trusted code, the cap is applied AFTER it, and
// every capped row is counted under a named reason. Today no client holds pattern-level support,
// so a shortlist of source-only adaptations collapses to one choice, by design.
test('regression: cap-one-experiment-after-classification -- a second source-only adaptation is dropped under a counted reason',async()=>{
 const findings=[evidenceFinding(),evidenceFinding({finding_id:'ef2',source_ids:['sp2'],observed_value:390}),evidenceFinding({finding_id:'ef3',source_ids:['sp3'],observed_value:380})];
 const mk=(n,key,sid)=>{const it=citing(candidate(),key,[sid]);it.weekly.rank=n;it.weekly.topic_key='topic-'+n;it.original_angle='Angle number '+n;return it;};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[mk(1,'ivan:2026-09-21:ef1','sp1'),mk(2,'ivan:2026-09-21:ef2','sp2'),mk(3,'ivan:2026-09-21:ef3','sp3')],evidencePack:{study:{study_id:'s1',state:'validated'},findings}});
 const rec=first(x);
 assert.equal(rec.proposed,1,'one experiment per week, whatever the model returns');
 assert.deepEqual(rec.dropped.map(d=>d.reason),['evidence_candidate_second_experiment','evidence_candidate_second_experiment']);
 assert.equal(rec.evidence_selection.experiments,1);
 assert.equal(rec.evidence_selection.dropped_second_experiment,2);
 assert.equal(rec.rows[0].context.evidence_package.mechanism_class,'experiment');
});

test('D15: the model can never downgrade the class -- an echoed supported package does not change the saved row',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 it.experiment=false;
 it.evidence_package={source_finding_ids:['ef1'],client_fact_refs:[],label:'evidence_backed',is_experiment:false,mechanism_class:'supported'};
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const pkg=first(x).rows[0].context.evidence_package;
 assert.equal(pkg.label,'experiment');
 assert.equal(pkg.is_experiment,true);
 assert.equal(pkg.mechanism_class,'experiment');
 assert.equal(pkg.mechanism_support,'source_only');
 assert(isFinite(pkg.observation_window.days));
});

test("D15: a client's own measured result stays supported and keeps its evidence_backed label",async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef-own');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding({finding_id:'ef-own',kind:'own_result'})]}});
 const pkg=first(x).rows[0].context.evidence_package;
 assert.equal(pkg.label,'evidence_backed');
 assert.equal(pkg.is_experiment,false);
 assert.equal(pkg.mechanism_support,'client_own_result');
});

test('D15: the competing explanations a source-only lift carries reach the model and the saved row',async()=>{
 const it=citing(candidate(),'ivan:2026-09-21:ef1');
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[it],evidencePack:{study:{study_id:'s1',state:'validated'},findings:[evidenceFinding()]}});
 const offered=x.packs[0].evidence_candidates[0];
 // limitations reach the model as L-codes resolved through the pack's own dictionary.
 const resolved=offered.limitations.map(c=>x.packs[0].evidence_limitations[c]||c);
 assert(resolved.some(l=>/giveaway|distribution/i.test(l)),'the model is shown the competing explanations');
 assert(first(x).rows[0].context.evidence_package.limitations.some(l=>/giveaway|distribution/i.test(l)));
});

// Defect A (Run 4 continuation): the measured proxy edge. Seven successful evidence calls took
// 198-293s; a large call fired alongside another returned HTTP 502 at 300.1s. One attempt is
// therefore capped just past that edge, and a 502 is weather that gets retried.
test('regression: attempt-window-capped-at-the-measured-edge -- one attempt never eats a client\'s whole share',async()=>{
 const one=await run({body:{preview:true,client_id:'ivan'},items:[]});
 assert.equal(first(one).client_share_ms,1740000);
 const call=one.calls.find(c=>c.url.endsWith('/v1/messages'));
 assert(call.timeout<=310000,'an attempt past the ~300s edge cannot return, so a longer window only blocks the retry');
 assert(call.timeout>=293000,'the window still holds the slowest evidence call ever measured');
});

test('regression: proxy-502-retried -- the edge answering 502 at the ceiling is weather, and the retry still fits',async()=>{
 let attempts=0;
 const x=await run({body:{preview:true},clients:[registry('arch'),registry('ivan'),registry('risedtc')],items:[],proxyBehaviour:()=>{
  attempts++;
  if(attempts>3) return null;
  const e=new Error('Request failed with status code 502');e.httpCode=502;throw e;
 }});
 assert.equal(first(x).proxy_attempts,3,'a 502 is 5xx: retried up to the attempt cap, never treated as a refusal');
 assert.equal(first(x).reason,'proxy_error');
 assert.equal(first(x).retryable,true);
 assert.equal(x.result.clients.length,3,'the other clients still run');
});

// D11 at the writer boundary: the guard runs on the live-shaped read, and a pack it did not run
// on never reaches the model.
test('regression: adaptable-source-refused -- a source with no body to adapt never becomes an offered candidate',async()=>{
 const findings=[evidenceFinding(),evidenceFinding({finding_id:'ef-bare',source_ids:['sp-bare'],observed_value:900})];
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[],
  evidencePack:{study:{study_id:'s1',state:'validated'},findings},
  studyPosts:(o)=>{const u=new URL(o.url);const ids=(/^in\.\((.*)\)$/.exec(u.searchParams.get('canonical_source_id')||'')||[,''])[1].split(',').map(decodeURIComponent).filter(Boolean);
   return ids.map(id=>id==='sp-bare'?studyPost(id,{post_text:'"The price for one TikTok is $45,000"'}):studyPost(id));}});
 const rec=first(x);
 const offered=x.packs[0].evidence_candidates.map(c=>c.draft_key);
 assert.equal(offered.length,1,'the bare-quote source is refused before the model ever sees it');
 assert(offered[0].endsWith(':ef1'));
 const refusal=rec.evidence_source_refusals.find(r=>r.finding_id==='ef-bare');
 assert.equal(refusal.code,'source_no_adaptable_body');
 assert.equal(rec.evidence_coverage.adaptable_source.refused_by_code.source_no_adaptable_body,1);
 assert(!JSON.stringify(x.packs[0]).includes('45,000'),'its text never reaches the model either');
});

test('regression: adaptable-source-unreadable -- when no source post resolves, nothing is offered and the record says why',async()=>{
 // No study id, so the by-primary-key read cannot run and no source body is available. The
 // honest outcome is a refusal per finding, an empty pool and a legacy pack -- never a candidate
 // offered on a source nobody could read.
 const x=await run({body:{preview:true,client_id:'ivan',evidence:true},items:[],
  evidencePack:{study:null,findings:[evidenceFinding()]}});
 const rec=first(x);
 assert.equal(rec.evidence_source_refusals[0].code,'source_text_unavailable');
 assert.equal(rec.evidence_coverage.adaptable_source.source_posts_supplied,0);
 assert.equal(rec.evidence_pool_survivors,0);
 assert.equal(x.packs[0].evidence_candidates,undefined,'no candidate is offered on an unreadable source');
});
