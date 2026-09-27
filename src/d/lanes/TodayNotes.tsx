import { useToday } from '../../hooks/useToday'
import { todayPlate, type ScheduledPost } from '../../lib/today'
import { warsawHm } from '../ui/time'

// ---------------------------------------------------------------------------
// FROM TODAY'S TODAY SCREEN, the one line about today no other D place carries:
// "N slots today cancelled" (the brief's calendar, called off, so not counted
// as going out). Same read as today (useToday: get-morning-brief).
// Lanes 3 (09-27, Ivan): the all-seats LinkedIn counters and the cold-email
// note are gone ("I don't need to see this"; "need reply" was the unmaintained
// needs_manual_reply flag, 246 rows across all seats, most with no reply in 30
// days). The supply alarm now sits on the seat's own square (SeatSquares).
// Nothing at all when there is nothing to say.
// ---------------------------------------------------------------------------

function slotLine(p: ScheduledPost): string {
  const at = p.scheduled_at ? warsawHm(p.scheduled_at) : null
  return [at, p.post_format, p.platform].filter(Boolean).join(' ')
}

export function TodayNotes() {
  const t = useToday()
  const cancelled = todayPlate(t.brief, 'all').cancelled
  const failed = t.error != null && !t.brief
  if (!cancelled.length && !failed) return null
  return (
    <div className="dl-today" data-today-notes>
      {cancelled.length > 0 && (
        <p data-cancelled-slots>
          {cancelled.length} slot{cancelled.length === 1 ? '' : 's'} today cancelled ({cancelled.map(slotLine).filter(Boolean).join(', ') || 'no time on the row'}). Called off, so {cancelled.length === 1 ? 'it is' : 'they are'} not counted as going out.
        </p>
      )}
      {failed && <p className="dl-today-warn">Could not read today's brief, so cancelled content slots are not shown.</p>}
    </div>
  )
}
