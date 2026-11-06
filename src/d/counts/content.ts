import { supabase } from '../../lib/supabase'
import { seatFilter, type Seat } from '../seats'

// Content "Waiting on you", per seat: drafts at review; a client's only while
// NOT on the client's board (a board row is the client's to read, not Ivan's
// to decide); Ivan's own whatever the flag (today's useGlanceCounts rule),
// written in the last 14 days, or dated (undated older ones sit in Review's "Going
// stale" fold and stop counting, the same clock DMs use). This is the SQL the
// D mocks were drawn from (build-data-content-full.py, waiting_on_ivan).
// Head counts only: no rows travel.
export const CONTENT_WAIT_DAYS = 14

export async function fetchContentWaiting(seat: Seat, now: number = Date.now()): Promise<number> {
  const since = new Date(now - CONTENT_WAIT_DAYS * 86_400_000).toISOString()
  // Review's own rule (weekModel goingStale, cross-review 2026-11-06): only an UNDATED draft older than 14 days
  // stops counting. A dated one still waits for a verdict, so it counts however old it is. Two head counts.
  const base = () => {
    let q = supabase.from('cb34_p2_safe_drafts')
      .select('id', { count: 'exact', head: true })
      .or(seatFilter(seat))
      .eq('status', 'review')
    // Today's rule (useGlanceCounts): every one of Ivan's own drafts at review counts,
    // board flag or not; a client's counts only while it is not on the client's board.
    if (seat !== 'ivan') q = q.not('board_visible', 'is', true)
    return q
  }
  const [fresh, oldDated] = await Promise.all([
    base().gt('created_at', since),
    base().lte('created_at', since).not('scheduled_at', 'is', null),
  ])
  for (const r of [fresh, oldDated]) {
    if (r.error) throw r.error
    if (r.count == null) throw new Error('Guarded draft count missing')
  }
  return (fresh.count ?? 0) + (oldDated.count ?? 0)
}
