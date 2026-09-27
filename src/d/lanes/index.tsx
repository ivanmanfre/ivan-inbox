/* ==========================================================================
   src/d/lanes — Lanes, Ivan's home, direction D. Read-only except Acknowledge.

   Desktop: one instrument. Bands run down (Seat, Today, Control, Campaigns,
   14 days, Inbound), the three seats run across in fixed columns and share
   ONE scroll with a sticky seat row, so a seat never sits below another.
   Rarer ledgers open as a right sheet from the foot bar.
   Phone: three seat plates side by side, the chosen seat below (Phone.tsx).
   Address: #exp/d/lanes[?seat=][&range=30d][&sheet=campaign&c=<id>|log|ledger|delivery|problems|decisions]
   ========================================================================== */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useLanes } from '../../hooks/useLanes'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { useReportFailed } from '../shell/health'
import { AnswerRow, N } from '../ui/AnswerRow'
import { Key } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { Failed, Offline } from '../ui/states'
import { useOnline } from '../ui/useOnline'
import { CampaignsCell, DeliveryCell, InboundCell, type BandCtx } from './bandCells'
import { CampaignSheet } from './CampaignSheet'
import { answerOf, hm, RANGES, type Range } from './model'
import { monitorLine, RangeKeys } from './foot'
import { Phone } from './Phone'
import { ControlCell, Plate, TodayCell } from './seatCells'
import { LanesSheet, type SheetKind } from './Sheets'
import { failedCount, useLanesData } from './useLanesData'
import { GLANCE_ROWS, GlancePhone, useGlance, type GlanceCtx } from './glance/Glance'
import './lanes.css'

const SHEETS: SheetKind[] = ['decisions', 'log', 'ledger', 'delivery', 'problems']

export default function LanesPage({ layout, route, navigate }: PlaceProps) {
  const { data, at, refresh } = useLanesData()
  const reg = useLanes()
  const online = useOnline()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { setNow(Date.now()) }, [at])
  useReportFailed('lanes', failedCount(data))

  const q = route.query
  const seats: Seat[] = SEATS.filter(s => reg.lanes.some(l => l.client_id === s))
  const cols = seats.length ? seats : [...SEATS]
  const range = (RANGES as string[]).includes(q.get('range') ?? '') ? (q.get('range') as Range) : '7d'
  const sheet = q.get('sheet')
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v) }
    navigate(dHash('lanes', null, next))
  }
  const ctx: BandCtx = {
    d: data, now, range, selected: sheet === 'campaign' ? q.get('c') : null,
    openCampaign: id => go({ sheet: 'campaign', c: id, seat: q.get('seat') }),
    openSheet: (kind, seat) => go({ sheet: kind, c: null, for: seat ?? null }),
  }
  const glance = useGlance(now)
  const g: GlanceCtx = {
    d: data, now, ...glance, openCampaign: ctx.openCampaign,
    // The glance's Invites and Rate limit rows open the band that acts on them.
    jump: (band, seat) => {
      if (layout === 'phone' && q.get('seat') !== seat) go({ seat })
      requestAnimationFrame(() => document.querySelector(`[data-band="${band}"][data-seat="${seat}"], .dl-phone [data-band="${band}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    },
  }
  const setRange = (r: Range) => go({ range: r === '7d' ? null : r })
  const close = () => go({ sheet: null, c: null, for: null })

  const ans = answerOf(data.cc.value, cols, now)
  const title = <>Invites today: {ans.inv.map((x, i) => <span key={x.seat}>{i ? ', ' : ''}{SEAT_NAME[x.seat]} <N v={x.v} /></span>)}.</>
  const camp = sheet === 'campaign' ? data.perf.value?.find(c => c.campaign_id === q.get('c')) ?? null : null
  const forSeat = (SEATS as readonly string[]).includes(q.get('for') ?? '') ? (q.get('for') as Seat) : null
  const probs = (data.cc.value?.recurrence?.items ?? []).filter(i => i.rank?.daily_pick).slice(0, 3).length

  const top = <>
    {!online && <Offline since={at ? hm(at) : null} />}
    {data.cc.failed && !data.cc.value && <Failed what="the send monitor" detail={data.cc.failed} onRetry={refresh} />}
  </>
  const sheets = <>
    {camp && <CampaignSheet c={camp} now={now} onClose={close} />}
    {sheet === 'campaign' && !camp && data.perf.value && (
      <Sheet open onClose={close} title="Campaign not found" sub="This campaign is archived or no longer in the list." className="dl-sheet"><p className="dl-sl">Nothing to show.</p></Sheet>
    )}
    {sheet && (SHEETS as string[]).includes(sheet) && <LanesSheet kind={sheet as SheetKind} seat={forSeat} p={data.cc.value} range={range} onClose={close} />}
  </>
  const doors = (
    <>
      <Key size="small" onClick={() => ctx.openSheet('delivery')}>Delivery by lane</Key>
      <Key size="small" onClick={() => ctx.openSheet('ledger')}>Daily ledger</Key>
      <Key size="small" onClick={() => ctx.openSheet('log')}>Send log</Key>
      <Key size="small" onClick={() => ctx.openSheet('problems')}>Recurring problems <span className="dl-kn">{data.cc.value ? probs : '?'}</span></Key>
    </>
  )

  if (layout === 'phone') {
    return (
      <>
        <AnswerRow title={title} sub={ans.sub} />
        {top}
        <GlancePhone seats={cols} g={g} />
        <Phone seats={cols} ctx={ctx} seat={(cols as string[]).includes(q.get('seat') ?? '') ? (q.get('seat') as Seat) : cols[0]}
          pick={s => go({ seat: s })} range={range} setRange={setRange} doors={doors} monitor={monitorLine(data, now)} />
        {sheets}
      </>
    )
  }

  const band = (label: string, note: ReactNode, cell: (s: Seat) => ReactNode, cls = '', id?: string) => <>
    <div className={`dl-gut ${cls}`}>{label}{note != null && <small>{note}</small>}</div>
    {cols.map(s => <div key={s} className={cls === 'dl-top' ? 'dl-pl' : ['dl-cell', ...cls.split(' ').filter(Boolean).map(c => c === 'dl-gl' ? 'dl-glc' : c)].join(' ')} data-seat={s} data-band={id}>{cell(s)}</div>)}
  </>
  return (
    <div className="dl-root">
      <AnswerRow title={title} sub={ans.sub} />
      {top}
      <div className="dl-grid" style={{ gridTemplateColumns: `var(--dl-gut) repeat(${cols.length}, minmax(0, 1fr))` }}>
        {band('Seat', null, s => <Plate seat={s} ctx={ctx} />, 'dl-top')}
        {GLANCE_ROWS.map(({ id, label, note, Cell }, i) => <Fragment key={id}>{band(label, note, s => <Cell seat={s} g={g} />, i === GLANCE_ROWS.length - 1 ? 'dl-gl dl-gl-last' : 'dl-gl', `glance-${id}`)}</Fragment>)}
        {band('Today', 'Warsaw day', s => <TodayCell seat={s} ctx={ctx} />, '', 'today')}
        {band('Control', 'live monitor', s => <ControlCell seat={s} ctx={ctx} />, '', 'control')}
        {band('Campaigns', 'last 7 days', s => <CampaignsCell seat={s} ctx={ctx} />)}
        {band('14 days', <>own scale per seat<RangeKeys range={range} setRange={setRange} /></>, s => <DeliveryCell seat={s} ctx={ctx} />)}
        {band('Inbound', 'decided without you', s => <InboundCell seat={s} ctx={ctx} />)}
      </div>
      <div className="dl-foot">
        <div className="dl-mon" title={monitorLine(data, now)}>{monitorLine(data, now)}</div>
        {doors}
      </div>
      {sheets}
    </div>
  )
}
