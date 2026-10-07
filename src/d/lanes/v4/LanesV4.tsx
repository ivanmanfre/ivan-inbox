import { useMotionLevel } from '../../../ds/motionLevel'
/* ==========================================================================
   src/d/lanes — Lanes, direction D, one seat at a time (Lanes 3, 09-27).
   Read-only except Acknowledge (local).

   Top: three seat squares (Ivan, Rise, Arch) side by side, desktop and phone:
   state, credits, today's invites / DMs / InMail, the seat's own warning.
   Clicking one chooses the seat (remembered); below, that seat only, as
   collapsible sections (SeatView). Seats are never added together.
   Address: #exp/d/lanes[?seat=][&range=30d][&sheet=campaign&c=<id>|control&for=|range|decisions&for=]
   (the old sheet addresses — log, ledger, delivery, problems, channels — still open their sheet)
   ========================================================================== */
import { Suspense, lazy, useEffect, useState } from 'react'
import { useLanes } from '../../../hooks/useLanes'
import { monitorLiveness } from '../../../lib/campaignControl'
import type { PlaceProps } from '../../places'
import { dHash } from '../../route'
import { SEATS, type Seat } from '../../seats'
import { useReportFailed } from '../../shell/health'
import { AnswerRow } from '../../ui/AnswerRow'
import { DIcon } from '../../ui/icons'
import { Sheet } from '../../ui/Sheet'
import { Failed, Offline } from '../../ui/states'
import { useOnline } from '../../ui/useOnline'
import type { BandCtx } from '../bandCells'
import { CampaignSheet } from '../CampaignSheet'
import { ChannelsSheet } from '../ChannelsSheet'
import { ControlSheet } from '../ControlSheet'
import { monitorLine } from '../foot'
import { RangeSheet } from '../LedgerSheet'
import { answerOf, hm, RANGES, type Range } from '../model'
import { storedSeat, storeSeat } from '../prefs'
import { Strip } from './Strip'
import { SeatView4 } from './SeatView'
import { LanesSheet, type SheetKind } from '../Sheets'
import { failedCount, useLanesData } from '../useLanesData'
import '../lanes.css'
import '../lanes3.css'
import './lanes4.css'

// Run 51: the DM outreach report (sends -> replies per lane and step) moved here from Content > Strategy.
const OutreachBlock = lazy(() => import('../../../wb/content/OutreachBlock').then(m => ({ default: m.OutreachBlock })))

const SHEETS: SheetKind[] = ['decisions', 'log', 'ledger', 'delivery', 'problems']
const isSeat = (v: string | null): v is Seat => (SEATS as readonly string[]).includes(v ?? '')

export default function LanesPage({ layout, route, navigate }: PlaceProps) {
  const motion = useMotionLevel()
  const { data, at, refresh } = useLanesData()
  const reg = useLanes()
  const online = useOnline()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { setNow(Date.now()) }, [at])
  useReportFailed('lanes', failedCount(data))

  const q = route.query
  const seats: Seat[] = SEATS.filter(s => reg.lanes.some(l => l.client_id === s))
  const cols = seats.length ? seats : [...SEATS]
  const [kept, setKept] = useState<Seat>(storedSeat)
  const seat: Seat = isSeat(q.get('seat')) ? (q.get('seat') as Seat) : cols.includes(kept) ? kept : cols[0]
  const range = (RANGES as string[]).includes(q.get('range') ?? '') ? (q.get('range') as Range) : '7d'
  const sheet = q.get('sheet')
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v) }
    navigate(dHash('lanes', null, next))
  }
  const pick = (s: Seat) => { storeSeat(s); setKept(s); go({ seat: s }) }
  const ctx: BandCtx = {
    d: data, now, range, selected: sheet === 'campaign' ? q.get('c') : null,
    openCampaign: id => go({ sheet: 'campaign', c: id }),
    openSheet: (kind, s) => go({ sheet: kind, c: null, for: s ?? null }),
    openControl: s => go({ sheet: 'control', c: null, for: s }),
  }
  const setRange = (r: Range) => go({ range: r === '7d' ? null : r })
  const close = () => go({ sheet: null, c: null, for: null })

  const ans = answerOf(data.cc.value, cols, now, null)
  const camp = sheet === 'campaign' ? data.perf.value?.find(c => c.campaign_id === q.get('c')) ?? null : null
  const forSeat = isSeat(q.get('for')) ? (q.get('for') as Seat) : null

  // Every read that failed or timed out (12 s) besides the monitor, said once, with Retry.
  const otherFailed = failedCount(data) - (data.cc.failed && !data.cc.value ? 1 : 0)
  const p = data.cc.value
  const staleMin = p && monitorLiveness(p, now) === 'stale' && p.monitor.last_tick_at ? Math.max(1, Math.round((now - Date.parse(p.monitor.last_tick_at)) / 6e4)) : null
  const tools = (
    <button type="button" className={`d-ib dl-refresh dl-refresh-${layout}`} data-verb="refresh" onClick={refresh} title={`Read everything again · ${monitorLine(data, now)}`} aria-label="Refresh">
      <DIcon name="retry" />
    </button>
  )
  return (
    <div data-motion={motion} className={`dl-root dl4 dl4-${layout}`} data-layout-v4="lanes">
      <AnswerRow title="Lanes" sub={staleMin != null ? `Monitor silent ${staleMin} min: numbers unverified.` : p ? ans.alert : null} tools={tools} />
      <div className="dl4-scroll" data-d-scroll>
        {!online && <Offline since={at ? hm(at) : null} />}
        {data.cc.failed && !data.cc.value && <Failed what="the send monitor" detail={data.cc.failed} onRetry={refresh} />}
        {otherFailed > 0 && <Failed what={otherFailed === 1 ? 'one of the reads on this page' : `${otherFailed} of the reads on this page`} onRetry={refresh} />}
        
        {p?.coverage.degraded && <p className="dl-notice">Coverage degraded{p.coverage.degraded_reasons.length ? `: ${p.coverage.degraded_reasons.join(' · ')}` : '.'}</p>}
        
        <Strip seats={cols} seat={seat} pick={pick} d={data} now={now} />
        <SeatView4 key={seat} seat={seat} ctx={ctx} range={range} setRange={setRange} retry={refresh} onCustom={() => go({ sheet: 'range', c: null })} />
        <a className="dl-outreach-link" href={dHash('lanes', null, { ...Object.fromEntries(q), sheet: 'outreach', for: seat })} data-verb="open-outreach">DM outreach results: sends to replies by step →</a>
      </div>
      {camp && <CampaignSheet c={camp} now={now} onClose={close} />}
      {sheet === 'campaign' && !camp && data.perf.value && (
        <Sheet open onClose={close} title="Campaign not found" sub="This campaign is archived or no longer in the list." className="dl-sheet"><p className="dl-sl">Nothing to show.</p></Sheet>
      )}
      {sheet === 'range' && <RangeSheet from={q.get('from')} to={q.get('to')} setRange={(from, to) => go({ from, to })} onClose={() => go({ sheet: null, from: null, to: null })} />}
      {sheet === 'channels' && <ChannelsSheet seat={forSeat ?? seat} setSeat={s => go({ for: s })} now={now} onClose={close} />}
      {sheet === 'control' && <ControlSheet seat={forSeat ?? seat} p={data.cc.value} pFailed={data.cc.failed} gov={data.gov.value?.find(x => x.client_id === (forSeat ?? seat)) ?? null}
        pauses={data.pauses.value} pausesFailed={data.pauses.failed} now={now} onClose={close} />}
      {sheet === 'outreach' && (
        <Sheet open onClose={close} title="DM outreach results" sub="Matured sends and replies per lane and step, against the prior period" className="dl-sheet">
          <div className="cn-legacy app wb ds-shell wb-work"><Suspense fallback={<p className="dl-sl">Reading…</p>}><OutreachBlock lane={forSeat ?? seat} /></Suspense></div>
        </Sheet>
      )}
      {sheet && (SHEETS as string[]).includes(sheet) &&<LanesSheet kind={sheet as SheetKind} seat={forSeat} p={data.cc.value} pFailed={data.cc.failed} range={range} now={now} setSeat={s => go({ for: s })} onClose={close} />}
    </div>
  )
}
