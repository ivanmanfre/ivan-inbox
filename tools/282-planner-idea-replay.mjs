// No-write replay of exact live CB35 verifier code over a real original-idea writer artifact.
// Prerequisites (private state, never commit): preflight.json (transaction-rollback registration proof),
// Secrets/VerifierPrepare.js/VerifierDecide.js from live verifier jMvDWNufLSHJ2Myp.
// secrets.json holds existing integration_config rows locally, mode 0600.
// Usage: node tools/282-planner-idea-replay.mjs positive | negative-length
// Explicit GPT run: PLANNER_JUDGE_MODEL=gpt-6.1-sol node tools/282-planner-idea-replay.mjs positive
// Positive uses real live lint + invention/narrow judges; negative-length fails before judge calls.
// All state-change RPCs are intercepted and return stale; generation/scheduling/publishing is refused.
// Outputs contain private content but no credentials; keep them in the private proof directory.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { judge } from './codex-json-judge.mjs';
const dir=process.env.PLANNER_PROOF_DIR || '/Users/ivanmanfredi/.local/state/planner-ideas-1015';
const secRows=JSON.parse(fs.readFileSync(dir+'/secrets.json'));
const proof=JSON.parse(fs.readFileSync(dir+'/preflight.json'))[0].proof;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const mode=process.argv[2]||'positive';
const judgeModel=process.env.PLANNER_JUDGE_MODEL||'claude-opus-5-5';
if(!['claude-opus-5-5','gpt-6.1-sol'].includes(judgeModel)) throw Error('unsupported judge override');
const suffix=judgeModel==='gpt-6.1-sol'?'-gpt-6.1-sol':'';
const pending=structuredClone(proof.pending);
if(mode==='negative-length') {
 pending.post_body=pending.post_body.repeat(3);
 pending.expected_body_sha256=sha(pending.post_body);
}
const writes=[],calls=[],readRequests=[];
async function http(req) {
 const method=(req.method||'GET').toUpperCase();
 const url=req.url;
 if(url.includes('/rpc/cb35_brain_pending_v4')) return [pending];
 if(url.includes('/rpc/')) {
  const fn=url.split('/rpc/')[1];
  if(fn!=='cb51_brain_history') {
   writes.push({fn,args:req.body});
   return {decision:'stale',reason:'no-write replay; captured verifier decision'};
  }
 }
 const canRead=method==='GET'||url.includes('/rpc/cb51_brain_history');
 const canLint=url.includes('/functions/v1/content-lint')&&req.body?.record===false;
 const canJudge=url.includes('railway')&&/\/v1\/messages\/?$/.test(url);
 if(!canRead&&!canLint&&!canJudge) throw Error('NO-WRITE REPLAY REFUSED '+method+' '+new URL(url).pathname);
 if(canJudge&&judgeModel==='gpt-6.1-sol') {
  const id='vote-'+(calls.length+1)+'-'+crypto.randomUUID();
  const prompt=req.body.messages.map(x=>x.content).join('\n\n');
  const receipt=await judge({prompts:[{id,prompt}],outputDir:dir+'/gpt-judges',label:id});
  const obj={model:receipt.model,content:[{type:'text',text:JSON.stringify(receipt.results[0].answer)}]};
  calls.push({request:{...req.body,model:judgeModel},response:obj,transport:receipt.transport,receipt:receipt.private_receipt});
  return obj;
 }
 const response=await fetch(url,{method,headers:req.headers,body:method==='GET'?undefined:JSON.stringify(req.body),signal:AbortSignal.timeout(Math.max(req.timeout||30000,60000))});
 const raw=await response.text();let obj;try{obj=JSON.parse(raw)}catch{throw Error('non-JSON '+response.status+' '+new URL(url).pathname)}
 if(canJudge) calls.push({request:req.body,response:obj,http_status:response.status});
 else readRequests.push({method,path:new URL(url).pathname,status:response.status});
 if(!response.ok) throw Error('HTTP '+response.status+' '+new URL(url).pathname);
 return obj;
}
let prep=[];
const $=name=>({all:()=>name==='Secrets'?secRows.map(json=>({json})):name==='VerifierPrepare'?prep:[]});
const context={helpers:{httpRequest:http}};
const prepare=new AsyncFunction('$','$input','$execution',fs.readFileSync(dir+'/VerifierPrepare.js','utf8'));
const decideSource=fs.readFileSync(dir+'/VerifierDecide.js','utf8');
// Only model literals change in this explicitly requested local replay; decision logic is identical.
const decide=new AsyncFunction('$','$input','$execution',judgeModel==='gpt-6.1-sol'?decideSource.replaceAll("model: 'claude-opus-5-5'","model: 'gpt-6.1-sol'"):decideSource);
prep=await prepare.call(context,$,{all:()=>[]},{id:'planner-idea-no-write-'+mode});
console.log(JSON.stringify({phase:'prepare',mode,noop:prep[0]?.json.noop,items:prep.length,checks:prep[0]?.json.checks,write_attempts:writes.map(x=>x.fn)}));
if(!prep[0]?.json.noop){
 const responses=await Promise.all(prep.map(async item=>({json:await http({method:'POST',url:item.json.proxy_url,headers:{'x-api-key':item.json.proxy_key,'anthropic-version':'2023-06-01','Content-Type':'application/json','X-Heartbeat':'1'},body:{model:'claude-opus-5-5',max_tokens:16000,messages:[{role:'user',content:item.json.prompt}]},timeout:240000})})));
 const result=await decide.call(context,$,{all:()=>responses},{id:'planner-idea-no-write-'+mode});
 fs.writeFileSync(dir+'/replay-'+mode+suffix+'.json',JSON.stringify({mode,judge_model:judgeModel,body_sha256:pending.expected_body_sha256,readRequests,calls,writes,result},null,2),{mode:0o600});
 console.log(JSON.stringify({phase:'decide',mode,result,decisions:writes.map(x=>({fn:x.fn,checks:x.args.p_validation?.checks||x.args.p_checks})),judge_calls:calls.length}));
}else fs.writeFileSync(dir+'/replay-'+mode+suffix+'.json',JSON.stringify({mode,judge_model:judgeModel,readRequests,calls,writes,result:prep},null,2),{mode:0o600});
