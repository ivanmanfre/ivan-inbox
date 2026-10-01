import { supabase } from '../../lib/supabase'
import { seatFilter, type Seat } from '../seats'

// Content "Waiting on you", per seat: drafts at review; a client's only while
// NOT on the client's board (a board row is the client's to read, not Ivan's
// to decide); Ivan's own whatever the flag (today's useGlanceCounts rule),
// written in the last 14 days (older ones sit in the page's "Older than two
// weeks" fold and stop counting, the same clock DMs use). This is the SQL the
// D mocks were drawn from (build-data-content-full.py, waiting_on_ivan).
// Head counts only: no rows travel.
export const CONTENT_WAIT_DAYS = 14

export async function fetchContentWaiting(seat: Seat, now: number = Date.now()): Promise<number> {
  const since = new Date(now - CONTENT_WAIT_DAYS * 86_400_000).toISOString()
  let q = supabase.from('cb34_p2_safe_drafts')
    .select('id', { count: 'exact', head: true })
    .or(seatFilter(seat))
    .eq('status', 'review')
    .gt('created_at', since)
  // Today's rule (useGlanceCounts): every one of Ivan's own drafts at review counts,
  // board flag or not; a client's counts only while it is not on the client's board.
  if (seat !== 'ivan') q = q.not('board_visible', 'is', true)
  const { count, error } = await q
  if (error) throw error
  if (count == null) throw new Error('Guarded draft count missing')
  return count
}
