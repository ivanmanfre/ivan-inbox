/* Lanes cells, part 2: Campaigns, 14 days (with the range keys) and Inbound.
   One seat per render; the desktop grid lays three side by side. */
import { useEffect, useState } from 'react'
import { groupBySeat, isWorking, shortName, type CampaignPerf } from '../../lib/campaignPerf'
import type { Seat } from '../seats'
import { laneLabel } from './labels'
import { dm as dayMonth, seriesOf, windowOf, type Bar, type Range } from './model'
import { fetchLaneMix, type LaneMix } from './reads'
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

// One read per Arch campaign per session: the lane mix moves slowly.
const mixCache = new Map<string, Promise<LaneMix>>()
function LaneLine({ id }: { id: string }) {
  const [mix, setMix] = useState<LaneMix | 'failed' | null>(null)
  useEffect(() => {
    let live = true
    if (!mixCache.has(id)) mixCache.set(id, fetchLaneMix(id))
    mixCache.get(id)!.then(m => { if (live) setMix(m) }, () => { mixCache.delete(id); if (live) setMix('failed') })
    return () => { live = false }
  }, [id])
  if (mix === null) return <div className="dl-ln dl-unk">Inside: reading…</div>
  if (mix === 'failed') return <div className="dl-ln dl-unk">Inside: could not be read</div>
  if (!mix.lanes.length) return null
  return <div className="dl-ln">Inside: {mix.lanes.slice(0, 3).map(l => `${laneLabel(l.lane)} ${mix.capped ? 'at least ' : ''}${l.n}`).join(', ')}</div>
}

function Camp({ c, ctx }: { c: CampaignPerf; ctx: BandCtx }) {
  const nb = (v: number, l: string) => <span><b className={v ? '' : 'dl-z'}>{v}</b>{l}</span>
  return (
    <button type="button" className={`dl-cp${ctx.selected === c.campaign_id ? ' dl-sel' : ''}`} onClick={() => ctx.openCampaign(c.campaign_id)}>
      <span className="dl-cn">{shortName(c.campaign_name)}</span><span className="dl-go">open ›</span>
      <span className="dl-nums">{nb(c.invites_7d, 'invites')}{nb(c.dms_7d, 'DMs')}{nb(c.replied_7d, 'replied')}{nb(c.calls_30d, 'calls 30d')}</span>
      <span className="dl-ln">{c.replied_7d ? `${c.positive_7d} positive of ${c.replied_7d}. ` : 'No replies yet. '}{acceptShort(c)}</span>
      {c.client_id === 'arch' && <LaneLine id={c.campaign_id} />}
    </button>
  )
}

export function CampaignsCell({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const [show, setShow] = useState(false)
  const rows = ctx.d.perf.value
  if (!rows) return <div className="dl-cps"><p className="dl-fo dl-unk">{ctx.d.perf.failed ? `Campaigns could not be read: ${ctx.d.perf.failed}` : 'Reading campaigns…'}</p></div>
  const g = groupBySeat(rows, [seat])[0]
  const retired = seat === 'ivan' ? rows.filter(r => r.client_id === seat && !isWorking(r) && !r.is_active) : []
  const rest = [...g.quiet, ...g.paused, ...retired]
  const fold = [g.quiet.length ? `${g.quiet.length} quiet this week` : '', g.paused.length ? `${g.paused.length} paused` : '', retired.length ? `${retired.length} retired` : ''].filter(Boolean).join(', ')
  return (
    <div className="dl-cps">
      {g.shown.length ? g.shown.map(c => <Camp key={c.campaign_id} c={c} ctx={ctx} />) : <p className="dl-fo">Nothing went out on this seat this week.</p>}
      {fold && (
        <button type="button" className="dl-fo dl-fold" aria-expanded={show} onClick={() => setShow(v => !v)}>
          <span>{fold}</span><span>{show ? 'hide' : 'show'}</span>
        </button>
      )}
      {show && rest.map(c => (
        <button type="button" key={c.campaign_id} className="dl-quiet" onClick={() => ctx.openCampaign(c.campaign_id)}>
          <span>{shortName(c.campaign_name)}</span><em>{c.is_active ? 'quiet' : seat === 'ivan' ? 'retired' : 'paused'}</em>
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
    return (
      <div className="dl-il" key={k}>
        <span>{label}{!rows ? (ctx.d.inbound.failed ? ': could not be read' : ': reading…') : x ? <>: <b>{x.passed}</b> {a}, <b>{x.dropped}</b> {b}</> : ': no decisions recorded yet'}</span>
        <em>{x ? `${x.d30} in 30d${x.last_at ? `, last ${dayMonth(x.last_at)}` : ''}` : ''}</em>
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
