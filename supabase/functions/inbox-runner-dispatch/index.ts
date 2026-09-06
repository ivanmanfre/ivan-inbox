// inbox-runner-dispatch — the browser's only door to the Claude runner.
//
// The runner is a second Railway service holding a full mirror of Ivan's
// ~/.claude, every working repo with push rights, and Claude Code logged in on
// his subscription, running jobs with `--permission-mode bypassPermissions`.
// A key that reaches that box is a key that runs arbitrary code on a filesystem
// carrying every client's credentials. The inbox is a static bundle on public
// GitHub Pages, so it can never hold that key: THIS function does, and it is the
// only thing that ever speaks to the runner.
//
// Every control here is inbox-claude's, deliberately byte-for-byte where it can
// be (the CORS allowlist, the getUser + single-operator check, the fail-closed
// config gate, the model allowlist). Read that file's header before changing
// anything here: the reasoning is the same reasoning, at a longer time scale.
//
// Fails closed on every ambiguity: missing config, unverifiable token, wrong
// user, unparseable body, unreachable runner.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
// The single user permitted to reach the runner. Compared against user.id —
// never email (mutable) and never role alone (every signed-in user has
// 'authenticated'). Shared with inbox-claude: one operator, one allowlist.
const ALLOWED_USER_ID = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
// The runner's public domain and its API key. RUNNER_URL is absent until the
// service has a domain; a POST still queues a job (the executor polls the table,
// it is not called), and only the two proxied reads degrade.
const RUNNER_URL = Deno.env.get('RUNNER_URL')
const RUNNER_KEY = Deno.env.get('RUNNER_KEY')

// Scoped, not '*'. The bundle is served from GitHub Pages; localhost entries let
// `npm run preview` exercise the real function during verification.
const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
  'http://localhost:5431',
]

// The same four ids inbox-claude forwards. A job's model reaches a CLI flag on
// the runner, so it is validated against a literal for the same reason: it must
// be unable to name a path, a repo, a tenant or a credential.
const ALLOWED_MODELS = [
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
] as const

// A prompt job's text, or a goal job's spec path. Larger than inbox-claude's
// 12k because a goal launcher can carry a whole brief, and still bounded: the
// row is read back into a phone.
const MAX_INPUT_CHARS = 20_000
const MAX_CWD_CHARS = 300
// The runner is a container that can be cold. Ten seconds is long enough for a
// warm answer and short enough that a dead runner does not hang the pane.
const RUNNER_TIMEOUT_MS = 10_000

function cors(origin: string | null): Record<string, string> {
  // Any localhost port is a preview of this app on the operator's own machine;
  // the production origin stays the single GitHub Pages host.
  const isLocal = !!origin && /^http:\/\/localhost:\d{4,5}$/.test(origin)
  const allowed = origin && (ALLOWED_ORIGINS.includes(origin) || isLocal) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function fail(status: number, code: string, origin: string | null, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  })
}

function ok(body: unknown, origin: string | null, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  })
}

/**
 * One keyed GET against the runner, relayed as JSON.
 *
 * The key never leaves this isolate. An unreachable runner is 503
 * `runner_unreachable` rather than a 200 with an empty list: a spec picker that
 * silently showed nothing would read as "you have no goal specs", which is a
 * different and false statement.
 */
async function proxyRunner(path: string, origin: string | null): Promise<Response> {
  if (!RUNNER_URL || !RUNNER_KEY) {
    return fail(503, 'runner_not_configured', origin,
      'The runner has no public domain on this function yet.')
  }
  const base = RUNNER_URL.replace(/\/$/, '')
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { 'x-runner-key': RUNNER_KEY },
      signal: AbortSignal.timeout(RUNNER_TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) {
      // A Railway domain that exists with nothing deployed behind it answers
      // 404 "Application not found" from the EDGE, not from the runner. That is
      // the same fact as a refused socket — the runner is not there — and the
      // pane should say so in those words rather than print a proxy's status
      // code. Anything else (401 on the key, a 500 out of the app itself) is a
      // runner that IS there and answered badly, which is a different sentence.
      const absent = res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504
      return fail(absent ? 503 : 502, absent ? 'runner_unreachable' : 'runner_error', origin,
        `status ${res.status} ${text.slice(0, 300)}`)
    }
    return new Response(text, {
      status: 200,
      headers: { ...cors(origin), 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : undefined
    return fail(503, 'runner_unreachable', origin, detail)
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST' && req.method !== 'GET') return fail(405, 'method_not_allowed', origin)

  // Config check first: an unset allowlist must refuse to serve, never fall
  // through to "no allowlist means everyone".
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ALLOWED_USER_ID || !SERVICE_KEY) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, anon: !!SUPABASE_ANON_KEY,
      allow: !!ALLOWED_USER_ID, service: !!SERVICE_KEY,
    })
    return fail(503, 'dispatch_not_configured', origin)
  }

  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return fail(401, 'unauthenticated', origin)

  // Library-verified: getUser() validates the signature and expiry server-side.
  // Never decode the payload manually — a hand-parsed JWT accepts any forgery.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.getUser(jwt)
  const user = data?.user
  if (error || !user) return fail(401, 'invalid_token', origin)
  if (user.id !== ALLOWED_USER_ID) {
    console.warn('rejected non-allowlisted user', { attempted: user.id })
    return fail(403, 'forbidden_user', origin)
  }

  // ---- reads: the two things the browser is allowed to learn about the box --
  if (req.method === 'GET') {
    const u = new URL(req.url)
    if (u.searchParams.get('specs')) return await proxyRunner('/jobs/specs', origin)
    if (u.searchParams.get('health')) return await proxyRunner('/health', origin)
    return fail(400, 'unknown_query', origin, 'expected ?specs=1 or ?health=1')
  }

  let body: { kind?: unknown; input?: unknown; cwd?: unknown; model?: unknown; cancel?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_json', origin)
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ---- cancel: the one narrow write, scoped to this user's open jobs --------
  // The executor sees the flip on its next poll and SIGTERMs the process; the
  // row is already honest before that happens, which is what the pane renders.
  if (typeof body.cancel === 'string' && body.cancel.trim()) {
    const id = body.cancel.trim()
    const { data: rows, error: cancelErr } = await db
      .from('runner_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .in('status', ['queued', 'running'])
      .select('id, status')
    if (cancelErr) return fail(500, 'cancel_failed', origin, cancelErr.message.slice(0, 200))
    if (!rows || rows.length === 0) {
      // Either it is not his, or it already finished. Both are "there is
      // nothing here to stop", and neither is worth telling him which.
      return fail(404, 'job_not_cancellable', origin, 'no queued or running job of yours with that id')
    }
    return ok({ id, status: 'cancelled' }, origin)
  }

  // ---- dispatch ------------------------------------------------------------
  const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
  if (kind !== 'prompt' && kind !== 'goal') {
    return fail(400, 'bad_kind', origin, "kind must be 'prompt' or 'goal'")
  }
  const input = typeof body.input === 'string' ? body.input.trim() : ''
  if (!input) return fail(400, 'empty_input', origin)
  if (input.length > MAX_INPUT_CHARS) return fail(413, 'input_too_long', origin, `max ${MAX_INPUT_CHARS}`)

  const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
  if (cwd.length > MAX_CWD_CHARS) return fail(413, 'cwd_too_long', origin, `max ${MAX_CWD_CHARS}`)

  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (model && !(ALLOWED_MODELS as readonly string[]).includes(model)) {
    return fail(400, 'model_not_allowed', origin, `known models: ${ALLOWED_MODELS.join(', ')}`)
  }

  const { data: row, error: insErr } = await db
    .from('runner_jobs')
    .insert({
      user_id: user.id,
      kind,
      input,
      cwd: cwd || null,
      model: model || null,
      // Left at the table default 'queued'. The executor owns every later
      // status, so writing one here would be this function claiming a fact
      // about a process it has not started.
    })
    .select('id, status, created_at')
    .single()
  if (insErr || !row) return fail(500, 'job_create_failed', origin, insErr?.message.slice(0, 200))

  return ok({ id: row.id, status: row.status, created_at: row.created_at }, origin, 201)
})
