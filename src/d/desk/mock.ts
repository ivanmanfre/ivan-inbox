// `?deskmock=1`: a canned desk for Playwright and local design work. Every row is
// made up (ivan-inbox is a public repo). It answers with the same event shapes as
// the content-desk function, so the feel measured here is the feel of the real view.
import type { ActionResult, SendBody, SendHandlers } from './api'
import type { DeskMessage, T3Job } from './model'

// The canned desk only exists where something switched it on: the dev server, or the
// mock harness's own build (enableDeskMock). The app's production bundle never does,
// so `?deskmock=1` on the real app does nothing (Sol desk-ui r1 #6).
let enabled = false
export function enableDeskMock(): void { enabled = true }

export function mockOn(): boolean {
  if (typeof window === 'undefined') return false
  if (!enabled && !import.meta.env.DEV) return false
  try {
    const s = new URLSearchParams(window.location.search)
    if (s.get('deskmock') === '1') return true
    const h = window.location.hash.split('?')[1]
    return !!h && new URLSearchParams(h).get('deskmock') === '1'
  } catch { return false }
}

export const MOCK_USER = '00000000-0000-4000-8000-00000000d35c'

const t0 = Date.parse('2026-11-16T08:00:00Z')
const at = (min: number) => new Date(t0 + min * 60_000).toISOString()

let rows: DeskMessage[] = [
  { id: 'm-1', role: 'assistant', origin: 'proactive', body: 'Week plan for 16 to 22 Nov. 4 posts are dated, the autopilot picked 1, and 1 slot is still open.', status: 'done', client_key: null, created_at: at(0),
    meta: { trigger: 'week_plan', drafts: [
      { handle: '#a1b2c', first_line: 'A made up post about trains in the rain.', status: 'scheduled', scheduled_at: at(60 * 25) },
      { handle: '#d3e4f', first_line: 'A made up post about a quiet Monday.', status: 'review', scheduled_at: null },
    ], chips: [{ label: 'Fill the open slot', send: 'fill the open slot' }] } },
  { id: 'm-2', role: 'user', origin: 'operator', body: 'whats going out this week', status: 'done', meta: {}, client_key: 'k-2', created_at: at(30) },
  { id: 'm-3', role: 'assistant', origin: 'desk', body: 'Four posts this week. Tuesday 09:30 the trains post, Wednesday the Monday post, Thursday and Saturday the two copies.', status: 'done', meta: { model: 'mock' }, client_key: null, created_at: at(31) },
]
const jobs = new Map<string, T3Job>()
type Listener = { message: (m: DeskMessage) => void; job?: (j: T3Job) => void }
const listeners = new Set<Listener>()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let n = 10

function push(m: DeskMessage) {
  rows = rows.filter(r => r.id !== m.id).concat(m)
  listeners.forEach(l => l.message(m))
}
function pushJob(j: T3Job) {
  jobs.set(j.id, j)
  listeners.forEach(l => l.job?.(j))
}

function answerFor(text: string, id: string): DeskMessage {
  const t = text.toLowerCase()
  const base: DeskMessage = { id, role: 'assistant', origin: 'desk', body: '', status: 'done', meta: { model: 'mock' }, client_key: null, created_at: new Date().toISOString() }
  if (/approve/.test(t)) return { ...base, body: 'Approving the trains post.', meta: { ...base.meta, actions: [{ id: `a-${id}`, kind: 'approve', label: 'Approve #a1b2c', state: 'held', undo: false, hold_ms: 8000, target: { kind: 'draft', handle: '#a1b2c', first_line: 'A made up post about trains in the rain.' } }] } }
  if (/move|thursday/.test(t)) return { ...base, body: 'Moved the Monday post to Thursday 09:30.', meta: { ...base.meta, actions: [{ id: `a-${id}`, kind: 'schedule', label: 'Moved #d3e4f to Thu 26 Nov 09:30', state: 'done', undo: true, target: { kind: 'draft', handle: '#d3e4f', first_line: 'A made up post about a quiet Monday.' } }] } }
  if (/poland|which one/.test(t)) return { ...base, body: 'Two drafts match. Tap the one you mean.', meta: { ...base.meta, chips: [{ label: '#a1b2c trains in the rain', send: 'move #a1b2c to thursday' }, { label: '#d3e4f a quiet Monday', send: 'move #d3e4f to thursday' }] } }
  if (/build|fix|research/.test(t)) {
    const jid = `j-${id}`
    const job: T3Job = { id: jid, status: 'queued', title: 'Made up build job', t3_link: null, result_summary: null }
    jobs.set(jid, job)
    void (async () => {
      await sleep(1200); pushJob({ ...job, status: 'launched', t3_link: 'https://example.com/t3/thread' })
      await sleep(1500); pushJob({ ...job, status: 'running', t3_link: 'https://example.com/t3/thread' })
      await sleep(2500); pushJob({ ...job, status: 'done', t3_link: 'https://example.com/t3/thread', result_summary: 'Made up result.' })
    })()
    return { ...base, body: 'That needs real work, so I opened a T3 thread for it.', meta: { ...base.meta, t3_job: { id: jid, status: 'queued', title: 'Made up build job' } } }
  }
  return { ...base, body: 'Two posts are dated next week. Belief 4 has nothing yet, so the Thursday slot is the one to fill. I can draft it from the last call if you want.', meta: { ...base.meta, chips: [{ label: 'Draft it', send: 'draft the thursday slot from the last call' }] } }
}

export const mockApi = {
  async send(body: SendBody, h: SendHandlers): Promise<'final' | 'error' | 'dropped'> {
    const uid = `u-${++n}`
    await sleep(60)
    const user: DeskMessage = { id: uid, role: 'user', origin: 'operator', body: body.text, status: 'done', meta: { ...(body.attachments ? { attachments: body.attachments } : {}), ...(body.voice ? { voice: true } : {}) }, client_key: body.client_key, created_at: new Date().toISOString() }
    rows = rows.concat(user)
    h.onAck?.({ user_message_id: uid, client_key: body.client_key })
    if (/fail please/.test(body.text)) { await sleep(400); h.onError?.('upstream_error', 'The model did not answer.'); return 'error' }
    const ans = answerFor(body.text, `r-${++n}`)
    await sleep(700)
    const words = ans.body.split(/(?<= )/)
    for (let i = 0; i < words.length; i += 3) { h.onDelta?.(words.slice(i, i + 3).join('')); await sleep(60) }
    // Stamped when it is stored, as the function stores it: after the stream.
    ans.created_at = new Date().toISOString()
    rows = rows.concat(ans)
    h.onFinal?.(ans)
    return 'final'
  },
  async op(o: 'undo' | 'commit' | 'cancel', actionId: string): Promise<ActionResult> {
    await sleep(150)
    const m = rows.find(r => r.meta.actions?.some(a => a.id === actionId))
    if (!m) return { ok: false, error: 'not_found' }
    const state = o === 'undo' ? 'undone' : o === 'commit' ? 'done' : 'cancelled'
    const next: DeskMessage = { ...m, meta: { ...m.meta, actions: m.meta.actions!.map(a => (a.id === actionId ? { ...a, state } : a)) } }
    push(next)
    return { ok: true, message: next }
  },
  async read(): Promise<DeskMessage[]> { await sleep(250); return rows.slice() },
  async jobs(ids: string[]): Promise<T3Job[]> { return ids.map(id => jobs.get(id)).filter((j): j is T3Job => !!j) },
  subscribe(message: (m: DeskMessage) => void, job?: (j: T3Job) => void): () => void {
    const l: Listener = { message, job }
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
  async upload(file: File): Promise<string> { await sleep(200); return `https://example.com/mock/${encodeURIComponent(file.name || 'photo.jpg')}` },
}
