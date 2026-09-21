import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const allowedUser = Deno.env.get('EDITORIAL_ALLOWED_USER_ID') ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID') ?? ''
const routerUrl = Deno.env.get('EDITORIAL_GENERATOR_URL') ?? `${url}/functions/v1/editorial-generator-router`
const routerToken = Deno.env.get('EDITORIAL_GENERATOR_TOKEN') ?? serviceKey
const origins = ['https://ivanmanfre.github.io', 'http://localhost:5173', 'http://localhost:4173']
const headers = (origin: string | null) => ({
  'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origins.includes(origin ?? '') ? origin! : origins[0],
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Vary': 'Origin',
})
const reply = (status: number, body: unknown, origin: string | null) => new Response(JSON.stringify(body), { status, headers: headers(origin) })
const service = createClient(url, serviceKey, { auth: { persistSession: false } })

Deno.serve(async request => {
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) })
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' }, origin)
  if (!url || !anon || !serviceKey || !allowedUser) return reply(503, { error: 'adapter_not_configured' }, origin)
  const bearer = request.headers.get('authorization')
  if (!bearer?.startsWith('Bearer ')) return reply(401, { error: 'unauthorized' }, origin)
  const userClient = createClient(url, anon, { auth: { persistSession: false },
    global: { headers: { Authorization: bearer } } })
  const { data: auth, error: authError } = await userClient.auth.getUser()
  if (authError || auth.user?.id !== allowedUser) return reply(403, { error: 'unauthorized' }, origin)
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return reply(400, { error: 'invalid_json' }, origin) }
  const clientId = body.client_id, briefId = body.brief_id, version = body.version
  const expectedHash = body.expected_hash, requestId = body.request_id, role = body.artifact_role
  if (!['ivan', 'risedtc', 'arch'].includes(String(clientId)) || typeof briefId !== 'string' || !briefId ||
      !Number.isInteger(version) || Number(version) < 1 || typeof expectedHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(expectedHash) || typeof requestId !== 'string' || !requestId ||
      typeof role !== 'string' || !role) return reply(400, { error: 'invalid_request' }, origin)
  const scoped = await userClient.rpc('editorial_read_brief', { p_gate: 'clientops', p_client_id: clientId,
    p_brief_id: briefId, p_version: version })
  if (scoped.error) return reply(403, { error: 'unauthorized' }, origin)
  const receipt = (state: 'blocked' | 'conflict', reason: string) => ({ request_id: requestId,
    client_id: clientId, brief_id: briefId, brief_version: version, expected_hash: expectedHash,
    artifact_role: role, artifact_id: null, idempotent_replay: false, state, blocked_reason: reason })
  if (!scoped.data?.found) return reply(200, receipt('conflict', 'no_such_version'), origin)
  if (scoped.data.access === 'permission_unavailable' || !scoped.data.brief)
    return reply(200, receipt('blocked', 'source_access_missing'), origin)
  const brief = scoped.data.brief
  if (brief.identity?.content_hash !== expectedHash) return reply(200, receipt('conflict', 'content_hash_mismatch'), origin)
  const internalCopy = role === 'internal_copy'
  if ((brief.readiness !== 'ready_to_draft' || brief.missing_material?.length) && !internalCopy) {
    return reply(200, receipt('blocked', 'essential_material_missing'), origin)
  }
  const format = brief.editorial_direction?.format
  if (internalCopy && !['carousel', 'single_image', 'lm_promo', 'video'].includes(format)) {
    return reply(200, receipt('blocked', 'internal_copy_format_not_supported'), origin)
  }
  const sourceIds = (brief.evidence ?? []).filter((e: Record<string, unknown>) =>
    !e.gap_state && (e.source_client_scope === 'public' || e.source_client_scope === clientId) &&
    (e.permission_state === 'public_source' || e.permission_state === 'granted' || e.permission_state == null ||
      (e.permission_state === 'unknown' && e.source_kind === 'call' && e.source_client_scope === clientId)))
    .map((e: Record<string, unknown>) => e.source_id)
  const claimIds = (brief.claim_ledger ?? []).filter((claim: { supporting_refs?: string[] }) =>
    claim.supporting_refs?.length && claim.supporting_refs.every((ref: string) =>
      brief.evidence?.some((e: { evidence_id: string; source_id: string }) =>
        e.evidence_id === ref && sourceIds.includes(e.source_id))))
    .map((claim: { claim_id: string }) => claim.claim_id)
  if (!sourceIds.length || !claimIds.length) return reply(200, receipt('blocked', 'permitted_evidence_missing'), origin)
  if (format === 'lm_promo' && (brief.resource?.readiness !== 'ready' ||
      !brief.resource?.asset_id || !brief.resource?.version ||
      brief.resource?.required_missing_material?.length)) {
    return reply(200, receipt('blocked', 'resource_not_ready'), origin)
  }
  const holds = [...(brief.missing_material ?? [])]
  if (brief.evidence?.some((e: Record<string, unknown>) => e.source_kind === 'call' &&
      e.source_client_scope === clientId && e.permission_state === 'unknown')) {
    holds.push('call_public_use_permission_unresolved')
  }
  if (format === 'carousel') holds.unshift('rendered_deck_unverified')
  if (format === 'single_image') holds.unshift('image_asset_pending', ...(brief.production?.required_materials ?? []))
  if (format === 'video') holds.unshift('recording_pending')
  const envelope = { schema: 'editorial-generation-v1', client_id: clientId,
    brief_id: briefId, brief_version: version, brief_hash: expectedHash,
    artifact_role: role, request_id: requestId, source_cutoff: brief.identity.source_cutoff,
    direction_version: brief.purpose.direction_version, source_ids: sourceIds,
    permitted_claim_ids: claimIds, brief, prior_generation: body.prior_generation ?? null,
    production_hold: holds, copy_only: internalCopy || format === 'single_image' }
  // The in-repo router has a default Supabase function URL; deployments may
  // override it only as an explicit release object.
  if (!routerUrl || !routerToken) return reply(200, receipt('blocked', 'generation_router_not_deployed'), origin)
  const reserved = await service.rpc('editorial_reserve_draft', { p_gate: 'clientops', p_client_id: clientId,
    p_brief_id: briefId, p_version: version, p_expected_hash: expectedHash,
    p_request_id: requestId, p_artifact_role: role })
  if (reserved.error) return reply(503, { error: 'reservation_failed', detail: reserved.error.message }, origin)
  if (reserved.data?.state !== 'accepted') return reply(200, reserved.data, origin)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 40_000)
  try {
    const response = await fetch(routerUrl, { method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${routerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, brief_id: briefId, version,
        content_hash: expectedHash, artifact_id: reserved.data.artifact_id,
        artifact_role: role, request_id: requestId, editorial_generation: envelope }),
    })
    if (!response.ok) throw new Error(`generator router returned HTTP ${response.status}`)
    const result = await response.json()
    if (result?.artifact_id !== reserved.data.artifact_id || result?.brief_id !== briefId ||
        result?.version !== version || result?.content_hash !== expectedHash ||
        !result?.native_draft_id || !['claimed','complete'].includes(result?.dispatch_state)) {
      throw new Error('generator did not echo the exact brief identity')
    }
    return reply(200, reserved.data, origin)
  } catch (e) {
    return reply(503, { error: 'generation_handoff_failed', detail: String(e),
      request_id: requestId, reserved_artifact_id: reserved.data.artifact_id }, origin)
  } finally { clearTimeout(timer) }
})
