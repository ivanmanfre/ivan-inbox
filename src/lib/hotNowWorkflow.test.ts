import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
const source='.superpowers/hot-now/workflow-before.json'
async function scenario(kind:'vendor'|'positive'|'duplicate') {
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-17T12:37:00Z'))
 try {
 const dir=mkdtempSync(join(tmpdir(),'hot-now-replay-')),out=join(dir,'after.json');execFileSync(process.execPath,['automation/hot-now/render-workflow.mjs',source,out]);const w=JSON.parse(readFileSync(out,'utf8')),node=w.nodes.find((x:{name:string})=>x.name==='Scan and Gate')
 const event={id:'event',headline:'Google shopping launch',summary:'New cart',scores:{fit:9,heat:8},status:'candidate',decision:'watch',primary_url:'https://blog.google/cart',source_published_at:'2026-10-17T12:00:00Z',detected_at:'2026-10-17T12:00:00Z',item_urls:[]}
 const quote='Google cart changed checkout routing.'
 const tweets=['a','b','c'].map((name,i)=>({type:'tweet',id:String((i+1)*111),url:`https://x.com/${name}/status/${(i+1)*111}`,text:name+': '+quote,createdAt:i?'2026-10-17T12:00:00Z':'2026-10-17T11:40:00Z',author:{id:name,userName:name,description:'ecommerce SEO specialist'}}))
 const old={id:'x:111',client_id:'swishdm',platform:'x',native_id:'111',url:tweets[0].url,person_key:'x:a',author_id:'a',author_name:'a',author_bio:'ecommerce SEO specialist',role:'practitioner',role_quote:'SEO specialist',ownership:'independent',thread_id:'111',origin_key:'x:111',text:tweets[0].text,quote,relevant:true,substantive:true,proof_kind:'commentary',is_reply:false,published_at:tweets[0].createdAt,fetched_at:'2026-10-17T11:47:00Z',source_kind:'live'}
 let saved={...event}
 const writes:{url:string;body?:unknown}[]=[]
 const http=async(o:{url:string;method:string;body?:unknown})=>{
  if(o.url.includes('/v1/messages')){const prompt=JSON.stringify(o.body);const j=prompt.includes('two short specific')?{queries:['Google cart update']}:prompt.includes('Classify these')?{items:tweets.map((_,idx)=>({idx,relevant:true,substantive:true,quote,role:'practitioner',role_quote:'SEO specialist',ownership:'independent',copy_of_idx:null})),buyer_idx:[0],buyer_reason:'Store owners should check checkout routing.',event_kind:'announcement'}:prompt.includes('duplicate checker')?{same_story:true,of_index:0,materially_new:false}:{supports:true,quote};return{content:[{type:'text',text:JSON.stringify(j)}]}}
  if(o.method==='POST'&&o.url.includes('/acts/')){expect(JSON.stringify(o.body)).not.toMatch(/(?:since_time|until_time|since_id|max_id|within_time):/);return kind==='vendor'?[]:tweets}
  if(o.url.includes('publish.twitter.com'))return{html:'<p>'+quote+'</p>'}
  if(o.url==='https://blog.google/cart')return '<meta property="article:published_time" content="2026-10-17T12:00:00Z"><p>'+quote.repeat(12)+'</p>'
  if(o.method==='GET'&&o.url.includes('integration_config'))return[{key:'swishdm_trend_mode',value:'shadow'}]
  if(o.method==='GET'&&o.url.includes('status=in.(candidate'))return[event]
  if(o.method==='GET'&&o.url.includes('swishdm_trend_evidence'))return kind==='vendor'?[]:[{pack:{receipts:[old],snapshots:[{at:'2026-10-17T11:47:00Z',receipt_ids:['x:111']}]}}]
  if(o.method==='GET'&&o.url.includes('select=id,headline,summary,status')&&kind==='duplicate')return[{id:'handled',headline:'Retailers combine checkout across search surfaces',status:'posted'}]
  if(o.method==='GET')return[]
  writes.push(o);if(o.url.includes('swishdm_trend_evidence'))return[{id:'evidence'}];saved={...saved,...(Array.isArray(o.body)?o.body[0]:(o.body as object))};return[saved]
 }
 const $=(name:string)=>name==='Load Secrets'?{all:()=>[{json:{key:'n8n_sb_key',value:'test'}},{json:{key:'apify_api_token',value:'test'}}]}:{first:()=>({json:{body:{}}})}
 const execute=new Function('$','return (async function(){'+node.parameters.jsCode+'}).call(this)')
 return {result:await execute.call({helpers:{httpRequest:http}},$),writes}
 }finally{vi.useRealTimers()}
}
const enabled=!!process.env.HOT_NOW_WORKFLOW_REPLAY
it.skipIf(!enabled)('retains verified primary text but cannot promote a vendor-only event',async()=>{const {result,writes}=await scenario('vendor');expect(result[0].json.to_draft).toEqual([]);expect(result[0].json.events[0].decision).toBe('watch');expect(writes.some(x=>JSON.stringify(x).includes('primary:https://blog.google/cart'))).toBe(true)})
it.skipIf(!enabled)('the actual patched scan can qualify real independent growth in shadow',async()=>{const {result,writes}=await scenario('positive');expect(result[0].json.events[0].decision).toBe('hot');expect(result[0].json.events[0].status).toBe('shadow');expect(writes.some(x=>JSON.stringify(x).includes('growing_people'))).toBe(true);expect(result[0].json.to_draft).toEqual([])})
it.skipIf(!enabled)('watch promotions still run reasoned duplicate protection',async()=>{const {result,writes}=await scenario('duplicate');expect(result[0].json.events[0].status).toBe('expired');expect(writes.some(x=>JSON.stringify(x).includes('"duplicate_of":"handled"'))).toBe(true);expect(result[0].json.to_draft).toEqual([])})
