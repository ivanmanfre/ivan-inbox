// inbox-rt-session — mints EPHEMERAL OpenAI Realtime client secrets for the browser.
//
// WHY THIS EXISTS. The live-conversation loop moves from a three-vendor cascade
// (ElevenLabs STT → inbox-fast → speechSynthesis, endpointed by an energy VAD
// and a silence timer) to ONE speech-to-speech session. The browser opens a
// WebRTC peer connection straight to OpenAI so audio never takes an extra hop,
// which means the browser needs a credential — and it must never be the real
// key. OpenAI's answer is an ephemeral client secret: the server mints it with
// the real key, the browser spends it on one call, and it expires on its own.
//
// AUTH mirrors inbox-rt-token/index.ts EXACTLY — same bearer verification via
// supabase.auth.getUser, same single-operator allowlist, same scoped CORS
// origin list, same vendor timeout. Every control fails CLOSED.
//
// THE FLOW this credential serves (docs: /api/docs/guides/realtime-webrtc):
//   1. browser POSTs here, gets { value, expires_at, model }
//   2. browser builds an RTCPeerConnection, adds the mic track, opens a data
//      channel named `oai-events`
//   3. browser POSTs its SDP offer to https://api.openai.com/v1/realtime/calls
//      with `Authorization: Bearer <value>` and `Content-Type: application/sdp`
//   The safety identifier is bound to the token at mint time, so the browser
//   never sends one.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
// Its own secret if set, otherwise the broker's — one operator, one allowlist.
const ALLOWED_USER_ID = Deno.env.get('INBOX_RT_ALLOWED_USER_ID')
  ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')

// KILL SWITCH. This lane bills per minute of audio against a live budget, so it
// ships with an off switch from day one: set INBOX_RT_DISABLED=1 and every mint
// refuses. Cheaper than revoking a key, and reversible without a deploy.
const DISABLED = Deno.env.get('INBOX_RT_DISABLED') === '1'

// Pinned to the MINI model deliberately: $20/1M audio output tokens against
// $64 for full gpt-realtime-2.1, roughly a 3x gap on the dominant cost line.
// Override per-deploy if quality is ever proven to be the blocker — do not let
// the CLIENT choose the model, that is a spend decision.
const MODEL = Deno.env.get('INBOX_RT_MODEL') ?? 'gpt-realtime-2.1-mini'
const VOICE = Deno.env.get('INBOX_RT_VOICE') ?? 'marin'

// Scoped, not '*'. Mirrors inbox-rt-token's list (GitHub Pages + the vite ports).
const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
  'http://localhost:5431',
]

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

  if (DISABLED) return fail(503, 'rt_disabled', origin, 'realtime lane is switched off')

  const key = Deno.env.get('OPENAI_API_KEY')
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

  // The ONLY thing the caller may influence is the system instructions, and
  // only as a string it already owns. Model, voice and audio config are the
  // server's — they are the spend and the behaviour.
  let instructions = ''
  try {
    const body = await req.json().catch(() => ({})) as { instructions?: unknown }
    if (typeof body.instructions === 'string') instructions = body.instructions.slice(0, 8000)
  } catch {
    return fail(400, 'bad_body', origin)
  }

  const session: Record<string, unknown> = {
    type: 'realtime',
    model: MODEL,
    // Reasoning on speech-to-speech: OpenAI's own guidance is to start at low
    // effort for production voice agents and only raise it if the task needs it.
    // Latency is the whole point of this lane, so low it is.
    reasoning: { effort: 'low' },
    audio: {
      output: { voice: VOICE },
      // Transcribe the user's own audio too: the chat pane shows the words as
      // they are spoken (the 08-03 requirement — live interim, not blob-then-text)
      // and the transcript is what gets escalated to the workbench.
      input: { transcription: { model: 'gpt-live-transcribe' } },
    },
  }
  if (instructions) session.instructions = instructions

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), VENDOR_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        // Bound to the minted token, so the browser never sends it.
        'OpenAI-Safety-Identifier': `inbox-${user.id}`,
      },
      body: JSON.stringify({ session }),
      signal: ctl.signal,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      console.error('vendor rejected mint', { model: MODEL, status: res.status })
      return fail(502, 'mint_failed', origin, `vendor_${res.status}: ${detail}`)
    }
    const json = await res.json() as { value?: string; expires_at?: number }
    if (typeof json.value !== 'string' || !json.value) {
      return fail(502, 'mint_failed', origin, 'vendor returned no client secret')
    }
    // The secret, its expiry, and the model the client must NOT choose but does
    // need to know (it goes in the /v1/realtime/calls query).
    return new Response(JSON.stringify({
      value: json.value,
      expires_at: json.expires_at ?? null,
      model: MODEL,
    }), {
      headers: { ...cors(origin), 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    console.error('mint failed', { model: MODEL, aborted })
    return fail(aborted ? 504 : 502, aborted ? 'mint_timeout' : 'mint_failed', origin)
  } finally {
    clearTimeout(timer)
  }
})
