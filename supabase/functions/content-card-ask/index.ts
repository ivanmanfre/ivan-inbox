// content-card-ask: ONE guided question for the day's post card (db/20261112b_content_card_question).
//
// Server-to-server: content_card_pick queues one pg_net call after it picks today's card (retries are the pick's
// job). The gate is `x-inbox-secret` equal to INBOX_PUSH_SECRET, checked before anything else, same as
// content-poland-read. Deployed with --no-verify-jwt for that reason (supabase/config.toml).
//
// Input {day, draft_id, dry?}. It reads the draft through content_card_ask_input, the prompt row ivan-card-question
// (client:ivan) at call time, asks the proxy once and stores the result through content_card_ask_save: a question,
// "none" (the post already carries his detail), or a transient failure (no prompt row, proxy down, refused or empty
// text, an answer that breaks the question rules). A made-up question is never stored. 2xx = a result is stored or
// there was nothing to ask about; 5xx = nothing stored, the pick may queue it again.
// dry: true works for ANY of Ivan's own drafts in review, writes nothing and returns the full result (replay).
// No supabase-js (as content-poland-read): plain fetch. Post text and keys are never logged.
import { ASK_SLUG, buildAskBody, DAY_RE, PROMPT_SCOPE, proxyCall, proxyUrl, readAsk, UUID_RE } from '../_shared/content-card.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CALL_TIMEOUT_MS = 120_000

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
      })
      if (!res.ok) { await res.body?.cancel(); return { data: null, ok: false } }
      return { data: await res.json(), ok: true }
    } catch {
      return { data: null, ok: false }
    }
  }

  let input: { day?: unknown; draft_id?: unknown; dry?: unknown }
  try { input = await req.json() } catch { return reply(400, { error: 'bad_request' }) }
  const day = typeof input?.day === 'string' ? input.day : ''
  const draft = typeof input?.draft_id === 'string' ? input.draft_id : ''
  const dry = input?.dry === true
  if (!UUID_RE.test(draft) || (!dry && !DAY_RE.test(day))) return reply(400, { error: 'bad_request' })

  const { data: got, ok: gotOk } = await rest('rpc/content_card_ask_input', { p_day: DAY_RE.test(day) ? day : null, p_draft: draft, p_dry: dry })
  if (!gotOk) return reply(500, { error: 'input_read_failed' })
  const inp = got as { ok?: boolean; why?: string; body?: string; sha?: string; source?: string; source_label?: string | null; hints?: unknown }
  if (!inp?.ok || typeof inp.body !== 'string' || typeof inp.sha !== 'string') {
    const out = { skipped: inp?.why ?? 'unreadable' }
    console.log('content-card-ask', JSON.stringify(out))
    return reply(200, out)
  }

  // Everything below ends in one stored result (or, dry, one returned result).
  const finish = async (result: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    if (dry) return reply(200, { dry: true, ...result, ...extra })
    const { data: saved, ok } = await rest('rpc/content_card_ask_save', { p_day: day, p_draft: draft, p_sha: inp.sha, p_result: result })
    const out = { state: result.state, error: result.error ?? null, saved }
    console.log('content-card-ask', JSON.stringify(out))
    return ok ? reply(200, out) : reply(500, { error: 'save_failed' })
  }

  const { data: cfg, ok: cfgOk } = await rest('integration_config?select=key,value&key=in.(railway_proxy_key,railway_proxy_url)')
  if (!cfgOk) return reply(500, { error: 'config_read_failed' })
  const conf = Object.fromEntries(((cfg ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]))
  const key = conf.railway_proxy_key
  const url = proxyUrl(conf.railway_proxy_url)
  if (!key || !url) return finish({ state: 'failed', error: 'proxy_not_configured' })

  const { data: rows, ok: promptOk } = await rest(`content_prompts?select=body,version&slug=eq.${ASK_SLUG}&scope=eq.${encodeURIComponent(PROMPT_SCOPE)}&is_active=eq.true&limit=1`)
  const prompt = promptOk ? (rows as { body?: string; version?: unknown }[] | null)?.[0] : undefined
  if (typeof prompt?.body !== 'string' || !prompt.body.trim()) return finish({ state: 'failed', error: 'no_prompt' })

  const payload = buildAskBody(prompt.body, { body: inp.body, source: inp.source, source_label: inp.source_label, hints: inp.hints })
  const call = await proxyCall(fetch, url, key, payload, CALL_TIMEOUT_MS)
  if (!call.ok) return finish({ state: 'failed', error: call.error })
  const read = readAsk(call.json, inp.body)
  const debug = dry ? { prompt_version: prompt.version ?? null, source: inp.source, hints: inp.hints, raw: call.json } : {}
  if (!read.ok) return finish({ state: 'failed', error: read.error }, { ...debug, model_result: read.result ?? null })
  return finish({ state: read.state, ...read.result }, debug)
})
