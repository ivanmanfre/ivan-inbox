// The Email folder (Ivan 09-27: "I don't see anything that needs me on emails. Yet I have like
// 20-something notifications in email... just show the ones that are actually waiting").
//
// WHY IT READ ~20+. The folder counted every conversation that carried ANY email row, either
// direction, any age, any stage (`threadKind(t) === 'email'`): on Ivan's seat that is 26 threads,
// 24 of them old campaign email replies on people he archived months ago, the rest our own sends.
// The green dot read `unread` on the same set, so an archived July reply nobody stamped lit it.
//
// THE RULE NOW. Waiting on him in email = today's needsAnswer on a thread whose newest owed
// inbound is an EMAIL (not solved, not discarded, not answered by a later send, inside the
// 14-day clock), or a pending email leg he can approve now (inside today's 14-day draft clock). Our own
// historical sends with no reply never count. Everything else sits under one folded "All email".
import { draftLegs, isConversation, isOwedInbound, messageChannel, needsAnswer, threadBucket, type Thread } from '../../lib/inbox'

export function emailWaiting(t: Thread, now: number = Date.now()): boolean {
  if (t.spam || !isConversation(t)) return false
  const emailLeg = draftLegs(t).some(l => messageChannel(l) === 'email')
  if (emailLeg && t.draftSnoozedUntil === null && threadBucket(t, now) !== 'waiting') return true
  const lastOwed = t.messages.filter(m => m.direction === 'inbound' && isOwedInbound(m)).at(-1)
  if (!lastOwed || messageChannel(lastOwed) !== 'email') return false
  return needsAnswer(t, now)
}

/** The folder's two lists for one seat's email threads: what waits on him, and the rest. */
export function splitEmail(ts: readonly Thread[], now: number = Date.now()): { waiting: Thread[]; rest: Thread[] } {
  const waiting: Thread[] = [], rest: Thread[] = []
  for (const t of ts) (emailWaiting(t, now) ? waiting : rest).push(t)
  return { waiting, rest }
}
