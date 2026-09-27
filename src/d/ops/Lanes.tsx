import { useState } from 'react'
import { COMMENT_IDEAS_PER_DAY, type OpsDraft } from '../../lib/ops'
import { kindsLine } from '../../wb/ops/lanes'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { Batch } from './Batch'
import { KIND_TITLE, LANE_OWNER, rowLine, type OpsBoard } from './model'

// THE LANES. Desktop: three seat columns side by side, never collapsed, never
// stacked, never scrolling on their own: plate, count, kinds line, quick batch,
// up to three rows around the open card, "N more in this lane", and on Ivan's
// lane the comment ideas for later. Phone: three plates as one row of tabs,
// the chosen lane's rows below.

const SHOW = 3

export function Row({ d, on, onPick }: { d: OpsDraft; on: boolean; onPick: (id: string) => void }) {
  const x = rowLine(d)
  return (
    <button type="button" className={`op-q${on ? ' op-on' : ''}`} data-op-row={d.id} aria-current={on ? 'true' : undefined} onClick={() => onPick(d.id)}>
      <span className="op-qm">
        <span className="op-qn"><b>{x.who}</b> <span>{KIND_TITLE[d.kind].toLowerCase()}</span></span>
        {x.text && <span className="op-qs">{x.text}</span>}
      </span>
      <time className={x.hot && x.time !== 'expired' ? 'op-hot' : ''}>{x.time}</time>
    </button>
  )
}

function Later({ board, sel, onPick }: { board: OpsBoard; sel: string | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  if (board.later.length === 0) return null
  return (
    <>
      <button type="button" className="op-fold" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>Ideas for later</span><b>{board.later.length}</b><small>{COMMENT_IDEAS_PER_DAY} a day</small>
      </button>
      {open && board.later.map(d => <Row key={d.id} d={d} on={d.id === sel} onPick={onPick} />)}
    </>
  )
}

function Column({ seat, board, sel, onPick, refresh }: {
  seat: Seat; board: OpsBoard; sel: string | null; onPick: (id: string) => void; refresh: () => void
}) {
  const [all, setAll] = useState(false)
  const cards = board.lanes[seat]
  const n = cards.length
  const i = Math.max(0, cards.findIndex(d => d.id === sel))
  const from = Math.min(Math.max(0, i - 1), Math.max(0, n - SHOW))
  const vis = all ? cards : cards.slice(from, from + SHOW)
  const selHere = cards.some(d => d.id === sel) || (seat === 'ivan' && board.later.some(d => d.id === sel))
  return (
    <section className={`op-col${selHere ? ' op-col-on' : ''}`} data-seat={seat} aria-label={`${SEAT_NAME[seat]} lane`}>
      <div className="op-plate"><b>{SEAT_NAME[seat]}</b><span>{LANE_OWNER[seat]}</span></div>
      <div className="op-cnt"><em className={n ? '' : 'op-dim'}>{n}</em><small>{n ? kindsLine(cards, true) : 'Nothing waiting'}</small></div>
      <Batch seat={seat} cards={cards} refresh={refresh} />
      {n === 0 && <div className="op-quiet">Nothing waiting on you here.</div>}
      {vis.map(d => <Row key={d.id} d={d} on={d.id === sel} onPick={onPick} />)}
      {n > SHOW && (
        <button type="button" className="op-fold" aria-expanded={all} onClick={() => setAll(a => !a)}>
          <span>{all ? 'Show three' : `${n - SHOW} more in this lane`}</span>
        </button>
      )}
      {seat === 'ivan' && <Later board={board} sel={sel} onPick={onPick} />}
    </section>
  )
}

export function DeskLanes({ board, sel, onPick, refresh }: { board: OpsBoard; sel: string | null; onPick: (id: string) => void; refresh: () => void }) {
  return (
    <div className="op-strip">
      {SEATS.map(s => <Column key={s} seat={s} board={board} sel={sel} onPick={onPick} refresh={refresh} />)}
    </div>
  )
}

export function PhoneLanes({ board, seat, setSeat, onPick, refresh }: {
  board: OpsBoard; seat: Seat; setSeat: (s: Seat) => void; onPick: (id: string) => void; refresh: () => void
}) {
  const cards = board.lanes[seat]
  return (
    <>
      <div className="op-plates" role="tablist" aria-label="Lanes">
        {SEATS.map(s => (
          <button key={s} type="button" role="tab" aria-selected={s === seat} className={`op-pt${s === seat ? ' op-on' : ''}`} onClick={() => setSeat(s)}>
            <b>{SEAT_NAME[s]}</b><small>{LANE_OWNER[s]}</small>
            <em className={board.lanes[s].length ? '' : 'op-dim'}>{board.lanes[s].length}</em>
          </button>
        ))}
      </div>
      <Batch seat={seat} cards={cards} refresh={refresh} />
      <div className="op-sec"><span>{SEAT_NAME[seat]}'s lane</span><span className="op-sk">{cards.length ? kindsLine(cards, true) : ''}</span></div>
      {cards.length === 0 && <div className="op-quiet">Nothing waiting in {SEAT_NAME[seat]}'s lane.</div>}
      {cards.map(d => <Row key={d.id} d={d} on={false} onPick={onPick} />)}
      {seat === 'ivan' && <Later board={board} sel={null} onPick={onPick} />}
    </>
  )
}
