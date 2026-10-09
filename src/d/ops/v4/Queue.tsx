import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../../../ds/Avatar'
import { Badge } from '../../../ds/Badge'
import { Segmented } from '../../../ds/Segmented'
import { LiveDot } from '../../../ds/Working'
import { outboundFeedId } from '../../../lib/ops'
import type { useCommentQueue } from '../../../hooks/useCommentQueue'
import type { useReactions } from '../../../hooks/useReactions'
import { kindsLine } from '../../../wb/ops/lanes'
import { SEATS, SEAT_NAME } from '../../seats'
import { Failed } from '../../ui/states'
import { Batch } from '../Batch'
import type { OpsBoard } from '../model'
import { ago } from '../model'
import { Tasks } from '../Tasks'
import { OpsReferences } from '../../../components/OpsReferences'
import { QueueRow } from './QueueRow'
type Props = {
  board: OpsBoard; drafts: Parameters<typeof Tasks>[0]['drafts']; lane: string; selected: string | null; selectedRx: string | null
  onSeat: (lane: string) => void; onPick: (id: string) => void; onReaction: (id: string) => void; refresh: () => void
  queue: ReturnType<typeof useCommentQueue>; rx: ReturnType<typeof useReactions>; onActed: (id: string, verb: string) => void
}
export function QueuePane({ board, drafts, lane, selected, selectedRx, onSeat, onPick, onReaction, refresh, queue, rx, onActed }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelectorAll('.ds-seg-item>.ds-badge').forEach(n => n.setAttribute('data-roll', '')) })
  const [laterOpen, setLaterOpen] = useState(false)
  const [highlight, setHighlight] = useState<string[]>([])
  const options = [...SEATS.map((s, i) => ({ id: s, label: <><Avatar name={SEAT_NAME[s]} initials={['I', 'R', 'A'][i]} size="sm" tint={(i + 1) as 1 | 2 | 3} /><span>{SEAT_NAME[s]}</span></>, count: board.waiting[s] })),
    ...board.other.map(o => ({ id: o.key, label: <span>{o.name}</span>, count: o.waiting }))]
  const known = SEATS.find(s => s === lane)
  const other = board.other.find(o => o.key === lane)
  const cards = known ? board.lanes[known] : other?.cards ?? []
  const later = known ? board.laterBy[known] : other?.later ?? []
  const name = known ? SEAT_NAME[known] : lane
  const n = queue.waiting.filter(e => cards.some(d => d.id === e.id)).length
  const row = (d: typeof cards[number]) => <QueueRow key={d.id} d={d} selected={selected === d.id} onPick={onPick}
    held={queue.held.has(d.id)} feed={queue.feed.get(outboundFeedId(d) ?? '')} position={queue.positionOf(d.id)} highlight={highlight.includes(d.id)} />
  return <div ref={ref} className="op4-queue-content">
    <Segmented options={options} value={lane} label="Seats" markerId="op4-seat" block className="op4-seats" onChange={onSeat} />
    <div className="op4-laneline"><span>{kindsLine(cards, true)}</span>{n > 0 && <Badge tone={queue.cappedToday ? 'attention' : 'neutral'} label={queue.cappedToday ? `${n} held: 3-a-day cap reached. Back tomorrow.` : `${n} queued. Leave the tab open.`}>{!queue.cappedToday && <LiveDot label="In the comment line" />}{n} {queue.cappedToday ? 'held: cap reached' : 'queued'}</Badge>}</div>
    <Batch lane={lane} cards={cards} refresh={refresh} look="v4" onActed={onActed} onHighlight={setHighlight} />
    <div className="op4-rows" data-queue-lane={lane}>{cards.length ? cards.map(row) : <div className="op-quiet">Nothing waiting in {name}’s lane.</div>}</div>
    {later.length > 0 && <><button type="button" className="op-fold" aria-expanded={laterOpen} title="Past the 3 a day the poster takes. They wait here, nothing is dropped." onClick={() => setLaterOpen(o => !o)}>Ideas for later <b>{later.length}</b></button>{laterOpen && <div className="op4-later">{later.map(row)}</div>}</>}
    <OpsReferences drafts={drafts} />
    <Tasks drafts={drafts} refresh={refresh} />
    <section className="op-rxs" aria-label="Reactions"><div className="op-sec"><span>Reactions <b>{rx.loading && !rx.rows.length ? '…' : rx.rows.length}</b></span></div>
      {rx.error && <Failed what="the reaction desk" detail={rx.error} onRetry={rx.refresh} />}
      {!rx.error && !rx.loading && !rx.rows.length && <div className="op-quiet">No reaction waiting.</div>}
      {rx.rows.map(r => { const who = r.evidence?.who ?? r.evidence?.author ?? 'Reaction'; return <button type="button" key={r.id} className={`op-q op4-row${selectedRx === r.id ? ' op-on' : ''}`} data-reaction={r.id} aria-current={selectedRx === r.id ? 'true' : undefined} onClick={() => onReaction(r.id)}>
        <Avatar size="sm" name={who} initials={who.slice(0, 2).toUpperCase()} /><span className="op4-rowmain"><span className="op4-rowtop"><b>{who}</b><time>{ago(r.evidence?.created_at ?? r.ingested_at)}</time></span><span className="op4-rowbottom"><Badge>{r.lane === 'risedtc' ? 'Rise' : 'Ivan'}</Badge><span className="op-qs">{r.raw_topic ?? r.evidence?.excerpt}</span>{!r.shot_url && <Badge tone="attention">no screenshot yet</Badge>}</span></span>
      </button> })}
    </section>
  </div>
}
