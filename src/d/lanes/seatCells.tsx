/* Lanes cells, part 1: the seat plate, the Today band and the Control band.
   Each renders ONE seat; the desktop grid lays three side by side, the phone
   stacks the chosen one. Hooks stay at the top of every component. */
import type { ReactNode } from 'react'
import { monitorLiveness } from '../../lib/campaignControl'
import { SEAT_NAME, SEAT_OWNER, type Seat } from '../seats'
import { Key } from '../ui/Key'
import { ackId, useAck } from './ack'
import { clientOf, controlOf, dm, seatWord, todayOf } from './model'
import type { LanesData } from './useLanesData'

export type CellCtx = { d: LanesData; now: number }

export const PERSON: Record<Seat, string> = { ivan: 'Iván Manfredi', risedtc: 'Mattan Danino', arch: 'Davorin Smit' }
const Sep = () => <span className="dl-sep">·</span>
/** A number or "unknown", never a made-up 0. */
export const num = (v: number | null | undefined): ReactNode =>
  v == null ? <span className="dl-unk">unknown</span> : v.toLocaleString('en-US')

export function Plate({ seat, ctx }: { seat: Seat; ctx: CellCtx }) {
  const p = ctx.d.cc.value
  const c = clientOf(p, seat)
  const w = p ? seatWord(c, monitorLiveness(p, ctx.now)) : null
  const h = ctx.d.health.value?.seats.find(x => x.name === PERSON[seat]) as
    | { account: string; sn: string | null; degraded: boolean; link: string | null; sn_credits?: number | null } | undefined
  return (
    <div className="dl-plate">
      <div className="dl-r1">
        <b>{SEAT_NAME[seat]}</b><span className="dl-who">{SEAT_OWNER[seat]}</span>
        {w ? <span className={`dl-st dl-${w.tone}`}>{w.word}</span> : <span className="dl-st dl-dim">{ctx.d.cc.failed ? 'Unknown, unverified' : 'Reading…'}</span>}
      </div>
      <div className="dl-hl">
        {h ? <>
          <span className={h.account === 'OK' ? 'dl-ok' : 'dl-bad'}>LinkedIn {h.account === 'OK' ? 'connected' : 'disconnected'}</span>
          <span className={h.sn === 'OK' ? 'dl-ok' : 'dl-bad'}>Sales Nav {h.sn === 'OK' ? 'on' : 'not working'}{h.sn_credits != null ? `, ${h.sn_credits} credits` : ''}</span>
          {h.degraded && h.link && <a className="dl-reconnect" data-verb="reconnect" href={h.link} target="_blank" rel="noreferrer">Reconnect</a>}
        </> : <span className="dl-bad">{ctx.d.health.failed ? 'seat health could not be read' : 'reading seat health…'}</span>}
      </div>
    </div>
  )
}

function Fig({ label, v, sub }: { label: string; v: number | null | undefined; sub: ReactNode }) {
  return (
    <div>
      <small>{label}</small>
      <em className={v == null ? 'dl-q' : v ? 'dl-on' : 'dl-z'}>{v == null ? '?' : v}</em>
      <u>{sub}</u>
    </div>
  )
}

export function TodayCell({ seat, ctx }: { seat: Seat; ctx: CellCtx }) {
  const t = todayOf(ctx.d.cc.value, seat, ctx.now)
  const cd = ctx.d.counters.value?.find(x => x.seat === seat && x.action_type === 'dm')
  const g = ctx.d.gov.value?.find(x => x.client_id === seat)
  const dmSub = ctx.d.counters.failed && !ctx.d.counters.value ? 'cap unknown' : cd ? `${cd.count} of ${cd.daily_limit ?? 50} cap` : 'cap 50, unused'
  return (
    <>
      <div className="dl-td">
        <Fig label="Invites" v={t?.inv} sub={<>yday {num(t?.invY)}</>} />
        <Fig label="DMs" v={t?.dm} sub={dmSub} />
        <Fig label="InMail" v={t?.inmail} sub="kept apart" />
      </div>
      <div className="dl-caps">
        {t ? <>
          Invite cap <b>{num(t.capUsed)}</b>/{num(t.cap)} today
          {t.wCap != null && <><Sep /><b>{num(t.wUsed)}</b>/{t.wCap} week</>}
          {t.resets && <><Sep />resets {t.resets}</>}
          {t.attempted != null && t.attempted > 0 && <><br />Tried <b>{t.attempted}</b> today, <b>{t.failed ?? 0}</b> refused</>}
        </> : <span className="dl-unk">{ctx.d.cc.failed ? 'Caps could not be read.' : 'Reading caps…'}</span>}
        <br />
        {g
          ? <>Governor <b>{g.used}</b>/{g.cap} {g.window_label === 'day' ? 'today' : `this ${g.window_label}`}<Sep />
            {g.cap > 0 && g.used >= g.cap ? 'Cap reached' : { normal: 'Normal', warm_only: 'Warm only', cold_paused: 'Cold paused' }[g.mode]}
            <Sep />accept {g.accept_rate == null ? 'no cohort yet' : `${g.accept_rate}%`}</>
          : <span className="dl-unk">Governor {ctx.d.gov.failed ? 'could not be read' : 'reading…'}</span>}
      </div>
    </>
  )
}

function Supply({ seat, ctx }: { seat: Seat; ctx: CellCtx }) {
  const pipe = (ctx.d.pipeline.value ?? []).filter(p => p.client_id === seat)
  const g = ctx.d.gov.value?.find(x => x.client_id === seat)
  const sendable = pipe.reduce((a, p) => a + p.sendable, 0)
  const rate = Math.max(pipe.reduce((a, p) => a + p.sent_7d, 0) / 7, g?.daily_used ?? 0)
  const runway = ctx.d.pipeline.value && rate > 0 ? Math.floor(sendable / rate) : null
  const cut = new Date(ctx.now - 7 * 864e5).toISOString().slice(0, 10)
  const rep = (ctx.d.replacement.value ?? []).filter(r => r.client_id === seat && r.day >= cut)
  const so = rep.reduce((a, r) => a + r.sent_out, 0), qi = rep.reduce((a, r) => a + r.qualified_in, 0)
  return <>{runway != null && <><Sep />runway {runway}d</>}{so > 0 && <><Sep />refill {(qi / so).toFixed(2)}x</>}</>
}

export function ControlCell({ seat, ctx }: { seat: Seat; ctx: CellCtx }) {
  const c = clientOf(ctx.d.cc.value, seat)
  const v = c ? controlOf(c, ctx.now) : null
  const inc = v?.incident ?? null
  const [acked, ack] = useAck(inc ? ackId(inc) : null, Boolean(inc?.acknowledged))
  if (!v) return <div className="dl-ct"><p className="dl-unk">{ctx.d.cc.failed ? `The send monitor could not be read: ${ctx.d.cc.failed}` : 'Reading the send monitor…'}</p></div>
  return (
    <div className="dl-ct">
      {inc ? (
        <div className="dl-inc">
          <p className="dl-lead">{inc.lead}</p>
          <div className="dl-ir">
            <div className="dl-im">
              {inc.observed_failures != null && <><b>{inc.observed_failures.toLocaleString('en-US')}</b> refusals{inc.opened_at ? ` since ${dm(inc.opened_at, 'UTC')}` : ''}{inc.observed_distinct_prospects != null ? `, ${inc.observed_distinct_prospects} people` : ''}. </>}
              Paused until <b>{inc.pausedUntil ?? 'not set'}</b>{inc.check ? `, next check ${inc.check}` : ''}.
              {acked && <span className="dl-acked"> Acknowledged, not recovered.</span>}
            </div>
            <Key verb="acknowledge" disabled={acked} onClick={ack} aria-label={acked ? 'Acknowledged' : 'Acknowledge this incident'}>{acked ? 'Acknowledged' : 'Acknowledge'}</Key>
          </div>
        </div>
      ) : <p className="dl-lead">{v.lead}</p>}
      <div className="dl-kv"><span className="dl-k">Window</span> {v.window}<Sep />
        {v.closed ? <>opens <b>{v.opens ?? 'not scheduled'}</b></> : <>{v.pct ?? '?'}% gone<Sep />{v.pace}{v.planned != null ? ` (${v.sent} of ${v.planned})` : ''}</>}
      </div>
      <div className="dl-kv"><span className="dl-k">Waiting</span> {v.pools.length ? v.pools.map(([k, n], i) => <span key={k}>{i ? ', ' : ''}{k} <b>{n}</b></span>) : 'unknown'}<Supply seat={seat} ctx={ctx} /></div>
      {!inc && v.next && <div className="dl-kv"><span className="dl-k">Next</span> {v.next}</div>}
    </div>
  )
}
