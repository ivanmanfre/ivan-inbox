// A request that never answers must end (Ivan 10-21, Diane O'Brien: the WebKit network process wedged,
// one awaited write never settled, `busy` never cleared and Send stayed grey in every thread until a
// relaunch). The supabase client's fetch goes through `timedFetch`, so every database read and write
// settles: with the server's answer, or with a NoAnswer error the screen can name.
//
// What it does NOT touch: a request that already carries its own AbortSignal (the caller owns its clock),
// and anything outside the database API (/functions, /storage, /realtime: uploads and edge functions
// set their own, longer limits). Auth gets a backstop too: a token refresh that hangs holds the auth
// lock, and every database call waits on that lock.

export const NO_ANSWER = 'No answer from the server'

/** Writes: the authenticated role's statement_timeout is 8 s, so 20 s is a hung connection, not a slow query. */
export const WRITE_MS = 20_000
/** Reads (GET/HEAD, including read RPCs): a backstop only. The DMs reads keep their own shorter clocks. */
export const READ_MS = 30_000
/** Auth (token refresh, magic link): auth-js retries a failed refresh on its own. */
export const AUTH_MS = 30_000
/** RPCs whose own statement_timeout is 15-20 s (pg_proc.proconfig, 2026-10-21): 20 s would cut them. */
export const SLOW_RPC_MS = 45_000
const SLOW_RPCS = new Set([
  'swishdm_set_buffer_visibility', 'inbox_phone_ranked_ideas_r2', 'operator_ranked_ideas', 'content_plan_week',
  'cb33_results', 'cb33_draft_reads', 'cb34_scoreboard', 'cb34_repeat_engagers', 'cb34_outlier_labels',
  'cb34_outlier_label_set', 'cb34_outlier_label_undo', 'cb39_verdicts', 'cb39_to_judge', 'cb39_verdict_set',
  'hot_now_skip', 'hot_now_cards',
])

/** Named AbortError so postgrest-js neither retries it nor reads it as a server answer. */
export class NoAnswerError extends Error {
  constructor(ms: number) { super(`${NO_ANSWER} in ${Math.round(ms / 1000)}s.`); this.name = 'AbortError' }
}

/** True for a timed-out request, thrown or handed back as a supabase-js `{ message }` error. */
export function isNoAnswer(e: unknown): boolean {
  if (e instanceof NoAnswerError) return true
  const m = e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : ''
  return m.includes(NO_ANSWER)
}

const urlOf = (input: RequestInfo | URL) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/** How long this request may wait, or null to leave it alone. */
export function deadlineFor(input: RequestInfo | URL, init?: RequestInit): number | null {
  if (init?.signal) return null
  const url = urlOf(input)
  if (/\/auth\/v1\//.test(url)) return AUTH_MS
  if (!/\/rest\/v1\//.test(url)) return null
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
  if (method === 'GET' || method === 'HEAD') return READ_MS
  const rpc = url.match(/\/rest\/v1\/rpc\/([^/?#]+)/)?.[1]
  return rpc && SLOW_RPCS.has(rpc) ? SLOW_RPC_MS : WRITE_MS
}

/** The supabase client's fetch. Races the request against its deadline, so it settles even when an
 *  abort is not honoured (a wedged network process), and aborts the request so it is not left open. */
export function timedFetch(input: RequestInfo | URL, init?: RequestInit, base: typeof fetch = globalThis.fetch): Promise<Response> {
  const ms = deadlineFor(input, init)
  if (ms === null) return base(input, init)
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const e = new NoAnswerError(ms); reject(e); ctl.abort(e) }, ms)
  })
  const req = base(input, { ...init, signal: ctl.signal })
  req.catch(() => {})
  return Promise.race([req, late]).finally(() => clearTimeout(timer))
}

/** Bound one call by its own, shorter clock (a check after a no-answer must not wait a full minute). */
export function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>, ms: number): Promise<T> {
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const e = new NoAnswerError(ms); reject(e); ctl.abort(e) }, ms)
  })
  const run = Promise.resolve(work(ctl.signal))
  run.catch(() => {})
  return Promise.race([run, late]).finally(() => clearTimeout(timer))
}
