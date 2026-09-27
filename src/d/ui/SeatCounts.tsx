import { SEATS, SEAT_NAME, type Seat, type SeatNumbers } from '../seats'

// ONE NUMBER PER SEAT, NEVER A TOTAL. The panel's line under a place
// ("Drafts for you  Ivan 2  Rise 2  Arch 0") and the dock's trio ("2·2·1").
// A number not read yet prints "…"; a failed read prints "?" and says so to a
// screen reader. A seat is never given a number it did not earn.

type Props = {
  numbers: SeatNumbers
  failed?: Partial<Record<Seat, boolean>>
}

function cell(n: number | null, failed: boolean | undefined) {
  if (failed && n == null) return { text: '?', cls: 'd-unk', aria: 'could not read' }
  if (n == null) return { text: '…', cls: 'd-wait', aria: 'reading' }
  return { text: String(n), cls: n > 0 ? 'd-hot' : '', aria: String(n) }
}

/** Panel line: a small caps label, then Ivan n  Rise n  Arch n. */
export function SeatCounts({ label, numbers, failed }: Props & { label: string }) {
  return (
    <div className="d-per" aria-label={`${label}: ${SEATS.map(s => `${SEAT_NAME[s]} ${cell(numbers[s], failed?.[s]).aria}`).join(', ')}`}>
      <small>{label}</small>
      {SEATS.map(s => {
        const c = cell(numbers[s], failed?.[s])
        return (
          <span key={s} className={c.cls} title={c.cls === 'd-unk' ? 'Could not read this count' : undefined}>
            {SEAT_NAME[s]} <b>{c.text}</b>
          </span>
        )
      })}
    </div>
  )
}

/** Dock trio: 2·2·1, a live number lit, a zero plain. */
export function SeatTrio({ numbers, failed }: Props) {
  return (
    <u className="d-trio" aria-label={SEATS.map(s => `${SEAT_NAME[s]} ${cell(numbers[s], failed?.[s]).aria}`).join(', ')}>
      {SEATS.map((s, i) => {
        const c = cell(numbers[s], failed?.[s])
        return (
          <span key={s}>{i > 0 ? '·' : ''}<i className={c.cls}>{c.text}</i></span>
        )
      })}
    </u>
  )
}
