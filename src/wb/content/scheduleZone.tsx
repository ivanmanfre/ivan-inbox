import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CalendarItem } from '../../lib/calendarItems'
import { typeLabel } from '../../exp/v2c/fmt'

// ---------------------------------------------------------------------------
// TODAY'S SCHEDULE ZONE, moved into the calendar (rebuild: the Today place is
// gone, blueprint v3 "Today's schedule zone moves here"). Three facts, the
// same three Today carried, read off the chips the calendar already drew:
//   OUT TODAY  what goes out (or went out) today
//   NEXT       the next armed post after now
//   "N slots today cancelled"  a called-off slot is news, not load (your lane:
//              the publish queue is yours by construction)
// The outreach QUEUE line stays behind: it was prospects, not content.
// ---------------------------------------------------------------------------

export type Zone = { outToday: CalendarItem[]; next: CalendarItem | null }

export function scheduleZone(items: CalendarItem[], today: string, now: number = Date.now()): Zone {
  const live = items.filter(i => (i.arming === 'armed' || i.arming === 'out') && i.stage !== 'stuck')
  const outToday = live.filter(i => i.day === today)
  const next = live
    .filter(i => i.arming === 'armed' && Date.parse(i.at) > now)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null
  return { outToday, next }
}

/** Queue rows called off today. Your lane only; null until read, and on a failed read. */
function useCancelledToday(on: boolean): number | null {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    if (!on) return
    const s = new Date(); s.setHours(0, 0, 0, 0)
    const e = new Date(s.getTime() + 86_400_000)
    let live = true
    supabase.from('scheduled_posts').select('id', { count: 'exact', head: true })
      .eq('status', 'cancelled').gte('scheduled_at', s.toISOString()).lt('scheduled_at', e.toISOString())
      .then(({ count, error }) => { if (live) setN(error ? null : count ?? 0) })
    return () => { live = false }
  }, [on])
  return n
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function ScheduleZone({ items, today, withQueue, onOpen }: {
  items: CalendarItem[]
  today: string
  withQueue: boolean
  onOpen: (id: string) => void
}) {
  const z = scheduleZone(items, today)
  const cancelled = useCancelledToday(withQueue)
  const rows: Array<[React.ReactNode, React.ReactNode]> = []
  rows.push(['Out today', z.outToday.length === 0
    ? <span className="a-dim">Nothing goes out today.</span>
    : (
      <span className="wb-ct-zone-list">
        {z.outToday.map(i => (
          <button key={i.id} type="button" className="wb-ct-zone-item" disabled={i.source !== 'draft'} onClick={() => onOpen(i.id)}>
            <b>{clock(i.postedAt ?? i.at)}</b> {i.arming === 'out' ? 'went out' : 'goes out'}, {i.title}
          </button>
        ))}
      </span>
    )])
  rows.push(['Next', z.next
    ? (
      <button type="button" className="wb-ct-zone-item" disabled={z.next.source !== 'draft'} onClick={() => onOpen(z.next!.id)}>
        <b>{when(z.next.at)}</b>{z.next.type ? ` · ${typeLabel(z.next.type)}` : ''}, {z.next.title}
      </button>
    )
    : <span className="a-dim">Nothing armed after today.</span>])
  return (
    <div className="wb-ct-zone">
      {cancelled != null && cancelled > 0 && (
        <p className="wb-ct-zone-cx">
          {cancelled} slot{cancelled === 1 ? '' : 's'} today cancelled. Called off, so {cancelled === 1 ? 'it is' : 'they are'} not counted as going out.
        </p>
      )}
      {rows.map(([k, v], i) => (
        <div key={i} className="wb-ct-zone-row">
          <span className="wb-ct-zone-k">{k}</span>
          <span className="wb-ct-zone-v">{v}</span>
        </div>
      ))}
    </div>
  )
}
