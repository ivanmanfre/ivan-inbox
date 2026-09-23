import { planNativeRoute } from '../../../src/lib/editorialNativeRoute.ts'
import { authorizeProofBudget, parseProofRequest, proofWebhookFields } from '../../../src/lib/editorialProofTransport.ts'
import type { ProofRequest, ProviderBudget } from '../../../src/lib/editorialProofTransport.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const routerToken = Deno.env.get('EDITORIAL_GENERATOR_TOKEN') ?? serviceKey
const n8nHost = (Deno.env.get('N8N_HOST') ?? '').replace(/\/$/,'')
const service = createClient(url, serviceKey, { auth: { persistSession: false } })
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})


Deno.serve(async request => {
  if (request.method !== 'POST') return reply(405,{error:'method_not_allowed'})
  if (!url || !serviceKey || !routerToken || !n8nHost) return reply(503,{error:'native_router_not_configured'})
  if (request.headers.get('authorization') !== `Bearer ${routerToken}`) return reply(403,{error:'unauthorized'})
  let body: Record<string,unknown>
  try { body = await request.json() } catch { return reply(400,{error:'invalid_json'}) }
  const envelope = body.editorial_generation as Record<string,unknown> | undefined
  const brief = envelope?.brief as Record<string,unknown> | undefined
  const identity = brief?.identity as Record<string,unknown> | undefined
  const direction = brief?.editorial_direction as Record<string,unknown> | undefined
  const clientId = body.client_id as string
  const artifactId = body.artifact_id as string
  const briefId = body.brief_id as string
  const version = body.version as number
  const hash = body.content_hash as string
  const requestId = body.request_id as string
  if (!['ivan','risedtc','arch'].includes(clientId) || !artifactId || !briefId || !Number.isInteger(version) ||
      !/^[0-9a-f]{64}$/.test(hash) || !requestId || envelope?.schema !== 'editorial-generation-v1' ||
      envelope.client_id !== clientId || envelope.brief_id !== briefId ||
      envelope.brief_version !== version || envelope.brief_hash !== hash ||
      identity?.client_id !== clientId || identity?.brief_id !== briefId ||
      identity?.version !== version || identity?.content_hash !== hash ||
      !Array.isArray(envelope.source_ids) || !envelope.source_ids.length ||
      !Array.isArray(envelope.permitted_claim_ids) || !envelope.permitted_claim_ids.length) {
    return reply(400,{error:'exact_editorial_envelope_required'})
  }
  const format = direction?.format
  let proof: ProofRequest | null = null
  let providerBudget: ProviderBudget | null = null
  try {
    proof = parseProofRequest(envelope.proof_transport)
    if (proof) providerBudget = await authorizeProofBudget(
      async (name,args) => { const result = await service.rpc(name,args); return { data:result.data,error:result.error } },
      { clientId,requestId,briefId,version,hash,format:String(format) },proof,envelope.provider_budget)
    else if (envelope.provider_budget != null) throw new Error('provider_budget_without_proof')
  } catch (error) {
    return reply(409,{error:'proof_transport_rejected',detail:String(error)})
  }
  const plan = planNativeRoute(clientId,String(format),envelope.copy_only === true,
    (brief?.resource as {readiness?:string;artifact_role?:string} | undefined) ?? null)
  if (!plan) return reply(409,{error:'native_format_bridge_not_staged',format})
  const title = String(direction?.proposed_hook || direction?.topic || '').slice(0,240)
  const topic = String(direction?.topic || '')
  const started = await service.rpc('editorial_begin_native_draft', {
    p_gate: 'clientops', p_client_id: clientId, p_artifact_id: artifactId,
    p_brief_id: briefId, p_version: version, p_expected_hash: hash,
    p_request_id: requestId, p_title: title, p_format: format, p_topic: topic,
  })
  if (started.error) return reply(409,{error:'native_draft_reservation_failed',detail:started.error.message})
  const native = started.data as {native_draft_id:string;should_dispatch:boolean;dispatch_state:string}
  if (!native.should_dispatch) return reply(200,{artifact_id:artifactId,brief_id:briefId,version,
    content_hash:hash,native_draft_id:native.native_draft_id,
    dispatch_state:native.dispatch_state,idempotent_replay:true})
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const path = plan.path
    const response = await fetch(`${n8nHost}/webhook/${path}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft_id:native.native_draft_id, artifact_id:artifactId,
        videoIdeaId:native.native_draft_id, title, topic,
        phase: plan.phase, format: plan.nativeFormat, post_format: plan.postFormat,
        ...proofWebhookFields(proof,providerBudget),
        editorial_generation: envelope }),
    })
    if (!response.ok) throw new Error(`native webhook HTTP ${response.status}`)
    return reply(202,{artifact_id:artifactId,brief_id:briefId,version,content_hash:hash,
      native_draft_id:native.native_draft_id,dispatch_state:'claimed',idempotent_replay:false})
  } catch (error) {
    await service.from('editorial_native_draft_dispatches').update({
      last_error:`unreconciled_transport:${String(error)}`.slice(0,500),
    }).eq('artifact_id',artifactId)
    return reply(503,{error:'native_dispatch_unreconciled',artifact_id:artifactId,
      native_draft_id:native.native_draft_id,dispatch_state:'claimed',reconciliation_required:true})
  } finally { clearTimeout(timer) }
})
