// content-stranger-read: the cold read of Ivan's brain-written business drafts (db/20261114f_content_stranger_read).
//
// Server-to-server: pg_cron runs content_stranger_tick every 10 minutes; it calls this function only when a draft's
// current text has no verdict. The gate is `x-inbox-secret` equal to INBOX_PUSH_SECRET, checked before anything else
// (same as content-card-ask). Deployed with --no-verify-jwt (supabase/config.toml).
//
// POST {} : reads the next due text (content_stranger_due), reads each twice through the proxy with the prompt row
// ivan-stranger-read (client:ivan), stores the combined result through content_stranger_save (verdict, or a counted
// try without one). A refused, empty or malformed answer is never a verdict.
// POST {draft_id, dry: true} : the same two reads for any of Ivan's own drafts, nothing stored, full reads returned.
// No supabase-js: plain fetch. Post text and keys are never logged.
import { proxyCall, proxyUrl, PROMPT_SCOPE, UUID_RE } from '../_shared/content-card.ts'
import { buildStrangerBody, combine, READS, readStranger, STRANGER_MODEL, STRANGER_SLUG } from '../_shared/stranger-read.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
// One draft per call: two parallel reads (90 s cap) plus REST calls (8 s cap each) stay inside pg_net's 150 s.
const CALL_TIMEOUT_MS = 90_000
const REST_TIMEOUT_MS = 8_000
const PER_RUN = 1

const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })

Deno.serve(async (req) => {
  const secret = Deno.env.get('INBOX_PUSH_SECRET')
  if (!secret) return reply(503, { error: 'not_configured' })
  if (req.headers.get('x-inbox-secret') !== secret) return reply(401, { error: 'unauthorized' })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
  const sk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!base || !sk) return reply(503, { error: 'not_configured' })
  const rest = async (path: string, body?: unknown): Promise<{ data: unknown; ok: boolean }> => {
    try {
      const res = await fetch(`${base}/rest/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      })
      if (!res.ok) { await res.body?.cancel(); return { data: null, ok: false } }
      return { data: await res.json(), ok: true }
    } catch {
      return { data: null, ok: false }
    }
  }

  let input: { draft_id?: unknown; dry?: unknown } = {}
  try { input = await req.json() } catch { /* an empty body is the cron call */ }
  const dry = input?.dry === true
  const dryDraft = typeof input?.draft_id === 'string' ? input.draft_id : ''
  if (dry && !UUID_RE.test(dryDraft)) return reply(400, { error: 'bad_request' })

  const { data: cfg, ok: cfgOk } = await rest('integration_config?select=key,value&key=in.(railway_proxy_key,railway_proxy_url)')
  if (!cfgOk) return reply(500, { error: 'config_read_failed' })
  const conf = Object.fromEntries(((cfg ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]))
  const key = conf.railway_proxy_key
  const url = proxyUrl(conf.railway_proxy_url)
  const { data: rows, ok: promptOk } = await rest(`content_prompts?select=body,version&slug=eq.${STRANGER_SLUG}&scope=eq.${encodeURIComponent(PROMPT_SCOPE)}&is_active=eq.true&limit=1`)
  const prompt = promptOk ? (rows as { body?: string; version?: unknown }[] | null)?.[0] : undefined
  const promptVersion = typeof prompt?.version === 'number' ? prompt.version : null

  // The texts to read: the due list, or (dry) the one draft asked for.
  let due: { draft_id: string; body: string; body_sha256: string }[] = []
  if (dry) {
    const { data, ok } = await rest(`carousel_drafts?select=id,post_body&id=eq.${dryDraft}&client_id=is.null&limit=1`)
    const d = ok ? (data as { id: string; post_body: string | null }[])[0] : undefined
    if (!d || typeof d.post_body !== 'string' || !d.post_body.trim()) return reply(404, { error: 'not_found' })
    due = [{ draft_id: d.id, body: d.post_body, body_sha256: '' }]
  } else {
    const { data, ok } = await rest('rpc/content_stranger_due', { p_limit: PER_RUN })
    if (!ok) return reply(500, { error: 'due_read_failed' })
    due = ((data ?? []) as typeof due).filter(x => UUID_RE.test(x.draft_id) && typeof x.body === 'string' && typeof x.body_sha256 === 'string')
  }
  if (due.length === 0) return reply(200, { read: 0 })

  const out: unknown[] = []
  for (const d of due) {
    let combined
    if (!key || !url) combined = { verdict: null, error: 'proxy_not_configured' } as const
    else if (typeof prompt?.body !== 'string' || !prompt.body.includes('{{BODY}}')) combined = { verdict: null, error: 'no_prompt' } as const
    else {
      const payload = buildStrangerBody(prompt.body, d.body)
      const calls = await Promise.all(Array.from({ length: READS }, () => proxyCall(fetch, url, key, payload, CALL_TIMEOUT_MS)))
      combined = combine(calls.map(c => (c.ok ? readStranger(c.json) : { ok: false as const, error: c.error })))
    }
    if (dry) { out.push({ draft_id: d.draft_id, prompt_version: promptVersion, ...combined }); continue }
    const { data: saved, ok } = await rest('rpc/content_stranger_save', {
      p_draft: d.draft_id, p_sha: d.body_sha256,
      p_verdict: combined.verdict, p_reason: combined.verdict ? combined.reason : null,
      p_detail: combined.verdict ? combined.detail : null, p_model: STRANGER_MODEL, p_prompt_version: promptVersion,
      p_error: combined.verdict ? null : combined.error,
    })
    out.push({ draft_id: d.draft_id, verdict: combined.verdict, error: combined.verdict ? null : combined.error, saved: ok ? saved : 'save_failed' })
  }
  if (!dry) console.log('content-stranger-read', JSON.stringify(out))
  return reply(200, dry ? { dry: true, results: out } : { read: out.length, results: out })
})
