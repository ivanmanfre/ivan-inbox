import { useState } from 'react'
import type { OpsDraft } from '../../lib/ops'
import { kindsLine } from '../../wb/ops/lanes'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { Batch } from './Batch'
import { kindTitle, LANE_OWNER, rowLine, type OpsBoard, type OtherLane } from './model'

// THE LANES. Desktop: three seat columns side by side, never collapsed, never
// stacked, never scrolling on their own: plate, count, kinds line, the comment
// queue's line, quick batch, up to three rows around the open card, "N more in
// this lane", and the lane's OWN comment ideas for later (each seat's poster
// takes 3 a day). A client with no seat gets its own lane under the columns
// (today's lanes.ts), never dropped. Phone: three plates as one row of tabs,
// the chosen lane's rows below, then any other lane.

const SHOW = 3

/** The comment queue's line for a lane's cards (today's per-lane banner), or null. */
export type QueueLine = (ids: ReadonlySet<string>) => { text: string; warn: boolean } | null

export function Row({ d, on, onPick }: { d: OpsDraft; on: boolean; onPick: (id: string) => void }) {
  const x = rowLine(d)
  return (
    <button type="button" className={`op-q${on ? ' op-on' : ''}`} data-op-row={d.id} aria-current={on ? 'true' : undefined} onClick={() => onPick(d.id)}>
      <span className="op-qm">
        <span className="op-qn"><b>{x.who}</b> <span>{kindTitle(d).toLowerCase()}</span></span>
        {x.text && <span className="op-qs">{x.text}</span>}
      </span>
      <time className={x.hot && x.time !== 'expired' ? 'op-hot' : ''}>{x.time}</time>
    </button>
  )
}

function Later({ later, sel, onPick }: { later: OpsDraft[]; sel: string | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  if (later.length === 0) return null
  return (
    <>
      <button type="button" className="op-fold" aria-expanded={open} data-later={later.length} onClick={() => setOpen(o => !o)}>
        <span>Ideas for later</span><b>{later.length}</b>
      </button>
      {open && later.map(d => <Row key={d.id} d={d} on={d.id === sel} onPick={onPick} />)}
    </>
  )
}

function QueueBan({ cards, queueLine }: { cards: OpsDraft[]; queueLine?: QueueLine }) {
  const q = queueLine?.(new Set(cards.map(d => d.id)))
  return q ? <div className={`op-ban${q.warn ? ' op-ban-warn' : ''}`} data-lane-queue>{q.text}</div> : null
}

type LaneProps = { sel: string | null; onPick: (id: string) => void; refresh: () => void; queueLine?: QueueLine }

function Column({ lane, name, owner, cards, later, sel, onPick, refresh, queueLine }: LaneProps & {
  lane: string; name: string; owner: string; cards: OpsDraft[]; later: OpsDraft[]
}) {
  const [all, setAll] = useState(false)
  const n = cards.length
  const i = Math.max(0, cards.findIndex(d => d.id === sel))
  const from = Math.min(Math.max(0, i - 1), Math.max(0, n - SHOW))
  const vis = all ? cards : cards.slice(from, from + SHOW)
  const selHere = cards.some(d => d.id === sel) || later.some(d => d.id === sel)
  return (
    <section className={`op-col${selHere ? ' op-col-on' : ''}`} data-seat={lane} aria-label={`${name} lane`}>
      <div className="op-plate"><b title={owner}>{name}</b></div>
      <div className="op-cnt"><em className={n ? '' : 'op-dim'}>{n}</em><small>{n ? kindsLine(cards, true) : 'Nothing waiting'}</small></div>
      <QueueBan cards={cards} queueLine={queueLine} />
      <Batch lane={lane} cards={cards} refresh={refresh} />
      {vis.map(d => <Row key={d.id} d={d} on={d.id === sel} onPick={onPick} />)}
      {n > SHOW && (
        <button type="button" className="op-fold" aria-expanded={all} onClick={() => setAll(a => !a)}>
          <span>{all ? 'Show three' : `${n - SHOW} more in this lane`}</span>
        </button>
      )}
      <Later later={later} sel={sel} onPick={onPick} />
    </section>
  )
}

function OtherLanes({ other, ...p }: LaneProps & { other: OtherLane[] }) {
  if (other.length === 0) return null
  return (
    <div className="op-strip op-other">
      {other.map(o => <Column key={o.key} lane={o.key} name={o.name} owner="no seat in this app" cards={o.cards} later={o.later} {...p} />)}
    </div>
  )
}

export function DeskLanes({ board, ...p }: LaneProps & { board: OpsBoard }) {
  return (
    <>
      <div className="op-strip">
        {SEATS.map(s => <Column key={s} lane={s} name={SEAT_NAME[s]} owner={LANE_OWNER[s]} cards={board.lanes[s]} later={board.laterBy[s]} {...p} />)}
      </div>
      <OtherLanes other={board.other} {...p} />
    </>
  )
}

export function PhoneLanes({ board, seat, setSeat, onPick, refresh, queueLine }: LaneProps & {
  board: OpsBoard; seat: Seat; setSeat: (s: Seat) => void
}) {
  const cards = board.lanes[seat]
  return (
    <>
      <div className="op-plates" role="tablist" aria-label="Lanes">
        {SEATS.map(s => (
          <button key={s} type="button" role="tab" aria-selected={s === seat} className={`op-pt${s === seat ? ' op-on' : ''}`} onClick={() => setSeat(s)}>
            <b>{SEAT_NAME[s]}</b>
            <em className={board.lanes[s].length ? '' : 'op-dim'}>{board.lanes[s].length}</em>
          </button>
        ))}
      </div>
      <QueueBan cards={cards} queueLine={queueLine} />
      <Batch lane={seat} cards={cards} refresh={refresh} />
      <div className="op-sec"><span>{SEAT_NAME[seat]}'s lane</span><span className="op-sk">{cards.length ? kindsLine(cards, true) : ''}</span></div>
      {cards.length === 0 && <div className="op-quiet">Nothing waiting in {SEAT_NAME[seat]}'s lane.</div>}
      {cards.map(d => <Row key={d.id} d={d} on={false} onPick={onPick} />)}
      <Later later={board.laterBy[seat]} sel={null} onPick={onPick} />
      {board.other.map(o => (
        <div key={o.key} data-seat={o.key}>
          <div className="op-sec"><span>{o.name} lane</span><span className="op-sk">{o.cards.length ? kindsLine(o.cards, true) : ''}</span></div>
          <QueueBan cards={o.cards} queueLine={queueLine} />
          <Batch lane={o.key} cards={o.cards} refresh={refresh} />
          {o.cards.map(d => <Row key={d.id} d={d} on={false} onPick={onPick} />)}
          <Later later={o.later} sel={null} onPick={onPick} />
        </div>
      ))}
    </>
  )
}
