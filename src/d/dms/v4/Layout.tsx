// Brief 4 DMs page frame (SPEC-dms §2.1, §2.6-§2.7). Desktop: seat control + search in the page band,
// list 320 (header, health, body, footer) and the thread. Phone: the same list in one column; the
// thread keeps the full-page takeover. The list body and the pane arrive as nodes built by the legacy
// layout functions (Layouts.tsx), so every handler is the one the legacy layout uses.
import { useEffect, useRef, type ReactNode } from 'react'
import { SEAT_NAME, type Seat, type SeatNumbers } from '../../seats'
import type { DayOut } from '../model'
import { FooterStat } from './Chrome'
import { useHoverPill } from './motion'

/** The list's scroller. Keyed by seat:folder:mode at the call site, so a switch replays the row rise. */
export function ListScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useHoverPill(ref, '.dm-q[role="button"]', true)
  return <div className="dm-colscroll dx-scroll" ref={ref}>{children}</div>
}

export function DesktopDmsV4({ seat, headline, head, health, list, pane, replied, today, listOpen, closeList }: {
  seat: Seat; headline: ReactNode; head: ReactNode; health: ReactNode; list: ReactNode; pane: ReactNode
  replied: number | null; today: DayOut | undefined; listOpen: boolean; closeList: () => void
}) {
  useEffect(() => {
    if (!listOpen) return
    const outside = (e: PointerEvent) => { if (!(e.target as Element)?.closest('.dx-list,.dx-list-trigger')) closeList() }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [listOpen, closeList])
  return (
    <div className="dm-page dm-desk dx-desk" data-v4-guard="">
      {headline}
      <div className="dm-grid4 dx-cols">
        <section className="dm-col dm-list dx-list" data-list-open={listOpen || undefined} aria-label={`${SEAT_NAME[seat]}'s conversations`} data-seat={seat}>
          {head}
          {health}
          {list}
          <FooterStat seat={seat} replied={replied} today={today} />
        </section>
        {pane}
      </div>
    </div>
  )
}

export function PhoneDmsV4({ seat, headline, seats, stat, search, folders, bulk, list }: {
  seat: Seat; headline: ReactNode; seats: ReactNode; stat: ReactNode; search: ReactNode; folders: ReactNode; bulk: ReactNode; list: ReactNode
}) {
  return (
    <div className="dm-page dm-phone dx-phone" data-v4-guard="">
      {headline}
      {seats}
      {stat}
      {search}
      {folders}
      {bulk}
      <section className="dm-col dm-list dx-list" aria-label={`${SEAT_NAME[seat]}'s conversations`} data-seat={seat}>
        {list}
      </section>
    </div>
  )
}

export type { SeatNumbers }
