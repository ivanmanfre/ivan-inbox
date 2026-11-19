// The Content Desk's pure model: message shapes (OUT/CONTRACT.md), the merge that
// reconciles an optimistic send with the stored rows, the SSE frame parser and the
// held-action clock. No React, no network: everything here is unit-tested.

export type DeskRole = 'user' | 'assistant'
export type DeskOrigin = 'operator' | 'desk' | 'proactive' | 't3'
export type ActionState = 'done' | 'held' | 'undone' | 'failed' | 'cancelled' | 'committing' | 'undoing' | 'unconfirmed'
export type T3Status = 'queued' | 'sent' | 'launched' | 'running' | 'done' | 'failed' | 'stalled'

export type DeskAction = {
  id: string; kind: string; label: string; state: ActionState; undo: boolean
  hold_ms?: number; detail?: string
  target?: { kind: 'draft'; handle: string; first_line: string }
}
/** A chip has ONE text: what it shows is exactly what it sends (Sol backend r5 B1). Any `label` a row
 *  still carries is ignored. */
export type DeskChip = { send: string; label?: string }
export type DeskDraftCard = { handle: string; first_line: string; status: string; scheduled_at?: string | null }
export type DeskT3 = { id: string; status: T3Status; title: string; link?: string | null }
export type DeskAttachment = { kind: 'photo' | 'link'; url: string; name?: string }
export type DeskMeta = {
  chips?: DeskChip[]; actions?: DeskAction[]; attachments?: DeskAttachment[]
  t3_job?: DeskT3; drafts?: DeskDraftCard[]
  model?: string; timings?: Record<string, number>; tool_calls?: number
  trigger?: string; voice?: boolean; test?: boolean
  /** On a failed answer row: the client_key of the send it failed to answer (the retry's key). */
  client_key?: string
  /** On the user row an answer belongs to (server). */
  reply_to?: string
  error?: string
  /** On a terminal answer, from that turn's action journal (Sol backend r5 B11): 'none' only when the
   *  turn wrote nothing and queued no job. Shown as a note; it never makes the UI send anything. */
  side_effects?: 'none' | 'some' | 'unknown'
  /** On a turn with change cards (server, Content Desk UI polish r5): the lines that are no card (a post it could not
   *  match, a could-not-save notice, a recovery line), kept apart from the cards' own receipts. */
  notes?: string[]
}

export type DeskMessage = {
  id: string
  role: DeskRole
  origin: DeskOrigin
  body: string
  status: 'streaming' | 'done' | 'error'
  meta: DeskMeta
  client_key: string | null
  created_at: string
  /** The row's last write; when two copies of a row meet, the newer one wins. */
  updated_at?: string
  /** Local only: an optimistic row the server has not stored yet. */
  local?: 'sending' | 'failed' | 'unconfirmed'
  /** Local only: the stream placeholder answering the user message with this client_key. */
  answers?: string
  /** Local only: why a send failed, in plain words. */
  error?: string
  /** Local only: the server refused this key for this text (key_mismatch); it is never resent. */
  mismatch?: boolean
}

export type T3Job = { id: string; status: T3Status; title: string; t3_link: string | null; result_summary: string | null; updated_at?: string }

/** The columns the app reads. */
export const MESSAGE_COLS = 'id,role,origin,body,status,meta,client_key,created_at,updated_at'

export function byTime(a: DeskMessage, b: DeskMessage): number {
  if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at)
  // Same instant: the question before its answer, then a stable order.
  if (a.role !== b.role) return a.role === 'user' ? -1 : 1
  return a.id.localeCompare(b.id)
}

/** Coerce a stored row (meta may be null on a hand-written row) into a message. */
export function asMessage(row: Partial<DeskMessage> & { id: string }): DeskMessage {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    origin: (row.origin ?? 'desk') as DeskOrigin,
    body: row.body ?? '',
    status: (row.status ?? 'done') as DeskMessage['status'],
    meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
    client_key: row.client_key ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
    ...(row.updated_at ? { updated_at: row.updated_at } : {}),
  }
}

/** True when `a` is a strictly older write of the same row than `b` (both stamped). */
export function olderThan(a: DeskMessage, b: DeskMessage): boolean {
  return !!a.updated_at && !!b.updated_at && a.updated_at < b.updated_at
}

/**
 * Fold stored rows into the list. A stored row replaces:
 *  - the row with the same id (an UPDATE),
 *  - the optimistic user row with the same client_key (the send landed),
 *  - and, for an assistant row from the desk, the open stream placeholder whose
 *    user message it answers (it is newer than that message). That way a realtime
 *    INSERT that beats the stream's `final` never shows the answer twice.
 */
export function mergeRows(list: DeskMessage[], rows: DeskMessage[]): DeskMessage[] {
  let out = list.slice()
  for (const r of rows) {
    // A late snapshot never rolls a row back: an older write of a row we already hold is skipped.
    const have = out.find(m => m.id === r.id)
    if (have && olderThan(r, have)) continue
    out = out.filter(m => m.id !== r.id && !(r.client_key && m.local && m.client_key === r.client_key && m.role === r.role))
    if (r.role === 'assistant' && r.origin === 'desk') {
      const ph = out.find(m => m.answers && m.status === 'streaming')
      // Only an answer newer than the question it answers closes the stream; an older
      // desk row (a history read landing mid-stream) never does.
      const asked = ph && out.find(m => m.role === 'user' && m.client_key === ph.answers)
      if (ph && asked && asked.created_at <= r.created_at && ph.created_at <= r.created_at) out = out.filter(m => m !== ph)
    }
    out.push(r)
  }
  out.sort(byTime)
  // The server's clock stamps Ivan's stored row later than the device stamped the
  // placeholder; the answer bubble still belongs right under the message it answers.
  for (const ph of out.filter(m => m.answers)) {
    const asked = out.findIndex(m => m.role === 'user' && m.client_key === ph.answers)
    if (asked < 0) continue
    out.splice(out.indexOf(ph), 1)
    out.splice(out.findIndex(m => m.role === 'user' && m.client_key === ph.answers) + 1, 0, ph)
  }
  return out
}

/** The optimistic pair a send draws at once: Ivan's bubble and the reserved answer bubble. */
export function optimisticPair(text: string, clientKey: string, now: Date, meta: DeskMeta = {}): [DeskMessage, DeskMessage] {
  const at = now.toISOString()
  // The placeholder sorts after the user row: same instant plus one millisecond.
  const after = new Date(now.getTime() + 1).toISOString()
  return [
    { id: `local:${clientKey}`, role: 'user', origin: 'operator', body: text, status: 'done', meta, client_key: clientKey, created_at: at, local: 'sending' },
    { id: `stream:${clientKey}`, role: 'assistant', origin: 'desk', body: '', status: 'streaming', meta: {}, client_key: null, created_at: after, answers: clientKey },
  ]
}

export function patch(list: DeskMessage[], id: string, fn: (m: DeskMessage) => DeskMessage): DeskMessage[] {
  return list.map(m => (m.id === id ? fn(m) : m))
}

/** What the cache may hold: stored rows only, newest 60. */
export function cacheable(list: DeskMessage[]): DeskMessage[] {
  return list.filter(m => !m.local && !m.answers).slice(-60)
}

// ---- SSE -------------------------------------------------------------------

export type SseFrame = { event: string; data: unknown }

/** Split a growing SSE buffer into whole frames plus the unfinished rest. */
export function parseSse(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = []
  const norm = buffer.replace(/\r\n/g, '\n')
  const parts = norm.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const part of parts) {
    let event = 'message'
    const data: string[] = []
    for (const line of part.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) continue
    const raw = data.join('\n')
    let parsed: unknown = raw
    try { parsed = JSON.parse(raw) } catch { /* plain text data stays a string */ }
    frames.push({ event, data: parsed })
  }
  return { frames, rest }
}

// ---- held actions ----------------------------------------------------------

export const DEFAULT_HOLD_MS = 8000

/** Seconds left on a hold, or 0 when it has run out. */
export function holdLeft(since: number, holdMs: number, now: number): number {
  return Math.max(0, Math.ceil((since + holdMs - now) / 1000))
}

/**
 * A held action seen for the first time. A fresh one (the answer just landed) gets
 * the whole countdown from now, so Ivan always sees the full hold. An old one (the
 * app was closed during the hold) is 'stale': shown as not done, with a button to
 * do it now. It never commits silently on reopen.
 */
export function holdStart(messageAt: string, now: number, holdMs: number): number | 'stale' {
  const at = Date.parse(messageAt)
  if (!Number.isFinite(at)) return now
  // A send's answer lands within seconds of its row; 20 s plus the hold covers a slow model.
  return now - at > holdMs + 20_000 ? 'stale' : now
}

// ---- small text helpers ----------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>()]+/gi

export function linksIn(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map(u => u.replace(/[.,;:!?)]+$/, '')))]
}

export const T3_LABEL: Record<T3Status, string> = {
  queued: 'Queued', sent: 'Sent to T3', launched: 'Thread open', running: 'Working',
  done: 'Done', failed: 'Failed', stalled: 'Stalled',
}
export const T3_LIVE: ReadonlySet<T3Status> = new Set(['queued', 'sent', 'launched', 'running'])

export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// ---- action labels ---------------------------------------------------------

/** The server writes most labels as whole sentences that already say what happened ("Moved "…" to Tue 9 Mar",
 *  "Undone.", "Done (ref 1a2b3c4d): approve "…""). The card's eyebrow names the state, so a label is shown
 *  cleaned (no ref, the post's own text as "this post" when the card shows the post below) and
 *  without a second state word in front of it. An imperative label ("Approve the trains post") keeps its prefix. */
// The UTC offset stays: on the autumn change day 02:30 happens twice, and the card must say which one.
const STATED = /^(done|undone|cancelled|not done|not confirmed|could not|couldn't|moved|removed|saved|added|rewriting|opened|proposed|failed|nothing|back|i |i'|the |this |that |["“])/i

/** Where the label quotes the card's post: the whole opener exactly as the server writes it ("<first line>"), or
 *  its clipped form ("<start>…"). Anything less certain returns null and the sentence stays as the server wrote it. */
function quotedPost(label: string, firstLine: string): [number, number] | null {
  const flat = firstLine.replace(/\s+/g, ' ').trim()
  if (flat.length < 8) return null
  const whole = label.indexOf(`"${flat}"`)
  if (whole >= 0) return [whole, whole + flat.length + 2]
  // The clipped form: an opening quote, a start of the opener, then "…" and the closing quote.
  const m = /"([^"]{8,}?)…"/.exec(label)
  if (m && flat.startsWith(m[1].trim())) return [m.index, m.index + m[0].length]
  return null
}

/** The server's short reference for the post a card targets ("ref 1a2b3c4d"): read only from the label's own
 *  opening ("Proposed (ref …):", "Done (ref …):", "Moved (ref …)"), never from a reason that quotes another post. */
export function labelRef(label: string): string | null {
  return /^\s*[A-Z][A-Za-z ]{0,30}? \(ref ([0-9a-f]{6,})\)/.exec(label)?.[1] ?? null
}

export function cleanLabel(label: string, target?: { first_line: string } | null): { text: string; stated: boolean } {
  let t = label.replace(/\s+/g, ' ').trim()
  t = t.replace(/\s*\(ref [0-9a-f]{6,}\)/gi, '').replace(/\s*\(no date\)/gi, '')
  if (target?.first_line) {
    const q = quotedPost(t, target.first_line)
    if (q) t = `${t.slice(0, q[0])}this post${t.slice(q[1])}`
  }
  let stated = STATED.test(t)
  // "Proposed: move …", "Done: approve …", "Not done: The write …": the eyebrow says the state, so the word goes.
  const lead = /^(proposed|done|not done)\s*:\s*/i.exec(t)
  if (lead) { t = t.slice(lead[0].length); stated = true }
  // A label that is only its state word says nothing the eyebrow does not.
  const bare = /^(undone|cancelled)\.?\s*/i.exec(t)
  if (bare) { t = t.slice(bare[0].length) || (bare[1].toLowerCase() === 'undone' ? 'Back as it was.' : 'Nothing changed.'); stated = true }
  if (t) t = t[0].toUpperCase() + t.slice(1)
  return { text: t, stated }
}
