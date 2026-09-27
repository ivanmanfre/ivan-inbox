// The top of a seat column (mock `.plate`, `.df-read`, `.df-out`): whose seat, the Needs you
// readout with its no-draft split, Replied 7d, and out per day (messages, invites kept apart)
// with the seat's send schedule so a scheduled zero never reads as broken.
import { SEAT_NAME, type Seat } from '../seats'
import { SCHEDULE, type DayOut } from './model'

const OWNER_LINE: Record<Seat, string> = { ivan: 'your seat', risedtc: "Mattan's seat", arch: "Davorin's seat" }

export function Plate({ seat }: { seat: Seat }) {
  return <div className="dm-plate"><b title={OWNER_LINE[seat]}>{SEAT_NAME[seat]}</b></div>
}

export function Bars({ days, tall = false }: { days: DayOut[]; tall?: boolean }) {
  const max = Math.max(1, ...days.map(d => d.msg))
  const h = tall ? 34 : 22
  return (
    <div className={`dm-bars${tall ? ' dm-bars-t' : ''}`} aria-label="Messages out per day, 7 days" role="img">
      {days.map((d, i) => (
        <i key={d.day} className={`${i === days.length - 1 ? 'dm-now' : ''}${d.msg ? '' : ' dm-z'}`}
          style={{ height: `${Math.max(2, Math.round((d.msg / max) * h))}px` }} title={`${d.day}: ${d.msg} messages, ${d.inv} invites`} />
      ))}
    </div>
  )
}

export function SeatStats({ seat, needs, nodraft, replied, days }: {
  seat: Seat
  /** The frame's number (same read as the panel), or null while it has not landed. */
  needs: number | null
  nodraft: number
  replied: number | null
  days: DayOut[]
}) {
  const today = days.at(-1) ?? { msg: 0, inv: 0 }
  const split = needs != null && needs > 0 && nodraft > 0
  return (
    <>
      <div className="dm-read">
        <div>
          <small>Needs you</small>
          <em className={needs ? 'dm-hot' : 'dm-zero'}>{needs ?? '…'}</em>
          {split && <u><b>{nodraft}</b> no draft</u>}
        </div>
        <div><small>Replied, 7d</small><em>{replied ?? '…'}</em></div>
      </div>
      <div className="dm-out">
        <Bars days={days} />
        <div className="dm-out-tx" title={SCHEDULE[seat]}>
          <span><b>{today.msg}</b> msgs <b>{today.inv}</b> inv today</span>
        </div>
      </div>
    </>
  )
}
