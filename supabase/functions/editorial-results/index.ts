import { createClient } from 'npm:@supabase/supabase-js@2'
import { normalizePostOutcome, normalizeResourceOutcomes } from '../../../src/lib/editorialOutcomes.ts'
import type { EditorialClientId } from '../../../src/lib/editorialTypes.ts'

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

async function allRows(table: string, column: string, value: string) {
  const out: Record<string, unknown>[] = []
  let total: number | null = null
  for (let offset = 0; offset <= 5000; offset += 200) {
    const { data, error, count } = await service.from(table).select('*', { count: 'exact' })
      .eq(column, value).order('created_at').order('id').range(offset, offset + 199)
    if (error || count === null) throw new Error(`${table} read failed: ${error?.message ?? 'no exact count'}`)
    total = count
    out.push(...(data ?? []))
    if (out.length >= total) break
    if (out.length >= 5000) throw new Error(`${table} exceeds bounded read; outcome remains unread`)
  }
  if (total !== out.length) throw new Error(`${table} returned ${out.length}/${total} rows`)
  return out
}

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
  const clientId = body.client_id
  const briefId = body.brief_id
  const version = body.version
  if (!['ivan', 'risedtc', 'arch'].includes(String(clientId)) || typeof briefId !== 'string' || !briefId ||
      !Number.isInteger(version) || Number(version) < 1) return reply(400, { error: 'invalid_request' }, origin)
  const scoped = await userClient.rpc('editorial_read_brief', { p_gate: 'clientops', p_client_id: clientId,
    p_brief_id: briefId, p_version: version })
  if (scoped.error) return reply(403, { error: 'unauthorized' }, origin)
  if (!scoped.data?.found) return reply(404, { error: 'brief_not_found' }, origin)
  if (scoped.data.access === 'permission_unavailable' || !scoped.data.brief) {
    return reply(409, { error: 'source_permission_unavailable' }, origin)
  }
  const brief = scoped.data.brief
  const unknowns: string[] = []
  let post = null, resource = null
  try {
    const publicationId = brief.decisions_links?.publication_id
    if (publicationId) {
      const table = clientId === 'ivan' ? 'own_posts' : 'client_post_metrics'
      const column = clientId === 'ivan' ? 'social_id' : 'social_id'
      let q = service.from(table).select('*').eq(column, publicationId)
      if (clientId !== 'ivan') q = q.eq('client_id', clientId)
      const { data, error } = await q.limit(1).maybeSingle()
      if (error) throw new Error(`post metric read failed: ${error.message}`)
      post = normalizePostOutcome({ clientId: clientId as EditorialClientId, postId: publicationId, metrics: data })
      if (!data) unknowns.push('Published post has no measured outcome row yet.')
    } else unknowns.push('No publication identity is linked to this brief version.')
    const assetId = brief.resource?.asset_id
    const expectedVersion = Number(brief.resource?.version)
    if (assetId && Number.isInteger(expectedVersion) && expectedVersion > 0) {
      const { data: asset, error } = await service.from('lead_magnets')
        .select('id,slug,client_id,current_data_version,status').eq('id', assetId).maybeSingle()
      if (error) throw new Error(`asset read failed: ${error.message}`)
      if (!asset || (asset.client_id !== clientId && !(clientId === 'ivan' && asset.client_id === null))) {
        unknowns.push('Exact client-owned asset version is unavailable.')
      } else if (asset.current_data_version !== expectedVersion || !asset.slug) {
        unknowns.push('Asset data version or slug differs from the brief; events cannot be attributed to this version.')
      } else {
        const observedThrough = new Date().toISOString()
        const events = await allRows('lm_events', 'lm_slug', asset.slug)
        const attributions = await allRows('lm_attribution', 'lm_slug', asset.slug)
        resource = normalizeResourceOutcomes({ clientId: clientId as EditorialClientId,
          assetClientId: (asset.client_id ?? clientId) as EditorialClientId, assetId: asset.id, slug: asset.slug,
          dataVersion: expectedVersion, promotionPublicationId: brief.identity.kind === 'promotion' ? publicationId : null,
          observationWindow: { start: null, end: observedThrough,
            definition: 'All retained rows for the exact asset slug through this read time; historical start is unknown.',
            readComplete: true }, events: events as never, attributions: attributions as never })
        if (brief.identity.kind === 'promotion' && resource.promotion_attribution.state === 'unknown') {
          unknowns.push('Resource totals are asset-version observations; no exact telemetry tag attributes them to this promotion.')
        }
      }
    } else if (brief.identity.kind === 'promotion' || brief.identity.kind === 'resource') {
      unknowns.push('No exact asset ID and data version are linked to this brief.')
    }
    const state = post || resource ? unknowns.length ? 'partial' : 'ready' : 'empty'
    return reply(200, { client_id: clientId, brief_id: briefId, brief_version: version,
      state, post, resource, unknowns }, origin)
  } catch (e) { return reply(503, { error: 'outcome_read_failed', detail: String(e) }, origin) }
})
