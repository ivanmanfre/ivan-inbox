// inbox-claude — the broker between the inbox PWA and Ivan's Claude Code
// container. The inbox is a static bundle on public GitHub Pages, so it can
// never hold the upstream credential; this function does.
//
// Every control here is load-bearing and was specified by the cross-tenant
// skeptic in goal-runs/inbox-v2-revamp-2026-08-01/phase1-audit/skeptic-security.md.
// Read that before changing anything in this file. In particular:
//
//   The upstream runs Claude Code with bypassPermissions and Bash on a
//   container that holds every client's credentials on one filesystem. Pinning
//   the workspace does NOT sandbox a Bash turn. The allowlist check below is
//   therefore the only control actually containing this surface — not a
//   formality, not defence in depth. If it fails open, the whole design is void.
//
// Fails closed on every ambiguity: missing config, unverifiable token, wrong
// user, unparseable body.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
// The single user permitted to reach the container. Compared against user.id —
// never email (mutable) and never role alone (every signed-in user has 'authenticated').
const ALLOWED_USER_ID = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
const UPSTREAM_URL = Deno.env.get('RAILWAY_CLAUDE_URL')
const UPSTREAM_KEY = Deno.env.get('RAILWAY_CLAUDE_API_KEY')

// Scoped, not '*'. The bundle is served from GitHub Pages; localhost entries let
// `npm run preview` exercise the real broker during verification.
const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
]

// Bound what a turn may carry. The upstream POST /chat/stream never reads
// session_id, never touches CLIENT_SESSIONS and never passes --resume
// (main.py:773-866), so every streamed turn is a fresh CLI session and the only
// continuity that exists is the transcript the client replays here. Cap it so a
// long history cannot be used to push an unbounded payload at the container.
const MAX_PROMPT_CHARS = 12_000
const MAX_CONTEXT_CHARS = 24_000
// Upstream /chat hard-caps at 900s and dies past it; stay well under so the
// client sees a structured timeout instead of a dropped socket.
const UPSTREAM_TIMEOUT_MS = 240_000

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
  // Distinct machine-readable codes so the UI can say what actually went wrong
  // rather than the reference implementation's single "failed" string.
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', origin)

  // Config check first: an unset allowlist must refuse to serve, never fall
  // through to "no allowlist means everyone". That exact fail-open is what left
  // the upstream service unauthenticated (main.py:37,73-77) — see SECURITY-P0.md.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ALLOWED_USER_ID || !UPSTREAM_URL) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, anon: !!SUPABASE_ANON_KEY,
      allow: !!ALLOWED_USER_ID, upstream: !!UPSTREAM_URL,
    })
    return fail(503, 'broker_not_configured', origin)
  }

  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return fail(401, 'unauthenticated', origin)

  // Library-verified: getUser() validates the signature and expiry server-side.
  // Never decode the payload manually — the repo has precedent functions that
  // atob the middle segment and trust it, which accepts any forged token.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.getUser(jwt)
  const user = data?.user
  if (error || !user) return fail(401, 'invalid_token', origin)
  if (user.id !== ALLOWED_USER_ID) {
    console.warn('rejected non-allowlisted user', { attempted: user.id })
    return fail(403, 'forbidden_user', origin)
  }

  // The request type deliberately has no working_directory and no client_id.
  // Those two fields are the upstream's cross-tenant primitive: working_directory
  // is used raw as the cwd with no allowlist (main.py:89,656) and client_id makes
  // get_client_config() clone another client's repo and inject that client's n8n
  // credentials (main.py:256-270). They are never read from the caller and never
  // forwarded, so no caller can steer the container at another tenant.
  let body: { prompt?: unknown; context?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_json', origin)
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const context = typeof body.context === 'string' ? body.context : ''
  if (!prompt) return fail(400, 'empty_prompt', origin)
  if (prompt.length > MAX_PROMPT_CHARS) return fail(413, 'prompt_too_long', origin)
  if (context.length > MAX_CONTEXT_CHARS) return fail(413, 'context_too_long', origin)

  const upstreamBody = {
    prompt: context ? `${context}\n\n---\n\n${prompt}` : prompt,
    stream: true,
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(`${UPSTREAM_URL.replace(/\/$/, '')}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Sent unconditionally. The upstream currently does not enforce it
        // (SECURITY-P0.md), so this is forward-compatible: the day Ivan sets
        // API_KEY on Railway, this keeps working with no change here.
        ...(UPSTREAM_KEY ? { 'X-API-Key': UPSTREAM_KEY } : {}),
      },
      body: JSON.stringify(upstreamBody),
      signal: ctl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    const aborted = e instanceof Error && e.name === 'AbortError'
    return fail(aborted ? 504 : 502, aborted ? 'upstream_timeout' : 'upstream_unreachable',
      origin, e instanceof Error ? e.message.slice(0, 200) : undefined)
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer)
    const detail = upstream.body ? (await upstream.text().catch(() => '')).slice(0, 300) : ''
    return fail(502, 'upstream_error', origin, `status ${upstream.status} ${detail}`)
  }

  // Relay the SSE stream through untouched. Cancelling the client read aborts
  // the upstream fetch, which is what makes the UI's stop button real rather
  // than cosmetic — the upstream kills its process group on disconnect.
  const relay = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 200) : 'relay failed'
        controller.enqueue(new TextEncoder()
          .encode(`event: error\ndata: ${JSON.stringify({ error: 'relay_broken', detail: msg })}\n\n`))
      } finally {
        clearTimeout(timer)
        controller.close()
        reader.releaseLock()
      }
    },
    cancel() {
      clearTimeout(timer)
      ctl.abort()
    },
  })

  return new Response(relay, {
    headers: {
      ...cors(origin),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
