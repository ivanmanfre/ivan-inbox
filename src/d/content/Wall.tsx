import { Unpublish } from './Unpublish'
import { Fragment, type CSSProperties } from 'react'
import type { ContentDraft } from '../../lib/content'
import { warsawDay, warsawDm, warsawDow } from '../ui/time'
import {
  FEED, LANES, LANE_NAME, imgOf, nextScheduled, publishedCount, scheduledIn,
  timeLine, titleOf, type Lane, type WallDay,
} from './model'
import { badgeOf, cellOrder, describe, weekendAfter, type PlanItem } from './planModel'
import type { ContentData } from './useContentData'

// C's wall planner: seats down the side, weekdays across. Every dated post a
// seat holds is on it (today's calendar builder): a second post on a day
// stacks behind "+N more", a weekend's posts ride on the Friday as "Sat/Sun",
// published history shows its ✓ and real time, a publish-queue-only post is
// drawn inert, a client row dated but not on his board says Planned. A card
// opens the post; ⇄ (or dragging the card onto another day) opens the move.
export type Ghost = { lane: Lane; key: string; title: string; time: string; label: string }

export type WallProps = {
  data: ContentData
  items: Record<Lane, Map<string, PlanItem[]>>
  days: WallDay[]
  stuck: string | null
  onOpen: (id: string, lane: Lane) => void
  onMove: (id: string, lane: Lane, day?: string) => void
  onArm: (id: string) => void
  /** Open the day panel: every post of a seat on these days. */
  onDay: (lane: Lane, keys: string[]) => void
  ghost?: Ghost | null
  lift?: string | null
  held?: { lane: Lane; key: string } | null
  now?: number
  /** The seats drawn, in order (the calendar's client switch); every seat when absent. */
  lanes?: readonly Lane[]
}

export function Card({ r, it, lane, onOpen }: { r: ContentDraft | null; it: PlanItem; lane: Lane; onOpen: () => void }) {
  const img = r ? imgOf(r.image_urls, 400) : null
  const b = badgeOf(it)
  const badge = b ? <span className={`cn-na${b.tone === 'warn' ? ' cn-ns' : b.tone === 'dim' ? ' cn-nd' : ''}`}>{b.text}</span> : null
  const inert = it.source === 'queue' || !r
  // The calendar's pointer engine lifts it (calGestures); a post that must not move says why.
  const refuse = it.stage === 'published' ? 'Already posted. It stays on the day it went out.' : inert ? 'This one lives only in the publish queue, so it can’t move here.' : !it.movable ? `This post is ${r!.status}. Only posts in review or scheduled can move.` : undefined
  const cal = { 'data-cal-id': it.id, 'data-cal-lane': lane, 'data-cal-refuse': refuse }
  const body = (
    <>
      {img
        ? <span className="cn-im" style={{ backgroundImage: `url('${img}')` }}>{badge}</span>
        : <span className="cn-im cn-txt">{badge}<span>{(r?.post_body ?? it.title).slice(0, 90)}</span></span>}
      <b>{r ? titleOf(r) : it.title}</b>
      <small>{timeLine(it.postedAt ?? it.at, lane)}{it.plannedAt ? ' ⚠' : ''}</small>
    </>
  )
  if (inert) return <div className={`cn-card cn-inert${it.stage === 'published' ? ' cn-past' : ''}`} title={describe(it)} aria-label={`${it.title}. ${describe(it)}`} {...cal}>{body}</div>
  return (
    <button type="button" className={`cn-card${it.stage === 'published' ? ' cn-past' : ''}`} onClick={onOpen} data-verb="open" aria-label={`Open ${titleOf(r!)}`} title={describe(it)} {...cal}>
      {body}
    </button>
  )
}

function Plate({ lane, data, days, stuck, compact, now }: { lane: Lane; data: ContentData; days: WallDay[]; stuck: string | null; compact: boolean; now?: number }) {
  const s = data.seats[lane]
  const next = nextScheduled(s.rows, lane, now)
  return (
    <div className="cn-feed">
      <b title={FEED[lane]}>{LANE_NAME[lane]}</b>
      {s.error ? <small className="cn-warn">could not read</small> : (
        <span className="cn-fn"><em>{!s.loadedAt ? '…' : scheduledIn(s.rows, lane, days)}</em>in {days.length === 10 ? '2 weeks' : 'this week'}</span>
      )}
      {!compact && !s.error && s.loadedAt && (
        <>
          <small title={next?.scheduled_at ? `next ${warsawDow(next.scheduled_at)} ${warsawDm(next.scheduled_at)}` : 'nothing next'}>published {publishedCount(s.rows)}</small>
        </>
      )}
      {lane === 'ivan' && stuck && <small className="cn-warn">{stuck}</small>}
    </div>
  )
}

/** A day the calendar's pointer engine can drop a post of this seat on. */
export function dropDay(lane: Lane, key: string) {
  return { 'data-cal-day': key, 'data-cal-lane': lane }
}

export function Wall({ data, items, days, stuck, onOpen, onMove, onArm, onDay, ghost, lift, held, now, lanes = LANES }: WallProps) {
  const ten = days.length > 5
  const cols = ten ? 'var(--feedw) repeat(5,minmax(0,1fr)) 6px repeat(5,minmax(0,1fr))' : 'var(--feedw) repeat(5,minmax(0,1fr))'
  const today = warsawDay(now ?? Date.now())
  const gap = (i: number) => (ten && i === 5 ? <div className="cn-gap" aria-hidden="true" /> : null)
  const style = { gridTemplateColumns: cols, '--feedw': ten ? '118px' : '124px' } as CSSProperties
  return (
    <div className="cn-wall" style={style} role="group" aria-label="Posts by seat and day">
      <div className="cn-wh">Feed</div>
      {days.map((d, i) => <Fragment key={d.key}>{gap(i)}<div className={`cn-wh${d.key === today ? ' cn-tod' : ''}`}><b>{d.dow}</b> {d.n}{ten ? '' : ` ${d.dm.split(' ')[1]}`}{d.key === today && <em>today</em>}</div></Fragment>)}
      {lanes.map(lane => (
        <Fragment key={lane}>
          <Plate lane={lane} data={data} days={days} stuck={stuck} compact={!ten} now={now} />
          {days.map((d, i) => {
            const on = cellOrder(items[lane].get(d.key) ?? [])
            const we = d.dow === 'Fri' ? weekendAfter(d.key) : null
            const weN = we ? we.reduce((a, k) => a + (items[lane].get(k)?.length ?? 0), 0) : 0
            const weekend = weN > 0 && we ? <button type="button" className="cn-more2" onClick={() => onDay(lane, we)}>Sat/Sun {weN}</button> : null
            if (ghost && ghost.lane === lane && ghost.key === d.key) {
              return <Fragment key={d.key}>{gap(i)}<div className="cn-cell cn-land"><div className="cn-ghost"><b>{ghost.label}</b><span>{ghost.title}</span><small>{ghost.time}</small></div></div></Fragment>
            }
            const drop = dropDay(lane, d.key)
            const it = on[0]
            if (!it) return <Fragment key={d.key}>{gap(i)}<div className={`cn-cell cn-none${d.key === today ? ' cn-tod' : ''}`} {...drop}>{weekend && <span className="cn-cellk2">{weekend}</span>}</div></Fragment>
            const r = it.source === 'draft' ? data.seats[lane].rows.find(x => x.id === it.id) ?? null : null
            const cls = ['cn-cell', d.key === today ? 'cn-tod' : '', lift === it.id ? 'cn-lifted' : '', held && held.lane === lane && held.key === d.key ? 'cn-held' : ''].filter(Boolean).join(' ')
            return (
              <Fragment key={d.key}>
                {gap(i)}
                <div className={cls} {...drop}>
                  <Card r={r} it={it} lane={lane} onOpen={() => onOpen(it.id, lane)} />
                  <span className="cn-cellk">
                    {it.unpublishId && <Unpublish id={it.unpublishId} onDone={data.refreshAll} />}
                    {it.armable && <button type="button" className="cn-mini" data-verb="schedule" onClick={() => onArm(it.id)}>Arm it</button>}
                    {it.movable && it.source === 'draft' && lift !== it.id && <button type="button" className="cn-mini" data-verb="move-day" aria-label={`Move ${it.title} to another day`} title="Move to another day" onClick={() => onMove(it.id, lane)}>⇄</button>}
                  </span>
                  {(on.length > 1 || weekend) && (
                    <span className="cn-cellk2">
                      {on.length > 1 && <button type="button" className="cn-more2" data-verb="day" onClick={() => onDay(lane, [d.key])}>+{on.length - 1} more</button>}
                      {weekend}
                    </span>
                  )}
                </div>
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
