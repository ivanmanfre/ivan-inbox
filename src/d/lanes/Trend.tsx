/* The last 14 days of one seat, big: invites sent, accepted, DMs sent, people
   who replied. One row each (never stacked, never added), a value over every
   bar, the day under it, the 14-day total on the right. A day with no reading
   is a dash, never 0.
   Invites / DMs / Replied: the send monitor's daily rows (Warsaw days).
   Accepted: the daily ledger (inbox_day_ledger_v), of the invites sent that
   UTC day, so it only rises as the day's invites are answered. */
import type { CcPayload } from '../../lib/campaignControl'
import { buildLedger, type LedgerRow } from '../../lib/kpis'
import type { Seat } from '../seats'
import { seriesOf, type Bar } from './model'
import type { Load } from './useRead'

function accSeries(rows: LedgerRow[] | null, seat: Seat, days: Bar[]): Bar[] {
  if (!rows || rows.length === 0) return days.map(b => ({ ...b, v: null }))
  const today = new Date().toISOString().slice(0, 10)
  const led = buildLedger(rows, seat, 16, today)
  return days.map(b => ({ ...b, v: led.find(x => x.day === b.day)?.accepted ?? null }))
}

function Line({ label, bars, note }: { label: string; bars: Bar[]; note: string }) {
  const max = Math.max(1, ...bars.map(b => b.v ?? 0))
  const known = bars.filter(b => b.v != null)
  const tot = known.length ? known.reduce((a, b) => a + (b.v ?? 0), 0) : null
  return (
    <div className="dl-tr" title={note}>
      <span className="dl-trl">{label}</span>
      <div className="dl-trb" aria-label={`${label}, last 14 days`}>
        {bars.map((b, i) => (
          <div key={b.day} className={`dl-trc${b.today ? ' dl-now' : ''}${i === 7 ? ' dl-wk' : ''}`} title={`${b.day}: ${b.v ?? 'no reading'}`}>
            <small className={b.v ? '' : 'dl-z'}>{b.v == null ? '–' : b.v}</small>
            <i className={b.v == null ? 'dl-nil' : b.v ? '' : 'dl-z'} style={{ height: `${b.v ? Math.max(6, Math.round((b.v / max) * 100)) : 3}%` }} />
          </div>
        ))}
      </div>
      <b className="dl-trt">{tot == null ? '?' : tot.toLocaleString('en-US')}<small>14 days</small></b>
    </div>
  )
}

export function Trend({ p, seat, now, ledger }: { p: CcPayload; seat: Seat; now: number; ledger: Load<LedgerRow[]> }) {
  const inv = seriesOf(p, seat, now, 'invitation')
  const dmb = seriesOf(p, seat, now, 'dm')
  const rep = seriesOf(p, seat, now, 'dm', 'replies_people')
  const acc = accSeries(ledger.kind === 'ready' ? ledger.data : null, seat, inv)
  return (
    <div className="dl-trend">
      <Line label="Invites sent" bars={inv} note="Confirmed invitations per Warsaw day (the send monitor)." />
      <Line label="Accepted" bars={acc} note={ledger.kind === 'ready' ? (ledger.data.length ? 'Accepted, of the invites sent that UTC day (the daily ledger). A day keeps rising as its invites are answered.' : 'The daily ledger has no rows, so accepts per day are not shown.') : ledger.kind === 'failed' ? `The daily ledger could not be read: ${ledger.message}` : 'Reading the daily ledger…'} />
      <Line label="DMs sent" bars={dmb} note="Confirmed DMs per Warsaw day (the send monitor)." />
      <Line label="Replied" bars={rep} note="People who replied, per Warsaw day (the send monitor)." />
      <div className="dl-tr dl-trax"><span className="dl-trl" /><div className="dl-trb">{inv.map((b, i) => <u key={b.day} className={i === 7 ? 'dl-wk' : ''}>{b.dow}<br />{Number(b.day.slice(8))}</u>)}</div><span className="dl-trt" /></div>
    </div>
  )
}
