/* Everything below the seat squares, for the chosen seat only (Ivan 09-28:
   "show the important things on the first side without collapsible stuff...
   the log collapsed for sure, and the recurring problems as well").
   Open: one status line, the key numbers for the window, invites sent by lane
   (today / 7 days) and lead supply beside lanes & campaigns, the rate charts and the last 14 days.
   Folded (remembered): Caps & control · Inbound · Numbers in detail ·
   Channels · Send log · Recurring problems. A folded section does not mount,
   so it reads nothing. An open incident shows its Control cell open. */
import { isWorking } from '../../lib/campaignPerf'
import { SEAT_NAME, type Seat } from '../seats'
import { CampaignsCell, InboundCell, type BandCtx } from './bandCells'
import { ChannelsSheet } from './ChannelsSheet'
import { RangeKeys } from './foot'
import { Kpis } from './Kpis'
import { LogSheet } from './LogSheet'
import { Inline } from './LSheet'
import { clientOf, controlOf, type Range } from './model'
import { PerfCharts, PerfDetail } from './Performance'
import { useOpenSections } from './prefs'
import { ProblemsSheet } from './ProblemsSheet'
import { Refill } from './Refill'
import { Section } from './Section'
import { SendMix } from './SendMix'
import { ControlCell, TodayCell } from './seatCells'
import { supplyOf } from './supply'

const noop = () => {}

export function SeatView({ seat, ctx, range, setRange, onCustom }: { seat: Seat; ctx: BandCtx; range: Range; setRange: (r: Range) => void; onCustom: () => void }) {
  const [open, toggle] = useOpenSections()
  const c = clientOf(ctx.d.cc.value, seat)
  const v = c ? controlOf(c, ctx.now) : null
  const s = supplyOf(ctx.d, seat, ctx.now)
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
    <div className="dl-seat" data-seat={seat}>
      {v && !v.incident && (
        <p className={`dl-status${v.blockers.length ? ' dl-held' : ''}`} title={v.lead}>
          {v.blockers.length ? `Cannot send right now: ${v.blockers.join('; ')}.` : v.lead}
          {v.next && <span className="dl-status-n">Next: {v.next}</span>}
        </p>
      )}
      {v?.incident && <div className="dl-sec dl-open dl-incident"><div className="dl-secb">{control}</div></div>}
      <div className="dl-kpih">
        <b>{SEAT_NAME[seat]}, key numbers</b>
        <RangeKeys range={range} setRange={setRange} onCustom={onCustom} />
      </div>
      <Kpis seat={seat} ctx={ctx} s={s} />
      <div className="dl-grid2">
        <div className="dl-col">
          <SendMix seat={seat} now={ctx.now} />
          <Refill seat={seat} d={ctx.d} s={s} now={ctx.now} />
        </div>
        <div className="dl-panel dl-camps" data-band="campaigns" data-seat={seat}>
          <div className="dl-panh"><b>Lanes & campaigns</b><span>{working != null ? `${working} sending this week, 7 days` : '7 days'}</span></div>
          <CampaignsCell seat={seat} ctx={ctx} />
        </div>
      </div>
      <PerfCharts seat={seat} ctx={ctx} />
      <div className="dl-folds">
        {!v?.incident && (
          <Section id="control" title="Caps & control" open={open.control} onToggle={toggle}
            summary={v ? (v.closed ? `not sending${v.opens ? `, opens ${v.opens}` : ''}` : v.pace) : null}>
            {control}
          </Section>
        )}
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
