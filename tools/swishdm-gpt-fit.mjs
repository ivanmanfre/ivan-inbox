#!/usr/bin/env node
// Authorized, bounded SwishDM-only fit/check backfill. Does not change production model routing.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { judge } from './codex-json-judge.mjs';
const exec = promisify(execFile);
export const MODEL='gpt-6.1-sol';
const PURPOSES=['reach','consideration','buyer','none'];
const LANES=['service','personal_reach','client','none'];
export function validateAnswer(kind, answer) {
  if(!answer || typeof answer!=='object' || Array.isArray(answer) || typeof answer.reason!=='string' || !answer.reason.trim()) throw Error('invalid judge answer');
  if(kind==='fit') {
    if(!Number.isInteger(answer.fit)||answer.fit<0||answer.fit>10||!PURPOSES.includes(answer.purpose)||!LANES.includes(answer.lane)) throw Error('invalid fit answer');
    return {fit:answer.fit,purpose:answer.purpose,lane:answer.lane,reason:answer.reason.trim().slice(0,400)};
  }
  if(!['idea','job_ad','repost','borrowed_media','paid_promo','bait','announcement'].includes(answer.engagement)||!['direct','stretch'].includes(answer.topic)||!['reader','adjacent','other'].includes(answer.audience)) throw Error('invalid check answer');
  return {engagement:answer.engagement,topic:answer.topic,audience:answer.audience,reason:answer.reason.trim().slice(0,400)};
}
export function validateRequest(row) {
  if(row.client!=='swishdm'||!['linkedin','x'].includes(row.platform)||!/^\d+$/.test(row.post_id)||typeof row.prompt!=='string'||createHash('sha256').update(row.prompt).digest('hex')!==row.prompt_sha256) throw Error('invalid scope or prompt receipt');
  return row;
}
export async function main(args=process.argv.slice(2)) {
  const opts=Object.fromEntries(args.map((x,i)=>x.startsWith('--')?[x.slice(2),args[i+1]]:null).filter(Boolean));
  if(!opts['state-dir']||!opts['sql-helper']) throw Error('Usage: --state-dir ABS_PRIVATE_PATH --sql-helper ABS_Q_SH');
  const state=resolve(opts['state-dir']);await mkdir(state,{recursive:true,mode:0o700});
  const runKey='swishdm-gpt61-'+new Date().toISOString().replace(/[^0-9T]/g,'');
  const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
  async function query(sql) {const {stdout}=await exec(resolve(opts['sql-helper']),[sql],{maxBuffer:8*1024*1024,timeout:120000});const r=JSON.parse(stdout);if(!Array.isArray(r)) throw Error('SQL rejected: '+JSON.stringify(r));return r;}
  async function rpc(mode,payload) {
    if(!['pool','judgments','checks_pool','checks','dry'].includes(mode))throw Error('mode outside bounded authorization');
    if(payload.clients?.length!==1||payload.clients[0]!=='swishdm')throw Error('RPC scope missing');
    const r=await query(`select public.cb22_promote('clientops',${literal(mode)},${literal(runKey)},${literal(JSON.stringify(payload))}::jsonb) result;`);
    if(r[0]?.result?.ok!==true)throw Error('RPC rejected');return r[0].result;
  }
  async function snapshot(){return (await query(`select jsonb_build_object('fit',(select count(*) from cb22_fit_judgments where client_id='swishdm'),'checks',(select count(*) from cb30_post_checks where client_id='swishdm'),'passing_checks',(select count(*) from cb30_post_checks where client_id='swishdm' and engagement='idea' and topic='direct' and audience in ('reader','adjacent')),'fit_models',(select jsonb_object_agg(served_model,n) from (select served_model,count(*) n from cb22_fit_judgments where client_id='swishdm' group by served_model)t),'check_models',(select jsonb_object_agg(served_model,n) from (select served_model,count(*) n from cb30_post_checks where client_id='swishdm' group by served_model)t),'inputs',public.cb22_inputs('clientops','swishdm')->'counts','visible',jsonb_array_length(public.cb22_inputs('clientops','swishdm')->'top'),'writer_enabled',(select platform->'measurement'->'writer_enabled' from client_registry where client_id='swishdm'),'policy',(select weekly_policy->>'status' from cb22_fit_brief_v where client_id='swishdm')) result;`))[0].result;}
  const before=await snapshot();const ledger={run_key:runKey,provider:'authenticated Codex ChatGPT subscription',model:MODEL,before,batches:[]};
  const save=()=>writeFile(resolve(state,runKey+'-receipt.json'),JSON.stringify(ledger,null,2)+'\n',{mode:0o600});
  for(const [kind,poolMode,storeMode,field] of [['fit','pool','judgments','judgments'],['check','checks_pool','checks','checks']]) {
    const pool=await rpc(poolMode,{clients:['swishdm']});const rows=(pool.pool?.swishdm||[]).map(validateRequest);
    if(rows.length>150)throw Error('Bounded pool limit exceeded');
    await writeFile(resolve(state,runKey+'-'+kind+'-pool.json'),JSON.stringify(rows),{mode:0o600});
    console.log(JSON.stringify({event:'pool',kind,count:rows.length,run_key:runKey}));
    const chunks=[];for(let i=0;i<rows.length;i+=8)chunks.push(rows.slice(i,i+8));let next=0;
    await Promise.all(Array.from({length:2},async()=>{while(next<chunks.length){const index=next++;const batch=chunks[index];
      const got=await judge({prompts:batch.map(r=>({id:r.platform+':'+r.post_id,prompt:r.prompt})),outputDir:state,label:runKey+'-'+kind+'-'+index,timeoutMs:240000});
      if(got.model!==MODEL||got.results.length!==batch.length)throw Error('provider/count mismatch');
      const mapped=got.results.map(({id,answer})=>{const row=batch.find(r=>r.platform+':'+r.post_id===id);if(!row)throw Error('cross-post answer');return {client:'swishdm',platform:row.platform,post_id:row.post_id,...(kind==='fit'?{seat:'A'}:{}),...validateAnswer(kind,answer),served_model:MODEL,prompt_sha256:row.prompt_sha256};});
      if(new Set(got.results.map(r=>r.id)).size!==batch.length)throw Error('duplicate answers');
      const stored=await rpc(storeMode,{clients:['swishdm'],[field]:mapped});
      ledger.batches.push({kind,index,requested:batch.length,inserted:stored.inserted,refused:stored.refused,model:got.model,ids:got.results.map(r=>r.id),usage:got.usage});await save();
      console.log(JSON.stringify({event:'stored',kind,index,inserted:stored.inserted,refused:stored.refused}));
      if(stored.refused!==0||stored.inserted!==batch.length)throw Error('DB refused genuine judge outputs');
    }}));
  }
  ledger.dry=await rpc('dry',{clients:['swishdm']});ledger.after=await snapshot();await save();
  if(ledger.after.writer_enabled!==false||ledger.after.policy!=='planning_draft')throw Error('approval/writer hold changed');
  console.log(JSON.stringify({event:'complete',run_key:runKey,model:MODEL,after:ledger.after,dry:ledger.dry}));return ledger;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
