/* Everything below the seat squares, for the chosen seat only (Ivan 09-28:
   "show the important things on the first side without collapsible stuff...
   the log collapsed for sure, and the recurring problems as well").
   Open: one status line, the key numbers for the window, invites sent by lane
   (today / 7 days) and lead supply beside lanes & campaigns, the rate charts and the last 14 days.
   Folded (remembered): Caps & control · Inbound · Numbers in detail ·
   Channels · Send log · Recurring problems. A folded section does not mount,
   so it reads nothing. An open incident shows its Control cell open. */
import { isWorking } from '../../../lib/campaignPerf'
import { SEAT_NAME, type Seat } from '../../seats'
import { CampaignsCell, InboundCell, type BandCtx } from '../bandCells'
import { ChannelsSheet } from '../ChannelsSheet'
import { Segmented } from '../../../ds/Segmented'
import { Numbers } from './Numbers'
import { Supply } from './Supply'
import { Sending } from './Sending'
import { History, Rates } from './History'
import { ackId, useAck } from '../ack'
import { Btn } from '../../ui/Key'
import { LogSheet } from '../LogSheet'
import { Inline } from '../LSheet'
import { clientOf, controlOf, type Range } from '../model'
import { PerfDetail } from '../Performance'
import { useOpenSections } from '../prefs'
import { ProblemsSheet } from '../ProblemsSheet'
import { Section } from '../Section'
import { ControlCell, TodayCell } from '../seatCells'
import { supplyOf } from '../supply'

const noop = () => {}

export function SeatView4({ seat, ctx, range, setRange, onCustom, retry }: { seat: Seat; ctx: BandCtx; range: Range; setRange: (r: Range) => void; onCustom: () => void; retry: () => void }) {
  const [open, toggle] = useOpenSections()
  const c = clientOf(ctx.d.cc.value, seat)
  const v = c ? controlOf(c, ctx.now) : null
  const s = supplyOf(ctx.d, seat, ctx.now)
  const [acked, ack] = useAck(v?.incident ? ackId(v.incident) : null, Boolean(v?.incident?.acknowledged))
  const working = ctx.d.perf.value ? ctx.d.perf.value.filter(x => x.client_id === seat && isWorking(x)).length : null
  const probs = (ctx.d.cc.value?.recurrence?.items ?? []).filter(i => i.rank?.daily_pick).slice(0, 3).length
  const inbound = ctx.d.inbound.value?.filter(r => r.client_id === seat).reduce((a, r) => a + r.d7, 0) ?? null
  const control = (
    <div className="dl-tc">
      <div data-band="today" data-seat={seat}><TodayCell seat={seat} ctx={ctx} /></div>
      <div data-band="control" data-seat={seat}><ControlCell seat={seat} ctx={ctx} /></div>
    </div>
  )
  return (
    <div className="dl4-seat" data-seat={seat}>
      {v?.incident && <div className="dl4-incident" data-bx-block><div><b>{v.incident.lead}</b><p>{v.incident.observed_failures ?? '?'} refusals, {v.incident.observed_distinct_prospects ?? '?'} people. Paused until {v.incident.pausedUntil ?? 'not set'}.{acked && ' Acknowledged, not recovered.'}</p></div><Btn verb="acknowledge" disabled={acked} onClick={ack}>{acked ? 'Acknowledged' : 'Acknowledge'}</Btn></div>}
      <div className="dl4-filter"><b>{SEAT_NAME[seat]}</b><Segmented markerId="dl4-range" label="Window for the totals" value={range} options={['7d','30d','90d','custom'].map(r => ({ id:r, label:r === 'custom' ? 'Custom' : r }))} onChange={r => r === 'custom' ? onCustom() : setRange(r as Range)} /></div>
      <Numbers seat={seat} ctx={ctx} retry={retry} />
      <div className="dl4-first"><Supply seat={seat} d={ctx.d} s={s} now={ctx.now} retry={retry} /><Sending seat={seat} now={ctx.now} /></div>
      <div className="dl4-below"><History seat={seat} ctx={ctx} /><section className="dl4-panel dl4-campaigns" data-band="campaigns" data-seat={seat} data-bx-block><h2>Campaigns <small>{working != null ? `${working} sending` : ''}</small></h2><CampaignsCell seat={seat} ctx={ctx} /></section></div>
      <Rates seat={seat} ctx={ctx} />
      <h2 className="dl4-more-head">More</h2>
      <div className="dl-folds">
          <Section id="control" title="Caps & control" open={open.control} onToggle={toggle}
            summary={v ? (v.closed ? `not sending${v.opens ? `, opens ${v.opens}` : ''}` : v.pace) : null}>
            {control}
          </Section>
        <Section id="inbound" title="Inbound" open={open.inbound} onToggle={toggle}
          summary={inbound != null ? `${inbound} decision${inbound === 1 ? '' : 's'} in 7 days` : null}>
          <InboundCell seat={seat} ctx={ctx} />
        </Section>
        <Section id="detail" title="Numbers in detail" open={open.detail} onToggle={toggle} summary="per campaign, delivery by lane, daily ledger">
          <PerfDetail seat={seat} ctx={ctx} />
        </Section>
        <Inline>
          <Section id="channels" title="Channels" open={open.channels} onToggle={toggle} summary="invites, DMs and InMail, each on its own">
            <ChannelsSheet seat={seat} setSeat={noop} now={ctx.now} onClose={noop} />
          </Section>
          <Section id="log" title="Send log" open={open.log} onToggle={toggle} summary={`${SEAT_NAME[seat]}'s sends and blocked sends, newest first`}>
            <LogSheet seat={seat} setSeat={noop} now={ctx.now} onClose={noop} />
          </Section>
          <Section id="problems" title="Recurring problems" open={open.problems} onToggle={toggle}
            summary={ctx.d.cc.value ? `${probs} picked today, every seat` : null}>
            <ProblemsSheet p={ctx.d.cc.value} pFailed={ctx.d.cc.failed} onClose={noop} />
          </Section>
        </Inline>
      </div>
    </div>
  )
}
