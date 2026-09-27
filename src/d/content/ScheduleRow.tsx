import { Fragment } from 'react'
import { localDay } from '../../lib/content'
import { warsawDm, warsawDow } from '../ui/time'
import type { Slot, WallDay } from './model'

// "Schedule on your feed": the next free weekday (3 days out, 10:45, skipping
// weekends and days his feed already holds), a ribbon of the wall's ten
// weekdays with the taken ones filled and the slot outlined, and the field,
// which stays editable for the times that are not that.
export function localInput(t: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${localDay(t)}T${p(t.getHours())}:${p(t.getMinutes())}`
}

export function ScheduleRow({ slot, when, setWhen, days, taken, armedFailed, current }: {
  slot: Slot | null
  when: string
  setWhen: (s: string) => void
  days: WallDay[]
  taken: Set<string> | null
  armedFailed: boolean
  current: string | null
}) {
  const at = new Date(when)
  const ok = !Number.isNaN(at.getTime())
  const whenKey = ok ? localDay(at) : ''
  const skip = slot && slot.skipped.length
    ? `${slot.skipped[0].day}${slot.skipped.length > 1 ? ` to ${slot.skipped[slot.skipped.length - 1].day}` : ''} ${slot.skipped.length > 1 ? 'are' : 'is'} taken or weekend.`
    : ''
  return (
    <div className="cn-sch">
      <div>
        <small className="cn-cap">{current ? 'Scheduled on your feed' : 'Schedule on your feed'}</small>
        <b>{ok ? `${warsawDow(at)} ${warsawDm(at)}, ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : 'Pick a time'}</b>
        <span className="cn-why">
          {current ? 'Already armed. A new time reschedules it.'
            : armedFailed ? 'Could not read which days your feed holds, so this is 3 days out, unchecked.'
              : slot ? `Next free weekday, 3 days out. ${skip}` : 'Reading your feed…'}
        </span>
      </div>
      <div className="cn-mrib" aria-label="Your feed, next two weeks">
        {days.map((d, i) => (
          <Fragment key={d.key}>
            {i === 5 && <i aria-hidden="true" />}
            <div className={[taken?.has(d.key) ? 'cn-t' : '', d.key === whenKey ? 'cn-slot' : ''].join(' ')} title={taken?.has(d.key) ? `${d.dow} ${d.dm}: has a post` : `${d.dow} ${d.dm}`}>
              <small>{d.dow[0]}</small>{d.n}
            </div>
          </Fragment>
        ))}
      </div>
      <input className="cn-fld" type="datetime-local" aria-label="Publish at" value={when} onChange={e => setWhen(e.target.value)} />
    </div>
  )
}
