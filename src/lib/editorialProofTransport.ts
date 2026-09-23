export const PROOF_COHORT_ID = 'content-brain-08-20260923'
export const PROOF_NAMESPACE = 'editorial-proof-v1'

export type ProofRequest = { namespace: typeof PROOF_NAMESPACE; cohort_id: typeof PROOF_COHORT_ID; slot: number }
export type ProviderBudget = {
  namespace: typeof PROOF_NAMESPACE; client_id: string; job_id: string; cohort_id: typeof PROOF_COHORT_ID
  slot: number; request_id: string; brief_id: string; brief_version: number; brief_hash: string
  route: 'text' | 'video_script'; call_limit: number; calls_reserved: number; status: string
}
export type ProofIdentity = { clientId:string; requestId:string; briefId:string; version:number; hash:string; format:string }
export type RpcResult = { data: unknown; error: { message?: string } | null }
export type ProofRpc = (name:string,args:Record<string,unknown>) => Promise<RpcResult>

const record = (value:unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string,unknown> : null

export function parseProofRequest(value:unknown): ProofRequest | null {
  if (value == null) return null
  const item = record(value)
  if (!item || Object.keys(item).sort().join(',') !== 'cohort_id,namespace,slot' ||
      item.namespace !== PROOF_NAMESPACE || item.cohort_id !== PROOF_COHORT_ID ||
      !Number.isInteger(item.slot) || Number(item.slot) < 1 || Number(item.slot) > 5) {
    throw new Error('invalid_proof_transport_request')
  }
  return item as ProofRequest
}

export function proofRoute(identity:ProofIdentity): 'text'|'video_script' {
  if (!['ivan','risedtc','arch'].includes(identity.clientId)) throw new Error('proof_lane_adapter_not_reviewed')
  if (identity.format === 'text') return 'text'
  if (identity.format === 'video' && identity.clientId === 'ivan') return 'video_script'
  throw new Error('proof_route_not_reviewed')
}

const jobId = (identity:ProofIdentity, proof:ProofRequest) =>
  `${PROOF_COHORT_ID}:${identity.clientId}:${proof.slot}:${identity.requestId}`

function exactBudget(row:Record<string,unknown>, identity:ProofIdentity, proof:ProofRequest,
  route:'text'|'video_script'): ProviderBudget {
  const expected: Omit<ProviderBudget,'namespace'|'call_limit'|'calls_reserved'|'status'> = {
    client_id:identity.clientId,job_id:jobId(identity,proof),cohort_id:PROOF_COHORT_ID,
    slot:proof.slot,request_id:identity.requestId,brief_id:identity.briefId,brief_version:identity.version,
    brief_hash:identity.hash,route }
  for (const [key,value] of Object.entries(expected)) if (row[key] !== value) {
    throw new Error(`provider_budget_identity_mismatch:${key}`)
  }
  if (!Number.isInteger(row.call_limit) || Number(row.call_limit) < 1 || Number(row.call_limit) > 12 ||
      !Number.isInteger(row.calls_reserved) || Number(row.calls_reserved) < 0 ||
      Number(row.calls_reserved) > Number(row.call_limit)) throw new Error('provider_budget_state_invalid')
  return { namespace:PROOF_NAMESPACE,...expected,call_limit:Number(row.call_limit),
    calls_reserved:Number(row.calls_reserved),status:String(row.status ?? '') }
}

export async function authorizeProofBudget(rpc:ProofRpc, identity:ProofIdentity,
  proof:ProofRequest, supplied?:unknown):Promise<ProviderBudget> {
  const route = proofRoute(identity)
  const expectedJobId = jobId(identity,proof)
  const result = await rpc('editorial_begin_provider_job', { p_client_id:identity.clientId,
    p_job_id:expectedJobId,p_cohort_id:PROOF_COHORT_ID,p_slot:proof.slot,p_request_id:identity.requestId,
    p_brief_id:identity.briefId,p_brief_version:identity.version,p_brief_hash:identity.hash,p_route:route })
  if (result.error) throw new Error(`provider_budget_authorization_failed:${result.error.message ?? 'unknown'}`)
  const row = record(Array.isArray(result.data) ? result.data[0] : result.data)
  if (!row) throw new Error('provider_budget_authorization_missing')
  const authorized = exactBudget(row,identity,proof,route)
  if (supplied != null) {
    const value = record(supplied)
    const keys = Object.keys(authorized).sort()
    if (!value || Object.keys(value).sort().join(',') !== keys.join(',') ||
        keys.some(key => value[key] !== authorized[key as keyof ProviderBudget])) {
      throw new Error('provider_budget_replay_mismatch')
    }
  }
  return authorized
}

export function proofWebhookFields(proof:ProofRequest|null,budget:ProviderBudget|null) {
  if (!proof && !budget) return {}
  if (!proof || !budget) throw new Error('declared_proof_missing_budget')
  return { proof_transport:proof, provider_budget:budget, route:budget.route }
}
