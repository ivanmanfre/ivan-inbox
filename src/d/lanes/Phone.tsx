/* Lanes on the phone: three seat plates side by side on top (invites today
   each, never summed, the state word, the last 7 days as mini bars), then the
   chosen seat below, band after band. The same cells the desktop grid draws. */
import type { ReactNode } from 'react'
import { monitorLiveness } from '../../lib/campaignControl'
import { isWorking } from '../../lib/campaignPerf'
import { SEAT_NAME, type Seat } from '../seats'
import { CampaignsCell, DeliveryCell, InboundCell, type BandCtx } from './bandCells'
import { RangeKeys } from './foot'
import { clientOf, seatWord, seriesOf, todayOf, type Range } from './model'
import { ControlCell, PERSON, TodayCell } from './seatCells'

function Sec({ children, tail }: { children: ReactNode; tail?: ReactNode }) {
  return <div className="dl-psec"><span>{children}</span>{tail}</div>
}

export function Phone({ seats, seat, pick, ctx, range, setRange, onCustom, doors, monitor }: {
  seats: Seat[]; seat: Seat; pick: (s: Seat) => void; ctx: BandCtx
  range: Range; setRange: (r: Range) => void; onCustom?: () => void; doors: ReactNode; monitor: string
}) {
  const p = ctx.d.cc.value
  const next = seats[(seats.indexOf(seat) + 1) % seats.length]
  const h = ctx.d.health.value?.seats.find(x => x.name === PERSON[seat])
  return (
    <div className="dl-phone">
      <div className="dl-plates" role="tablist" aria-label="Seats">
        {seats.map(s => {
          const w = p ? seatWord(clientOf(p, s), monitorLiveness(p, ctx.now)) : null
          const v = todayOf(p, s, ctx.now)?.inv ?? null
          const bars = seriesOf(p, s, ctx.now, 'invitation', 'sent', 7)
          const max = Math.max(1, ...bars.map(b => b.v ?? 0))
          return (
            <button key={s} type="button" role="tab" aria-selected={s === seat} className={`dl-pp${s === seat ? ' dl-on' : ''}`} onClick={() => pick(s)}>
              <b>{SEAT_NAME[s]}</b>
              <span className={`dl-pw dl-${w?.tone ?? 'dim'}`}>{w?.word ?? (ctx.d.cc.failed ? 'Unknown' : 'Reading…')}</span>
              <em className={v == null ? 'dl-q' : v ? 'dl-on' : 'dl-z'}>{v ?? '?'}</em>
              <span className="dl-mini" aria-hidden="true">{bars.map(b => <i key={b.day} className={`${b.today ? 'dl-now' : ''}${b.v ? '' : ' dl-z'}`} style={{ height: `${Math.max(2, Math.round(((b.v ?? 0) / max) * 18))}px` }} />)}</span>
            </button>
          )
        })}
      </div>
      <div className="dl-ro">
        <span>{SEAT_NAME[seat]}{h && h.account !== 'OK' ? ' · LinkedIn disconnected' : ''}</span>
        {next !== seat && <button type="button" onClick={() => pick(next)}>{SEAT_NAME[next]} ›</button>}
      </div>
      <div data-band="today" data-seat={seat}><TodayCell seat={seat} ctx={ctx} /></div>
      <div data-band="control" data-seat={seat}><ControlCell seat={seat} ctx={ctx} /></div>
      <Sec tail={<span>{ctx.d.perf.value ? ctx.d.perf.value.filter(c => c.client_id === seat && isWorking(c)).length : ''}</span>}>Campaigns, 7 days</Sec>
      <CampaignsCell seat={seat} ctx={ctx} />
      <Sec tail={<RangeKeys range={range} setRange={setRange} onCustom={onCustom} />}>14 days</Sec>
      <DeliveryCell seat={seat} ctx={ctx} />
      <Sec>Inbound</Sec>
      <InboundCell seat={seat} ctx={ctx} />
      <div className="dl-doors">{doors}</div>
      <p className="dl-pmon">{monitor}</p>
    </div>
  )
}
