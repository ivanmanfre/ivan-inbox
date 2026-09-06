/* ==========================================================================
   src/wb/ask/jobs.ts — the Ask pane's half of the Claude runner.

   The runner is a second Railway service holding a mirror of the whole Mac
   setup: the skills, the hooks, the memory, every working repo with push
   rights, and Claude Code logged in on the same subscription. A job dispatched
   from here survives the phone being locked, the tab being closed and the
   MacBook being shut, and lands back as a row plus a push notification.

   Two halves, and they are deliberately asymmetric:

     WRITES go through `inbox-runner-dispatch`, always. The browser holds no
     runner key and has no insert grant on `runner_jobs` (db/050 gives
     `authenticated` exactly select + update(status)); a bundle on public
     GitHub Pages must not be one leaked build away from running arbitrary
     Claude on a box carrying every client's credentials.

     READS go straight to PostgREST and to realtime, under the row-level
     policy `runner_jobs_owner_read`. There is nothing to proxy: the rows are
     his own, and a function hop between the row and the card would only add a
     cold start to a card that is already watching a live subscription.
   ========================================================================== */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-runner-dispatch`

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type JobKind = 'prompt' | 'goal'

export type RunnerJob = {
  id: string
  kind: JobKind
  input: string
  cwd: string | null
  model: string | null
  status: JobStatus
  log: string | null
  report_path: string | null
  cost_usd: number | null
  ran_on: string | null
  error_detail: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

/** One goal spec the runner found on disk. */
export type GoalSpec = { path: string; name: string; mtime?: string; cwd?: string }

/** The columns the card actually draws. Naming them keeps a `select *` from
 * quietly widening what the browser pulls down every 20 rows. */
const JOB_COLUMNS =
  'id,kind,input,cwd,model,status,log,report_path,cost_usd,ran_on,error_detail,' +
  'started_at,finished_at,created_at,updated_at'

/** How many jobs the thread carries. Beyond this it is a history, not a thread. */
const JOB_LIMIT = 20

export function isOpen(s: JobStatus): boolean {
  return s === 'queued' || s === 'running'
}

/** A refusal with the function's own machine-readable code, never a stack. */
export class RunnerError extends Error {
  readonly code: string
  readonly status: number
  constructor(status: number, code: string, detail?: string) {
    super(detail || code)
    this.code = code
    this.status = status
  }
}

async function bearer(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new RunnerError(401, 'not_signed_in')
  return token
}

async function call(init: RequestInit & { query?: string }): Promise<unknown> {
  const token = await bearer()
  const { query, ...rest } = init
  let res: Response
  try {
    res = await fetch(FN_URL + (query ?? ''), {
      ...rest,
      headers: {
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(rest.headers ?? {}),
      },
    })
  } catch (e) {
    throw new RunnerError(0, 'dispatch_unreachable', e instanceof Error ? e.message : undefined)
  }
  const text = await res.text()
  let body: { error?: string; detail?: string } | unknown = null
  try { body = text ? JSON.parse(text) : null } catch { /* a non-JSON body is a proxy's, not ours */ }
  if (!res.ok) {
    const b = body as { error?: string; detail?: string } | null
    throw new RunnerError(res.status, b?.error ?? 'dispatch_failed', b?.detail)
  }
  return body
}

/** Queue one job. Returns its id, which is also its deep link. */
export async function dispatchJob(job: {
  kind: JobKind
  input: string
  cwd?: string | null
  model?: string | null
}): Promise<{ id: string }> {
  const out = await call({
    method: 'POST',
    body: JSON.stringify({
      kind: job.kind,
      input: job.input,
      ...(job.cwd ? { cwd: job.cwd } : {}),
      ...(job.model ? { model: job.model } : {}),
    }),
  })
  return out as { id: string }
}

/** Stop a job of his own that has not finished. */
export async function cancelJob(id: string): Promise<void> {
  await call({ method: 'POST', body: JSON.stringify({ cancel: id }) })
}

/**
 * The goal specs the runner can see, cached for a minute.
 *
 * The cache is here rather than in the component because the menu is opened,
 * closed and opened again while a job is being chosen, and each open must not
 * cost a cold edge function plus a container round trip. A FAILURE is cached
 * too, briefly, for the same reason — but it is cached as a failure, so the
 * menu says the runner could not be reached rather than showing an empty list
 * that reads as "you have no specs".
 */
type SpecCache = { at: number; specs: GoalSpec[] | null; error: RunnerError | null }
const SPEC_TTL_MS = 60_000
let specCache: SpecCache | null = null

export async function fetchSpecs(): Promise<GoalSpec[]> {
  if (specCache && Date.now() - specCache.at < SPEC_TTL_MS) {
    if (specCache.error) throw specCache.error
    if (specCache.specs) return specCache.specs
  }
  try {
    const out = await call({ method: 'GET', query: '?specs=1' })
    const specs = Array.isArray(out) ? (out as GoalSpec[]).filter(s => s && typeof s.path === 'string') : []
    specCache = { at: Date.now(), specs, error: null }
    return specs
  } catch (e) {
    const err = e instanceof RunnerError ? e : new RunnerError(0, 'specs_failed')
    specCache = { at: Date.now(), specs: null, error: err }
    throw err
  }
}

// ---------------------------------------------------------------------------
// The log.
//
// The executor appends raw stream-json frames, one JSON object per line. Those
// lines are for a machine; a card that printed them would be printing a
// transcript of a protocol. So the last few lines are RENDERED: an assistant
// text frame becomes its own sentence, a tool_use frame becomes the tool's
// name, a result frame becomes what it cost. A line this parser does not
// recognise is dropped rather than guessed at — a card is not the place to
// invent a summary of a frame nobody has read.
// ---------------------------------------------------------------------------

type Frame = {
  type?: string
  subtype?: string
  message?: { content?: unknown[]; model?: string }
  model?: string
  total_cost_usd?: number
  result?: string
}

function frameLine(f: Frame): string | null {
  if (f.type === 'system' && f.subtype === 'init') {
    return f.model ? `Started on ${f.model}` : 'Started'
  }
  if (f.type === 'assistant' && Array.isArray(f.message?.content)) {
    const parts: string[] = []
    for (const blockRaw of f.message.content) {
      const b = blockRaw as { type?: string; text?: string; name?: string }
      // 🔴 Filter on the block TYPE, never take content[0]: a thinking block is
      // block zero on a reasoning model and reading it as the answer is how the
      // 2026-09-01 invite triage lost every output it had.
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text.trim())
      else if (b.type === 'tool_use' && b.name) parts.push(`${b.name}…`)
    }
    const line = parts.join(' ').replace(/\s+/g, ' ').trim()
    return line || null
  }
  if (f.type === 'result') {
    const cost = typeof f.total_cost_usd === 'number' ? ` · $${f.total_cost_usd.toFixed(2)}` : ''
    return `Finished${cost}`
  }
  return null
}

/** The last `n` readable lines of a stream-json log, newest last. */
export function logLines(log: string | null, n = 3): string[] {
  if (!log) return []
  const out: string[] = []
  const lines = log.split('\n')
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const raw = lines[i].trim()
    if (!raw) continue
    if (raw.startsWith('{')) {
      try {
        const line = frameLine(JSON.parse(raw) as Frame)
        if (line) out.unshift(line.length > 160 ? `${line.slice(0, 159)}…` : line)
      } catch { /* a half-written frame at the tail of a live append */ }
      continue
    }
    // The executor's own words (a 429 pause, a sync line) are already prose.
    out.unshift(raw.length > 160 ? `${raw.slice(0, 159)}…` : raw)
  }
  return out
}

/** The whole readable log, for the report sheet. */
export function logTail(log: string | null, n = 200): string[] {
  return logLines(log, n)
}

/** A job's one-line name: the first line of a prompt, or a spec's file name. */
export function jobTitle(j: RunnerJob): string {
  if (j.kind === 'goal') {
    const base = j.input.split('/').pop() ?? j.input
    return base.replace(/^GOAL-/, '').replace(/\.md$/, '')
  }
  const first = j.input.split('\n').find(l => l.trim()) ?? j.input
  return first.length > 72 ? `${first.slice(0, 71)}…` : first
}

// ---------------------------------------------------------------------------
// The subscription.
// ---------------------------------------------------------------------------

/**
 * The user's last 20 jobs, kept live.
 *
 * One channel per mount, with the mount's own id in the topic: `supabase
 * .channel()` hands back the EXISTING channel for a topic it already holds, so
 * a second subscriber on screen would bind postgres_changes to an already
 * subscribed channel and throw inside the effect — the same trap useOps and
 * useContent both carry a comment about.
 *
 * A realtime payload is applied DIRECTLY rather than triggering a refetch. A
 * running job updates its log every 10 s and a refetch per append would be 20
 * rows pulled down for one changed column.
 */
export function useRunnerJobs() {
  const [jobs, setJobs] = useState<RunnerJob[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const topic = `runner_jobs:${useId()}`

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('runner_jobs')
      .select(JOB_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(JOB_LIMIT)
    if (!alive.current) return
    if (err) { setError(err.message); setLoaded(true); return }
    setError(null)
    setJobs(((data ?? []) as unknown as RunnerJob[]).slice().reverse())
    setLoaded(true)
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_jobs' }, payload => {
        const row = payload.new as RunnerJob | undefined
        if (!row?.id) { void refresh(); return }
        setJobs(prev => {
          const at = prev.findIndex(j => j.id === row.id)
          if (at === -1) return [...prev, row].slice(-JOB_LIMIT)
          const next = prev.slice()
          next[at] = { ...next[at], ...row }
          return next
        })
      })
      .subscribe()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      alive.current = false
      supabase.removeChannel(ch)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, topic])

  /** Put a just-dispatched job on screen before realtime catches up. The
   * optimistic row is replaced by the real one on the first payload. */
  const add = useCallback((id: string, kind: JobKind, input: string, model: string | null, cwd: string | null) => {
    const now = new Date().toISOString()
    const optimistic: RunnerJob = {
      id, kind, input, cwd, model, status: 'queued',
      log: null, report_path: null, cost_usd: null, ran_on: null, error_detail: null,
      started_at: null, finished_at: null, created_at: now, updated_at: now,
    }
    setJobs(prev => prev.some(j => j.id === id) ? prev : [...prev, optimistic].slice(-JOB_LIMIT))
  }, [])

  return { jobs, loaded, error, refresh, add }
}

/**
 * The `?job=<id>` (and `&report=1`) a notification's url carries.
 *
 * The hash is parsed here rather than through `parseWbHash` because that parser
 * resolves a ROUTE — a job id is a parameter of the ask place, not a place of
 * its own, and teaching the router about it would put a runner concept in the
 * app's route table for one deep link.
 *
 * TWO THINGS MAKE IT WORK, and both were measured rather than assumed.
 *
 * 1. THE ROUTER REWRITES THE HASH BEFORE THIS PANE EXISTS. `Shell` reads
 *    `parseWbHash(location.hash)` once at mount and then writes the canonical
 *    form back, dropping every key it does not own — `?skin=b` and `?job=` both.
 *    This module lives in a LAZILY imported chunk, so by the time it evaluates,
 *    `location.hash` no longer carries the id. The navigation entry does: its
 *    `name` is the URL the document was actually loaded with, and nothing
 *    rewrites that. Measured: landing on `…/ask?job=<id>&report=1` leaves
 *    `location.hash === '#exp/brain-b/dms/chat'` six seconds later.
 * 2. IT LATCHES. When the app is ALREADY open, the service worker navigates the
 *    existing tab, so the id arrives as a `hashchange` and is then normalised
 *    away a beat later. Holding the last id seen — until a DIFFERENT one
 *    arrives — is what keeps the card marked, and it is what the mark wants
 *    anyway: he came here to read one job.
 */
export function useJobDeepLink(): { job: string | null; report: boolean } {
  const readFrom = (url: string) => {
    const q = url.indexOf('?', url.indexOf('#'))
    if (q === -1) return { job: null, report: false }
    const params = new URLSearchParams(url.slice(q + 1))
    return { job: params.get('job'), report: params.get('report') === '1' }
  }
  const read = () => readFrom(location.hash)
  /** The URL this document was loaded with, before anything rewrote it. */
  const readBoot = () => {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as { name?: string } | undefined
      const fromNav = nav?.name ? readFrom(nav.name) : { job: null, report: false }
      if (fromNav.job) return fromNav
    } catch { /* no navigation timing here; the live hash is the only source */ }
    return read()
  }
  const [link, setLink] = useState(readBoot)
  useEffect(() => {
    const on = () => setLink(prev => {
      const next = read()
      if (!next.job) return prev
      return next.job === prev.job && next.report === prev.report ? prev : next
    })
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return link
}
