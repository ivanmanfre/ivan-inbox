// inbox-rt-token — mints SINGLE-USE ElevenLabs realtime tokens for the browser.
//
// WHY THIS EXISTS. The realtime STT path (scribe_v2_realtime over a browser
// WebSocket) and the streaming TTS path (tts_websocket) both need to open a
// socket straight from the browser to api.elevenlabs.io — the audio must not
// take an extra hop through an edge relay (browser WS can't send headers, a
// relay would need --no-verify-jwt, and edge duration caps kill long
// dictation; phase3-stt-research.md). ElevenLabs' answer to "browser, no
// key" is a single-use token: the server mints it with the real key, the
// browser spends it once on one WS connection, and it expires in 15 minutes.
// The provider key NEVER reaches the browser.
//
// AUTH mirrors inbox-stt/index.ts EXACTLY — same bearer verification via
// supabase.auth.getUser, same single-operator allowlist, same scoped CORS
// origin list. Every control fails CLOSED.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
// Its own secret if set, otherwise the broker's — one operator, one allowlist.
const ALLOWED_USER_ID = Deno.env.get('INBOX_RT_ALLOWED_USER_ID')
  ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')

// Scoped, not '*'. Mirrors inbox-stt's list (GitHub Pages + the vite ports).
const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
  'http://localhost:5431',
]

// The two token types this fn will mint, and nothing else. The names are
// ElevenLabs' single-use token types (POST /v1/single-use-token/{type}):
//   stt → realtime_scribe  (wss /v1/speech-to-text/realtime)
//   tts → tts_websocket    (wss /v1/text-to-speech/:voice/stream-input)
const KINDS: Record<string, string> = {
  stt: 'realtime_scribe',
  tts: 'tts_websocket',
}

const VENDOR_TIMEOUT_MS = 10_000

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', origin)

  const key = Deno.env.get('ELEVENLABS_API_KEY')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ALLOWED_USER_ID || !key) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, anon: !!SUPABASE_ANON_KEY, allow: !!ALLOWED_USER_ID, key: !!key,
    })
    return fail(503, 'rt_not_configured', origin)
  }

  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return fail(401, 'unauthenticated', origin)

  // getUser() validates signature and expiry server-side. Never decode the
  // payload manually — that accepts any forged token.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.getUser(jwt)
  const user = data?.user
  if (error || !user) return fail(401, 'invalid_token', origin)
  if (user.id !== ALLOWED_USER_ID) {
    console.warn('rejected non-allowlisted user', { attempted: user.id })
    return fail(403, 'forbidden_user', origin)
  }

  let kind: string
  try {
    const body = await req.json() as { kind?: unknown }
    kind = typeof body.kind === 'string' ? body.kind : ''
  } catch {
    return fail(400, 'bad_body', origin)
  }
  const tokenType = KINDS[kind]
  if (!tokenType) return fail(400, 'unknown_kind', origin, `kind must be one of: ${Object.keys(KINDS).join(', ')}`)

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), VENDOR_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/single-use-token/${tokenType}`, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      signal: ctl.signal,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      console.error('vendor rejected mint', { tokenType, status: res.status })
      return fail(502, 'mint_failed', origin, `vendor_${res.status}: ${detail}`)
    }
    const json = await res.json() as { token?: string }
    if (typeof json.token !== 'string' || !json.token) {
      return fail(502, 'mint_failed', origin, 'vendor returned no token')
    }
    // Token only. It is single-use and expires in ~15 minutes on its own.
    return new Response(JSON.stringify({ token: json.token }), {
      headers: { ...cors(origin), 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    console.error('mint failed', { tokenType, aborted })
    return fail(aborted ? 504 : 502, aborted ? 'mint_timeout' : 'mint_failed', origin)
  } finally {
    clearTimeout(timer)
  }
})
