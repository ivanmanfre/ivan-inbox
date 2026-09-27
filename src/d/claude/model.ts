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
