import { describe,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { authorizeProofBudget,parseProofRequest,proofWebhookFields,PROOF_COHORT_ID,PROOF_NAMESPACE,
  proofRoute,type ProofRequest } from './editorialProofTransport'
import { planNativeRoute } from './editorialNativeRoute'

const identity = { clientId:'ivan',requestId:'request-1',briefId:'brief-1',version:2,
  hash:'a'.repeat(64),format:'text' }
const proof:ProofRequest = { namespace:PROOF_NAMESPACE,cohort_id:PROOF_COHORT_ID,slot:3 }
const row = { client_id:'ivan',job_id:`${PROOF_COHORT_ID}:ivan:3:request-1`,cohort_id:PROOF_COHORT_ID,
  slot:3,request_id:'request-1',brief_id:'brief-1',brief_version:2,brief_hash:'a'.repeat(64),
  route:'text',call_limit:12,calls_reserved:0,status:'active' }

const textLanes = [
  { clientId:'ivan', path:'post-gen-v2' },
  { clientId:'risedtc', path:'rise-dtc-post-gen-v2-max' },
  { clientId:'arch', path:'arch-post-gen-v2' },
] as const

describe('proof cohort transport',()=>{
  it('accepts only the exact namespace, cohort and outer slot without caller budget controls',()=>{
    expect(parseProofRequest(proof)).toEqual(proof)
    for (const bad of [{...proof,slot:0},{...proof,slot:6},{...proof,cohort_id:'other'},
      {...proof,call_limit:99},{...proof,reset:true}]) expect(()=>parseProofRequest(bad)).toThrow()
  })
  it('binds the authenticated draft identity to the server-authorized budget and webhook body',async()=>{
    const rpc=vi.fn(async()=>({data:row,error:null}))
    const budget=await authorizeProofBudget(rpc,identity,proof)
    expect(rpc).toHaveBeenCalledWith('editorial_begin_provider_job',expect.objectContaining({
      p_request_id:'request-1',p_brief_id:'brief-1',p_brief_version:2,p_route:'text',p_slot:3 }))
    expect(proofWebhookFields(proof,budget)).toEqual({proof_transport:proof,provider_budget:budget,route:'text'})
  })
  it.each(textLanes)('authorizes $clientId text for its reviewed native path and exact budget identity',async lane=>{
    const laneIdentity={...identity,clientId:lane.clientId,requestId:`request-${lane.clientId}`}
    const laneRow={...row,client_id:lane.clientId,request_id:laneIdentity.requestId,
      job_id:`${PROOF_COHORT_ID}:${lane.clientId}:3:${laneIdentity.requestId}`}
    const rpc=vi.fn(async()=>({data:laneRow,error:null}))
    const budget=await authorizeProofBudget(rpc,laneIdentity,proof)
    const native=planNativeRoute(lane.clientId,'text',false,null)
    expect(native?.path).toBe(lane.path)
    expect(budget).toMatchObject({client_id:lane.clientId,request_id:laneIdentity.requestId,
      job_id:laneRow.job_id,route:'text',call_limit:12,calls_reserved:0})
    expect(rpc).toHaveBeenCalledWith('editorial_begin_provider_job',expect.objectContaining({
      p_client_id:lane.clientId,p_job_id:laneRow.job_id,p_route:'text' }))
    const fetcher=vi.fn(async(_url:string,init:RequestInit)=>({ok:true,body:JSON.parse(String(init.body))}))
    const payload={draft_id:`draft-${lane.clientId}`,...proofWebhookFields(proof,budget)}
    await fetcher(`https://n8n.invalid/webhook/${native?.path}`,{method:'POST',body:JSON.stringify(payload)})
    expect(fetcher.mock.calls[0][0]).toBe(`https://n8n.invalid/webhook/${lane.path}`)
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual(payload)
  })
  it('rejects unknown clients and keeps video proof Ivan-only',()=>{
    expect(()=>proofRoute({...identity,clientId:'unknown'})).toThrow(/lane_adapter/)
    expect(proofRoute({...identity,format:'video'})).toBe('video_script')
    expect(()=>proofRoute({...identity,clientId:'risedtc',format:'video'})).toThrow(/route_not_reviewed/)
    expect(()=>proofRoute({...identity,clientId:'arch',format:'video'})).toThrow(/route_not_reviewed/)
  })
  it('rejects unsupported lanes, identity mismatch and caller-raised budgets before dispatch',async()=>{
    const rpc=async()=>({data:row,error:null})
    await expect(authorizeProofBudget(rpc,{...identity,clientId:'unknown'},proof)).rejects.toThrow(/lane/)
    await expect(authorizeProofBudget(async()=>({data:{...row,brief_hash:'b'.repeat(64)},error:null}),identity,proof))
      .rejects.toThrow(/identity_mismatch/)
    const valid=await authorizeProofBudget(rpc,identity,proof)
    await expect(authorizeProofBudget(rpc,identity,proof,{...valid,call_limit:99})).rejects.toThrow(/replay_mismatch/)
    expect(()=>proofWebhookFields(proof,null)).toThrow(/missing_budget/)
  })
  it('carries the exact authorized budget through draft, router and mocked webhook transport',async()=>{
    const rpc=vi.fn(async()=>({data:row,error:null}))
    const draftBudget=await authorizeProofBudget(rpc,identity,proof)
    const envelope={schema:'editorial-generation-v1',...proofWebhookFields(proof,draftBudget)}
    const routerBudget=await authorizeProofBudget(rpc,identity,proof,envelope.provider_budget)
    const fetcher=vi.fn(async(_url:string,init:RequestInit)=>({ok:true,body:JSON.parse(String(init.body))}))
    const payload={draft_id:'native-1',editorial_generation:envelope,...proofWebhookFields(proof,routerBudget)}
    await fetcher('https://n8n.invalid/webhook/post-gen-v2',{method:'POST',body:JSON.stringify(payload)})
    const delivered=JSON.parse(String(fetcher.mock.calls[0][1].body))
    expect(delivered.provider_budget).toEqual(draftBudget)
    expect(delivered.editorial_generation.provider_budget).toEqual(draftBudget)
    expect(delivered.route).toBe('text')
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('the actual handlers fail closed before native dispatch, replay without fetch, and retain ambiguous claims',()=>{
    const draft=readFileSync('supabase/functions/editorial-draft/index.ts','utf8')
    const router=readFileSync('supabase/functions/editorial-generator-router/index.ts','utf8')
    expect(draft.indexOf('authorizeProofBudget')).toBeLessThan(draft.indexOf("editorial_reserve_draft"))
    expect(router.indexOf('authorizeProofBudget')).toBeLessThan(router.indexOf("editorial_begin_native_draft"))
    expect(router.indexOf('if (!native.should_dispatch) return')).toBeLessThan(router.indexOf('await fetch('))
    expect(router).toContain('...proofWebhookFields(proof,providerBudget)')
    expect(router).toContain("dispatch_state:'claimed',reconciliation_required:true")
    expect(router).not.toContain("dispatch_state:'failed',last_error")
  })
})
