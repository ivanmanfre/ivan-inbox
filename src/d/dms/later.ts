// Later (Ivan 09-27: "What's the difference between 'later' and 'follow up on a date'? Shouldn't
// that be the same thing"). ONE key and ONE section. Under the hood today's two writes stay as they
// are, chosen by the thread:
//   · a pending draft      -> today's snooze (snoozeDraft on every leg; Undo = unsnooze)
//   · no draft, Rise/Arch  -> today's dated follow-up (setFollowUp on the prospect; Undo = clear,
//                              or the previous date put back). Ivan's seat has no dated-follow-up
//                              drafter, so a draftless thread there offers no Later.
import type { Thread } from '../../lib/inbox'
import { seatOf, type Seat } from '../seats'
import type { Edits } from './verbs'

export type LaterPath = 'snooze' | 'followup' | null

export function laterPath(t: Thread): LaterPath {
  if (t.spam || t.ownerConfirmation) return null
  if (t.draft) return t.draftSnoozedUntil === null ? 'snooze' : null
  const seat = seatOf(t.client_id)
  return seat === 'risedtc' || seat === 'arch' ? 'followup' : null
}

/** The draft as it sits in the database: what a Later from a list row (no editor open) carries. */
export function editsOf(t: Thread): Edits {
  return { main: t.draft?.message_text ?? '', email: t.draft?.email_mirror_text ?? null, companion: t.companionDraft?.message_text ?? null }
}

export type LaterItem = { t: Thread; at: string; kind: 'draft' | 'followup' }

/** One seat's Later list: pushed drafts and dated follow-ups together, soonest first, one row per
 *  person (the sooner of the two dates when both exist). */
export function laterItems(pushed: readonly Thread[], dated: readonly { prospect_id: string; at: string }[], byId: ReadonlyMap<string, Thread>, seat: Seat): LaterItem[] {
  const out = new Map<string, LaterItem>()
  const put = (i: LaterItem) => {
    const was = out.get(i.t.prospect_id)
    if (!was || Date.parse(i.at) < Date.parse(was.at)) out.set(i.t.prospect_id, i)
  }
  for (const t of pushed) if (t.draftSnoozedUntil) put({ t, at: t.draftSnoozedUntil, kind: 'draft' })
  for (const d of dated) {
    const t = byId.get(d.prospect_id)
    if (t && seatOf(t.client_id) === seat && !t.spam) put({ t, at: d.at, kind: 'followup' })
  }
  return [...out.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
