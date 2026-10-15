// node tools/test-cb22-swishdm-scope.cjs /private/path/to/live-Judge-and-Promote.js
// Runs the actual deployed node against fake HTTP and credentials; never contacts a service.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const run = new AsyncFunction('$', '$execution', source);
const secrets = {n8n_webhook_key:'test', n8n_sb_key:'test', railway_proxy_url:'https://proxy.example.test',railway_proxy_key:'test',apify_api_token:'test'};
async function fixture(body, populated=false) {
  const calls=[];
  const $=name => {
    if(name==='CB-22 Promotion Webhook') return {first:()=>({json:{body:{mode:'dry',judge:false,key:'test',...body}}})};
    if(name==='Secrets') return {all:()=>Object.entries(secrets).map(([key,value])=>({json:{key,value}}))};
    return {isExecuted:false};
  };
  const result=await run.call({helpers:{httpRequest:async req=>{
    if(req.url==='https://proxy.example.test') return {statusCode:200,body:JSON.stringify({model:'claude-opus-fixture',content:[{type:'text',text:JSON.stringify({fit:8,purpose:'reach',lane:'client',reason:'Fixture fit'})}]})};
    assert(req.url.endsWith('/rpc/cb22_promote'));
    calls.push(req.body);
    if(populated && req.body.p_mode==='pool') { const c=req.body.p_payload.clients[0]; return {statusCode:200,body:{ok:true,pool:{[c]:Array.from({length:151},(_,i)=>({client:c,platform:'linkedin',post_id:String(i+1),prompt:'fixture',prompt_sha256:'0'.repeat(64)}))},counts:{}}}; }
    return {statusCode:200,body:{ok:true,pool:{},counts:{},summary:{},week_start:'2026-10-12'}};
  }}},$, {mode:'production'});
  return {calls,result};
}
(async()=>{
  const sw=await fixture({clients:['swishdm']});
  assert(sw.calls.length>0);assert(sw.calls.every(c=>JSON.stringify(c.p_payload.clients)==='["swishdm"]'));
  assert(sw.calls.every(c=>['pool','dry'].includes(c.p_mode)));
  const iv=await fixture({clients:['ivan']});assert(iv.calls.every(c=>JSON.stringify(c.p_payload.clients)==='["ivan"]'));
  const all=await fixture({});assert.deepEqual(all.calls.filter(c=>c.p_mode==='pool').flatMap(c=>c.p_payload.clients),['ivan','risedtc','arch','swishdm']);
  for(const clients of [[],['unknown'],['swishdm','unknown'],null,'swishdm']) {
    const invalid=await fixture({clients});assert.equal(invalid.calls.length,0);assert(JSON.stringify(invalid.result).includes('unknown_client_scope'));
  }
  const busy=await fixture({judge:true},true);
  const judged=busy.calls.filter(c=>c.p_mode==='judgments').flatMap(c=>c.p_payload.judgments);
  assert.equal(judged.length,150);
  for(const c of ['ivan','risedtc','arch','swishdm']) assert(judged.filter(j=>j.client===c).length>=37);
  console.log('PASS: SwishDM-only scope, existing Ivan scope, default four seats; empty/malformed/mixed unknown scopes make zero HTTP calls; 150 shared judge slots give every busy seat at least 37.');
})().catch(e=>{console.error(e);process.exitCode=1;});
