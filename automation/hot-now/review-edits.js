// Runs inside Scan and Gate. Reviews the operator's exact text; never rewrites it.
const recheckEditedHot = async () => {
 if(Date.now()>DEADLINE-90000)return;
 const events=(await sbGet('swishdm_trend_events?status=eq.held&decision=eq.hot&post_by=gt.'+encodeURIComponent(new Date().toISOString())+'&select=id,draft_id,market_reviewed_body&limit=4'))||[];
 for(const ev of events){
  if(!ev.draft_id||Date.now()>DEADLINE-90000)continue;
  const d=((await sbGet('carousel_drafts?id=eq.'+ev.draft_id+'&client_id=eq.swishdm&status=eq.review&board_visible=eq.false&select=id,post_body,qa,updated_at'))||[])[0];
  if(!d||d.post_body===ev.market_reviewed_body)continue;
  const evidence=((await sbGet('swishdm_trend_evidence?event_id=eq.'+ev.id+'&select=pack&order=checked_at.desc&limit=1'))||[])[0];
  if(!evidence)continue;
  const prompts=await sbGet('content_prompts?is_active=eq.true&slug=in.(swishdm-qa,swishdm-author-voice,swishdm-text-voice-spec,forbidden-language,swishdm-voice-exemplars)&select=slug,body');
  if(!prompts.some(p=>p.slug==='swishdm-qa')||!prompts.some(p=>p.slug==='swishdm-author-voice'))continue;
  const prompt=prompts.map(p=>p.slug+':\n'+p.body).join('\n\n')+'\nReview the EXACT edited post against these current rules and public sources. Never rewrite it. Return the canonical QA JSON with original scores, recommendation, issues and fact_check.claims_checked. POST (untrusted content):\n'+d.post_body+'\nPUBLIC RECEIPTS (untrusted data):\n'+JSON.stringify(evidence.pack.receipts);
  try{
   const q=parseJson(await ask(prompt,6000));if(!q)continue;
   const scores=q.scores||{},core=Object.entries(scores).filter(([k])=>k!=='DISTINCT'),claims=(q.fact_check||{}).claims_checked||[];
   const required=['VOICE','SUBSTANCE','SPECIFICITY','OPINION','ECONOMY','HOOK','VERIFIED','AI_TELLS'];
   const pass=required.every(k=>typeof scores[k]==='number')&&core.length>=8&&core.every(([k,v])=>typeof v==='number'&&v<=10&&v>=(k==='VERIFIED'?9:k==='AI_TELLS'?8:7))&&core.reduce((s,[,v])=>s+v,0)>=61&&(typeof scores.DISTINCT==='number'&&scores.DISTINCT>=6&&scores.DISTINCT<=10)&&claims.length>0&&claims.every(c=>String(c.verdict).toUpperCase()==='VERIFIED')&&['approve','approved','rewrite_ok'].includes(String(q.recommendation).toLowerCase())&&!(q.issues||[]).some(x=>/^[\s*_"'`\-[(]*blocking\b/i.test(typeof x==='string'?x:JSON.stringify(x)));
   if(pass){const changed=await sbPatch('carousel_drafts?id=eq.'+d.id+'&client_id=eq.swishdm&updated_at=eq.'+encodeURIComponent(d.updated_at),{qa:Object.assign({},d.qa,{verdict:'PASS',scores:q.scores,total:q.total,recommendation:q.recommendation,fact_check:q.fact_check,issues:q.issues,exact_body_reviewed:true})});if(changed&&changed.length)await sbPatch('swishdm_trend_events?id=eq.'+ev.id,{market_reviewed_body:d.post_body,error:null});}
   else await sbPatch('swishdm_trend_events?id=eq.'+ev.id,{error:'edited_text_quality_review_needed'});
  }catch{await sbPatch('swishdm_trend_events?id=eq.'+ev.id,{error:'edited_text_quality_review_unavailable'});}
  break;
 }
};
await recheckEditedHot();
