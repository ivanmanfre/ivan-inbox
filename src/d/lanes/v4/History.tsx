import { fetchDayLedger } from '../../../lib/kpis'
import type { BandCtx } from '../bandCells'
import type { Seat } from '../../seats'
import { seriesOf, type Bar } from '../model'
import { accSeries } from '../Trend'
import { useRead } from '../useRead'
import { RateBars } from '../RateBars'
import { acceptByLane, replyByLane, FORMULA, RANGE_DAYS } from '../rates'
import { DateRates } from '../DateRates'
import { Skeleton } from '../../ui/states'

function Line({ label, bars }: { label: string; bars: Bar[] }) {
  const known = bars.filter(b => b.v != null), max = Math.max(1, ...known.map(b => b.v!))
  const today = bars.find(b => b.today)?.v
  return <div className="dl4-history-line"><b>{label}</b><div className="dl4-history-bars">{bars.map(b => <button key={b.day} type="button" title={`${b.day}: ${b.v ?? 'no reading'}`} aria-label={`${label}, ${b.day}: ${b.v ?? 'no reading'}`} className={b.today ? 'dl4-now' : undefined}>
    <i className={b.v == null ? 'dl4-nil' : undefined} style={{ height: `${b.v == null ? 2 : b.v > 0 ? Math.max(3,b.v / max * 100) : 0}%` }} />
  </button>)}</div><small>today {today ?? '?'} · 14d {known.length ? known.reduce((a, b) => a + b.v!, 0) : '?'}</small></div>
}
export function History({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const ledger = useRead(fetchDayLedger, 'ledger')
  const p = ctx.d.cc.value
  const inv = seriesOf(p, seat, ctx.now, 'invitation')
  return <section className="dl4-panel dl4-history" data-bx-block><h2>Last 14 days</h2>
    {!p ? ctx.d.cc.failed ? <p>The send monitor could not be read.</p> : <Skeleton lines={4} /> : <>
      <Line label="Invites sent" bars={inv} />
      <Line label="Accepted" bars={accSeries(ledger.kind === 'ready' ? ledger.data : null, seat, inv)} />
      <Line label="DMs sent" bars={seriesOf(p, seat, ctx.now, 'dm')} />
      <Line label="Replied" bars={seriesOf(p, seat, ctx.now, 'dm', 'replies_people')} />
    </>}
  </section>
}
export function Rates({ seat, ctx }: { seat: Seat; ctx: BandCtx }) {
  const p = ctx.d.cc.value, days = RANGE_DAYS[ctx.range]
  return <><DateRates seat={seat} range={ctx.range} now={ctx.now} />
    <details className="dl-monitor-rates"><summary>{days}-day send monitor rates</summary><div className="dl4-rates" data-bx-block>
    <RateBars title={`Acceptance per lane, ${days} days`} unit="people invited" formula={FORMULA.accept(ctx.range)} rates={p ? acceptByLane(p, seat, ctx.range) : null} failed={ctx.d.cc.failed} empty={`No invite went out on this seat in the last ${days} days.`} />
    <RateBars title={`Reply rate per lane, ${days} days`} unit="people first messaged" formula={FORMULA.reply(ctx.range)} rates={p ? replyByLane(p, seat, ctx.range) : null} failed={ctx.d.cc.failed} empty={`No first DM went out on this seat in the last ${days} days.`} />
  </div></details></>
}
