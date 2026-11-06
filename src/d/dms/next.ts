// After Send, Discard, Later or Solved on the open thread: the next Needs you thread to open.
// Same seat first (the row after this one, then from the top), then the other seats in order.
// Pure: it only picks; opening it never sends anything.
import type { Thread } from '../../lib/inbox'
import { SEATS, seatOf, type Seat } from '../seats'
import type { SeatView } from './model'

const needsRows = (v: SeatView): Thread[] => [...v.owner, ...v.drafted, ...v.nodraft]

export function nextNeedsYou(views: Record<Seat, SeatView>, t: Thread): Thread | null {
  const seat = seatOf(t.client_id)
  if (!seat) return null
  const start = SEATS.indexOf(seat)
  for (let k = 0; k < SEATS.length; k++) {
    const rows = needsRows(views[SEATS[(start + k) % SEATS.length]])
    const at = k === 0 ? rows.findIndex(r => r.prospect_id === t.prospect_id) : -1
    const order = at < 0 ? rows : [...rows.slice(at + 1), ...rows.slice(0, at)]
    const hit = order.find(r => r.prospect_id !== t.prospect_id)
    if (hit) return hit
  }
  return null
}
