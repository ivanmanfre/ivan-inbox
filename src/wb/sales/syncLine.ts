/* ==========================================================================
   src/wb/sales/syncLine.ts: the quiet line under the Sales head (2026-11-06).

   "Calendar checked 14:05 · last new booking Mon 2 Nov"

   An empty week and a broken sync used to look the same. The sync writes a
   heartbeat every run in which Google answered, even with zero events, so a
   fresh "checked" time means the empty list is real. A stale or missing one is
   said plainly, in the urgent tone.
   ========================================================================== */
import { dayKey, WARSAW } from './match'
import type { CalendarSyncStatus } from '../../lib/salesPacks'

/** The sync runs every 15 minutes; three missed runs is a broken sync. */
export const SYNC_STALE_MS = 45 * 60_000

const clock = (at: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: WARSAW, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(at)

const day = (at: Date, now: Date) => {
  if (dayKey(at) === dayKey(now)) return 'today'
  if (dayKey(at) === dayKey(new Date(now.getTime() - 86_400_000))) return 'yesterday'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: WARSAW, weekday: 'short', day: 'numeric', month: 'short',
  }).format(at)
}

export type SyncLine = { text: string; stale: boolean }

/** `status` null = the status read itself failed. */
export function syncLine(status: CalendarSyncStatus | null, now: Date = new Date()): SyncLine {
  if (!status) return { text: 'Could not read when the calendar was last checked.', stale: true }
  const booking = status.last_new_booking_at
    ? `last new booking ${day(new Date(status.last_new_booking_at), now)}`
    : 'no bookings on record'
  const checked = status.checked_at ? new Date(status.checked_at) : null
  if (!checked || Number.isNaN(checked.getTime())) {
    return { text: `Calendar sync has not reported yet · ${booking}`, stale: true }
  }
  if (now.getTime() - checked.getTime() > SYNC_STALE_MS) {
    const when = dayKey(checked) === dayKey(now) ? clock(checked) : `${day(checked, now)} ${clock(checked)}`
    return { text: `Calendar not checked since ${when}. The sync may be down · ${booking}`, stale: true }
  }
  return { text: `Calendar checked ${clock(checked)} · ${booking}`, stale: false }
}
