// Compile the tested pure policy into the two existing n8n Code nodes.
// Input is a freshly fetched PRIVATE workflow JSON, never a committed credential dump.
import fs from 'node:fs'
import ts from 'typescript'
const [input,output]=process.argv.slice(2)
if(!input||!output)throw Error('Usage: node render-workflow.mjs fresh-private-workflow.json output.json')
const workflow=JSON.parse(fs.readFileSync(input,'utf8'))
if(workflow.id!=='vMNwesUjd8Iooqqi'||workflow.nodes.length!==5)throw Error('Unexpected workflow identity or structure')
const compile=file=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*\n/gm,'').replace(/^export /gm,'')
const policy=compile('./validation.ts')+'\n'+compile('./market-check.ts')
const scan=workflow.nodes.find(n=>n.name==='Scan and Gate')
let s=scan.parameters.jsCode
if(s.includes('MARKET_VALIDATION_V1'))throw Error('Already patched; use the retained pre-change snapshot for reproducible rebuild')
s='// MARKET_VALIDATION_V1\n'+policy+'\n'+s
s=s.replace("const RUN = 'tr-' + NOW.toString(36);", "const RUN = 'tr-' + NOW.toString(36);\nconst RECHECK_ONLY = new Date(NOW).getUTCMinutes() === 37;\nconst DEADLINE = NOW + 520000;")
s=s.replace('for (let a = 0; a < 4; a++) {', "for (let a = 0; a < 2; a++) {\n    if (Date.now() > DEADLINE - 65000) throw new Error('scan_time_budget');")
s=s.replace('timeout: 900000','timeout: 60000').replace('await sleep(20000 * (a + 1))','await sleep(2000)')
const oldHeat="(2) HEAT: at least two independent source types"
const begin=s.indexOf(oldHeat),end=s.indexOf('(3) FRESH:',begin)
if(begin<0||end<0)throw Error('Heat prompt anchor changed')
s=s.slice(0,begin)+'(2) HEAT: nominate relevant events for a separate market-evidence check. A vendor announcement by itself stays watch. Independent practitioner discussion and observed traction are mandatory for hot. '+s.slice(end)
s=s.replace('const SINCE_MS = NOW - 14 * HOUR;', 'if (!RECHECK_ONLY) {\nconst SINCE_MS = NOW - 14 * HOUR;')
s=s.replace('// 1d. Hand drops', '} // broad discovery only on the hourly tick\n\n// 1d. Hand drops')
// All X reads now use a collector whose public documentation does not permit mock empty results.
s=s.replace('acts/CJdippxWmn9uRfooo/run-sync-get-dataset-items?timeout=120','acts/apidojo~tweet-scraper/run-sync-get-dataset-items?timeout=45')
s=s.replace("body: { twitterContent: XQ[qi], maxItems: 30, queryType: 'Top' }", "body: { searchTerms: [XQ[qi].replace(/\\b(?:since_time|until_time|since_id|max_id|within_time):\\S+/g,'')], maxItems: 30, sort: 'Latest' }")
s=s.replace('timeout: 150000','timeout: 55000')
s=s.replace('decision=eq.watch&status=eq.candidate','decision=neq.manual&manual_by=is.null&status=in.(candidate,shadow,held)')
s=s.replace('select=id,headline,item_urls,detected_at,source_published_at&order=', 'select=*&order=')
s=s.replace("let gate = { events: [] }; let gateStatus = 'no_new_items';", "let gate = { events: [] }; let gateStatus = 'no_new_items';")
s=s.replace('if (batch.length || openWatch.length) {','if (!RECHECK_ONLY && batch.length) {')
s=s.replace('const recorded = []; const toDraft = [];', `const recorded = []; const toDraft = []; let marketAttempts = 0;
const marketHttp = (o) => { if(Date.now()>DEADLINE-20000) throw new Error('scan_time_budget'); return http(o); };
const verifyMarket = async (event, previousId) => {
 const prior = previousId ? (await sbGet('swishdm_trend_evidence?event_id=eq.'+previousId+'&select=pack&order=checked_at.desc&limit=4')) || [] : [];
 return verifyCandidate(event, {now:Date.now(),history:prior.map(r=>r.pack),
  ask:async prompt=>{const j=parseJson(await ask(prompt,5000));if(!j)throw new Error('invalid_classification_json');return JSON.stringify(j);},
  search:async query=>marketHttp({method:'POST',json:true,timeout:55000,url:'https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?timeout=45&token='+S.apify_api_token,headers:{'Content-Type':'application/json'},body:{searchTerms:[query],maxItems:20,sort:'Latest'}}),
  primary:async url=>parsePrimary(String(await marketHttp({method:'GET',url,timeout:12000,disableFollowRedirect:true,headers:{'User-Agent':'swishdm-market-check/1.0'}}))),
  verifyPost:async url=>{const r=await marketHttp({method:'GET',url:'https://publish.twitter.com/oembed?omit_script=true&url='+encodeURIComponent(url),json:true,timeout:7000});return clean(r.html||'');}
 });
};`)
s=s.replace("const evs = ((gate && gate.events) || []).filter((e) => e && e.headline);", "const evs = ((gate && gate.events) || []).filter((e) => e && e.headline);\nfor(const w of openWatch){if(!evs.some(e=>e.existing_event_id===w.id))evs.push({existing_event_id:w.id,headline:w.headline,summary:w.summary,decision:'watch',fit:(w.scores||{}).fit||0,heat:(w.scores||{}).heat||0,item_idx:[]});}")
s=s.replace("  const firstAge = Number(e.first_item_age_min);", "  const previous = openWatch.find(w=>w.id===e.existing_event_id);\n  if(previous && previous.draft_id && marketAttempts>=2)continue;")
s=s.replace("const storyMs = pubTimes.length ? Math.min.apply(null, pubTimes) : (isNaN(firstAge) ? NOW : NOW - firstAge * 60000);", "let storyMs = pubTimes.length ? Math.min.apply(null,pubTimes) : NaN;\n  if(previous && previous.source_published_at){const t=Date.parse(previous.source_published_at);if(Number.isFinite(t))storyMs=Number.isFinite(storyMs)?Math.min(storyMs,t):t;}")
s=s.replace("  const prim = ","  const candidatePrim = ")
s=s.replace("  const postBy = ","  const prim = previous && previous.primary_url ? previous.primary_url : candidatePrim;\n  const postBy = ")
// previous is required by the primary/time calculation: place its declaration before candidatePrim.
s=s.replace("  const previous = openWatch.find(w=>w.id===e.existing_event_id);\n  if(previous && previous.draft_id && marketAttempts>=2)continue;\n",'')
s=s.replace('  const candidatePrim =', '  const previous = openWatch.find(w=>w.id===e.existing_event_id);\n  if(previous && previous.draft_id && marketAttempts>=2)continue;\n  const candidatePrim =')
s=s.replace("const scores = { fit:","const scores = { fit:")
s=s.replace('tokenDup(e.headline, recentDone)', 'tokenDup(e.headline, recentDone.filter(r=>r.id!==(previous&&previous.id)))')
s=s.replace(' }, recentDone);',' }, recentDone.filter(r=>r.id!==(previous&&previous.id)));')
const anchor="  if (decision === 'hot' && !dupOf) {"
s=s.replace(anchor,`  let market=null;
  if(!dupOf && Number(e.fit)>=7 && marketAttempts<2 && Date.now()<DEADLINE-150000){
   marketAttempts++;
   try{market=await verifyMarket({headline:e.headline,primary_url:prim,source_published_at:Number.isFinite(storyMs)?new Date(storyMs).toISOString():null,post_by:Number.isFinite(postBy)?new Date(postBy).toISOString():''},mergeId);}catch(err){reason='Market check unavailable: '+String(err.message||err).slice(0,160);}
  }
  decision = !dupOf && market && market.validation.status==='validated' ? 'hot' : 'watch';
  if(market)reason=market.validation.status==='validated'?market.validation.buyer_reason:market.validation.failure_reasons.join(', ');
  if (decision === 'hot' && !dupOf) {`)
s=s.replace("    if (postBy <= NOW + 2 * HOUR)","    if(previous && previous.draft_id){status='held';}\n    else if (postBy <= NOW + 2 * HOUR)")
s=s.replace("source_published_at: new Date(storyMs).toISOString()", "source_published_at: Number.isFinite(storyMs)?new Date(storyMs).toISOString():null")
s=s.replace("post_by: decision === 'hot' ? new Date(postBy).toISOString() : null", "post_by: Number.isFinite(postBy)?new Date(postBy).toISOString():null")
s=s.replace("    recorded.push({ id: saved.id", `    if(market){
     const proof=((await sbPost('swishdm_trend_evidence?on_conflict=event_id,run_id',[{event_id:saved.id,run_id:RUN,checked_at:market.validation.validated_at,pack:Object.assign({},market.pack,{collection:{actor:'apidojo~tweet-scraper',queries:market.queries,results:market.collected}}),validation:market.validation}],'resolution=ignore-duplicates,return=representation'))||[])[0];
     if(!proof)throw new Error('market_evidence_write_failed');
     await sbPatch('swishdm_trend_events?id=eq.'+saved.id,{market_evidence_id:proof.id,market_validation:market.validation});
    }
    recorded.push({ id: saved.id`)
// Duplicate protection must run on the final promotion, including watch upgrades.
const duplicateStart=s.indexOf("  if (decision === 'hot') {",s.indexOf('let dupOf = null;'));
const duplicateEnd=s.indexOf('  let market=null;',duplicateStart);
if(duplicateStart<0||duplicateEnd<0)throw Error('Duplicate block anchor changed');
let duplicateBlock=s.slice(duplicateStart,duplicateEnd);
s=s.slice(0,duplicateStart)+s.slice(duplicateEnd);
duplicateBlock=duplicateBlock.replace("} catch (x) {} }", "} catch (x) {decision='watch';reason='duplicate_check_unavailable: '+String(x.message||x).slice(0,120);} }");
const promotion="  if (decision === 'hot' && !dupOf) {";
s=s.replace(promotion,duplicateBlock+"  if(previous && previous.draft_id){status='held';if(!dupOf)decision='hot';}\n"+promotion);
s=s.replace("source_published_at: Number.isFinite(storyMs)?new Date(storyMs).toISOString():null, post_by: Number.isFinite(postBy)?new Date(postBy).toISOString():null", "source_published_at: market ? (market.pack.event_at||null) : (previous&&previous.source_published_at)||null, post_by: market ? market.pack.post_by||null : (previous&&previous.post_by)||null");
const reviewEdits=fs.readFileSync(new URL('./review-edits.js',import.meta.url),'utf8');
s=s.replace('return [{ json: { run: RUN, mode: MODE, caps:',reviewEdits+"\nawait sbPost('swishdm_trend_runs?on_conflict=run_id',[{run_id:RUN,mode:MODE,started_at:new Date(NOW).toISOString(),sources:srcStats,events:recorded,collected:items.length}],'resolution=ignore-duplicates');\nreturn [{ json: { run: RUN, mode: MODE, caps:");
scan.parameters.jsCode=s
workflow.nodes.find(n=>n.type==='n8n-nodes-base.scheduleTrigger').parameters.rule.interval[0].expression='7,37 7-21 * * *'
const draft=workflow.nodes.find(n=>n.name==='Draft and Hold')
draft.parameters.jsCode=draft.parameters.jsCode.replace("{ status: 'held', draft_id: ins.id, qa:","{ status: 'held', draft_id: ins.id, market_reviewed_body: best.body, qa:").replace("source_label: ('Hot topic: ' + short)","source_label: ((ev.decision==='manual'?'Manual pick: ':'Hot topic: ') + short)")
fs.writeFileSync(output,JSON.stringify(workflow,null,2))
console.log(JSON.stringify({id:workflow.id,nodes:workflow.nodes.length,active:workflow.active,scanBytes:s.length}))
