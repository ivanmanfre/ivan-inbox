import { Segmented } from '../../../ds/Segmented'
import { monitorLiveness } from '../../../lib/campaignControl'
import { SEAT_NAME, STUDIO_NAME, isStudioSeat, type Seat } from '../../seats'
import { clientOf, seatWord, todayOf } from '../model'
import { OUT_OF_LEADS, seatWarnings, stateTime } from '../SeatSquares'
import { PERSON } from '../seatCells'
import type { AnnaRead } from '../anna'
import type { LanesData } from '../useLanesData'

export function stripState(d: LanesData, seat: Seat, now: number, annaRead?: AnnaRead, leah?: AnnaRead) {
  const anna = seat === 'leah' ? leah : annaRead
  if (isStudioSeat(seat)) return { word: anna?.error ? 'Unverified' : !anna?.value ? 'Reading' : !anna.value.enabled ? 'Paused' : anna.value.pause_reason ? 'On hold' : 'Enabled', tone: anna?.error || anna?.value?.pause_reason ? 'warn' : 'neutral', time: null, warnings: [] as string[] }
  const p = d.cc.value
  return { ...seatWord(clientOf(p, seat), p ? monitorLiveness(p, now) : 'unknown'), time: stateTime(d, seat, now), warnings: seatWarnings(d, seat, now) }
}

/** Today's invites, DMs and InMail, always. A number the monitor did not give is "?", never a hidden row and never a warning in its place. */
export function todayLine(t: { inv: number | null; dm: number | null; inmail: number | null } | null, credits?: number | null): string {
  return `${t?.inv ?? '?'} invites · ${t?.dm ?? '?'} DMs · ${t?.inmail ?? '?'} InMail today${credits != null ? ` · ${credits} credits` : ''}`
}
/** Real problems (disconnected, Sales Nav broken) keep the warning colour; the supply note is quiet. */
export const isProblem = (w: string) => w !== OUT_OF_LEADS
export function Strip({ seats, seat, pick, d, now, phone = false, anna, leah, setupKey, pickSetup }: { seats: Seat[]; seat: Seat; pick: (s: Seat) => void; d: LanesData; now: number; phone?: boolean; anna?: AnnaRead; leah?: AnnaRead; setupKey?: string | null; pickSetup?: (key: string) => void }) {
  // Phone: the tabs are a 44px segmented control (name + a state dot); the chosen seat's state, warnings and today's counts sit in ONE line under it.
  const chosen = phone ? stripState(d, seat, now, anna, leah) : null
  const chosenToday = phone ? todayOf(d.cc.value, seat, now) : null
  const chosenHealth = phone ? d.health.value?.seats.find(h => h.name === PERSON[seat]) as { sn_credits?: number | null } | undefined : undefined
  const studioLine = (s: 'anna' | 'leah') => { const r = s === 'leah' ? leah : anna; return r?.error ? 'Current counts unavailable' : r?.value ? `${r.value.sent_today} / ${r.value.daily_cap} invites today` : `Reading ${STUDIO_NAME[s]}’s invitations…` }
  const chosenLine = isStudioSeat(seat) ? studioLine(seat) : chosen ? todayLine(chosenToday, chosenHealth?.sn_credits) : ''
  return <div className="dl4-strip" data-bx-block>
    <Segmented block markerId="dl4-seat" label="Seats" value={setupKey ? `setup/${setupKey}` : seat} onChange={s => s.startsWith('setup/') ? pickSetup?.(s.slice(6)) : pick(s as Seat)} options={[...seats.map(s => {
      const w = stripState(d, s, now, anna, leah), t = todayOf(d.cc.value, s, now)
      const health = d.health.value?.seats.find(h => h.name === PERSON[s]) as { sn_credits?: number | null } | undefined
      const line = isStudioSeat(s) ? studioLine(s) : todayLine(t, health?.sn_credits), note = w.warnings.join(' · ')
      return { id: s, label: <span className="dl4-tab" data-pick={s} data-seat={s}>
        <span className="dl4-tab-head"><span className="dl4-avatar">{SEAT_NAME[s][0]}</span><b>{SEAT_NAME[s]}</b>{phone && <i className={`dl4-dot dl4-${w.tone}`} aria-hidden="true" />}<span className={`dl4-pill dl4-${w.tone}`} title={`${w.word}${w.time ? ` · ${w.time}` : ''}`}>
          {!isStudioSeat(s) && !d.cc.value && !d.cc.failed ? <span className="ols-skeleton" aria-label="Reading state" /> : w.word}<span className="dl4-state-time">{w.time && ` · ${w.time}`}</span></span></span>
        <span className="dl4-tab-line" aria-label={line} title={line}>{line}</span>
        {note && <span className={`dl4-tab-note${w.warnings.some(isProblem) ? ' dl4-warn' : ''}`} title={note} data-seat-warning="">{note}</span>}
      </span> }
    }), ...(anna?.value?.setups ?? []).filter(link => !(seats as string[]).includes(link.key)).map(link => ({
      id: `setup/${link.key}`, label: <span className="dl4-tab">
        <span className="dl4-tab-head"><span className="dl4-avatar">{link.name[0]}</span><b title={link.name}>{link.name.split(/\s+/)[0]}</b></span>
        <span className="dl4-tab-line">Connection status only</span>
      </span>,
    }))]} />
    {!setupKey && chosen && <div className="dl4-seatline" data-seat={seat}>
      <span className="dl4-seatline-top"><span className={`dl4-pill dl4-${chosen.tone}`}>{!isStudioSeat(seat) && !d.cc.value && !d.cc.failed ? <span className="ols-skeleton" aria-label="Reading state" /> : chosen.word}</span>{chosen.time && <span className="dl4-seatline-time">{chosen.time}</span>}</span>
      <span className="dl4-seatline-text">{chosenLine}</span>
      {chosen.warnings.length > 0 && <span className={`dl4-seatline-note${chosen.warnings.some(isProblem) ? ' dl4-warn' : ''}`} data-seat-warning="">{chosen.warnings.join(' · ')}</span>}
    </div>}
    {seats.map(s => { const h = d.health.value?.seats.find(x => x.name === PERSON[s]); return h?.degraded && h.link ? <a key={s} className="dl4-reconnect" data-verb="reconnect" href={h.link} target="_blank" rel="noreferrer">Reconnect {SEAT_NAME[s]}</a> : null })}
  </div>
}
