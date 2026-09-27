/* Performance of the chosen seat: acceptance and reply rate per lane (the
   window picked with 7d / 30d / 90d), acceptance per campaign (7 days), the
   last 14 days big, the window in words, then Delivery and the Daily ledger
   (the old foot-strip sheets, drawn here, this seat only). Read-only. */
import { fetchDayLedger, type LedgerRow } from '../../lib/kpis'
import type { Seat } from '../seats'
import { WindowNotes, type BandCtx } from './bandCells'
import { Shs } from './CampaignSheet'
import { DeliverySheet } from './DeliverySheet'
import { LedgerSheet } from './LedgerSheet'
import { Inline } from './LSheet'
import { RateBars } from './RateBars'
import { acceptByCampaign, acceptByLane, FORMULA, replyByLane, RANGE_DAYS } from './rates'
import { Trend } from './Trend'
import { useRead } from './useRead'

const noop = () => {}

export function Performance({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const ledger = useRead<LedgerRow[]>(fetchDayLedger, 'ledger')
  const p = ctx.d.cc.value
  const pf = ctx.d.cc.failed
  const days = RANGE_DAYS[ctx.range]
  return (
    <div className="dl-perf">
      <div className="dl-rcs">
        <RateBars title={`Acceptance per lane, ${days} days`} unit="judged invites" formula={FORMULA.accept(ctx.range)}
          rates={p ? acceptByLane(p, seat, ctx.range) : null} failed={pf} empty={`No invite went out on this seat in the last ${days} days.`} />
        <RateBars title={`Reply rate per lane, ${days} days`} unit="people first messaged" formula={FORMULA.reply(ctx.range)}
          rates={p ? replyByLane(p, seat, ctx.range) : null} failed={pf} empty={`No first DM went out on this seat in the last ${days} days.`} />
        <RateBars title="Acceptance per campaign, 7 days" unit="judged invites" formula={FORMULA.campaign}
          rates={ctx.d.perf.value ? acceptByCampaign(ctx.d.perf.value, seat) : null} failed={ctx.d.perf.failed} empty="No campaign on this seat sent an invite in the last 7 days." />
      </div>
      <Shs>Last 14 days</Shs>
      {p ? <Trend p={p} seat={seat} now={ctx.now} ledger={ledger} /> : <p className={`dl-sl ${pf ? 'dl-bad' : 'dl-unk'}`}>{pf ? `The send monitor could not be read: ${pf}` : 'Reading the send monitor…'}</p>}
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
