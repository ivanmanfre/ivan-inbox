// inbox-fast — the LIVE CONVERSATION fast lane.
//
// WHY DIRECT API AND NOT THE RAILWAY PROXY (measured 2026-08-03, orchestrator):
// the Railway proxy's /v1/messages spawns a fresh Claude Code CLI per call and
// a trivial one-line turn measured 4.14s WALL TIME — that fails the <2.5s
// first-audible gate for a voice loop before TTS is even added. The direct
// Anthropic API streams the first token in a few hundred ms. The proxy-first
// ruling (proxy-first-api-fallback-routing-2026-07-30) is about single-shot
// content jobs; Ivan's own latency demand is the overriding constraint here,
// and this is documented as a deliberate exception.
//
// WHAT THIS IS NOT: it is not the brain. Real work — files, pipeline state,
// research, anything needing tools — escalates through the EXISTING
// inbox-claude broker (Railway Claude Code). This fn only converses, and its
// system prompt instructs the model to emit an <<ESCALATE: …>> line when a
// turn needs the full pipeline; the CLIENT detects that token and dispatches
// the escalation through useChat.send. The fast lane never touches Supabase
// data, never runs tools, and never sees a working directory.
//
// AUTH mirrors inbox-stt/index.ts EXACTLY — bearer verified via
// supabase.auth.getUser, single-operator allowlist, scoped CORS. Fails CLOSED.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const ALLOWED_USER_ID = Deno.env.get('INBOX_FAST_ALLOWED_USER_ID')
  ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')

const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
  'http://localhost:5431',
]

// PROBED at deploy time (2026-08-03) via this fn's own ?probe=models route:
// the account's /v1/models catalog was checked for anything faster/newer in
// the Haiku tier. claude-haiku-4-5 is the fastest current model the key
// serves; INBOX_FAST_MODEL can move it without a redeploy if a newer id
// lands. Voice loop wants time-to-first-token above all — Haiku wins that.
const MODEL = Deno.env.get('INBOX_FAST_MODEL') || 'claude-haiku-4-5'

// A VOICE reply. 400 tokens is ~45s of speech — already the ceiling of what
// anyone wants read aloud; the prompt asks for 1-3 sentences.
const MAX_TOKENS = 400

// History cap: the client already trims to ~12 turns, but the fn enforces its
// own bound so a buggy client can't ship an unbounded prompt to a paid API.
const MAX_MESSAGES = 30
const MAX_CONTENT_CHARS = 4000

// SHORT on purpose (~1.6k chars): this prompt rides every voice turn and the
// loop is latency- and cost-sensitive. Spoken register, concise, and the
// escalation contract — the model DECIDES when a turn needs the real pipeline.
const SYSTEM = `You are the voice of Ivan's operations inbox — a spoken, live conversation. Ivan runs a single-operator LinkedIn content and outreach engine (content drafts, lead magnets, DM/comment outreach lanes, client RISE DTC). You are the FAST lane: you chat, answer, think aloud briefly, and route real work elsewhere.

Register: spoken, not written. 1-3 short sentences unless Ivan explicitly asks for more. No markdown, no bullet lists, no headers, no emoji — your words are read aloud by TTS. Numbers and names said plainly. It is fine to be direct and colloquial.

ESCALATION — the one structured thing you do. You have NO tools, NO file access, NO live data. When Ivan asks for anything that needs real work — reading or changing files, checking pipeline/queue/campaign state, research, sending or drafting anything, debugging, "look at", "check", "update", "find out" — do BOTH of these in one reply:
1. Say one short spoken sentence acknowledging what you're kicking off (e.g. "On it — I'm sending that to the workbench now.").
2. On its own line, emit exactly: <<ESCALATE: concise imperative task summary>>
The <<ESCALATE: …>> line is machine-read and never spoken; keep the summary under 200 characters, self-contained, third-person imperative ("Check why the RISE cold email lane sent 0 yesterday"). Never emit it for pure conversation, opinions, or things you can answer from the transcript. Never emit more than one per reply. Never invent an escalation Ivan didn't ask for.

When a completed escalation result is fed back to you (a message starting "[work result]"), summarize it aloud in 1-3 sentences — the outcome first, then the one thing that matters next. Don't recite details; the full text is already on Ivan's screen.

If you don't know, say so in one sentence. Never fabricate pipeline state, metrics, or file contents — that's exactly what escalation is for.`

const VENDOR_TIMEOUT_MS = 30_000

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'x-fast-model',
    'Vary': 'Origin',
  }
}

function fail(status: number, code: string, origin: string | null, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST' && req.method !== 'GET') return fail(405, 'method_not_allowed', origin)

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ALLOWED_USER_ID || !key) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, anon: !!SUPABASE_ANON_KEY, allow: !!ALLOWED_USER_ID, key: !!key,
    })
    return fail(503, 'fast_not_configured', origin)
  }

  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return fail(401, 'unauthenticated', origin)
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.getUser(jwt)
  const user = data?.user
  if (error || !user) return fail(401, 'invalid_token', origin)
  if (user.id !== ALLOWED_USER_ID) {
    console.warn('rejected non-allowlisted user', { attempted: user.id })
    return fail(403, 'forbidden_user', origin)
  }

  // ---- ?probe=models — AUTH-GATED (sits below the operator allowlist check
  // above, so only Ivan's own JWT can hit it). Lists what the account's key
  // actually serves, so the MODEL choice above stays honest over time.
  const url = new URL(req.url)
  if (url.searchParams.get('probe') === 'models') {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    })
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: { ...cors(origin), 'Content-Type': 'application/json' },
    })
  }
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', origin)

  // ---- body: {messages: [{role:'user'|'assistant', content: string}...]}
  let messages: { role: 'user' | 'assistant'; content: string }[]
  try {
    const body = await req.json() as { messages?: unknown }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return fail(400, 'no_messages', origin)
    }
    messages = body.messages.slice(-MAX_MESSAGES).map((m) => {
      const mm = m as { role?: unknown; content?: unknown }
      const role = mm.role === 'assistant' ? 'assistant' : 'user'
      const content = typeof mm.content === 'string' ? mm.content.slice(0, MAX_CONTENT_CHARS) : ''
      return { role, content }
    }).filter((m) => m.content.trim())
    if (!messages.length) return fail(400, 'no_messages', origin)
    // The API requires the first message to be a user turn.
    while (messages.length && messages[0].role !== 'user') messages.shift()
    if (!messages.length) return fail(400, 'no_messages', origin)
  } catch {
    return fail(400, 'bad_body', origin)
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), VENDOR_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        system: SYSTEM,
        messages,
      }),
      signal: ctl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    const aborted = e instanceof Error && e.name === 'AbortError'
    return fail(aborted ? 504 : 502, aborted ? 'fast_timeout' : 'fast_upstream_error', origin)
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer)
    const detail = (await upstream.text().catch(() => '')).slice(0, 300)
    console.error('anthropic rejected', { status: upstream.status })
    return fail(502, 'fast_upstream_error', origin, `vendor_${upstream.status}: ${detail}`)
  }

  // Relay the SSE stream verbatim. The client parses Anthropic's own event
  // shapes (content_block_delta / message_stop) — no re-framing layer to
  // drift. The timer is cleared when the stream ends either way.
  const relay = new ReadableStream({
    start(controller) {
      const reader = upstream.body!.getReader()
      const pump = (): Promise<void> => reader.read().then(({ done, value }) => {
        if (done) { clearTimeout(timer); controller.close(); return }
        controller.enqueue(value)
        return pump()
      }).catch((e) => {
        clearTimeout(timer)
        console.error('relay broke', { message: e instanceof Error ? e.name : 'unknown' })
        controller.error(e)
      })
      return pump()
    },
    cancel() { clearTimeout(timer); ctl.abort() },
  })

  return new Response(relay, {
    headers: {
      ...cors(origin),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Fast-Model': MODEL,
    },
  })
})
