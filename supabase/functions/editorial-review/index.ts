import { createClient } from 'npm:@supabase/supabase-js@2'
import { canonicalBriefPayload } from '../../../src/lib/editorialBriefs.ts'
import type { EditorialBrief } from '../../../src/lib/editorialTypes.ts'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const allowedUser = Deno.env.get('EDITORIAL_ALLOWED_USER_ID') ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID') ?? ''
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
  const { client_id: clientId, brief_id: briefId, version, expected_hash: expectedHash,
    verdict, reason, request_id: requestId } = body
  if (!['ivan', 'risedtc', 'arch'].includes(String(clientId)) || typeof briefId !== 'string' || !briefId ||
      !Number.isInteger(version) || Number(version) < 1 || typeof expectedHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(expectedHash) || !['pass', 'revise', 'fail'].includes(String(verdict)) ||
      typeof reason !== 'string' || !reason.trim() || typeof requestId !== 'string' || !requestId.trim()) {
    return reply(400, { error: 'invalid_request' }, origin)
  }
  const scoped = await userClient.rpc('editorial_read_brief', { p_gate: 'clientops', p_client_id: clientId,
    p_brief_id: briefId, p_version: version })
  if (scoped.error) return reply(403, { error: 'unauthorized' }, origin)
  if (!scoped.data?.found) return reply(200, { state: 'conflict', reason: 'no_such_version' }, origin)
  const old = scoped.data.brief as EditorialBrief
  if (old.identity.content_hash !== expectedHash) return reply(200, { state: 'conflict', reason: 'content_hash_mismatch' }, origin)
  const reviewerSeat = `operator:${auth.user.id}`
  if (old.review?.reviewer_seat === reviewerSeat || old.identity.client_id !== clientId) {
    return reply(200, { state: 'blocked', reason: 'invalid_reviewer_or_client' }, origin)
  }
  const brief = structuredClone(old)
  brief.identity.version = Number(version) + 1
  brief.identity.created_at = new Date().toISOString()
  brief.identity.status = 'proposed'
  brief.identity.content_hash = ''
  brief.review = { reviewer_seat: reviewerSeat, reviewer_model: 'human',
    verdict: verdict as 'pass' | 'revise' | 'fail', reviewed_at: brief.identity.created_at, notes: reason }
  if (verdict === 'pass') {
    brief.missing_material = brief.missing_material.filter(x => x !== 'Explicit independent editorial review')
    brief.readiness = brief.missing_material.length ? 'needs_material' : 'ready_to_draft'
    if (brief.readiness !== 'ready_to_draft') return reply(200, { state: 'blocked', reason: 'essential_material_missing' }, origin)
  } else {
    brief.readiness = 'needs_material'
    if (!brief.missing_material.length) brief.missing_material = [`Editorial review: ${reason}`]
  }
  brief.revises = { brief_id: old.identity.brief_id, version: old.identity.version,
    changed_evidence: 'Editorial review event; evidence retained unchanged.' }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBriefPayload(brief)))
  brief.identity.content_hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
  const committed = await service.rpc('editorial_commit_review', {
    p_gate: 'clientops', p_client_id: clientId, p_brief_id: briefId, p_version: version,
    p_expected_hash: expectedHash, p_request_id: requestId, p_verdict: verdict,
    p_reason: reason, p_reviewer_seat: reviewerSeat, p_new_payload: brief,
    p_new_hash: brief.identity.content_hash,
  })
  if (committed.error) return reply(503, { error: 'review_commit_failed', detail: committed.error.message }, origin)
  return reply(200, committed.data, origin)
})
