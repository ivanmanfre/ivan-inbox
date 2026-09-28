/* The chosen seat's key numbers for the window (7d / 30d / 90d), one row of
   tiles, open on the first screen (Ivan 09-28: "show KPIs and infographics per
   client"). Every number comes from a read the page already makes; a number
   that cannot be read shows "?", never 0. Invites, DMs and InMail stay apart. */
import type { ReactNode } from 'react'
import type { Seat } from '../seats'
import type { BandCtx } from './bandCells'
import { windowOf } from './model'
import { replyByLane, seatAccept } from './rates'
import type { Supply } from './supply'

const WORD = { '7d': '7 days', '30d': '30 days', '90d': '90 days' } as const

function Tile({ label, v, sub, tone, title }: { label: string; v: ReactNode; sub?: ReactNode; tone?: 'lime' | 'warn' | 'dim'; title?: string }) {
  return (
    <div className="dl-kpi" title={title}>
      <small>{label}</small>
      <em className={tone ? `dl-kpi-${tone}` : undefined}>{v}</em>
      {sub != null && <u>{sub}</u>}
    </div>
  )
}

const n = (v: number | null | undefined) => (v == null ? '?' : v.toLocaleString('en-US'))

export function Kpis({ seat, ctx, s }: { seat: Seat; ctx: BandCtx; s: Supply }) {
  const p = ctx.d.cc.value
  const r = ctx.range
  const w = windowOf(p, seat, r)
  const acc = p ? seatAccept(p, seat, r) : null
  const prev = p && r !== '90d' ? seatAccept(p, seat, r === '7d' ? 'prev7d' : 'prev30d') : null
  const rep = p ? replyByLane(p, seat, r).total : null
  const o = ctx.d.outcomes.value?.find(x => x.client_id === seat)
  const convos = o && r !== '90d' ? (r === '7d' ? o.convos_7d : o.convos_30d) : null
  const calls = o && r !== '90d' ? (r === '7d' ? o.calls_7d : o.calls_30d) : null
  const delta = acc?.pct != null && prev?.pct != null ? Math.round((acc.pct - prev.pct) * 10) / 10 : null
  const reading = !p && !ctx.d.cc.failed
  return (
    <div className="dl-kpis" data-band="kpis" data-seat={seat} aria-busy={reading || undefined}>
      <Tile label={`Invites, ${WORD[r]}`} v={n(w.inv)} tone={w.inv ? 'lime' : 'dim'}
        sub={w.invFailed != null ? `${w.invFailed.toLocaleString('en-US')} refused` : undefined} />
      <Tile label="Accepted ≤72h" v={acc?.pct != null ? `${acc.pct}%` : '?'} tone={acc?.pct != null ? undefined : 'dim'}
        title={`Accepted within 72h ÷ people first invited in the window. The newest invites can still accept, so it only rises.${prev?.pct != null ? ` Previous ${WORD[r]}: ${prev.pct}%.` : ''}`}
        sub={acc?.pct != null ? <>{acc.hit} of {acc.base}{delta != null && <> · <span className={delta >= 0 ? 'dl-up' : 'dl-dn'}>{delta >= 0 ? '+' : ''}{delta}pp</span></>}</> : 'nobody invited'} />
      <Tile label="Replied ≤72h" v={rep?.pct != null ? `${rep.pct}%` : '?'} tone={rep?.pct != null ? undefined : 'dim'}
        title="Replied within 72h ÷ people whose first DM went out in the window."
        sub={rep ? `${rep.hit} of ${rep.base} messaged` : undefined} />
      <Tile label="Conversations" v={n(convos)} tone={convos ? undefined : 'dim'}
        sub={r === '90d' ? 'not counted for 90 days' : <>{n(calls)} call{calls === 1 ? '' : 's'}</>} />
      <Tile label="Ready to invite" v={n(s.ready)} tone={s.ready ? 'lime' : 'warn'}
        title="People who pass this seat's sender filter now. A ceiling: checks made only at send time are not replayed."
        sub={s.runwayDays != null ? <span className={s.runwayDays < 3 ? 'dl-dn' : undefined}>runway {s.runwayDays}d</span> : s.ready ? 'nothing sent in 7 days' : undefined} />
      <Tile label="Refill, 7 days" v={s.refill != null ? `${s.refill.toFixed(2)}x` : '?'} tone={s.refill == null ? 'dim' : s.refill < 1 ? 'warn' : undefined}
        title="People newly qualified ÷ people invited, last 7 days. Under 1x the ready pool shrinks."
        sub={s.refill != null ? `${s.in7} in · ${s.out7} out` : 'nothing sent in 7 days'} />
    </div>
  )
}
