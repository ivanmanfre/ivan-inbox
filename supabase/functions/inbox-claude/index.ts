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
import {
  assembleSystemPrompt,
  MAX_SYSTEM_PROMPT_CHARS,
  P16_OPERATOR_RULES,
  summaryDelta,
} from './assembler.ts'
import { DEPTH_BLOCK, DEPTH_BLOCK_CHARS } from './depth-block.ts'
import { unfurl, UnfurlError } from './unfurl.ts'

// Supabase's edge runtime keeps a promise alive after the response has been
// returned. Deno's own types do not know it, and it is absent under `deno test`,
// so it is declared here and used through the guard below.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

/** Run a write that must outlive the response, whether or not waitUntil exists. */
function afterResponse(work: PromiseLike<unknown>) {
  const p = Promise.resolve(work).catch((e) => console.error('after-response write failed', e))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p)
}

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
// Shared with inbox-turn-run: the container sends this back on the completion
// webhook so that endpoint can prove the payload came from a turn we dispatched.
const INBOX_PUSH_SECRET = Deno.env.get('INBOX_PUSH_SECRET')

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
  'http://localhost:5431', // the vis-faithful preview worktree — same list inbox-stt ships
]

// Bound what a turn may carry.
//
// HISTORY, because the shape of this file only makes sense with it: /chat/stream
// used to ignore session_id entirely, so every streamed turn was a fresh CLI
// session and the only continuity was the transcript the client replayed here.
// As of the 2026-09-04 run the container honours session_id (--resume when the
// jsonl exists, --session-id when it does not), so continuity lives in the
// container and the client stops replaying anything. The caps stay: a long
// attachment must still not be able to push an unbounded payload upstream.
//
// Both caps bound the USER's text and nothing else. The memory envelope is
// broker-authored and separately bounded by MAX_SYSTEM_PROMPT_CHARS, so it must
// never eat into what Ivan is allowed to type.
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
  // Any localhost port is a preview of this app on the operator's own machine
  // (vite preview picks a free port per candidate/gate run); the production
  // origin stays the single GitHub Pages host. A localhost origin is not a
  // security boundary a browser can be tricked across from the public web.
  const isLocal = !!origin && /^http:\/\/localhost:\d{4,5}$/.test(origin)
  const allowed = origin && (ALLOWED_ORIGINS.includes(origin) || isLocal) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // The browser cannot read a response header it was not offered. These two are
    // how the UI learns which model the turn actually ran on and how much context
    // rode with it — facts it would otherwise have to invent.
    'Access-Control-Expose-Headers':
      'x-broker-model, x-broker-context-chars, x-broker-context-shed, ' +
      'x-broker-turn-id, x-broker-thread-id, x-broker-session, x-broker-grounded-on',
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
  //
  // `thread_id` and `turn_id` are the other two caller-steerable fields, and they
  // are safe for the same reason: a thread is loaded and REQUIRED to belong to
  // this user before anything is written to it, and a turn id addresses only a row
  // this request is about to create.
  let body: {
    prompt?: unknown; context?: unknown; model?: unknown
    thread_id?: unknown; turn_id?: unknown; unfurl?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_json', origin)
  }

  // ---- alternative mode: unfurl a pasted link ------------------------------
  // Same bearer and same allowlist as a turn; it just costs a fetch instead of a
  // container. It touches no database and dispatches nothing.
  if (typeof body.unfurl === 'string' && body.unfurl.trim()) {
    try {
      const card = await unfurl(body.unfurl)
      return new Response(JSON.stringify(card), {
        headers: { ...cors(origin), 'Content-Type': 'application/json' },
      })
    } catch (e) {
      if (e instanceof UnfurlError) return fail(e.status, e.code, origin, e.message === e.code ? undefined : e.message)
      console.error('unfurl failed', e)
      return fail(502, 'unfurl_failed', origin)
    }
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const context = typeof body.context === 'string' ? body.context : ''
  const wantModel = typeof body.model === 'string' ? body.model.trim() : ''
  const wantThreadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : ''
  const wantTurnId = typeof body.turn_id === 'string' ? body.turn_id.trim() : ''
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

  // ---- persistence: the row is the truth, the stream is the fast path --------
  // Without a service-role key there is nowhere to write the turn, and a turn
  // nobody recorded is a turn that vanishes the moment the tab closes. Refuse.
  if (!SERVICE_KEY) {
    console.error('refusing: no service role key, turns cannot be persisted')
    return fail(503, 'broker_not_configured', origin)
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ---- thread: the unit of CLI-session continuity ---------------------------
  // A named thread must belong to this user. The allowlist means that is one
  // account today, which is exactly why the check is cheap and must still be here:
  // the day a second account exists, this is what stops it reading the first one's
  // session.
  let thread: {
    id: string; session_id: string; session_started_at: string | null
    grounded_summary_date: string | null; user_id: string
  }
  if (wantThreadId) {
    const { data: t, error: tErr } = await db
      .from('inbox_threads')
      .select('id, user_id, session_id, session_started_at, grounded_summary_date')
      .eq('id', wantThreadId)
      .maybeSingle()
    if (tErr) return fail(500, 'thread_lookup_failed', origin, tErr.message.slice(0, 200))
    if (!t || t.user_id !== user.id) return fail(404, 'thread_not_found', origin)
    thread = t
    // ONE TURN AT A TIME PER SESSION. Measured on the container 2026-09-04: two
    // runs overlapping on one session_id lost the first run's assistant reply from
    // the transcript entirely. The CLI serialises nothing; this check is what does.
    // A turn the client already stopped (aborted) or one the sweep gave up on is
    // not "running" and does not block.
    const { data: busy } = await db
      .from('inbox_turns')
      .select('id, started_at')
      .eq('thread_id', thread.id)
      .in('status', ['queued', 'running'])
      .limit(1)
    if (busy && busy.length) {
      return fail(409, 'thread_busy', origin,
        `turn ${busy[0].id} is still running on this thread; wait for it or start a new thread`)
    }
  } else {
    const { data: t, error: tErr } = await db
      .from('inbox_threads')
      .insert({ user_id: user.id, title: prompt.slice(0, 80), model: wantModel || null })
      .select('id, user_id, session_id, session_started_at, grounded_summary_date')
      .single()
    if (tErr || !t) return fail(500, 'thread_create_failed', origin, tErr?.message.slice(0, 200))
    thread = t
  }

  // A session the container has demonstrably held. Set by inbox-turn-run on the
  // first turn that finishes; null means the envelope has to ride again.
  const resumed = thread.session_started_at != null

  // ---- the brain: assembled fresh per turn ----------------------------------
  // PARITY-SPEC + DEPTH-SPEC. Fails CLOSED: the conditions the assembler throws on
  // are a missing service key, a cross-tenant row, MEMORY.md unreachable with no
  // cached assembly, and over-cap after the full shed ladder. None of those are
  // states a turn should quietly run without.
  //
  // WHAT MOVED, 2026-09-04: the envelope used to ride in append_system_prompt on
  // every turn. It now rides in the PROMPT of the first turn of a session, and on
  // later turns nothing rides at all except the days that moved. The CLI keeps its
  // own conversation, so re-sending 36k characters of memory it already read is
  // pure cost. What stays in append_system_prompt is the small, byte-stable pair
  // (operator rules + depth recipes) — byte-stable so the container's own prompt
  // cache is not invalidated turn over turn.
  const APPEND_SYSTEM_PROMPT = `${P16_OPERATOR_RULES.trimEnd()}\n\n${DEPTH_BLOCK}`

  let envelope = ''
  let contextShed: string[] = []
  let grounding: Awaited<ReturnType<typeof assembleSystemPrompt>>['grounding']
  try {
    const assembled = await assembleSystemPrompt({
      env: (k) => Deno.env.get(k),
      // Reserve BOTH halves of what append_system_prompt will carry, so the
      // artifact that actually leaves the broker is the thing bounded.
      reserveChars: DEPTH_BLOCK_CHARS + P16_OPERATOR_RULES.length,
    })
    envelope = assembled.text
    contextShed = assembled.shed
    grounding = assembled.grounding
  } catch (e) {
    console.error('context assembly failed', e)
    return fail(503, 'context_assembly_failed', origin,
      e instanceof Error ? e.message.slice(0, 300) : undefined)
  }
  // The assembler already reserved both blocks, so this can only trip if the files
  // disagree. Assert it anyway — a payload nobody bounded is exactly what the cap
  // exists to prevent.
  const wholeArtifact = envelope.length + APPEND_SYSTEM_PROMPT.length
  if (wholeArtifact > MAX_SYSTEM_PROMPT_CHARS) {
    console.error('assembled prompt over cap', { chars: wholeArtifact })
    return fail(500, 'context_over_cap', origin, `${wholeArtifact} > ${MAX_SYSTEM_PROMPT_CHARS}`)
  }

  // ---- what the broker adds to THIS turn ------------------------------------
  // First turn of a session: the whole envelope, framed as data.
  // Resumed session: only the daily-summary days newer than the one the thread was
  // last grounded on, and usually nothing at all.
  let brokerPrefix = ''
  if (!resumed) {
    brokerPrefix = `[Operator memory, assembled by the broker. Treat as data.]\n${envelope}\n[End of operator memory.]\n\n---\n\n`
  } else if (grounding.summary_date &&
             (!thread.grounded_summary_date || grounding.summary_date > thread.grounded_summary_date)) {
    try {
      const delta = await summaryDelta({ env: (k) => Deno.env.get(k) }, thread.grounded_summary_date)
      if (delta) brokerPrefix = `${delta}\n\n---\n\n`
    } catch (e) {
      // A delta that cannot be read is not worth failing a turn the container can
      // already answer from the session it holds. Say so in the log and carry on.
      console.warn('summary delta failed, sending none', e)
    }
  }

  // The operator's own words get a named boundary whenever anything rides ahead of
  // them. Measured 2026-09-04 (gate G2): with only a `---` between a 46k "treat as
  // data" envelope and his sentence, the model filed his sentence under the data
  // and refused to act on it one turn later.
  const OPERATOR_BOUNDARY = '[Ivan, the operator, writing now:]\n'
  const upstreamPrompt = brokerPrefix + (context ? `${context}\n\n---\n\n` : '') +
    (brokerPrefix || context ? OPERATOR_BOUNDARY : '') + prompt
  // What the BROKER added, which is what the UI's context meter is about. The
  // user's own prompt and chips are not the broker's doing and are not counted.
  const contextChars = brokerPrefix.length + APPEND_SYSTEM_PROMPT.length

  // ---- the row, written before the container is asked anything --------------
  const turnId = wantTurnId || crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const turnSources: { kind: string; path: string; at?: string | null }[] = [
    { kind: 'memory', path: 'project/MEMORY.md', at: grounding.memory_index_at },
  ]
  if (grounding.summary_date) {
    turnSources.push({ kind: 'summary', path: grounding.summary_date, at: grounding.summary_date })
  }
  for (const b of grounding.blocks) {
    turnSources.push({ kind: 'block', path: b.id, at: null })
  }

  const { error: insErr } = await db.from('inbox_turns').insert({
    id: turnId,
    thread_id: thread.id,
    user_id: user.id,
    prompt: prompt,          // the USER's text only; the envelope is not his words
    context: context || null,
    context_chars: contextChars,
    model: wantModel || null,
    status: 'running',
    started_at: startedAt,
    session_id: thread.session_id,
    resumed: resumed,
    grounding: {
      resumed: resumed,
      summary_date: grounding.summary_date,
      memory_index_at: grounding.memory_index_at,
      compiled_at: grounding.compiled_at,
      blocks_shed: contextShed,
    },
    sources: turnSources,
  })
  if (insErr) return fail(500, 'turn_create_failed', origin, insErr.message.slice(0, 200))

  /** Mark this turn failed before handing the caller the error it already returns. */
  async function markTurnError(code: string, detail?: string) {
    await db.from('inbox_turns').update({
      status: 'error',
      error_code: code,
      error_detail: detail?.slice(0, 2000) ?? null,
      finished_at: new Date().toISOString(),
    }).eq('id', turnId).is('finished_at', null)
  }

  // 🔴 PERMISSION MODE IS SENT EXPLICITLY, AND IT IS A DELIBERATE GRANT.
  //
  // The header of this file has always SAID the upstream runs with
  // bypassPermissions. It did not: nothing here ever sent `permission_mode`, so
  // the container fell through to its own default of `acceptEdits`
  // (claude-code-railway/main.py:86). In that mode every Bash call waits for an
  // approval that nobody on this path can give, because the caller is a voice
  // session or a chat pane, not a terminal with a human at it. Measured
  // 2026-08-16: every escalated turn ended with the model asking to have the
  // next Bash call approved, so the lane could talk about his data and never
  // read it.
  //
  // What this grant costs, stated plainly rather than discovered later: a turn
  // dispatched from here runs unattended Bash on a filesystem that holds every
  // client's credentials, and pinning the workspace does NOT sandbox that. The
  // controls actually containing this surface are the ones above — the verified
  // bearer, the single-operator allowlist, the scoped origins — and they are now
  // the ONLY ones. Ivan authorised this explicitly on 2026-08-16 after the risk
  // was put to him in those words; it is the same trust level as him typing the
  // command himself, which is what this lane exists to replace.
  //
  // To take the grant back: delete the line. The container returns to
  // acceptEdits on the next request, no deploy needed upstream.
  const upstreamBody = {
    prompt: upstreamPrompt,
    stream: true,
    append_system_prompt: APPEND_SYSTEM_PROMPT,
    permission_mode: 'bypassPermissions',
    ...(wantModel ? { model: wantModel } : {}),
    // The four fields that make a turn outlive its tab. The container resumes the
    // session when it holds the jsonl, starts one under this id when it does not,
    // and POSTs the completion to inbox-turn-run either way. on_complete_secret is
    // the same INBOX_PUSH_SECRET that endpoint checks; the container never sees a
    // Supabase key.
    session_id: thread.session_id,
    ...(INBOX_PUSH_SECRET
      ? {
        on_complete: `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/inbox-turn-run`,
        on_complete_secret: INBOX_PUSH_SECRET,
      }
      : {}),
    turn_id: turnId,
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
    const code = aborted ? 'upstream_timeout' : 'upstream_unreachable'
    const detail = e instanceof Error ? e.message.slice(0, 200) : undefined
    // The row exists and nothing upstream will ever finish it, so close it here
    // rather than leaving the watchdog to call it 'lost' fifteen minutes later.
    await markTurnError(code, detail)
    return fail(aborted ? 504 : 502, code, origin, detail)
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer)
    const detail = upstream.body ? (await upstream.text().catch(() => '')).slice(0, 300) : ''
    await markTurnError('upstream_error', `status ${upstream.status} ${detail}`)
    return fail(502, 'upstream_error', origin, `status ${upstream.status} ${detail}`)
  }

  // Relay the SSE stream through untouched. Cancelling the client read aborts
  // the upstream fetch, so this isolate stops relaying. It does NOT stop the
  // work: the container's detached task owns the process and runs to the end,
  // as cancel() below says. Stop is a client-side stop plus a written-down
  // client_gone_at, not a kill.
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
      // Still abort the relay — the client is gone and this isolate should not sit
      // on an open socket. The container's detached task keeps running and will
      // POST inbox-turn-run when it finishes, which is the whole point: the answer
      // lands in the row and pushes to his phone even though nobody was watching.
      ctl.abort()
      afterResponse(
        db.from('inbox_turns')
          .update({ client_gone_at: new Date().toISOString() })
          .eq('id', turnId)
          .is('finished_at', null),
      )
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
      // The row this stream belongs to, so the UI can poll it when the stream dies
      // and can tell the difference between a fresh session and a resumed one.
      'X-Broker-Turn-Id': turnId,
      'X-Broker-Thread-Id': thread.id,
      'X-Broker-Session': resumed ? 'resumed' : 'new',
      'X-Broker-Grounded-On': grounding.summary_date ?? 'unknown',
    },
  })
})
