import { Unpublish } from './Unpublish'
import { Btn } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { LANE_NAME, dayLabel, timeLine, type Lane } from './model'
import { badgeOf, cellOrder, describe, type PlanItem } from './planModel'

// Today's day panel ("+N more" on the month grid): every post a seat holds on
// the day(s), in firing order, each with what it is (posted and when, set to
// publish, dated but not set, queue only) and its own Open / Move / Arm it.
export function DayPanel({ lane, keys, items, onClose, onOpen, onMove, onArm, onChanged = () => {} }: {
  lane: Lane; keys: string[]; items: Map<string, PlanItem[]>; onClose: () => void
  onOpen: (id: string, lane: Lane) => void; onMove: (id: string, lane: Lane) => void; onArm: (id: string) => void; onChanged?: () => void
}) {
  return (
    <Sheet open onClose={onClose} title={`${LANE_NAME[lane]} · ${keys.map(dayLabel).join(' and ')}`} sub="Every post this seat holds on the day">
      <div className="cn-daylist">
        {keys.map(k => {
          const on = cellOrder(items.get(k) ?? [])
          return (
            <section key={k}>
              {keys.length > 1 && <small className="cn-cap">{dayLabel(k)}</small>}
              {on.length === 0 && <p className="cn-dim">Nothing on {dayLabel(k)}.</p>}
              {on.map(it => {
                const b = badgeOf(it)
                return (
                  <div key={it.id} className="cn-dayrow">
                    <span className="cn-mono">{timeLine(it.postedAt ?? it.at, lane)}</span>
                    <div><b>{it.title}</b>{b && <small className={b.tone === 'warn' ? 'cn-warn' : ''}> · {b.text}</small>}<small className="cn-dim">{describe(it)}</small></div>
                    <span className="cn-ia">
                      {it.postedUrl && <a className="cn-mini" href={it.postedUrl} target="_blank" rel="noreferrer">Open post</a>}
                      {it.unpublishId && <Unpublish id={it.unpublishId} onDone={onChanged} />}
                      {it.source === 'draft' && <Btn verb="open" onClick={() => { onClose(); onOpen(it.id, lane) }}>Open</Btn>}
                      {it.source === 'draft' && it.movable && <Btn verb="move-day" onClick={() => { onClose(); onMove(it.id, lane) }}>Move</Btn>}
                      {it.armable && <Btn verb="schedule" onClick={() => { onClose(); onArm(it.id) }}>Arm it</Btn>}
                    </span>
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </Sheet>
  )
}
