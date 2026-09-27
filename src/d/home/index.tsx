/* ==========================================================================
   src/d/home — Home, the landing. Per seat (Ivan, Rise, Arch): next week's
   posts, DM drafts, invites today, ready leads, rate limit. Then Tasks.
   One big number and a short label per tile, nothing else; every tile opens
   the page that acts on it. Desktop: three seat columns, tiles aligned in rows.
   Phone: one stacked block per seat.
   Address: #exp/d/home
   ========================================================================== */
import type { ReactNode } from 'react'
import type { PlaceProps } from '../places'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { AnswerRow } from '../ui/AnswerRow'
import { Offline } from '../ui/states'
import { useOnline } from '../ui/useOnline'
import { useHome, type HomeData } from './reads'
import { HomeTasks } from './Tasks'
import { Drafts, Invites, Limit, NextWeek, Ready } from './Tiles'
import './home.css'

function SeatBlock({ seat, h }: { seat: Seat; h: HomeData }) {
  return (
    <section className="hm-seat" aria-label={SEAT_NAME[seat]} data-seat={seat}>
      <h2 className="hm-sn">{SEAT_NAME[seat]}</h2>
      <NextWeek seat={seat} h={h} />
      <div className="hm-pair"><Drafts seat={seat} h={h} /><Invites seat={seat} h={h} /></div>
      <div className="hm-pair"><Ready seat={seat} h={h} /><Limit seat={seat} h={h} /></div>
    </section>
  )
}

export default function HomePage({ layout }: PlaceProps) {
  const h = useHome()
  const online = useOnline()
  // Desktop: rows of the same tile across the three seats, so a number sits beside its peers.
  const rows: Array<[string, (p: { seat: Seat; h: HomeData }) => ReactNode]> = [
    ['week', NextWeek],
    ['work', p => <div className="hm-pair"><Drafts {...p} /><Invites {...p} /></div>],
    ['send', p => <div className="hm-pair"><Ready {...p} /><Limit {...p} /></div>],
  ]
  return (
    <div className={`hm hm-${layout}`}>
      {layout === 'desktop' && <AnswerRow title="Home" />}
      {!online && <Offline since={null} />}
      {layout === 'desktop' ? (
        <div className="hm-grid">
          {SEATS.map(s => <h2 key={s} className="hm-sn">{SEAT_NAME[s]}</h2>)}
          {rows.map(([id, Cell]) => SEATS.map(s => <div key={`${id}-${s}`} className={`hm-c hm-c-${id}`}><Cell seat={s} h={h} /></div>))}
        </div>
      ) : (
        <div className="hm-stack">{SEATS.map(s => <SeatBlock key={s} seat={s} h={h} />)}</div>
      )}
      <HomeTasks />
    </div>
  )
}
