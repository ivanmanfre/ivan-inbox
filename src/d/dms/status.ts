// All conversations (Ivan 09-27: "below everything... I want to see the full logs, each DM
// conversation, collapsed, but I want to be able to open it"). Every conversation on the seat,
// newest activity first, with ONE short status word from today's rules (never re-judged here).
import { eventTime, isAutoReplyThread, isOlderOwed, isSettledBySolve, threadBucket, type Thread } from '../../lib/inbox'
import { lastDiscard, owedSince } from './model'
import { dayMonth } from './threadRows'

export type StatusKind = 'needs' | 'later' | 'older' | 'solved' | 'discarded' | 'auto' | 'replied' | 'waiting'
export type Status = { kind: StatusKind; word: string }

export function statusOf(t: Thread, now: number = Date.now(), datedAt: string | null = null): Status {
  if (threadBucket(t, now) !== 'waiting') return { kind: 'needs', word: 'needs you' }
  const back = t.draftSnoozedUntil ?? datedAt
  if (back) return { kind: 'later', word: `later · ${dayMonth(back)}` }
  if (isOlderOwed(t, now)) return { kind: 'older', word: 'older' }
  const owed = owedSince(t)
  if (owed && isSettledBySolve(t.solvedAt, owed)) return { kind: 'solved', word: 'solved' }
  const d = lastDiscard(t)
  if (d && t.draft === null) {
    const at = Date.parse(d.send_blocked_at ?? eventTime(d))
    const after = t.messages.some(m => (m.direction === 'outbound' && m.sent_at && Date.parse(m.sent_at) > at) || (m.direction === 'inbound' && Date.parse(eventTime(m)) > at))
    if (!after) return { kind: 'discarded', word: 'discarded' }
  }
  if (isAutoReplyThread(t)) return { kind: 'auto', word: 'auto-reply' }
  if (t.last.direction === 'inbound') return { kind: 'replied', word: 'replied' }
  return { kind: 'waiting', word: 'waiting on them' }
}
