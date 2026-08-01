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
import { assembleSystemPrompt, MAX_SYSTEM_PROMPT_CHARS } from './assembler.ts'
import { DEPTH_BLOCK, DEPTH_BLOCK_CHARS } from './depth-block.ts'

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

// Re-exported from the assembler so there is one number, not two. The assembler
// runs its load-shed ladder against `MAX_SYSTEM_PROMPT_CHARS - DEPTH_BLOCK_CHARS`;
// the assertion below is the belt to that braces, and fails the turn rather than
// handing the container a payload nobody bounded.
export { MAX_SYSTEM_PROMPT_CHARS }

/**
 * The models this broker will forward, as a literal. Verified twice today against
 * the DEPLOYED upstream, not against documentation:
 *   - GET /v1/models returns opus-4-8, opus-4-7, opus-4-6, sonnet-4-6, haiku-4-5
 *   - MODEL_MAP in claude-code-railway/main.py:1230-1243 maps each of those to the
 *     CLI's short name (read-only; that repo is another task's to edit)
 * opus-4-6 is live and accepted upstream, so it is here — a picker that silently
 * omitted an available model would be its own small lie.
 *
 * ⚠ THE UPSTREAM DOES NOT ACCEPT `model` ON /chat/stream YET. ChatRequest
 * (main.py:78-88) has no such field and both /chat call sites hardcode
 * "--model", CLAUDE_MODEL. A separate, serialized task adds it. Until then this
 * allowlist governs what LEAVES the broker, and the honest-degrade path below is
 * what the operator actually sees.
 */
const ALLOWED_MODELS = [
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // The browser cannot read a response header it was not offered. These two are
    // how the UI learns which model the turn actually ran on and how much context
    // rode with it — facts it would otherwise have to invent.
    'Access-Control-Expose-Headers': 'x-broker-model, x-broker-context-chars, x-broker-context-shed',
    'Vary': 'Origin',
  }
}

/**
 * Does the DEPLOYED upstream accept a per-request `model` on /chat/stream?
 *
 * THE FAILURE THIS EXISTS TO PREVENT is not rejection — it is silent acceptance.
 * FastAPI's Pydantic models ignore unknown fields by default, so sending `model`
 * to today's `ChatRequest` returns 200, drops the field, and runs the turn on
 * whatever `CLAUDE_MODEL` the container booted with. The operator picks Haiku,
 * gets Opus, and nothing anywhere says so. A silent fallback is the one outcome
 * this plumbing may not have.
 *
 * MEASURED TODAY, 2026-08-01: the upstream's `/openapi.json` 302s to `/login`, so
 * the schema is not readable from here, and `ChatRequest` (main.py:78-88) has no
 * `model` field — both `/chat` call sites hardcode `"--model", CLAUDE_MODEL`
 * (main.py:677, 807). Support is therefore FALSE and the probe cannot see it.
 *
 * So capability is decided fail-closed by two independent signals, either of which
 * is sufficient and neither of which is assumed:
 *   1. `UPSTREAM_MODEL_PASSTHROUGH=true` on the broker — the switch the serialized
 *      Railway task's owner flips once `model` actually lands upstream. Unset
 *      today, deliberately, and NOT set by this run.
 *   2. the upstream's own OpenAPI schema showing the field, if it ever becomes
 *      readable — an automatic upgrade path that needs no deploy here.
 *
 * Returns true / false / null (probe failed and no flag — unknown, never "yes").
 */
let modelCapCache: { at: number; value: boolean } | null = null
const MODEL_CAP_TTL_MS = 60_000

async function upstreamAcceptsModel(base: string): Promise<boolean | null> {
  if (Deno.env.get('UPSTREAM_MODEL_PASSTHROUGH') === 'true') return true
  if (modelCapCache && Date.now() - modelCapCache.at < MODEL_CAP_TTL_MS) return modelCapCache.value
  try {
    const res = await fetch(`${base}/openapi.json`, { signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return null
    const doc = await res.json() as {
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> }
    }
    const props = doc.components?.schemas?.ChatRequest?.properties
    if (!props) return null
    const value = Object.prototype.hasOwnProperty.call(props, 'model')
    modelCapCache = { at: Date.now(), value }
    return value
  } catch {
    return null // unreachable schema is UNKNOWN, and unknown is not "yes"
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
  //
  // `model` IS read from the caller, and is the only new caller-steerable field.
  // It is safe in a way working_directory and client_id are not: it is validated
  // against a literal allowlist of five model IDs and can address nothing. It
  // cannot name a path, a tenant, a repo or a credential.
  let body: { prompt?: unknown; context?: unknown; model?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_json', origin)
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const context = typeof body.context === 'string' ? body.context : ''
  const wantModel = typeof body.model === 'string' ? body.model.trim() : ''
  if (!prompt) return fail(400, 'empty_prompt', origin)
  if (prompt.length > MAX_PROMPT_CHARS) return fail(413, 'prompt_too_long', origin)
  if (context.length > MAX_CONTEXT_CHARS) return fail(413, 'context_too_long', origin)

  const upstreamBase = UPSTREAM_URL.replace(/\/$/, '')

  // ---- model: validate, then verify, then forward. Never two of the three. ----
  if (wantModel && !(ALLOWED_MODELS as readonly string[]).includes(wantModel)) {
    return fail(400, 'model_not_allowed', origin, `known models: ${ALLOWED_MODELS.join(', ')}`)
  }
  if (wantModel) {
    const supported = await upstreamAcceptsModel(upstreamBase)
    if (supported === false) {
      return fail(409, 'model_not_supported_upstream', origin,
        'The container accepts no per-request model on /chat/stream yet; it would run this turn ' +
        'on its boot-time default and report nothing. Refusing rather than pretending.')
    }
    if (supported === null) {
      return fail(409, 'model_support_unknown', origin,
        'The container schema is not readable from here (/openapi.json redirects to /login) and ' +
        'UPSTREAM_MODEL_PASSTHROUGH is not set, so the broker cannot confirm a per-request model ' +
        'would be honoured. As of 2026-08-01 it would not be: ChatRequest has no model field. ' +
        'Refusing rather than running the turn on an unknown model.')
    }
  }

  // ---- the brain: assembled fresh per turn, appended as system prompt ---------
  // PARITY-SPEC + DEPTH-SPEC. Fails CLOSED: the conditions the assembler throws on
  // are a missing service key, a cross-tenant row, MEMORY.md unreachable with no
  // cached assembly, and over-cap after the full shed ladder. None of those are
  // states a turn should quietly run without.
  let appendSystemPrompt: string
  let contextChars = 0
  let contextShed: string[] = []
  try {
    const assembled = await assembleSystemPrompt({
      env: (k) => Deno.env.get(k),
      reserveChars: DEPTH_BLOCK_CHARS,
    })
    appendSystemPrompt = `${assembled.text}\n\n${DEPTH_BLOCK}`
    contextChars = appendSystemPrompt.length
    contextShed = assembled.shed
  } catch (e) {
    console.error('context assembly failed', e)
    return fail(503, 'context_assembly_failed', origin,
      e instanceof Error ? e.message.slice(0, 300) : undefined)
  }
  // The assembler already reserved the depth block, so this can only trip if the
  // two files disagree. Assert it anyway — a payload nobody bounded is exactly
  // what the cap exists to prevent.
  if (appendSystemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
    console.error('assembled prompt over cap', { chars: appendSystemPrompt.length })
    return fail(500, 'context_over_cap', origin,
      `${appendSystemPrompt.length} > ${MAX_SYSTEM_PROMPT_CHARS}`)
  }

  const upstreamBody = {
    prompt: context ? `${context}\n\n---\n\n${prompt}` : prompt,
    stream: true,
    append_system_prompt: appendSystemPrompt,
    ...(wantModel ? { model: wantModel } : {}),
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(`${upstreamBase}/chat/stream`, {
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
      // What the turn ACTUALLY ran on. Empty when the caller named no model, which
      // means the container's boot-time default — a thing this broker cannot read,
      // so it says "default" rather than guessing a name.
      'X-Broker-Model': wantModel || 'container-default',
      'X-Broker-Context-Chars': String(contextChars),
      'X-Broker-Context-Shed': contextShed.join(',') || 'none',
    },
  })
})
