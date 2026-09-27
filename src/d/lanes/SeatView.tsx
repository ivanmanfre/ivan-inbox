/* Everything below the seat squares, for the chosen seat only, as collapsible
   sections (open state remembered, the first one open until changed):
   Today & control · Lanes & campaigns · Performance · Channels · Send log ·
   Recurring problems. A folded section does not mount, so it reads nothing. */
import { isWorking } from '../../lib/campaignPerf'
import { SEAT_NAME, type Seat } from '../seats'
import { CampaignsCell, InboundCell, type BandCtx } from './bandCells'
import { Shs } from './CampaignSheet'
import { ChannelsSheet } from './ChannelsSheet'
import { RangeKeys } from './foot'
import { readyOf } from './glance/ready'
import { LogSheet } from './LogSheet'
import { Inline } from './LSheet'
import { clientOf, controlOf, type Range } from './model'
import { Performance } from './Performance'
import { useOpenSections } from './prefs'
import { ProblemsSheet } from './ProblemsSheet'
import { acceptByLane } from './rates'
import { Section } from './Section'
import { ControlCell, TodayCell } from './seatCells'

const noop = () => {}

function Ready({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const r = ctx.d.ready.value
  if (!r) return <p className="dl-sl dl-unk">{ctx.d.ready.failed ? `Ready to invite could not be read: ${ctx.d.ready.failed}` : 'Reading who is ready to invite…'}</p>
  const g = ctx.d.gov.value?.find(x => x.client_id === seat)
  const s = readyOf(r, seat, g)
  return (
    <div className="dl-ready" title="People who pass this seat's sender filter right now, per lane. A ceiling: the checks the sender makes only at send time (geo, ads, live gate) are not replayed.">
      <div className="dl-readyh"><b>{s.total.toLocaleString('en-US')}</b> ready to invite</div>
      <div className="dl-readyl">{s.lanes.length ? s.lanes.map(l => (
        <span key={l.lane} className={l.off ? 'dl-dimt' : ''}>{l.label} <b>{l.capped ? '≥' : ''}{l.n.toLocaleString('en-US')}</b>{l.off ? ` (${l.off})` : ''}</span>
      )) : <span className="dl-dimt">No lane has anyone ready.</span>}</div>
    </div>
  )
}

export function SeatView({ seat, ctx, range, setRange, onCustom }: { seat: Seat; ctx: BandCtx; range: Range; setRange: (r: Range) => void; onCustom: () => void }) {
  const [open, toggle] = useOpenSections()
  const c = clientOf(ctx.d.cc.value, seat)
  const v = c ? controlOf(c, ctx.now) : null
  const working = ctx.d.perf.value ? ctx.d.perf.value.filter(x => x.client_id === seat && isWorking(x)).length : null
  const acc = ctx.d.cc.value ? acceptByLane(ctx.d.cc.value, seat, range).total : null
  const probs = (ctx.d.cc.value?.recurrence?.items ?? []).filter(i => i.rank?.daily_pick).slice(0, 3).length
  const ready = ctx.d.ready.value ? readyOf(ctx.d.ready.value, seat, ctx.d.gov.value?.find(x => x.client_id === seat)).total : null
  return (
    <div className="dl-seat" data-seat={seat}>
      <Section id="today" title="Today & control" open={open.today} onToggle={toggle}
        summary={v ? (v.incident ? 'incident open' : v.closed ? `not sending${v.opens ? `, opens ${v.opens}` : ''}` : v.pace) : null}>
        <div className="dl-tc">
          <div data-band="today" data-seat={seat}><TodayCell seat={seat} ctx={ctx} /></div>
          <div data-band="control" data-seat={seat}><ControlCell seat={seat} ctx={ctx} /></div>
        </div>
      </Section>
      <Section id="lanes" title="Lanes & campaigns" open={open.lanes} onToggle={toggle}
        summary={[working != null ? `${working} campaign${working === 1 ? '' : 's'} sending this week` : '', ready != null ? `${ready.toLocaleString('en-US')} ready to invite` : ''].filter(Boolean).join(' · ')}>
        <Ready seat={seat} ctx={ctx} />
        <Shs>Campaigns, 7 days</Shs>
        <CampaignsCell seat={seat} ctx={ctx} />
        <Shs>Inbound</Shs>
        <InboundCell seat={seat} ctx={ctx} />
      </Section>
      <Section id="perf" title="Performance" open={open.perf} onToggle={toggle}
        summary={acc?.pct != null ? `${acc.pct}% accepted in ${range}` : null}
        tools={<RangeKeys range={range} setRange={setRange} onCustom={onCustom} />}>
        <Performance seat={seat} ctx={ctx} />
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
  )
}
