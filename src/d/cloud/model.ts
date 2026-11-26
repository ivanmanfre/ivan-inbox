// Cloud jobs (db/20261126p): any task Ivan sends to Ivan Cloud from the inbox, and his replies
// into the same T3 thread. One desk_t3_jobs row is one turn; a conversation is a root job
// (origin 'inbox') plus its replies (origin 'reply', parent_job_id chain).

export type CloudStatus = 'queued' | 'sent' | 'stalled' | 'launched' | 'running' | 'done' | 'failed'

export type CloudJob = {
  id: string
  origin: 'inbox' | 'reply'
  status: CloudStatus
  title: string
  brief: string
  t3_link: string | null
  t3_thread_id: string | null
  result_summary: string | null
  parent_job_id: string | null
  created_at: string
  updated_at: string
}

export const JOB_COLS = 'id,origin,status,title,brief,t3_link,t3_thread_id,result_summary,parent_job_id,created_at,updated_at'

export const LIVE: ReadonlySet<CloudStatus> = new Set(['queued', 'sent', 'stalled', 'launched', 'running'])

export type Convo = {
  root: CloudJob
  /** The root first, then each reply, oldest to newest. */
  turns: CloudJob[]
  latest: CloudJob
  live: boolean
  /** The turn a reply answers: the newest finished turn that has a thread (Sol r2 #5). */
  replyTo: CloudJob | null
  /** A reply can go in: nothing is working and a finished turn with a thread exists. */
  canReply: boolean
  link: string | null
  updatedAt: string
}

/** The root of a job's chain, or null when a link in it is missing from the list. */
function rootOf(j: CloudJob, byId: Map<string, CloudJob>): CloudJob | null {
  let cur: CloudJob | undefined = j
  for (let n = 0; cur && n < 200; n++) {
    if (!cur.parent_job_id) return cur.origin === 'inbox' ? cur : null
    cur = byId.get(cur.parent_job_id)
  }
  return null
}

export function conversations(jobs: CloudJob[]): Convo[] {
  const byId = new Map(jobs.map(j => [j.id, j]))
  const groups = new Map<string, CloudJob[]>()
  for (const j of jobs) {
    const r = rootOf(j, byId)
    if (!r) continue
    const g = groups.get(r.id) ?? []
    g.push(j)
    groups.set(r.id, g)
  }
  const out: Convo[] = []
  for (const [rootId, g] of groups) {
    const root = byId.get(rootId)!
    const turns = [...g].sort((a, b) => a.id === rootId ? -1 : b.id === rootId ? 1 : a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    const latest = turns[turns.length - 1]
    const live = turns.some(t => LIVE.has(t.status))
    const replyTo = [...turns].reverse().find(t => !!t.t3_thread_id && (t.status === 'done' || t.status === 'failed')) ?? null
    const link = [...turns].reverse().find(t => t.t3_link)?.t3_link ?? null
    const updatedAt = turns.reduce((m, t) => (t.updated_at > m ? t.updated_at : m), root.updated_at)
    out.push({ root, turns, latest, live, replyTo, canReply: !live && !!replyTo, link, updatedAt })
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** One plain line for a turn that is not finished yet. */
export function liveLine(s: CloudStatus): string {
  switch (s) {
    case 'queued': return 'Waiting to start'
    case 'sent': return 'Starting on Ivan Cloud'
    case 'stalled': return 'Not picked up yet. It starts as soon as the bridge is back.'
    case 'launched': return 'Started on Ivan Cloud'
    case 'running': return 'Working on it'
    default: return ''
  }
}

/** The list row's status word. */
export function statusWord(c: Convo): string {
  if (c.live) return c.latest.status === 'stalled' ? 'Waiting' : 'Working'
  return c.latest.status === 'failed' ? 'Failed' : 'Done'
}

/** The first readable line of a result, for the list row. */
export function firstLine(text: string | null | undefined, max = 140): string {
  const line = (text ?? '').split('\n').map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? ''
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
}

const ERRORS: Record<string, string> = {
  not_allowed: 'This account cannot start cloud jobs.',
  empty_job: 'Write what the job should do first.',
  empty_reply: 'Write a reply first.',
  bad_context: 'That job could not be read. Try again.',
  no_such_job: 'That job is gone.',
  no_thread_yet: 'The job has not started yet. Reply once it answers.',
  still_running: 'It is still working. Reply once it answers.',
  thread_busy: 'It is still working on the last message. Reply once it answers.',
}

export function errorWords(code: string | null | undefined): string {
  return (code && ERRORS[code]) || 'That did not go through. Try again.'
}

/** Merge rows into a list by id, keeping whichever copy of a row is newer (updated_at), so a late
 *  read can never put back an older state than a live change already showed (Sol r2 #7). */
export function merge(list: CloudJob[], rows: CloudJob[]): CloudJob[] {
  const byId = new Map(list.map(j => [j.id, j]))
  for (const r of rows) {
    const have = byId.get(r.id)
    if (!have || r.updated_at >= have.updated_at) byId.set(r.id, r)
  }
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** One row in. */
export function upsert(list: CloudJob[], row: CloudJob): CloudJob[] {
  return merge(list, [row])
}

// ---- submissions that survive a reload -------------------------------------
// Every unconfirmed submission keeps its own key, saved on the device per destination ('new' or a
// conversation's root id) and text, so a retry after a lost answer or a reload returns the job it
// already made instead of starting a second one. Only the key the server confirmed is cleared, so
// a second submission or another tab never erases the first one's key (Sol r2 #1, r3 #5).
const SUBMIT_KEY = 'cloud-submit-v2'
type Pending = Record<string, { text: string; key: string; at: number }[]>
const KEEP_MS = 7 * 86400e3

function readPending(): Pending {
  try {
    const p = JSON.parse(localStorage.getItem(SUBMIT_KEY) || '{}') as Pending
    return p && typeof p === 'object' ? p : {}
  } catch { return {} }
}
function writePending(p: Pending): void {
  try { localStorage.setItem(SUBMIT_KEY, JSON.stringify(p)) } catch { /* storage blocked: memory only */ }
}
const memory: Pending = {}

export function submissionKey(dest: string, text: string, make: () => string, now = Date.now()): string {
  const stored = readPending()
  const list = [...(stored[dest] ?? []), ...(memory[dest] ?? [])].filter(x => now - x.at < KEEP_MS)
  const hit = list.find(x => x.text === text)
  if (hit) return hit.key
  const next = { text, key: make(), at: now }
  memory[dest] = [...(memory[dest] ?? []), next]
  writePending({ ...stored, [dest]: [...(stored[dest] ?? []).filter(x => now - x.at < KEEP_MS), next] })
  return next.key
}

/** The server confirmed this key: forget it, and only it. */
export function submissionDone(dest: string, key: string): void {
  memory[dest] = (memory[dest] ?? []).filter(x => x.key !== key)
  const p = readPending()
  p[dest] = (p[dest] ?? []).filter(x => x.key !== key)
  if (!p[dest].length) delete p[dest]
  writePending(p)
}
