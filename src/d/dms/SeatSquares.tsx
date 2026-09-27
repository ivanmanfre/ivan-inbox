// One seat at a time (Ivan 09-27, the Lanes pattern: "three seat squares on top, click one, only
// that seat below"). Each square: whose seat, Needs you (the frame's number, so the rail and the page
// never disagree), drafts ready, replied in 7 days and today's sends. Clicking one picks the seat the
// list below shows; the choice is remembered. Seats are never added together.
import { SEATS, SEAT_NAME, SEAT_OWNER, type Seat, type SeatNumbers } from '../seats'
import type { DayOut } from './model'

const KEY = 'd.dms.seat.v1'

export function readSeat(): Seat | null {
  try { const v = localStorage.getItem(KEY); return (SEATS as readonly string[]).includes(v ?? '') ? v as Seat : null } catch { return null }
}
export function writeSeat(s: Seat) {
  try { localStorage.setItem(KEY, s) } catch { /* private mode: this session only */ }
}

/** The seat to show: the one in the link, else the remembered one, else the one with the most
 *  Needs you (Ivan's on a tie or while the counts are still reading). */
export function pickSeat(fromRoute: string | null, stored: Seat | null, needs: SeatNumbers): Seat {
  if ((SEATS as readonly string[]).includes(fromRoute ?? '')) return fromRoute as Seat
  if (stored) return stored
  let best: Seat = 'ivan'
  for (const s of SEATS) if ((needs[s] ?? -1) > (needs[best] ?? -1)) best = s
  return best
}

export type SquareStat = { replied: number | null; today: DayOut | undefined; extra?: string | null }

export function SeatSquares({ seat, pick, needs, drafts, stats, phone = false }: {
  seat: Seat; pick: (s: Seat) => void; needs: SeatNumbers; drafts: SeatNumbers; stats: Record<Seat, SquareStat>; phone?: boolean
}) {
  return (
    <div className={`dm-sqs${phone ? ' dm-sqs-phone' : ''}`} role="tablist" aria-label="Seats">
      {SEATS.map(s => {
        const n = needs[s], d = drafts[s], st = stats[s]
        return (
          <button key={s} type="button" role="tab" aria-selected={s === seat} data-pick={s} className={`dm-sq${s === seat ? ' dm-on' : ''}`}
            title={SEAT_OWNER[s]} onClick={() => pick(s)}>
            <span className="dm-sq-h"><b>{SEAT_NAME[s]}</b>{!phone && st.extra && <small>{st.extra}</small>}</span>
            <span className="dm-sq-n">
              <em className={n == null ? 'dm-q' : n ? 'dm-hot' : 'dm-zero'}>{n ?? '?'}</em>
              <small>Needs you</small>
            </span>
            <span className="dm-sq-l">
              <span><b>{d ?? '?'}</b> draft{d === 1 ? '' : 's'}</span>
              {!phone && <span><b>{st.replied ?? '…'}</b> replied 7d</span>}
              {!phone && <span><b>{st.today?.msg ?? 0}</b> msgs <b>{st.today?.inv ?? 0}</b> inv today</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
