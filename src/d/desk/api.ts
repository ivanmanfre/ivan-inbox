// The Content Desk's network: the content-desk edge function (OUT/CONTRACT.md),
// the owner-RLS reads of desk_messages / desk_t3_jobs, and the photo upload.
// `?deskmock=1` swaps every call for the canned mock (./mock.ts) so Playwright can
// measure the feel without a session or a backend.
import { supabase } from '../../lib/supabase'
import { uploadDraftPicture } from '../../lib/content'
import { MESSAGE_COLS, asMessage, parseSse, type DeskAttachment, type DeskMessage, type T3Job } from './model'
import { mockApi, mockOn } from './mock'

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/content-desk`

export type SendBody = { text: string; client_key: string; attachments?: DeskAttachment[]; voice?: boolean; chip?: boolean }
export type SendHandlers = {
  onAck?: (a: { user_message_id: string; client_key: string }) => void
  onDelta?: (text: string) => void
  onFinal?: (m: DeskMessage) => void
  onError?: (code: string, detail?: string) => void
}
export type ActionResult = { ok: boolean; message?: DeskMessage; error?: string }

function evalHeader(): Record<string, string> {
  try { return localStorage.getItem('desk-eval') === '1' ? { 'x-desk-eval': '1' } : {} } catch { return {} }
}

async function bearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
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

async function op(o: 'undo' | 'commit' | 'cancel', actionId: string): Promise<ActionResult> {
  if (mockOn()) return mockApi.op(o, actionId)
  const token = await bearer()
  if (!token) return { ok: false, error: 'Sign in again.' }
  try {
    const res = await window.fetch(FN, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...evalHeader() },
      body: JSON.stringify({ op: o, action_id: actionId }),
    })
    const j = await res.json().catch(() => ({})) as ActionResult & { detail?: string }
    if (!res.ok) return { ok: false, error: j.error ?? `http_${res.status}` }
    return { ok: j.ok !== false, message: j.message ? asMessage(j.message) : undefined, error: j.error }
  } catch {
    return { ok: false, error: 'No connection.' }
  }
}
export const undoAction = (id: string) => op('undo', id)
export const commitAction = (id: string) => op('commit', id)
export const cancelAction = (id: string) => op('cancel', id)

/** The newest 60 desk messages, oldest first. Owner RLS decides what comes back. */
export async function readMessages(): Promise<DeskMessage[]> {
  if (mockOn()) return mockApi.read()
  const { data, error } = await supabase.from('desk_messages').select(MESSAGE_COLS).order('created_at', { ascending: false }).limit(60)
  if (error) throw error
  return (data ?? []).map(r => asMessage(r as DeskMessage)).reverse()
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
  let subscribed = false
  const ch = supabase.channel(topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'desk_messages', filter: `user_id=eq.${userId}` }, p => {
      const row = (p as unknown as { new?: DeskMessage }).new
      if (row && row.id) on.message(asMessage(row))
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'desk_t3_jobs', filter: `user_id=eq.${userId}` }, p => {
      const row = (p as unknown as { new?: T3Job }).new
      if (row && row.id) on.job(row)
    })
    .subscribe(status => {
      // A re-subscribe after a drop missed whatever happened in between: the caller re-reads.
      if (status === 'SUBSCRIBED') { if (subscribed) on.resubscribed(); subscribed = true }
    })
  return () => { void supabase.removeChannel(ch) }
}

/** The photo goes where the app's own picture upload puts it (post-stills/onepost), named desk-. */
export async function uploadDeskPhoto(file: File): Promise<string> {
  if (mockOn()) return mockApi.upload(file)
  return uploadDraftPicture('ivan', 'desk0000', file)
}
