// After Send, Discard, Later or Solved on the open thread: the next Needs you thread to open.
// Same seat first (the row after this one, then from the top), then the other seats in order.
// Pure: it only picks; opening it never sends anything.
import type { Thread } from '../../lib/inbox'
import { SEATS, seatOf, type Seat } from '../seats'
import type { SeatView } from './model'

/** Every row Needs you counts, in list order (email-only owed threads last, as the count has them). */
export const needsRows = (v: SeatView): Thread[] => [...v.owner, ...v.drafted, ...v.nodraft, ...v.emailOwed]

/** `before`: the seat's Needs you order as it was while `t` was still in it. A verb patches its row
 *  before it resolves, so by then `t` may have left the list; its old place still says what is next. */
export function nextNeedsYou(views: Record<Seat, SeatView>, t: Thread, before?: readonly string[]): Thread | null {
  const seat = seatOf(t.client_id)
  if (!seat) return null
  const start = SEATS.indexOf(seat)
  for (let k = 0; k < SEATS.length; k++) {
    const rows = needsRows(views[SEATS[(start + k) % SEATS.length]]).filter(r => r.prospect_id !== t.prospect_id)
    if (k === 0) {
      const ids = before?.includes(t.prospect_id) ? before : needsRows(views[seat]).map(r => r.prospect_id)
      const at = ids.indexOf(t.prospect_id)
      const live = new Map(rows.map(r => [r.prospect_id, r] as const))
      const after = at < 0 ? [] : ids.slice(at + 1).flatMap(id => live.get(id) ?? [])
      const hit = after[0] ?? rows[0]
      if (hit) return hit
      continue
    }
    if (rows[0]) return rows[0]
  }
  return null
}
