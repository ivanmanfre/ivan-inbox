// desk-t3: the Content Desk's door to a T3 Code thread on Ivan Cloud.
//
// HOW A JOB TRAVELS (measured 2026-11-18, see goal-run RUN-LOG-T3.md):
//   1. The desk calls queueT3Job: one desk_t3_jobs row, status 'queued'.
//   2. A Mac launchd job (~/.claude-resident/desk-t3/poll.py, every 20 s)
//      claims it, mints the job's one-time report token (only its sha256 is
//      stored), and launches ONE root thread on Ivan Cloud over railway ssh
//      (the host's local WS RPC orchestration.launchThread).
//   3. The same poller reads the thread state on Ivan Cloud and reports
//      launched -> running -> done|failed through public.desk_t3_report, which
//      writes the result into the desk as an origin='t3' message.
//
// WHY NOT A WEBHOOK: Ivan Cloud runs T3 0.0.46 (2026-10-03), whose scheduled
// tasks support only interval and fixed_time schedules, and the host has no
// public port. So nothing outside can push into it; the Mac relays. The work
// itself runs in the cloud. If the Mac is asleep the job waits as 'queued',
// sweepT3Stalls turns it 'stalled' after 10 minutes (the desk then shows the
// open-in-T3 link), and the poller still launches it when the Mac wakes.

export const T3_ENV_ID = '2a18874a-64d0-4c8c-8c7a-9be5c8706279'
export const T3_WEB_ORIGIN = 'https://app.t3.codes'
export const MAX_BRIEF_CHARS = 8000
export const MAX_TITLE_CHARS = 120
export const STALL_AFTER_MS = 10 * 60 * 1000

/** The T3 web app, opened on Ivan Cloud. A thread link once one exists. */
export function t3OpenUrl(threadId?: string | null): string {
  return threadId ? `${T3_WEB_ORIGIN}/#/${T3_ENV_ID}/${threadId}` : `${T3_WEB_ORIGIN}/#/${T3_ENV_ID}`
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// deno-lint-ignore no-explicit-any
type Db = any

export interface T3JobInput {
  userId: string
  messageId?: string | null
  title: string
  brief: string
}

export interface T3JobResult {
  job_id: string | null
  status: 'queued' | 'failed'
  open_url: string
  error?: string
}

/**
 * Queue a heavy job for Ivan Cloud. Never throws: a failure comes back as
 * status 'failed' with a short error the desk can say out loud.
 *
 * The stored report_token_hash is a placeholder hash of a token nobody keeps;
 * the poller replaces it with its own when it claims the job, so a queued row
 * can never be reported on by anyone.
 */
export async function queueT3Job(db: Db, input: T3JobInput): Promise<T3JobResult> {
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS)
  const brief = input.brief.trim().slice(0, MAX_BRIEF_CHARS)
  if (!title || !brief) return { job_id: null, status: 'failed', open_url: t3OpenUrl(), error: 'empty_job' }
  try {
    const { data, error } = await db.from('desk_t3_jobs').insert({
      user_id: input.userId,
      message_id: input.messageId ?? null,
      title,
      brief,
      status: 'queued',
      report_token_hash: await sha256Hex(randomToken()),
      events: [{ at: new Date().toISOString(), status: 'queued', by: 'desk' }],
    }).select('id').single()
    if (error || !data) {
      return { job_id: null, status: 'failed', open_url: t3OpenUrl(), error: String(error?.message ?? 'insert_failed').slice(0, 200) }
    }
    return { job_id: data.id, status: 'queued', open_url: t3OpenUrl() }
  } catch (e) {
    return { job_id: null, status: 'failed', open_url: t3OpenUrl(), error: String((e as Error)?.message ?? e).slice(0, 200) }
  }
}

/** The name the mission brief used; same thing. */
export const dispatchT3Job = queueT3Job

/**
 * Jobs nobody picked up in 10 minutes become 'stalled' so the desk can say so
 * and show the open-in-T3 link. The poller still launches a stalled job later.
 * Returns how many rows changed.
 */
export async function sweepT3Stalls(db: Db, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - STALL_AFTER_MS).toISOString()
  const { data, error } = await db.from('desk_t3_jobs')
    .update({ status: 'stalled', updated_at: new Date(now).toISOString() })
    .in('status', ['queued', 'sent'])
    .is('t3_thread_id', null)
    .lt('updated_at', cutoff)
    // a job the Mac poller is still holding (its lease, poller_seen_at, renewed each tick) is
    // not stalled; only one nobody has looked at for STALL_AFTER_MS is (Sol desk-t3 r3 #1)
    .or(`poller_seen_at.is.null,poller_seen_at.lt.${cutoff}`)
    .select('id')
  if (error) return 0
  return Array.isArray(data) ? data.length : 0
}

export interface T3JobView {
  id: string
  title: string
  status: string
  t3_link: string | null
  result_summary: string | null
  created_at: string
  updated_at: string
}

/** One plain line for the brief and the chips: what the job is doing now. */
export function t3StatusLine(j: T3JobView): string {
  const s: Record<string, string> = {
    queued: 'waiting for the Mac to hand it to Ivan Cloud',
    sent: 'starting on Ivan Cloud',
    launched: 'started on Ivan Cloud',
    running: 'running on Ivan Cloud',
    done: 'finished',
    failed: 'failed',
    stalled: 'not picked up yet (the Mac may be asleep); it will start when the Mac wakes',
  }
  return `"${j.title}": ${s[j.status] ?? j.status}`
}
