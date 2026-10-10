import { ReplySources } from './ReplySources'
/* Performance of the chosen seat. Open (PerfCharts): acceptance and reply
   rate per lane for the window picked with 7d / 30d / 90d, and the last 14
   days big. Folded (PerfDetail): acceptance per campaign, the window in words,
   Delivery and the Daily ledger (this seat only). Read-only. */
import { fetchDayLedger, type LedgerRow } from '../../lib/kpis'
import type { Seat } from '../seats'
import { WindowNotes, type BandCtx } from './bandCells'
import { Shs } from './CampaignSheet'
import { DeliverySheet } from './DeliverySheet'
import { LedgerSheet } from './LedgerSheet'
import { Inline } from './LSheet'
import { RateBars } from './RateBars'
import { acceptByCampaign, acceptByLane, FORMULA, replyByLane, RANGE_DAYS } from './rates'
import { DateRates } from './DateRates'
import { Trend } from './Trend'
import { useRead } from './useRead'

const noop = () => {}

/** Open on the first screen: acceptance and reply rate per lane for the window, and the last 14 days. */
export function PerfCharts({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const ledger = useRead<LedgerRow[]>(fetchDayLedger, 'ledger')
  const p = ctx.d.cc.value
  const pf = ctx.d.cc.failed
  const days = RANGE_DAYS[ctx.range]
  return (
    <div className="dl-perf">
      <ReplySources scope={{ kind: 'operator', clientId: seat }} />
      <DateRates seat={seat} range={ctx.range} now={ctx.now} />
      <details className="dl-monitor-rates"><summary>{days}-day send monitor rates</summary>
      <div className="dl-rcs dl-rcs2">
        <RateBars title={`Acceptance per lane, ${days} days`} unit="people invited" formula={FORMULA.accept(ctx.range)}
          rates={p ? acceptByLane(p, seat, ctx.range) : null} failed={pf} empty={`No invite went out on this seat in the last ${days} days.`} />
        <RateBars title={`Reply rate per lane, ${days} days`} unit="people first messaged" formula={FORMULA.reply(ctx.range)}
          rates={p ? replyByLane(p, seat, ctx.range) : null} failed={pf} empty={`No first DM went out on this seat in the last ${days} days.`} />
      </div>
      </details>
      <div className="dl-panel dl-trendp">
        <div className="dl-panh"><b>Last 14 days</b><span>invites, accepted, DMs, replied</span></div>
        {p ? <Trend p={p} seat={seat} now={ctx.now} ledger={ledger} /> : <p className={`dl-sl ${pf ? 'dl-bad' : 'dl-unk'}`}>{pf ? `The send monitor could not be read: ${pf}` : 'Reading the send monitor…'}</p>}
      </div>
    </div>
  )
}

/** Folded by default: acceptance per campaign, the window in words, delivery by lane and the daily ledger. */
export function PerfDetail({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const p = ctx.d.cc.value
  const pf = ctx.d.cc.failed
  const days = RANGE_DAYS[ctx.range]
  return (
    <div className="dl-perf">
      <div className="dl-rcs dl-rcs1">
        <RateBars title="Acceptance per campaign, 7 days" unit="judged invites" formula={FORMULA.campaign}
          rates={ctx.d.perf.value ? acceptByCampaign(ctx.d.perf.value, seat) : null} failed={ctx.d.perf.failed} empty="No campaign on this seat sent an invite in the last 7 days." />
      </div>
      <WindowNotes seat={seat} ctx={ctx} />
      <Inline>
        <Shs>Delivery by lane, {days} days</Shs>
        <DeliverySheet p={p} pFailed={pf} range={ctx.range} onClose={noop} seats={[seat]} />
        <Shs>Daily ledger</Shs>
        <LedgerSheet p={p} range={ctx.range} onClose={noop} seats={[seat]} />
      </Inline>
    </div>
  )
}
