import { fetchOpsDrafts, pendingOps, splitCommentIdeas, type OpsDraft } from '../../lib/ops'
import { seatOf, type Seat } from '../seats'

// Ops "Waiting on you", per seat: THE Ops number (lib/ops.ts opsBadge), split
// by seat instead of summed. Every pending card and task counts, except the
// comment ideas past what the poster can still take today (they sit in the
// page's "for later" fold). ops_drafts' legacy client 'rise' is Rise.
// Per seat, the three numbers add up to today's single Ops badge.
export function opsWaitingBySeat(rows: OpsDraft[], now: number = Date.now()): Record<Seat, number> {
  const later = new Set(splitCommentIdeas(rows, now).later.map(d => d.id))
  const out: Record<Seat, number> = { ivan: 0, risedtc: 0, arch: 0 }
  for (const d of pendingOps(rows, now)) {
    if (later.has(d.id)) continue
    const s = seatOf(d.client_id)
    if (s) out[s] += 1
  }
  return out
}

export async function fetchOpsWaiting(now: number = Date.now()): Promise<Record<Seat, number>> {
  return opsWaitingBySeat(await fetchOpsDrafts(), now)
}

