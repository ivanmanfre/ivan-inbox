import { useMemo, useState, type DragEvent } from 'react'
import { monthLabel, monthWeeks, shiftMonth } from '../../lib/calendarItems'
import type { ContentDraft } from '../../lib/content'
import { Btn } from '../ui/Key'
import { LANES, LANE_NAME, FEED, type Lane } from './model'
import { badgeOf, cellOrder, describe, monthCounts, undated, waited, type PlanItem } from './planModel'
import { DRAG_MIME, dropZone, type WallProps } from './Wall'

// THE MONTH (today's calendar, in D): one seat at a time, Sunday-start weeks
// with weekends, Previous / Today / Next, the month's three counts with what
// each means, up to two posts per day and "+N more" for the rest, every post
// kind the wall draws, drag a post onto a day to move it, and the undated rail
// ("Show undated drafts · N", remembered like today's) where a draft gets its
// first date: "Give it a date", or drag it onto a day. A drop never writes: it
// opens the move, which is the confirm.
const RAIL_KEY = 'ct-cal-rail'
const VISIBLE = 2

export function Month({ lane, setLane, items, rows, onOpen, onMove, onArm, onDay, now = Date.now() }: {
  lane: Lane; setLane: (l: Lane) => void; items: Map<string, PlanItem[]>; rows: ContentDraft[]
  onOpen: WallProps['onOpen']; onMove: WallProps['onMove']; onArm: WallProps['onArm']; onDay: WallProps['onDay']; now?: number
}) {
  const today = new Date(now)
  const [ym, setYm] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [rail, setRailState] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } })
  const setRail = (v: boolean) => { setRailState(v); try { localStorage.setItem(RAIL_KEY, v ? '1' : '0') } catch { /* private mode */ } }
  const weeks = useMemo(() => monthWeeks(ym.year, ym.month), [ym])
  const inMonth = useMemo(() => new Set(weeks.flat().filter(k => Number(k.slice(5, 7)) - 1 === ym.month)), [weeks, ym.month])
  const counts = monthCounts([...items.values()].flat(), inMonth)
  const loose = useMemo(() => undated(rows), [rows])
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const dragRail = (id: string) => (e: DragEvent) => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ id, lane })); e.dataTransfer.effectAllowed = 'move' }

  return (
    <section className="cn-month" aria-label={`${LANE_NAME[lane]} month`}>
      <div className="cn-mh">
        <div className="cn-seg" role="tablist" aria-label="Seat">
          {LANES.map(l => <button key={l} type="button" role="tab" aria-selected={l === lane} className={l === lane ? 'cn-on' : ''} onClick={() => setLane(l)}>{LANE_NAME[l]}</button>)}
        </div>
        <span className="cn-mnav">
          <button type="button" data-verb="month-prev" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym.year, ym.month, -1))}>‹</button>
          <b>{monthLabel(ym.year, ym.month)}</b>
          <button type="button" data-verb="month-next" aria-label="Next month" onClick={() => setYm(shiftMonth(ym.year, ym.month, 1))}>›</button>
          <button type="button" data-verb="month-today" onClick={() => setYm({ year: today.getFullYear(), month: today.getMonth() })}>Today</button>
        </span>
        <span className="cn-mcounts">
          <span title="Set to publish: the publisher holds it for its time.">{counts.scheduled} set to publish</span>
          <span title="Went out on LinkedIn (or his board) this month.">{counts.posted} posted</span>
          {counts.planned > 0 && <span className="cn-warn" title="Dated, but nothing is set to publish it yet.">{counts.planned} dated, not set</span>}
        </span>
        <button type="button" className="cn-railt" data-verb="rail" aria-expanded={rail} onClick={() => setRail(!rail)}>
          {rail ? 'Hide' : 'Show'} undated drafts · {loose.length}
        </button>
      </div>
      <div className={`cn-mbody${rail ? ' cn-with-rail' : ''}`}>
        <div className="cn-mgrid" role="grid" aria-label={`${FEED[lane]}, ${monthLabel(ym.year, ym.month)}`}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="cn-wh">{d}</div>)}
          {weeks.flat().map(k => {
            const on = cellOrder(items.get(k) ?? [])
            const cls = ['cn-mday', inMonth.has(k) ? '' : 'cn-out', k === todayKey ? 'cn-today' : ''].filter(Boolean).join(' ')
            return (
              <div key={k} className={cls} {...dropZone(lane, k, onMove)}>
                <small>{Number(k.slice(8))}</small>
                {on.slice(0, VISIBLE).map(it => <Chip key={it.id} it={it} lane={lane} onOpen={onOpen} onMove={onMove} onArm={onArm} />)}
                {on.length > VISIBLE && <button type="button" className="cn-more2" data-verb="day" onClick={() => onDay(lane, [k])}>+{on.length - VISIBLE} more</button>}
              </div>
            )
          })}
        </div>
        {rail && (
          <aside className="cn-rail" aria-label="Undated drafts">
            <small className="cn-cap">No date yet, oldest first · drag one onto a day</small>
            {loose.length === 0 && <p className="cn-dim">Every draft that can take a date has one.</p>}
            {loose.map(r => (
              <div key={r.id} className="cn-railrow" draggable={r.movable && lane !== 'arch'} onDragStart={dragRail(r.id)}>
                <button type="button" className="cn-railt2" data-verb="open" onClick={() => onOpen(r.id, lane)}>{r.title}</button>
                <small className="cn-dim">waited {waited(r.createdAt, now)}</small>
                {r.movable && lane !== 'arch' && <Btn verb="give-date" onClick={() => onMove(r.id, lane)}>Give it a date</Btn>}
              </div>
            ))}
          </aside>
        )}
      </div>
    </section>
  )
}

function Chip({ it, lane, onOpen, onMove, onArm }: { it: PlanItem; lane: Lane; onOpen: WallProps['onOpen']; onMove: WallProps['onMove']; onArm: WallProps['onArm'] }) {
  const b = badgeOf(it)
  const inert = it.source === 'queue'
  const drag = !inert && it.movable
  return (
    <div className={`cn-chip2${it.stage === 'published' ? ' cn-posted' : ''}${b?.tone === 'warn' ? ' cn-chip-warn' : ''}`} title={describe(it)}
      draggable={drag} onDragStart={drag ? (e => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ id: it.id, lane })); e.dataTransfer.effectAllowed = 'move' }) : undefined}>
      {inert ? <span className="cn-chipt">{it.title}</span>
        : <button type="button" className="cn-chipt" data-verb="open" onClick={() => onOpen(it.id, lane)}>{it.title}</button>}
      <small>{b ? b.text : ''}{it.plannedAt ? ' · time differs' : ''}</small>
      {(it.armable || (drag && it.source === 'draft')) && (
        <span className="cn-chipk">
          {it.armable && <button type="button" data-verb="schedule" onClick={() => onArm(it.id)}>Arm it</button>}
          {drag && <button type="button" data-verb="move-day" aria-label={`Move ${it.title}`} onClick={() => onMove(it.id, lane)}>Move</button>}
        </span>
      )}
    </div>
  )
}
