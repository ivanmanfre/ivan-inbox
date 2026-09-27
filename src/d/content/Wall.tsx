import { Fragment, type CSSProperties } from 'react'
import type { ContentDraft } from '../../lib/content'
import { warsawDm, warsawDow } from '../ui/time'
import {
  FEED, LANES, LANE_NAME, imgOf, isPlanned, nextScheduled, postOn, publishedCount, scheduledIn,
  timeLine, titleOf, type Lane, type WallDay,
} from './model'
import type { ContentData } from './useContentData'

// C's wall planner: seats down the side, weekdays across. A card opens the
// post; "Move" on a card opens the move panel; an Ivan row that is dated but
// not armed says so and carries "Arm it".
export type Ghost = { lane: Lane; key: string; title: string; time: string; label: string }

type Props = {
  data: ContentData
  days: WallDay[]
  stuck: string | null
  onOpen: (id: string, lane: Lane) => void
  onMove: (id: string, lane: Lane) => void
  onArm: (id: string) => void
  ghost?: Ghost | null
  lift?: string | null
  held?: { lane: Lane; key: string } | null
  now?: number
}

export function Card({ r, lane, onOpen }: { r: ContentDraft; lane: Lane; onOpen: () => void }) {
  const img = imgOf(r.image_urls, 400)
  const planned = isPlanned(r, lane)
  const badge = planned ? <span className="cn-na cn-ns">NOT SCHEDULED</span>
    : r.status === 'review' ? <span className="cn-na">IN REVIEW</span> : null
  return (
    <button type="button" className="cn-card" onClick={onOpen} data-verb="open" aria-label={`Open ${titleOf(r)}`}>
      {img
        ? <span className="cn-im" style={{ backgroundImage: `url('${img}')` }}>{badge}</span>
        : <span className="cn-im cn-txt">{badge}<span>{(r.post_body ?? '').slice(0, 90)}</span></span>}
      <b>{titleOf(r)}</b>
      <small>{r.scheduled_at ? timeLine(r.scheduled_at, lane) : ''}</small>
    </button>
  )
}

function Plate({ lane, data, days, stuck, compact, now }: { lane: Lane; data: ContentData; days: WallDay[]; stuck: string | null; compact: boolean; now?: number }) {
  const s = data.seats[lane]
  const next = nextScheduled(s.rows, lane, now)
  return (
    <div className="cn-feed">
      <b>{LANE_NAME[lane]}</b>
      <small>{FEED[lane]}</small>
      {s.error ? <small className="cn-warn">could not read</small> : (
        <span className="cn-fn"><em>{s.loading && !s.loadedAt ? '…' : scheduledIn(s.rows, lane, days)}</em>in {days.length === 10 ? '2 weeks' : 'this week'}</span>
      )}
      {!compact && !s.error && s.loadedAt && (
        <>
          <small>next {next?.scheduled_at ? `${warsawDow(next.scheduled_at)} ${warsawDm(next.scheduled_at)}` : 'none'}</small>
          <small>published {publishedCount(s.rows)}</small>
        </>
      )}
      {lane === 'ivan' && stuck && <small className="cn-warn">{stuck}</small>}
    </div>
  )
}

export function Wall({ data, days, stuck, onOpen, onMove, onArm, ghost, lift, held, now }: Props) {
  const ten = days.length > 5
  const cols = ten ? 'var(--feedw) repeat(5,minmax(0,1fr)) 6px repeat(5,minmax(0,1fr))' : 'var(--feedw) repeat(5,minmax(0,1fr))'
  const gap = (i: number) => (ten && i === 5 ? <div className="cn-gap" aria-hidden="true" /> : null)
  const style = { gridTemplateColumns: cols, '--feedw': ten ? '118px' : '124px' } as CSSProperties
  return (
    <div className="cn-wall" style={style} role="grid" aria-label="Posts by seat and day">
      <div className="cn-wh">Feed</div>
      {days.map((d, i) => <Fragment key={d.key}>{gap(i)}<div className="cn-wh"><b>{d.dow}</b> {d.n}{ten ? '' : ` ${d.dm.split(' ')[1]}`}</div></Fragment>)}
      {LANES.map(lane => (
        <Fragment key={lane}>
          <Plate lane={lane} data={data} days={days} stuck={stuck} compact={!ten} now={now} />
          {days.map((d, i) => {
            if (ghost && ghost.lane === lane && ghost.key === d.key) {
              return <Fragment key={d.key}>{gap(i)}<div className="cn-cell cn-land"><div className="cn-ghost"><b>{ghost.label}</b><span>{ghost.title}</span><small>{ghost.time}</small></div></div></Fragment>
            }
            const r = postOn(data.seats[lane].rows, lane, d.key)
            if (!r) return <Fragment key={d.key}>{gap(i)}<div className="cn-cell cn-none" /></Fragment>
            const cls = ['cn-cell', lift === r.id ? 'cn-lifted' : '', held && held.lane === lane && held.key === d.key ? 'cn-held' : ''].filter(Boolean).join(' ')
            const canMove = r.status === 'review' || r.status === 'scheduled'
            return (
              <Fragment key={d.key}>
                {gap(i)}
                <div className={cls}>
                  <Card r={r} lane={lane} onOpen={() => onOpen(r.id, lane)} />
                  <span className="cn-cellk">
                    {isPlanned(r, lane) && <button type="button" className="cn-mini" data-verb="schedule" onClick={() => onArm(r.id)}>Arm it</button>}
                    {canMove && lift !== r.id && <button type="button" className="cn-mini" data-verb="move-day" aria-label={`Move ${titleOf(r)} to another day`} title="Move to another day" onClick={() => onMove(r.id, lane)}>⇄</button>}
                  </span>
                </div>
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
