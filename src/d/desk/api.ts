// The Content Desk's network: the content-desk edge function (OUT/CONTRACT.md),
// the owner-RLS reads of desk_messages / desk_t3_jobs, and the photo upload.
// `?deskmock=1` swaps every call for the canned mock (./mock.ts) so Playwright can
// measure the feel without a session or a backend.
import { supabase } from '../../lib/supabase'
import { uploadDraftPicture } from '../../lib/content'
import { MESSAGE_COLS, asMessage, parseSse, type DeskAttachment, type DeskMessage, type T3Job } from './model'
import { mockApi, mockOn } from './mock'

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/content-desk`

export type SendBody = { text: string; client_key: string; attachments?: DeskAttachment[]; voice?: boolean; chip?: boolean; regen_of?: string }
export type SendHandlers = {
  onAck?: (a: { user_message_id: string; client_key: string }) => void
  onDelta?: (text: string) => void
  onFinal?: (m: DeskMessage) => void
  onError?: (code: string, detail?: string) => void
}
export type ActionResult = { ok: boolean; message?: DeskMessage; error?: string; detail?: string }

function evalOn(): boolean {
  try { return localStorage.getItem('desk-eval') === '1' } catch { return false }
}
function evalHeader(): Record<string, string> {
  return evalOn() ? { 'x-desk-eval': '1' } : {}
}
/** Eval and smoke turns are stamped meta.test by the server; Ivan's desk never shows them (only eval mode does). */
const isTestRow = (m: { meta?: unknown }) => !!m.meta && typeof m.meta === 'object' && (m.meta as { test?: unknown }).test === true

async function bearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** Ask the backend to build the brief now, so the first message does not wait for it. Never throws. */
export async function warmDesk(): Promise<void> {
  if (mockOn()) return
  try {
    const token = await bearer()
    if (!token) return
    await window.fetch(FN, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...evalHeader() },
      body: JSON.stringify({ op: 'warm' }),
      keepalive: true,
    })
  } catch { /* a warm-up is best effort */ }
}

/** Read the SSE answer of a send. Resolves when the stream ends (final, error or a dropped socket). */
export async function sendDesk(body: SendBody, h: SendHandlers, signal?: AbortSignal): Promise<'final' | 'error' | 'dropped'> {
  if (mockOn()) return mockApi.send(body, h)
  const token = await bearer()
  if (!token) { h.onError?.('unauthenticated', 'Sign in again.'); return 'error' }
  let res: Response
  try {
    res = await window.fetch(FN, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...evalHeader() },
      body: JSON.stringify({ op: 'send', ...body }),
      signal,
    })
  } catch {
    h.onError?.('offline', 'No connection. Your message is kept.')
    return 'error'
  }
  if (!res.ok || !res.body) {
    let code = `http_${res.status}`, detail: string | undefined
    try { const j = await res.json() as { error?: string; detail?: string }; code = j.error ?? code; detail = j.detail } catch { /* not json */ }
    h.onError?.(code, detail)
    return 'error'
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', ended: 'final' | 'error' | null = null
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const { frames, rest } = parseSse(buf)
      buf = rest
      for (const f of frames) {
        const d = (f.data ?? {}) as Record<string, unknown>
        if (f.event === 'ack') h.onAck?.(d as { user_message_id: string; client_key: string })
        else if (f.event === 'delta' && typeof d.text === 'string') h.onDelta?.(d.text)
        else if (f.event === 'final' && d.message && typeof d.message === 'object') { ended = 'final'; h.onFinal?.(asMessage(d.message as DeskMessage)) }
        else if (f.event === 'error') { ended = 'error'; h.onError?.(String(d.error ?? 'error'), typeof d.detail === 'string' ? d.detail : undefined) }
      }
    }
  } catch {
    return ended ?? 'dropped'
  }
  return ended ?? 'dropped'
}

export const OP_TIMEOUT_MS = 15_000

/**
 * One bounded POST to the function: the whole call (session token, request, body) ends after
 * OP_TIMEOUT_MS, so no op can hang a row on "Cancelling" (Sol desk-ui r4 #3). A timeout comes back as
 * error 'timeout', any other network failure as 'No connection.'.
 */
async function post<T>(payload: Record<string, unknown> | (() => Record<string, unknown> | null)): Promise<{ ok: true; status: number; okHttp: boolean; j: T } | { ok: true; skipped: true } | { ok: false; error: string }> {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), OP_TIMEOUT_MS)
  const aborted = new Promise<never>((_, rej) => c.signal.addEventListener('abort', () => rej(new Error('timeout')), { once: true }))
  aborted.catch(() => {})
  try {
    const token = await Promise.race([bearer(), aborted])
    if (!token) return { ok: false, error: 'Sign in again.' }
    // A payload built now, right before the request (after the token wait): null sends nothing.
    const body = typeof payload === 'function' ? payload() : payload
    if (!body) return { ok: true, skipped: true }
    const res = await Promise.race([window.fetch(FN, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...evalHeader() },
      body: JSON.stringify(body),
      signal: c.signal,
    }), aborted])
    const j = await Promise.race([res.json().catch(() => ({})), aborted]) as T
    return { ok: true, status: res.status, okHttp: res.ok, j }
  } catch {
    return { ok: false, error: c.signal.aborted ? 'timeout' : 'No connection.' }
  } finally {
    clearTimeout(t)
  }
}

async function op(o: 'undo' | 'commit' | 'cancel', actionId: string): Promise<ActionResult> {
  if (mockOn()) return mockApi.op(o, actionId)
  const r = await post<ActionResult & { detail?: string }>({ op: o, action_id: actionId })
  if (!r.ok) return { ok: false, error: r.error }
  if ('skipped' in r) return { ok: false, error: 'No connection.' } // never: a fixed payload is always sent
  const j = r.j ?? {} as ActionResult
  if (!r.okHttp) return { ok: false, error: j.error ?? `http_${r.status}` }
  // the server's own sentence for a refusal (an Undo too late, a post changed since) rides along as detail
  return { ok: j.ok !== false, message: j.message ? asMessage(j.message) : undefined, error: j.error, ...(typeof j.detail === 'string' ? { detail: j.detail } : {}) }
}

/** Stop the answer being written for this question (its client key). Best effort: a turn past the model finishes. */
export async function stopDesk(clientKey: string): Promise<boolean> {
  if (mockOn()) return mockApi.stop(clientKey)
  const r = await post<{ ok?: boolean }>({ op: 'stop', client_key: clientKey })
  return r.ok && 'j' in r && r.j?.ok === true
}

/** Per action id, from the stored row (also when it was already armed): its state, when it was first
 *  seen, and when the server will commit it; or an error for that id (content-desk heldSeen). */
export type HeldSeenEntry = { id: string; state?: string; seen_at?: string | null; hold_until?: string | null; error?: string }
export type HeldSeenResult = { ok: boolean; error?: string; results?: HeldSeenEntry[] }

/**
 * Tell the server these held actions are now on Ivan's screen. The server arms each hold's commit
 * timer only from this moment (commit at seen + hold_ms, through the same compare-and-set as a tap),
 * so nothing can commit before he could see its Undo. Bounded like every op. The top-level `ok` is
 * false when any id failed; the per-id `results` still say which.
 *
 * `stillWanted` is checked for every id at the last moment, after the session token resolves and right
 * before the request: an id Ivan tapped Undo on while this call waited is left out, and when none is
 * left nothing is sent at all (Sol desk-ui r7 P1). Left-out ids have no entry in `results`.
 */
export async function markHeldSeen(actionIds: string[], stillWanted: (id: string) => boolean = () => true): Promise<HeldSeenResult> {
  if (mockOn()) { const ids = actionIds.filter(stillWanted); return ids.length ? mockApi.heldSeen(ids) : { ok: true, results: [] } }
  const r = await post<HeldSeenResult>(() => {
    const ids = actionIds.filter(stillWanted)
    return ids.length ? { op: 'held_seen', action_ids: ids } : null
  })
  if (!r.ok) return { ok: false, error: r.error }
  if ('skipped' in r) return { ok: true, results: [] }
  const j = r.j ?? {} as HeldSeenResult
  if (!r.okHttp) return { ok: false, error: j.error ?? `http_${r.status}` }
  return { ok: j.ok !== false, results: Array.isArray(j.results) ? j.results : [], error: j.error }
}
export const undoAction = (id: string) => op('undo', id)
export const commitAction = (id: string) => op('commit', id)
export const cancelAction = (id: string) => op('cancel', id)

/** The newest 60 desk messages, oldest first. Owner RLS decides what comes back. */
export async function readMessages(): Promise<DeskMessage[]> {
  if (mockOn()) return mockApi.read()
  let q = supabase.from('desk_messages').select(MESSAGE_COLS)
  if (!evalOn()) q = q.or('meta->>test.is.null,meta->>test.neq.true')
  const { data, error } = await q.order('created_at', { ascending: false }).limit(60)
  if (error) throw error
  return (data ?? []).filter(r => evalOn() || !isTestRow(r as DeskMessage)).map(r => asMessage(r as DeskMessage)).reverse()
}

export async function readJobs(ids: string[]): Promise<T3Job[]> {
  if (!ids.length || mockOn()) return mockOn() ? mockApi.jobs(ids) : []
  const { data, error } = await supabase.from('desk_t3_jobs').select('id,status,title,t3_link,result_summary,updated_at').in('id', ids.slice(0, 50))
  if (error) throw error
  return (data ?? []) as T3Job[]
}

/** Live rows: every insert or update of a desk message or a T3 job of this user. Returns the unsubscribe. */
export function subscribeDesk(topic: string, userId: string, on: { message: (m: DeskMessage) => void; job: (j: T3Job) => void; resubscribed: () => void }): () => void {
  if (mockOn()) return mockApi.subscribe(on.message, on.job)
  const ch = supabase.channel(topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'desk_messages', filter: `user_id=eq.${userId}` }, p => {
      const row = (p as unknown as { new?: DeskMessage }).new
      if (row && row.id && (evalOn() || !isTestRow(row))) on.message(asMessage(row))
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'desk_t3_jobs', filter: `user_id=eq.${userId}` }, p => {
      const row = (p as unknown as { new?: T3Job }).new
      if (row && row.id) on.job(row)
    })
    .subscribe(status => {
      // Every SUBSCRIBED re-reads, the first one too: anything settled between the history read
      // and the subscription (a server commit, an answer) would otherwise be missed (Sol desk-ui r4 #4).
      if (status === 'SUBSCRIBED') on.resubscribed()
    })
  return () => { void supabase.removeChannel(ch) }
}

/**
 * The photo goes where the app's own picture upload puts it (post-stills/onepost), which is a PUBLIC
 * bucket on purpose: a photo the desk attaches to a draft must be a public URL for the post to go out
 * with it (operator_set_draft_photos takes https URLs), so a private bucket would break attach.
 * Called only when Ivan taps Send (a removed thumbnail uploads nothing), and the stored name is random:
 * the original file name never reaches the path (Sol desk-ui r1 #7).
 */
export async function uploadDeskPhoto(file: File): Promise<string> {
  if (mockOn()) return mockApi.upload(file)
  const ext = (file.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'
  const renamed = new File([file], `photo.${ext}`, { type: file.type })
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')
  return uploadDraftPicture('ivan', rand, renamed)
}
