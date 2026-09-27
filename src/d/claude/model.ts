// Pure pieces of the D Claude drawer, so the rules are testable without a DOM.
// Nothing here reads the network; the data is today's (useChat, turns.ts).
import type { Subject } from '../../exp/v2c/chat/paneContext'
import type { Thread } from '../../lib/turns'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import { SEAT_NAME, type Seat } from '../seats'
import { warsawDayWord } from '../ui/time'

/** What the subject chip prints about the person the DMs page handed over. */
export type SubjectMeta = { name: string; first: string; seat: string | null; draftWaiting: boolean }

const SEAT_BY_LABEL: Record<string, string> = Object.fromEntries(
  (Object.entries(LANE_LABEL) as [ContentLane, string][]).map(([k, v]) => [v, SEAT_NAME[k as Seat]]),
)

/** Reads the chip's facts back out of today's `threadSubject` summary (never a body). */
export function subjectMeta(s: Subject): SubjectMeta {
  const name = s.label.trim()
  const first = name.split(/\s+/)[0] || name
  const m = s.summary.match(/\(([^,()]+), [0-9a-z-]{1,8}\b/i)
  const lane = m ? m[1].trim() : null
  const seat = lane ? SEAT_BY_LABEL[lane] ?? (lane === 'null' ? 'Ivan' : lane) : null
  return { name, first, seat, draftWaiting: /reply draft is waiting/i.test(s.summary) }
}

/** The subject chip's words: "Angel Wang · Arch · draft waiting". */
export function chipLabel(m: SubjectMeta): string {
  return [m.name, m.seat, m.draftWaiting ? 'draft waiting' : null].filter(Boolean).join(' · ')
}

/** The field a "Draft it" hand-off starts with (today's quick-ask wording, AskThread QUICK_ASKS). */
export function draftStarter(m: SubjectMeta): string {
  return `Draft a reply to ${m.first} `
}

/** Threads grouped by the Warsaw day of their last turn, newest first as they came. */
export function chatsByDay(threads: Thread[], now = Date.now()): { label: string; items: Thread[] }[] {
  const out: { label: string; items: Thread[] }[] = []
  for (const t of threads) {
    const label = t.last_turn_at ? warsawDayWord(t.last_turn_at, now) : 'Earlier'
    const band = out[out.length - 1]
    if (band && band.label === label) band.items.push(t)
    else out.push({ label, items: [t] })
  }
  return out
}

/** "3 turns", "1 turn", or "failed" when the last turn of the chat failed. */
export function chatTail(t: Pick<Thread, 'turn_count' | 'last_status'>): { text: string; failed: boolean } {
  if (t.last_status === 'error') return { text: `${t.turn_count ?? 0} ${t.turn_count === 1 ? 'turn' : 'turns'} · failed`, failed: true }
  if (t.last_status === 'running' || t.last_status === 'queued') return { text: 'running', failed: false }
  const n = t.turn_count ?? 0
  return { text: `${n} ${n === 1 ? 'turn' : 'turns'}`, failed: false }
}

/** Seconds since a stamp, never negative. */
export function secsSince(at: number | null, now: number): number {
  return at == null ? 0 : Math.max(0, Math.round((now - at) / 1000))
}

/** "+9s" for a step that landed 9 s into the turn; null when the time is not known. */
export function stepOffset(at: number | undefined, t0: number | null): string | null {
  if (at == null || t0 == null) return null
  return `+${Math.max(0, Math.round((at - t0) / 1000))}s`
}

/** The status the drawer head shows. Nothing at rest. */
export type Status = 'working' | 'elsewhere' | 'failed' | 'idle'
export function statusOf(x: { busy: boolean; runningElsewhere: boolean; lastFailed: boolean }): Status {
  if (x.busy) return 'working'
  if (x.runningElsewhere) return 'elsewhere'
  if (x.lastFailed) return 'failed'
  return 'idle'
}

/** The first readable line of an answer, for the "Claude answered" card. */
export function firstLine(text: string, max = 140): string {
  const line = text.split('\n').map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** A uuid from a query value, or null (the push link is the only way in for ids). */
export function uuidOrNull(v: string | null | undefined): string | null {
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null
}

/** A chat title on one line (today's ThreadMenu `shortTitle`, kept here so D does not load that menu's CSS). */
export function shortTitle(title: string, max = 90): string {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).replace(/[\s,.;:]+$/, '')}…`
}

/** A bot turn's bundle label (today's BotTurn `bundleLabel`: one `[` line per feed row the tick read). */
export function bundleLabel(prompt: string): string {
  const n = (prompt ?? '').split('\n').filter(l => l.trimStart().startsWith('[')).length
  return n > 0 ? `${n} event${n === 1 ? '' : 's'}` : 'Feed rows'
}

/**
 * Today's plain words for transport failures (wb/ask/AskThread.tsx errorCopy), so
 * the glass never names the broker. Unmapped text falls through with "broker" swapped out.
 */
const ERROR_COPY: [RegExp, string][] = [
  [/broker unreachable|could not reach|econnrefused|network error/i, 'Claude could not be reached. Nothing was sent.'],
  [/stream ended early|dropped the connection|stream (?:closed|aborted)/i, 'The answer stopped early. Send it again.'],
  [/timed? ?out|timeout/i, 'That took too long and stopped. Send it again.'],
]
export function errorCopy(message: string): string {
  for (const [re, plain] of ERROR_COPY) if (re.test(message)) return plain
  return message.replace(/\bbrokers?\b/gi, 'Claude').replace(/\s+,\s+/g, '. ')
}
/** Today's thread-busy refusal: never offered as a Retry. */
export const THREAD_BUSY_RE = /still working on the last one/i

/** "2.1s · $0.0123" (today's TurnMeta): only what the row actually reported. */
export function turnMetaLine(t: { durationMs?: number | null; costUsd?: number | null }): string {
  const parts: string[] = []
  if (t.durationMs != null) parts.push(`${(t.durationMs / 1000).toFixed(1)}s`)
  if (t.costUsd != null) parts.push(`$${t.costUsd.toFixed(4)}`)
  return parts.join(' · ')
}

/** Today's session line (AskThread sessionLine). */
export function sessionWords(g: { session: 'new' | 'resumed' } | null): string {
  if (!g) return 'New conversation'
  return g.session === 'resumed' ? 'Continuing this thread' : 'Fresh session'
}

/** Today's empty-chat starters (send word for word) and quick asks (insert only), AskThread QUICK_ASKS. */
export const QUICK_ASKS: { label: string; send?: string; insert?: string }[] = [
  { label: 'What needs me', send: 'What is waiting on me right now?' },
  { label: 'Failed today', send: 'What broke today?' },
  { label: 'Look first', send: 'What should I look at first?' },
  { label: 'Draft a reply', insert: 'Draft a reply to ' },
  { label: 'Run a scan', insert: 'Run a scan on ' },
]
