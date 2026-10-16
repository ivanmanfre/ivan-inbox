import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
// The private source file is an explicit local integration fixture, not a CI dependency.
const source='.superpowers/hot-now/workflow-before.json'
it.skipIf(!process.env.HOT_NOW_WORKFLOW_REPLAY)('executes the actual patched scan and cannot promote a vendor-only event',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-17T12:37:00Z'))
 try{
 const dir=mkdtempSync(join(tmpdir(),'hot-now-replay-')),out=join(dir,'after.json');execFileSync(process.execPath,['automation/hot-now/render-workflow.mjs',source,out]);const w=JSON.parse(readFileSync(out,'utf8'));const n=w.nodes.find((x:{name:string})=>x.name==='Scan and Gate');
 const event={id:'event',headline:'Google shopping launch',summary:'New cart',scores:{fit:9,heat:8},status:'candidate',decision:'watch',primary_url:'https://blog.google/cart',source_published_at:'2026-10-17T12:00:00Z',detected_at:'2026-10-17T12:00:00Z',item_urls:[]}
 const writes:unknown[]=[]
 const http=async(o:{url:string;method:string;body?:unknown})=>{
 if(o.url.includes('/v1/messages'))return {content:[{type:'text',text:JSON.stringify(o.body&&JSON.stringify(o.body).includes('two short specific')?{queries:['Google cart update']}:{supports:true,quote:'Google announced a new universal cart for shopping.'})}]};
 if(o.method==='POST'&&o.url.includes('/acts/'))return [];
 if(o.url==='https://blog.google/cart')return 'Google announced a new universal cart for shopping. '.repeat(8);
 if(o.method==='GET'&&o.url.includes('integration_config'))return [{key:'swishdm_trend_mode',value:'shadow'}];
 if(o.method==='GET'&&o.url.includes('swishdm_trend_events?status=in.'))return [event];
 if(o.method==='GET')return [];
 writes.push(o);if(o.url.includes('swishdm_trend_evidence'))return [{id:'evidence'}];return [{...event,...(o.body as object)}]
 }
 const $=(name:string)=>name==='Load Secrets'?{all:()=>[{json:{key:'n8n_sb_key',value:'test'}},{json:{key:'apify_api_token',value:'test'}}]}:{first:()=>({json:{body:{}}})}
 const execute=new Function('$','return (async function(){'+n.parameters.jsCode+'}).call(this)')
 const result=await execute.call({helpers:{httpRequest:http}},$)
 expect(result[0].json.to_draft).toEqual([]);expect(result[0].json.events[0].decision).toBe('watch');expect(writes.some(x=>JSON.stringify(x).includes('independent_people_below_3'))).toBe(true)
 writeFileSync(join(dir,'result.json'),JSON.stringify(result))
 }finally{vi.useRealTimers()}
})
