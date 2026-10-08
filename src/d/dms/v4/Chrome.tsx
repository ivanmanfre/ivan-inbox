// Brief 4 DMs chrome (SPEC-dms §2.2-§2.3.6): the seat control in the page band, the list header
// (folders + filter), the health line and the footer stat. Presentational: every value and closure
// arrives already computed by Dms() (index.tsx); seat and folder picks go through the guarded
// navigators there. Hooks sit at the top of each component, before any return.
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { SEATS, SEAT_NAME, SEAT_OWNER, type Seat, type SeatNumbers } from '../../seats'
import type { DayOut } from '../model'
import { SCHEDULE } from '../model'
import { Count } from '../../ui/Count'
import { useMotionLevel } from '../../../ds/motionLevel'
import { useThumb } from './motion'

const WHOSE: Record<Seat, string> = { ivan: 'Your seat', risedtc: "Mattan's seat", arch: "Davorin's seat" }

/** The whole seat readout, said once: tooltip and aria-label (the activity 3.0 hid in sr-only text). */
export function seatReadout(s: Seat, needs: number | null | undefined, drafts: number | null | undefined, replied: number | null, today: DayOut | undefined): string {
  const n = needs == null ? 'needs you unknown' : `${needs} needs you`
  const d = drafts == null ? 'drafts unknown' : `${drafts} draft${drafts === 1 ? '' : 's'}`
  return `${WHOSE[s]} · ${n} · ${d} · replied 7d ${replied ?? '…'} · today ${today?.msg ?? 0} msgs ${today?.inv ?? 0} inv · ${SCHEDULE[s]}`
}

export function SeatSeg({ seat, pick, needs, drafts, stats, phone = false }: {
  seat: Seat; pick: (s: Seat) => void; needs: SeatNumbers; drafts: SeatNumbers
  stats: Record<Seat, { replied: number | null; today: DayOut | undefined }>; phone?: boolean
}) {
  const level = useMotionLevel()
  const track = useRef<HTMLDivElement>(null)
  const previous = useRef(seat)
  useLayoutEffect(() => {
    if (previous.current !== seat && level !== 'off' && track.current) {
      track.current.classList.remove('dx-thumb-jump'); void track.current.offsetWidth; track.current.classList.add('dx-thumb-jump')
    }
    previous.current = seat
  }, [seat, level])
  const i = Math.max(0, SEATS.indexOf(seat))
  return (
    <div ref={track} className={`dx-seats${phone ? ' dx-seats-phone' : ''}`} role="tablist" aria-label="Seats" style={{ '--i': i } as CSSProperties}>
      <span className="dx-seats-thumb" aria-hidden="true"><span /></span>
      {SEATS.map(s => {
        const n = needs[s]
        const tip = seatReadout(s, n, drafts[s], stats[s].replied, stats[s].today)
        return (
          <button key={s} type="button" role="tab" aria-selected={s === seat} data-pick={s} className={`dm-sq dx-seat${s === seat ? ' dm-on' : ''}`}
            title={tip} aria-label={`${SEAT_NAME[s]}: ${tip}`} onClick={() => pick(s)}>
            <b>{SEAT_NAME[s]}</b>
            <em className={`dx-badge ${n == null ? 'dx-badge-unk' : n ? 'dx-badge-hot' : 'dx-badge-zero'}`} aria-hidden="true">{n == null ? '?' : <Count value={n} duration={480} />}</em>
          </button>
        )
      })}
    </div>
  )
}

/** The list header: the folder control (a measured thumb) and the filter. */
export function ListHead({ folders, filter, pick }: { folders: ReactNode; filter: ReactNode; pick: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useThumb(ref, '.dm-folders', pick, true)
  return (
    <div className="dx-lhead" ref={ref}>
      {folders}
      <span className="dx-lhead-f">{filter}</span>
    </div>
  )
}

/** The seat's activity, visible (SPEC-dms §2.3.6). */
export function FooterStat({ seat, replied, today }: { seat: Seat; replied: number | null; today: DayOut | undefined }) {
  return (
    <div className="dx-foot" title={SEAT_OWNER[seat]}>
      {SEAT_NAME[seat]} · replied 7d <b>{replied ?? '…'}</b> · today <b>{today?.msg ?? 0}</b> msgs · <b>{today?.inv ?? 0}</b> inv · {SCHEDULE[seat]}
    </div>
  )
}
