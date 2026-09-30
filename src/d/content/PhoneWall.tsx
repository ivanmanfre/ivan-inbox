import { Unpublish } from './Unpublish'
import { Fragment } from 'react'
import { warsawDm, warsawDow } from '../ui/time'
import { FEED, LANES, LANE_NAME, nextScheduled, publishedCount, scheduledIn, type Lane, type WallDay } from './model'
import { cellOrder, weekendAfter, type PlanItem } from './planModel'
import { Card, type WallProps } from './Wall'
import type { ContentData } from './useContentData'

// Phone wall (D phone Content): a 3 x 10 ribbon, then one band per seat with a
// strip of every dated card in the two weeks (weekends and a second post on a
// day included; published and queue-only posts drawn as on the wall). Tap =
// open; Move and Arm it sit under each card, never hover.
export function PhoneWall({ data, items, days, stuck, onOpen, onMove, onArm, now }: {
  data: ContentData; items: Record<Lane, Map<string, PlanItem[]>>; days: WallDay[]; stuck: string | null
  onOpen: WallProps['onOpen']; onMove: WallProps['onMove']; onArm: WallProps['onArm']; now?: number
}) {
  const gap = (i: number) => (i === 5 ? <span aria-hidden="true" /> : null)
  const keys = days.flatMap(d => (d.dow === 'Fri' ? [d.key, ...weekendAfter(d.key)] : [d.key]))
  return (
    <>
      <div className="cn-rib" aria-label="Two weeks by seat">
        <span />
        {days.map((d, i) => <Fragment key={d.key}>{gap(i)}<div className="cn-h"><b>{d.dow[0]}</b>{d.n}</div></Fragment>)}
        {LANES.map(l => (
          <Fragment key={l}>
            <div className="cn-f">{LANE_NAME[l]}</div>
            {days.map((d, i) => {
              const on = items[l].get(d.key) ?? []
              const cls = !on.length ? '' : on.some(it => it.stage === 'review' || it.arming === 'planned') ? 'cn-r' : 'cn-s'
              return <Fragment key={d.key}>{gap(i)}<i className={cls} /></Fragment>
            })}
          </Fragment>
        ))}
      </div>
      <div className="cn-key2"><span>▪ scheduled or posted</span><span>□ in review or not set</span><span>▨ nothing</span></div>
      {LANES.map(l => {
        const s = data.seats[l]
        const cards = keys.flatMap(k => cellOrder(items[l].get(k) ?? []))
        const next = nextScheduled(s.rows, l, now)
        return (
          <section key={l} className="cn-band" aria-label={LANE_NAME[l]}>
            <div className="cn-bh">
              <div><b title={FEED[l]}>{LANE_NAME[l]}</b></div>
              {s.error ? <small className="cn-warn">could not read</small> : (
                <div><em>{s.loadedAt ? scheduledIn(s.rows, l, days) : '…'}</em>{s.loadedAt
                  ? <small title={next?.scheduled_at ? `next ${warsawDow(next.scheduled_at)} ${warsawDm(next.scheduled_at)}` : 'nothing next'}>in 2 weeks · published {publishedCount(s.rows)}</small>
                  : <small>in 2 weeks</small>}</div>
              )}
              {l === 'ivan' && stuck && <small className="cn-warn">{stuck}</small>}
            </div>
            <div className="cn-strip">
              {cards.length === 0 && <div className="cn-none">{s.loadedAt ? 'nothing dated in these two weeks' : 'reading…'}</div>}
              {cards.map(it => {
                const r = it.source === 'draft' ? s.rows.find(x => x.id === it.id) ?? null : null
                return (
                  <div key={it.id} className="cn-pc">
                    <div className="cn-dd"><b>{warsawDow(it.postedAt ?? it.at)}</b> {warsawDm(it.postedAt ?? it.at)}</div>
                    <Card r={r} it={it} lane={l} onOpen={() => onOpen(it.id, l)} />
                    <div className="cn-ia">
                      {it.unpublishId && <Unpublish id={it.unpublishId} onDone={data.refreshAll} />}
                      {it.armable && <button type="button" className="cn-mini" data-verb="schedule" onClick={() => onArm(it.id)}>Arm it</button>}
                      {it.movable && it.source === 'draft' && <button type="button" className="cn-mini" data-verb="move-day" aria-label={`Move ${it.title}`} onClick={() => onMove(it.id, l)}>Move</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </>
  )
}
