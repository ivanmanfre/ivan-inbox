/* Lanes cells, part 2: Campaigns, 14 days (with the range keys) and Inbound.
   One seat per render; the desktop grid lays three side by side. */
import { useEffect, useState } from 'react'
import { groupBySeat, shortName, type CampaignPerf } from '../../lib/campaignPerf'
import type { Seat } from '../seats'
import { laneLabel } from './labels'
import { dm as dayMonth, seriesOf, windowOf, type Bar, type Range } from './model'
import { laneMixOnce, type LaneMix } from './reads'
import { inboundStatus, type InboundDailyRow } from '../../lib/inbound'

/** 14 UTC days of inbound decisions for one seat and lane, oldest first; null when unread. */
function spark(daily: InboundDailyRow[] | null, seat: Seat, k: string, now: number): number[] | null {
  if (!daily) return null
  return Array.from({ length: 14 }, (_, i) => {
    const day = new Date(now - (13 - i) * 864e5).toISOString().slice(0, 10)
    return daily.filter(d => d.client_id === seat && d.lane === k && d.day.slice(0, 10) === day).reduce((a, d) => a + d.n, 0)
  })
}
import { num, type CellCtx } from './seatCells'

export type BandCtx = CellCtx & {
  range: Range
  openCampaign: (id: string) => void
  openSheet: (kind: 'decisions' | 'log' | 'ledger' | 'delivery' | 'problems', seat?: Seat) => void
  selected?: string | null
}

export function acceptShort(c: CampaignPerf): string {
  if (!c.accept_judged) return 'Accept rate: no invitation is 72h old yet'
  return `${Math.round((c.accept_72h / c.accept_judged) * 100)}% accepted within 72h, ${c.accept_72h} of ${c.accept_judged} judged`
}

function LaneLine({ id }: { id: string }) {
  const [mix, setMix] = useState<LaneMix | 'failed' | null>(null)
  useEffect(() => {
    let live = true
    laneMixOnce(id).then(m => { if (live) setMix(m) }, () => { if (live) setMix('failed') })
    return () => { live = false }
  }, [id])
  if (mix === null) return <div className="dl-ln dl-unk">Inside: reading…</div>
  if (mix === 'failed') return <div className="dl-ln dl-unk">Inside: could not be read</div>
  if (!mix.lanes.length) return null
  return <div className="dl-ln">Inside: {mix.lanes.slice(0, 3).map(l => `${laneLabel(l.lane)} ${mix.capped ? 'at least ' : ''}${l.n}`).join(', ')}</div>
}

function Camp({ c, ctx }: { c: CampaignPerf; ctx: BandCtx }) {
  const all = ctx.d.campSends.value?.find(x => x.campaign_id === c.campaign_id)?.sent ?? null
  const nb = (v: number, l: string) => <span><b className={v ? '' : 'dl-z'}>{v}</b>{l}</span>
  return (
    <button type="button" className={`dl-cp${ctx.selected === c.campaign_id ? ' dl-sel' : ''}`} onClick={() => ctx.openCampaign(c.campaign_id)}>
      <span className="dl-cn">{shortName(c.campaign_name)}</span>
      <span className="dl-nums">{nb(c.invites_7d, 'invites')}{nb(c.dms_7d, 'DMs')}{nb(c.replied_7d, 'replied')}{nb(c.calls_30d, 'calls 30d')}</span>
      {/* The long accept sentence and the all-time total stay one hover (and one tap, in the campaign sheet) away. */}
      <span className="dl-ln" title={`${acceptShort(c)}${all != null ? ` · ${all.toLocaleString('en-US')} sent all time` : ''}`}>
        {c.replied_7d ? `${c.positive_7d} positive of ${c.replied_7d}` : 'No replies yet'}{c.accept_judged ? ` · ${Math.round((c.accept_72h / c.accept_judged) * 100)}% accepted` : ''}</span>
      {c.client_id === 'arch' && <LaneLine id={c.campaign_id} />}
    </button>
  )
}

export function CampaignsCell({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const [show, setShow] = useState(false)
  const rows = ctx.d.perf.value
  if (!rows) return <div className="dl-cps"><p className="dl-fo dl-unk">{ctx.d.perf.failed ? `Campaigns could not be read: ${ctx.d.perf.failed}` : 'Reading campaigns…'}</p></div>
  const g = groupBySeat(rows, [seat])[0]
  // Ivan's paused campaigns are hidden outright (ruling 07-25, today's Overview); clients' paused ones fold.
  const paused = seat === 'ivan' ? [] : g.paused
  const rest = [...g.quiet, ...paused]
  const fold = [g.quiet.length ? `${g.quiet.length} quiet this week` : '', paused.length ? `${paused.length} paused` : ''].filter(Boolean).join(', ')
  return (
    <div className="dl-cps">
      {g.shown.length ? g.shown.map(c => <Camp key={c.campaign_id} c={c} ctx={ctx} />) : <p className="dl-fo">Nothing went out on this seat this week.</p>}
      {fold && (
        <button type="button" className="dl-fo dl-fold" aria-expanded={show} onClick={() => setShow(v => !v)}>
          <span>{fold}</span><span>{show ? 'hide' : 'show'}</span>
        </button>
      )}
      {ctx.d.campSends.value && (() => {
        const mine = ctx.d.campSends.value.filter(x => rows.some(r => r.campaign_id === x.campaign_id && r.client_id === seat) && (seat !== 'ivan' || x.is_active))
        return <p className="dl-fo dl-tot2"><span>{g.shown.length} of {mine.length} shown</span><span>{mine.reduce((a, x) => a + x.sent, 0).toLocaleString('en-US')} sent all time</span></p>
      })()}
      {show && rest.map(c => (
        <button type="button" key={c.campaign_id} className="dl-quiet" onClick={() => ctx.openCampaign(c.campaign_id)}>
          <span>{shortName(c.campaign_name)}</span><em>{c.is_active ? 'quiet' : 'paused'}</em>
        </button>
      ))}
    </div>
  )
}

function Mult({ label, bars, total, sub }: { label: string; bars: Bar[]; total: number | null; sub: string }) {
  const max = Math.max(1, ...bars.map(b => b.v ?? 0))
  return (
    <div className="dl-sm">
      <span>{label}</span>
      <div className="dl-bs" aria-label={`${label}, last 14 days`}>
        {bars.map((b, i) => (
          <i key={b.day} title={`${b.day}: ${b.v ?? 'no reading'}`}
            className={[b.v == null ? 'dl-nil' : b.v ? '' : 'dl-z', b.today ? 'dl-now' : '', i === 7 ? 'dl-wk' : ''].filter(Boolean).join(' ')}
            style={{ height: `${b.v ? Math.max(8, Math.round((b.v / max) * 100)) : 4}%` }} />
        ))}
      </div>
      <b>{total == null ? '?' : total.toLocaleString('en-US')}<small>{sub}</small></b>
    </div>
  )
}

const RANGE_WORD: Record<Range, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

export function DeliveryCell({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const p = ctx.d.cc.value
  if (!p) return <div className="dl-dv"><p className="dl-unk">{ctx.d.cc.failed ? 'Delivery could not be read.' : 'Reading delivery…'}</p></div>
  const w = windowOf(p, seat, ctx.range)
  const inv = seriesOf(p, seat, ctx.now, 'invitation'), dmb = seriesOf(p, seat, ctx.now, 'dm'), rep = seriesOf(p, seat, ctx.now, 'dm', 'replies_people')
  const o = ctx.d.outcomes.value?.find(x => x.client_id === seat)
  const vb = ctx.d.viewed.value?.find(x => x.client_id === seat)
  const sc = ctx.d.scans.value?.find(x => x.client_id === seat)
  const convos = o ? (ctx.range === '7d' ? o.convos_7d : ctx.range === '30d' ? o.convos_30d : null) : null
  const calls = o ? (ctx.range === '7d' ? o.calls_7d : ctx.range === '30d' ? o.calls_30d : null) : null
  const viewed = vb && ctx.range !== '90d' ? (ctx.range === '7d' ? [vb.viewed_7d, vb.invited_7d] : [vb.viewed_30d, vb.invited_30d]) : null
  return (
    <div className="dl-dv">
      <Mult label="Invites" bars={inv} total={w.inv} sub={ctx.range} />
      <Mult label="DMs" bars={dmb} total={w.dm} sub={ctx.range} />
      <Mult label="Replied" bars={rep} total={w.repliers} sub="people" />
      <div className="dl-ax"><span /><div>{inv.map((b, i) => <u key={b.day} className={i === 7 ? 'dl-wk' : ''}>{b.dow}</u>)}</div><span /></div>
      <div className="dl-fn">
        {!w.hasInterval ? <>No {RANGE_WORD[ctx.range]} window in this snapshot.</> : <>
          {RANGE_WORD[ctx.range]}: {w.matured
            ? <><b>{w.accepted}</b> of {w.matured} accepted ≤72h (<b>{w.rate}%</b>{w.prevRate != null ? <>, <span className={(w.delta ?? 0) >= 0 ? 'dl-up' : 'dl-dn'}>was {w.prevRate}%</span></> : ctx.range === '90d' ? ', no earlier 90 days to compare' : ''})</>
            : 'accept rate: nothing old enough yet'}
          <br /><b>{num(convos)}</b> conversations · <b>{num(calls)}</b> calls · InMail <b>{num(w.inmail)}</b> · {num(w.invFailed)} invites refused
          {viewed && <><br />Viewed your profile back: <b>{viewed[0]}</b> of {viewed[1]} invited (a floor)</>}
          {sc && <><br />Scan opens: <b>{sc.opens_7d}</b> in 7d · {sc.opens_30d} in 30d · {sc.distinct_prospects} people{sc.last_open ? `, last ${dayMonth(sc.last_open)}` : ''}</>}
        </>}
      </div>
    </div>
  )
}

export function InboundCell({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const rows = ctx.d.inbound.value
  const lane = (k: 'requests' | 'filtered') => rows?.find(r => r.client_id === seat && r.lane === k) ?? null
  const cb = (ctx.d.cameBack.value ?? []).filter(x => x.tenant === seat)
  const line = (label: string, k: 'requests' | 'filtered', a: string, b: string) => {
    const x = lane(k)
    const st = x ? inboundStatus(x.last_at, x.total, new Date(ctx.now).toISOString()) : 'off'
    const word = !x || st === 'off' ? 'no decisions recorded yet' : st === 'live' ? `live, last ${dayMonth(x.last_at!)}` : `quiet for ${Math.floor((ctx.now - Date.parse(x.last_at!)) / 864e5)} days`
    const days = spark(ctx.d.inboundDaily.value, seat, k, ctx.now)
    return (
      <div className="dl-il" key={k}>
        <span>{label}{!rows ? (ctx.d.inbound.failed ? ': could not be read' : ': reading…') : x ? <>: <b>{x.passed}</b> {a}, <b>{x.dropped}</b> {b}</> : ''}
          <small className={`dl-ist${st === 'live' ? ' dl-livet' : ''}`}>{rows ? word : ''}</small></span>
        <em>{x ? `${x.d7} in 7d · ${x.d30} in 30d` : ''}
          {days && <span className="dl-mini dl-ispk" aria-label="decisions per day, 14 days">{days.map((v, i) => <i key={i} className={v ? '' : 'dl-z'} style={{ height: `${v ? Math.max(3, Math.round((v / Math.max(1, ...days)) * 12)) : 2}px` }} />)}</span>}</em>
      </div>
    )
  }
  return (
    <div className="dl-ib">
      {line('Invites to this seat', 'requests', 'accepted', 'left pending')}
      {line('Cold-DM filter', 'filtered', 'let in', 'dropped')}
      <div className="dl-il">
        <span>Came back, no reply: {ctx.d.cameBack.value ? (cb.length ? <span className="dl-nm">{cb.map(x => x.name).join(', ')}</span> : 'nobody') : ctx.d.cameBack.failed ? 'could not be read' : 'reading…'}</span>
        <em>{cb[0] ? `${cb[0].signals?.[0]?.kind === 'scan_open' ? 'opened scan' : 'back'} ${dayMonth(cb[0].last_signal_at)}` : ''}</em>
      </div>
      <div className="dl-il"><span>New people found</span><em><b>{num(ctx.d.engagers.value?.[seat])}</b> in 7d</em></div>
      {seat === 'ivan' && <div className="dl-il"><span>Warm signals to approve</span><em>{ctx.d.warm.value == null ? num(null) : ctx.d.warm.value ? <b>{ctx.d.warm.value}</b> : 'none today'}</em></div>}
      <button type="button" className="dl-more" onClick={() => ctx.openSheet('decisions', seat)}>Each decision, with the reason ›</button>
    </div>
  )
}
