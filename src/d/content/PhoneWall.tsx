import { Fragment } from 'react'
import { warsawDm, warsawDow } from '../ui/time'
import { FEED, LANES, LANE_NAME, isPlanned, isScheduled, nextScheduled, postOn, publishedCount, scheduledIn, titleOf, type Lane, type WallDay } from './model'
import { Card } from './Wall'
import type { ContentData } from './useContentData'

// Phone wall (D phone Content): a 3 x 10 ribbon, then one band per seat with a
// strip of its dated cards. Tap = open; Move sits under each card, never hover.
export function PhoneWall({ data, days, stuck, onOpen, onMove, onArm, now }: {
  data: ContentData; days: WallDay[]; stuck: string | null
  onOpen: (id: string, lane: Lane) => void; onMove: (id: string, lane: Lane) => void; onArm: (id: string) => void; now?: number
}) {
  const gap = (i: number) => (i === 5 ? <span aria-hidden="true" /> : null)
  return (
    <>
      <div className="cn-rib" aria-label="Two weeks by seat">
        <span />
        {days.map((d, i) => <Fragment key={d.key}>{gap(i)}<div className="cn-h"><b>{d.dow[0]}</b>{d.n}</div></Fragment>)}
        {LANES.map(l => (
          <Fragment key={l}>
            <div className="cn-f">{LANE_NAME[l]}</div>
            {days.map((d, i) => {
              const r = postOn(data.seats[l].rows, l, d.key)
              const cls = !r ? '' : r.status === 'review' || isPlanned(r, l) ? 'cn-r' : 'cn-s'
              return <Fragment key={d.key}>{gap(i)}<i className={cls} /></Fragment>
            })}
          </Fragment>
        ))}
      </div>
      <div className="cn-key2"><span>▪ scheduled</span><span>□ in review</span><span>▨ nothing</span></div>
      {LANES.map(l => {
        const s = data.seats[l]
        const cards = days.map(d => postOn(s.rows, l, d.key)).filter((r): r is NonNullable<typeof r> => !!r)
        const next = nextScheduled(s.rows, l, now)
        return (
          <section key={l} className="cn-band" aria-label={LANE_NAME[l]}>
            <div className="cn-bh">
              <div><b>{LANE_NAME[l]}</b> <small>{FEED[l]}</small></div>
              {s.error ? <small className="cn-warn">could not read</small> : (
                <div><em>{s.loadedAt ? scheduledIn(s.rows, l, days) : '…'}</em><small>in 2 weeks · next {next?.scheduled_at ? `${warsawDow(next.scheduled_at)} ${warsawDm(next.scheduled_at)}` : 'none'} · published {publishedCount(s.rows)}</small></div>
              )}
              {l === 'ivan' && stuck && <small className="cn-warn">{stuck}</small>}
            </div>
            <div className="cn-strip">
              {cards.length === 0 && <div className="cn-none">{s.loadedAt ? 'nothing dated in these two weeks' : 'reading…'}</div>}
              {cards.map(r => (
                <div key={r.id} className="cn-pc">
                  <div className="cn-dd"><b>{warsawDow(r.scheduled_at as string)}</b> {warsawDm(r.scheduled_at as string)}{!isScheduled(r, l) && isPlanned(r, l) ? ' · not armed' : ''}</div>
                  <Card r={r} lane={l} onOpen={() => onOpen(r.id, l)} />
                  <div className="cn-ia">
                    {isPlanned(r, l) && <button type="button" className="cn-mini" data-verb="schedule" onClick={() => onArm(r.id)}>Arm it</button>}
                    {(r.status === 'review' || r.status === 'scheduled') && <button type="button" className="cn-mini" data-verb="move-day" aria-label={`Move ${titleOf(r)}`} onClick={() => onMove(r.id, l)}>Move</button>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}
