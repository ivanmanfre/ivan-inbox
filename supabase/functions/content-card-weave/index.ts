import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildWeaveBody, DAY_RE, PROMPT_SCOPE, proxyCall, proxyUrl, readWeave, UUID_RE, WEAVE_SLUG } from '../_shared/content-card.ts'

// content-card-weave: his one-line answer worked into the day's post card (db/20261112b_content_card_question).
// Called from the app by the signed-in owner; same owner check as inbox-email-stats / inbox-calendar.
// Input {day, draft_id, body_sha, answer}. content_card_weave_input requires today's shown card with a live question
// asked on this exact body. One proxy call with the prompt row ivan-card-weave (client:ivan), then the code checks of
// _shared/content-card.ts (only the anchor's paragraph and its neighbours changed, no new em dash, bounded growth...).
// It NEVER writes the draft: it returns the proposed text, which the app opens in the card's Fix editor for him to
// read, change and save himself. Any failure = {error}, and the app opens the editor on the unchanged text.
const CALL_TIMEOUT_MS = 100_000

Deno.serve(async req => {
  const origin = req.headers.get('origin') ?? ''
  const headers = { 'Access-Control-Allow-Origin': origin === 'https://ivanmanfre.github.io' || /^http:\/\/localhost:\d{4,5}$/.test(origin) ? origin : 'https://ivanmanfre.github.io',
    'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', Vary: 'Origin' }
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  if (req.method === 'OPTIONS') return respond({ ok: true })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), allowed = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
  if (!url || !anon || !service || !allowed) return respond({ error: 'Not configured.' }, 503)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  if (!token) return respond({ error: 'Sign in again.' }, 401)
  try {
    const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(token)
    if (error || !data.user) return respond({ error: 'Sign in again.' }, 401)
    if (data.user.id !== allowed) return respond({ error: 'Access denied.' }, 403)
  } catch { return respond({ error: 'Login verification is unavailable. Try again.' }, 503) }

  let input: { day?: unknown; draft_id?: unknown; body_sha?: unknown; answer?: unknown }
  try { input = await req.json() } catch { return respond({ error: 'bad_request' }, 400) }
  const day = typeof input?.day === 'string' ? input.day : ''
  const draft = typeof input?.draft_id === 'string' ? input.draft_id : ''
  const sha = typeof input?.body_sha === 'string' ? input.body_sha : ''
  const answer = typeof input?.answer === 'string' ? input.answer.trim() : ''
  if (!DAY_RE.test(day) || !UUID_RE.test(draft) || !/^[0-9a-f]{64}$/.test(sha)) return respond({ error: 'bad_request' }, 400)
  if (!answer || answer.length > 1000) return respond({ error: 'unusable' }, 422)

  const sb = createClient(url, service, { auth: { persistSession: false } })
  const { data: got, error: ge } = await sb.rpc('content_card_weave_input', { p_day: day, p_draft: draft, p_sha: sha })
  if (ge) return respond({ error: 'input_read_failed' }, 500)
  const inp = got as { ok?: boolean; why?: string; body?: string; question?: string; anchor?: string; source?: string; source_label?: string | null }
  if (!inp?.ok || typeof inp.body !== 'string' || typeof inp.question !== 'string' || typeof inp.anchor !== 'string') {
    return respond({ error: inp?.why ?? 'unreadable' }, 409)
  }

  const { data: cfg, error: ce } = await sb.from('integration_config').select('key,value').in('key', ['railway_proxy_key', 'railway_proxy_url'])
  if (ce) return respond({ error: 'config_read_failed' }, 500)
  const conf = Object.fromEntries((cfg ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const proxy = proxyUrl(conf.railway_proxy_url)
  if (!conf.railway_proxy_key || !proxy) return respond({ error: 'proxy_not_configured' }, 503)
  const { data: prompt, error: pe } = await sb.from('content_prompts').select('body').eq('slug', WEAVE_SLUG).eq('scope', PROMPT_SCOPE).eq('is_active', true).limit(1).maybeSingle()
  if (pe || typeof prompt?.body !== 'string' || !prompt.body.trim()) return respond({ error: 'no_prompt' }, 503)

  const payload = buildWeaveBody(prompt.body, { body: inp.body, source: inp.source, source_label: inp.source_label, question: inp.question, anchor: inp.anchor, answer })
  const call = await proxyCall(fetch, proxy, conf.railway_proxy_key, payload, CALL_TIMEOUT_MS)
  if (!call.ok) { console.log('content-card-weave', JSON.stringify({ error: call.error })); return respond({ error: call.error }, 502) }
  const read = readWeave(call.json, inp.body, inp.anchor, answer)
  console.log('content-card-weave', JSON.stringify(read.ok ? { ok: true } : { error: read.error }))
  if (!read.ok) return respond({ error: read.error, why: read.why ?? null }, 422)
  return respond({ ok: true, text: read.text })
})
