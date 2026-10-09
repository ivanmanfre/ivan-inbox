import { Segmented } from '../../../ds/Segmented'
import { monitorLiveness } from '../../../lib/campaignControl'
import { SEAT_NAME, type Seat } from '../../seats'
import { clientOf, seatWord, todayOf } from '../model'
import { seatWarnings, stateTime } from '../SeatSquares'
import { PERSON } from '../seatCells'
import type { LanesData } from '../useLanesData'

export function stripState(d: LanesData, seat: Seat, now: number) {
  const p = d.cc.value
  return { ...seatWord(clientOf(p, seat), p ? monitorLiveness(p, now) : 'unknown'), time: stateTime(d, seat, now), warnings: seatWarnings(d, seat) }
}
export function Strip({ seats, seat, pick, d, now, phone = false }: { seats: Seat[]; seat: Seat; pick: (s: Seat) => void; d: LanesData; now: number; phone?: boolean }) {
  // Phone: the tabs are a 44px segmented control (name + a state dot); the chosen seat's state, warnings and today's counts sit in ONE line under it.
  const chosen = phone ? stripState(d, seat, now) : null
  const chosenToday = phone ? todayOf(d.cc.value, seat, now) : null
  const chosenHealth = phone ? d.health.value?.seats.find(h => h.name === PERSON[seat]) as { sn_credits?: number | null } | undefined : undefined
  const chosenLine = chosen ? chosen.warnings.length ? chosen.warnings.join(' · ') : `${chosenToday?.inv ?? '?'} invites · ${chosenToday?.dm ?? '?'} DMs · ${chosenToday?.inmail ?? '?'} InMail today${chosenHealth?.sn_credits != null ? ` · ${chosenHealth.sn_credits} credits` : ''}` : ''
  return <div className="dl4-strip" data-bx-block>
    <Segmented block markerId="dl4-seat" label="Seats" value={seat} onChange={s => pick(s as Seat)} options={seats.map(s => {
      const w = stripState(d, s, now), t = todayOf(d.cc.value, s, now)
      const health = d.health.value?.seats.find(h => h.name === PERSON[s]) as { sn_credits?: number | null } | undefined
      const line = w.warnings.length ? w.warnings.join(' · ') : `${t?.inv ?? '?'} invites · ${t?.dm ?? '?'} DMs · ${t?.inmail ?? '?'} InMail today${health?.sn_credits != null ? ` · ${health.sn_credits} credits` : ''}`
      return { id: s, label: <span className="dl4-tab" data-pick={s} data-seat={s}>
        <span className="dl4-tab-head"><span className="dl4-avatar">{SEAT_NAME[s][0]}</span><b>{SEAT_NAME[s]}</b>{phone && <i className={`dl4-dot dl4-${w.tone}`} aria-hidden="true" />}<span className={`dl4-pill dl4-${w.tone}`} title={`${w.word}${w.time ? ` · ${w.time}` : ''}`}>
          {!d.cc.value && !d.cc.failed ? <span className="ols-skeleton" aria-label="Reading state" /> : w.word}<span className="dl4-state-time">{w.time && ` · ${w.time}`}</span></span></span>
        <span className={`dl4-tab-line${w.warnings.length ? ' dl4-warn' : ''}`} aria-label={line} title={line} data-seat-warning={w.warnings.length ? '' : undefined}>{line}</span>
      </span> }
    })} />
    {chosen && <div className="dl4-seatline" data-seat={seat}>
      <span className="dl4-seatline-top"><span className={`dl4-pill dl4-${chosen.tone}`}>{!d.cc.value && !d.cc.failed ? <span className="ols-skeleton" aria-label="Reading state" /> : chosen.word}</span>{chosen.time && <span className="dl4-seatline-time">{chosen.time}</span>}</span>
      <span className={`dl4-seatline-text${chosen.warnings.length ? ' dl4-warn' : ''}`}>{chosenLine}</span>
    </div>}
    {seats.map(s => { const h = d.health.value?.seats.find(x => x.name === PERSON[s]); return h?.degraded && h.link ? <a key={s} className="dl4-reconnect" data-verb="reconnect" href={h.link} target="_blank" rel="noreferrer">Reconnect {SEAT_NAME[s]}</a> : null })}
  </div>
}
