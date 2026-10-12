import { planDay, type PlanRead } from '../../../lib/contentPlan'
import { hmIn, zonedToUtc } from '../laneTime'
import { tzOf, type PlanItem } from './planBrain'

// MOVE DAY (spec 2026-10-12 §3c). A dated post: a two-week weekday picker (Sat and Sun only when the post sits on
// one); the post keeps its time of day in its account's zone; its own day and days already past cannot be picked.
// A planned slot has no date yet: it moves to another week of the plan, only to a week with room. Picking only
// reports the choice (`onPick`): the panel does the write. Nothing here dates, schedules or publishes.

const NAME = { this: 'This week', next: 'Next week', after: 'Week after' } as const
const addDays = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dm = (iso: string) => planDay(iso).replace(/^\w+ /, '')
const isWeekend = (iso: string | null) => { if (!iso) return false; const d = new Date(`${iso}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6 }

/** The two weeks a dated post can move within: its own week and the next one (the previous one for the last week). */
export function moveWeeks(item: PlanItem): string[] {
  const start = item.which === 'after' ? addDays(item.week, -7) : item.week
  return [start, addDays(start, 7)]
}

type Props = { item: PlanItem; read: PlanRead; onPick: (iso: string) => void; onCancel: () => void; busy?: boolean }

export function MoveDay({ item, read, onPick, onCancel, busy = false }: Props) {
  const tz = tzOf(read)
  const cancel = <button type="button" className="cv2-k cv2-k-q" data-verb="plan-move-cancel" onClick={onCancel}>Cancel</button>

  if (item.kind === 'planned') {
    const weeks = Array.isArray(read.weeks) ? read.weeks : []
    return <div className="pl2-mv" role="group" aria-label="Move day">
      <p className="pl2-mv-h">{weeks.some(w => w.start !== item.week && Number(w.filled) < Number(w.target))
        ? 'Move it to another week. It gets a day when you approve it.'
        : 'Every other week of the plan is full, so it stays in its week.'}</p>
      <div className="pl2-mv-wks">
        {weeks.map(w => {
          const own = w.start === item.week
          const full = !own && !(Number(w.filled) < Number(w.target))
          const note = own ? 'Its week now' : full ? `Full: ${w.filled} of ${w.target}` : `${w.filled} of ${w.target}, room for ${w.target - w.filled} more`
          return <button key={w.start} type="button" className="pl2-mv-wk" disabled={own || full || busy} data-verb="plan-move-week"
            aria-current={own ? 'true' : undefined} onClick={() => onPick(w.start)}>
            <b>{NAME[w.which] ?? 'Week'}</b><span>{dm(w.start)} to {dm(addDays(w.start, 4))}</span><small>{note}</small>
          </button>
        })}
      </div>
      <div className="pl2-mv-f">{cancel}</div>
    </div>
  }

  const hm = item.at ? hmIn(item.at, tz.name) : null
  const weekend = isWeekend(item.day)
  const cols = weekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4]
  const now = Date.now()
  return <div className="pl2-mv" role="group" aria-label="Move day">
    <p className="pl2-mv-h">{hm ? `Pick a day. It keeps its time: ${hm} ${tz.label}.` : 'Pick a day.'}</p>
    {moveWeeks(item).map(ws => <div key={ws} className="pl2-mv-row" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map(k => {
        const day = addDays(ws, k)
        const own = day === item.day
        const at = hm ? Date.parse(zonedToUtc(day, hm, tz.name)) : NaN
        const past = !Number.isFinite(at) || at <= now
        const label = planDay(day)
        return <button key={day} type="button" className="pl2-mv-d" disabled={own || past || busy} data-verb="plan-move-day"
          aria-current={own ? 'date' : undefined} aria-label={own ? `${label}, its day now` : label} onClick={() => onPick(day)}>
          <span>{label.split(' ')[0]}</span><b>{Number(day.slice(8, 10))}</b>
        </button>
      })}
    </div>)}
    <div className="pl2-mv-f">{cancel}</div>
  </div>
}
