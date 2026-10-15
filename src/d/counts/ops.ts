import { countsAsWaiting, fetchOpsDrafts, pendingOps, type OpsDraft } from '../../lib/ops'
import { fetchXReview, xWaitingCount } from '../../lib/xReview'
import { seatOf, type Seat } from '../seats'

// Ops "Waiting on you", per seat: THE Ops number (lib/ops.ts opsBadge), split
// by seat instead of summed. Every pending card and task counts, except comment
// ideas and newsjacks (countsAsWaiting: they show on the board, never in the
// number). ops_drafts' legacy client 'rise' is Rise.
// Per seat; with `other` (clients with no seat) they add up to today's single Ops badge.
export type OpsWaiting = Record<Seat, number> & {
  /** Pending cards for a client with no seat in this app (drawn as their own lane on Ops, never dropped). */
  other?: number
}

export function opsWaitingBySeat(rows: OpsDraft[], now: number = Date.now()): OpsWaiting {
  const out: OpsWaiting = { ivan: 0, risedtc: 0, arch: 0, swishdm: 0 }
  for (const d of pendingOps(rows, now)) {
    if (!countsAsWaiting(d)) continue
    const s = seatOf(d.client_id)
    if (s) out[s] += 1
    else out.other = (out.other ?? 0) + 1
  }
  return out
}

// X articles and quote posts waiting for review (lib/xReview.ts) are Ivan's and count in his
// number, so the Ops badge rings for them too. A failed X read never fails the ops count: it
// adds nothing and the X flag on the page says the rest.
export async function fetchOpsWaiting(now: number = Date.now()): Promise<OpsWaiting> {
  const [rows, x] = await Promise.all([
    fetchOpsDrafts(),
    fetchXReview().catch((e: unknown) => { console.warn('[d] x review count read failed', e); return null }),
  ])
  const out = opsWaitingBySeat(rows, now)
  out.ivan += xWaitingCount(x)
  return out
}
