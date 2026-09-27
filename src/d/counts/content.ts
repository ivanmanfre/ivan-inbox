import { supabase } from '../../lib/supabase'
import { seatFilter, type Seat } from '../seats'

// Content "Waiting on you", per seat: drafts at review that are NOT on a
// client board (a board row is the client's to read, not Ivan's to decide),
// written in the last 14 days (older ones sit in the page's "Older than two
// weeks" fold and stop counting, the same clock DMs use). This is the SQL the
// D mocks were drawn from (build-data-content-full.py, waiting_on_ivan).
// Head counts only: no rows travel.
export const CONTENT_WAIT_DAYS = 14

export async function fetchContentWaiting(seat: Seat, now: number = Date.now()): Promise<number> {
  const since = new Date(now - CONTENT_WAIT_DAYS * 86_400_000).toISOString()
  const { count, error } = await supabase.from('carousel_drafts')
    .select('id', { count: 'exact', head: true })
    .or(seatFilter(seat))
    .eq('status', 'review')
    .not('board_visible', 'is', true)
    .gt('created_at', since)
  if (error) throw error
  if (count == null) throw new Error('carousel_drafts count missing')
  return count
}
