import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const source=readFileSync('automation/hot-now/review-edits.js','utf8')
async function review(pass:boolean,stale=false){
 const writes:{path:string;body:Record<string,unknown>}[]=[]
 const get=async(path:string)=>path.includes('content_prompts')?[{slug:'swishdm-qa',body:'QA'},{slug:'swishdm-author-voice',body:'Voice'}]:path.includes('swishdm_trend_evidence')?[{pack:{receipts:[]}}]:path.includes('carousel_drafts')?[{id:'draft',post_body:'Exact edited text',qa:{},updated_at:'timestamp'}]:[{id:'event',draft_id:'draft',market_reviewed_body:'Old text'}]
 const patch=async(path:string,body:Record<string,unknown>)=>{writes.push({path,body});return stale?[]:[body]}
 const ask=async()=>JSON.stringify({recommendation:pass?'approve':'reject',rewrite:'A completely different rewrite',scores:{AI_TELLS:9,VERIFIED:9,HOOK:8,VOICE:8,SUBSTANCE:8,SPECIFICITY:8,OPINION:8,ECONOMY:8,DISTINCT:7},fact_check:{claims_checked:[{verdict:'VERIFIED'}]},issues:[]})
 const run=new Function('sbGet','sbPatch','ask','parseJson','DEADLINE','return (async()=>{'+source+'})()')
 await run(get,patch,ask,JSON.parse,Date.now()+300000);return writes
}
it('binds the reviewed exact edit and never the QA rewrite',async()=>{const writes=await review(true);expect(writes.find(x=>x.body.market_reviewed_body)?.body.market_reviewed_body).toBe('Exact edited text');expect(JSON.stringify(writes)).not.toContain('completely different rewrite')})
it('keeps a failing edit blocked for review',async()=>{const writes=await review(false);expect(writes.some(x=>x.body.market_reviewed_body)).toBe(false);expect(writes[0].body.error).toBe('edited_text_quality_review_needed')})
it('cannot stamp an edit that moved during QA',async()=>{const writes=await review(true,true);expect(writes.some(x=>x.body.market_reviewed_body)).toBe(false);expect(writes[0].path).toContain('updated_at=eq.timestamp')})
it('formatted blocking issues cannot be approved',async()=>{const bad=source.replace("const q=parseJson(await ask(prompt,6000));", "const q=parseJson(await ask(prompt,6000)); q.issues=['**BLOCKING: unsupported claim**'];");const run=new Function('sbGet','sbPatch','ask','parseJson','DEADLINE','return (async()=>{'+bad+'})()');const writes:Record<string,unknown>[]=[];await run(async(p:string)=>p.includes('content_prompts')?[{slug:'swishdm-qa',body:''},{slug:'swishdm-author-voice',body:''}]:p.includes('evidence')?[{pack:{receipts:[]}}]:p.includes('carousel_drafts')?[{id:'d',post_body:'edit',updated_at:'t'}]:[{id:'e',draft_id:'d',market_reviewed_body:'old'}],async(_p:string,b:Record<string,unknown>)=>{writes.push(b);return[b]},async()=>JSON.stringify({recommendation:'approve',scores:{VOICE:8,SUBSTANCE:8,SPECIFICITY:8,OPINION:8,ECONOMY:8,HOOK:8,VERIFIED:9,AI_TELLS:9,DISTINCT:7},fact_check:{claims_checked:[{verdict:'VERIFIED'}]}}),JSON.parse,Date.now()+300000);expect(writes.some(x=>x.market_reviewed_body)).toBe(false)})
