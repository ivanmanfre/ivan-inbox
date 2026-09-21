import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const allowedUser = Deno.env.get('EDITORIAL_ALLOWED_USER_ID') ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID') ?? ''
const routerUrl = Deno.env.get('EDITORIAL_GENERATOR_URL') ?? ''
const routerToken = Deno.env.get('EDITORIAL_GENERATOR_TOKEN') ?? ''
const origins = ['https://ivanmanfre.github.io', 'http://localhost:5173', 'http://localhost:4173']
const headers = (origin: string | null) => ({
  'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origins.includes(origin ?? '') ? origin! : origins[0],
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
  const brief = scoped.data.brief
  if (brief.identity?.content_hash !== expectedHash) return reply(200, receipt('conflict', 'content_hash_mismatch'), origin)
  if (brief.readiness !== 'ready_to_draft' || brief.missing_material?.length) {
    return reply(200, receipt('blocked', 'essential_material_missing'), origin)
  }
  // The router is an exact, release-controlled generation handoff. A missing
  // router blocks cleanly; it never mints a draft identity or falls back to a topic.
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
        artifact_role: role, request_id: requestId }),
    })
    if (!response.ok) throw new Error(`generator router returned HTTP ${response.status}`)
    const result = await response.json()
    if (result?.artifact_id !== reserved.data.artifact_id || result?.brief_id !== briefId ||
        result?.version !== version || result?.content_hash !== expectedHash) {
      throw new Error('generator did not echo the exact brief identity')
    }
    return reply(200, reserved.data, origin)
  } catch (e) {
    return reply(503, { error: 'generation_handoff_failed', detail: String(e),
      request_id: requestId, reserved_artifact_id: reserved.data.artifact_id }, origin)
  } finally { clearTimeout(timer) }
})
