/* The three seat squares on top of Lanes (Ivan, Rise, Arch), side by side on
   desktop and phone. Each: the state word with its time (resumes / resets /
   opens), LinkedIn + Sales Nav credits, today's invites, DMs and InMail as big
   numbers (never added together), and the seat's own warning (out of leads,
   disconnected). Clicking a square chooses the seat the page below shows. */
import { monitorLiveness } from '../../lib/campaignControl'
import { supplyAlarmLane } from '../../lib/focus'
import { SEAT_NAME, type Seat } from '../seats'
import { clientOf, controlOf, hm, seatWord, todayOf } from './model'
import { PERSON } from './seatCells'
import type { LanesData } from './useLanesData'

type Health = { account: string; sn: string | null; degraded: boolean; link: string | null; sn_credits?: number | null }

/** The time that goes with the state word, in words; null when there is none. */
export function stateTime(d: LanesData, seat: Seat, now: number): string | null {
  const p = d.cc.value
  const c = clientOf(p, seat)
  if (!p || !c) return null
  const w = seatWord(c, monitorLiveness(p, now)).word
  const v = controlOf(c, now)
  const pause = d.pauses.value?.[seat]
  if (w === 'Rate limited') {
    const at = v.incident?.pausedUntil ?? (pause && Date.parse(pause) > now ? hm(pause) : null)
    return at ? `resumes ${at}` : v.incident?.check ? `next check ${v.incident.check.split(',')[0]}` : null
  }
  if (w === 'Capacity reached') { const t = todayOf(p, seat, now)?.resets; return t ? `resets ${t}` : null }
  if (v.closed && v.opens) return `opens ${v.opens}`
  return null
}

/** The seat's own warnings, worst first. Same rule and rows as the old all-seats line. */
export function seatWarnings(d: LanesData, seat: Seat): string[] {
  const out: string[] = []
  const h = d.health.value?.seats.find(x => x.name === PERSON[seat]) as Health | undefined
  if (h && h.account !== 'OK') out.push('LinkedIn disconnected')
  if (h && h.sn != null && h.sn !== 'OK') out.push('Sales Nav not working')
  if (d.pipeline.value && d.gov.value) {
    const alarm = supplyAlarmLane(d.pipeline.value.filter(r => r.client_id === seat), d.gov.value.filter(g => g.client_id === seat))
    if (alarm === seat) out.push('Out of leads: under a day of supply left')
  }
  return out
}

function Big({ label, v }: { label: string; v: number | null | undefined }) {
  return <div className="dl-sqn"><em className={v == null ? 'dl-q' : v ? 'dl-on' : 'dl-z'}>{v == null ? '?' : v}</em><small>{label}</small></div>
}

function Square({ seat, d, now, on, pick }: { seat: Seat; d: LanesData; now: number; on: boolean; pick: (s: Seat) => void }) {
  const p = d.cc.value
  const w = p ? seatWord(clientOf(p, seat), monitorLiveness(p, now)) : null
  const t = todayOf(p, seat, now)
  const time = stateTime(d, seat, now)
  const h = d.health.value?.seats.find(x => x.name === PERSON[seat]) as Health | undefined
  const warns = seatWarnings(d, seat)
  return (
    <div className={`dl-sq${on ? ' dl-on' : ''}${warns.length ? ' dl-sqw' : ''}`} data-seat={seat}>
      <button type="button" className="dl-sqhit" role="tab" aria-selected={on} data-pick={seat} aria-label={`Show ${SEAT_NAME[seat]}`} onClick={() => pick(seat)} />
      <div className="dl-sqh">
        <b>{SEAT_NAME[seat]}</b>
        <span className={`dl-sqs dl-${w?.tone ?? 'dim'}`}>{w ? w.word : d.cc.failed ? 'Unknown, unverified' : 'Reading…'}{time && <span> · {time}</span>}</span>
      </div>
      <div className="dl-sqc">
        {h ? <>{h.account === 'OK' ? 'LinkedIn connected' : ''}{h.sn_credits != null && <span title="Sales Navigator credits">{h.account === 'OK' ? ' · ' : ''}<b>{h.sn_credits}</b> credits</span>}</>
          : <span className="dl-unk">{d.health.failed ? 'Seat health could not be read' : 'Reading seat health…'}</span>}
      </div>
      <div className="dl-sqr">
        <Big label="invites today" v={t?.inv} />
        <Big label="DMs today" v={t?.dm} />
        <Big label="InMail today" v={t?.inmail} />
      </div>
      {warns.length > 0 && <div className="dl-sqx">{warns.map(x => <p key={x} data-seat-warning>{x}</p>)}</div>}
      {h?.degraded && h.link && <a className="dl-reconnect dl-sqa" data-verb="reconnect" href={h.link} target="_blank" rel="noreferrer">Reconnect</a>}
    </div>
  )
}

export function SeatSquares({ seats, seat, pick, d, now }: { seats: Seat[]; seat: Seat; pick: (s: Seat) => void; d: LanesData; now: number }) {
  return (
    <div className="dl-sqs" role="tablist" aria-label="Seats">
      {seats.map(s => <Square key={s} seat={s} d={d} now={now} on={s === seat} pick={pick} />)}
    </div>
  )
}
