import { useEffect, useState } from 'react'
import { fetchRateComparison, presetRateDates, previousRateDates, validRateDates, warsawDate, type RateComparisonRow, type RateDates } from '../../lib/rateComparison'
import type { Seat } from '../seats'
import type { Range } from './model'
import { RANGE_DAYS } from './rates'
import { useRetryRead } from './useRead'
import './dateRates.css'

const pct = (n: number) => `${Number(n).toFixed(1)}%`
function Value({ r }: { r?: RateComparisonRow }) {
  return <>{r?.rate_pct == null ? <span>No mature sample</span> : <><b>{pct(r.rate_pct)}</b><small>{r.outcomes} of {r.mature}</small></>}
    {r && r.pending > 0 && <small>{r.pending} pending</small>}</>
}
export function RateComparisonTables({ rows, seat }: { rows: RateComparisonRow[]; seat: Seat }) {
  const mine = rows.filter(r => r.client_id === seat)
  return <div className="dl-date-tables">{(['invitation','dm'] as const).map(ch => {
    const lanes = ['__all__', ...Array.from(new Set(mine.filter(r => r.channel === ch && r.lane !== '__all__').map(r => r.lane))).sort()]
    const title = ch === 'invitation' ? 'Acceptance rate comparison' : 'Reply rate comparison'
    return <table key={ch} aria-label={title}>
      <caption>{title}</caption>
      <thead><tr><th scope="col">Lane</th><th scope="col">Selected</th><th scope="col">Previous</th><th scope="col">Change</th></tr></thead>
      <tbody>{lanes.map(lane => {
        const cur = mine.find(r => r.channel === ch && r.lane === lane && r.period === 'current')
        const prev = mine.find(r => r.channel === ch && r.lane === lane && r.period === 'previous')
        const delta = cur?.rate_pct != null && prev?.rate_pct != null ? Number(cur.rate_pct) - Number(prev.rate_pct) : null
        return <tr key={lane}><th scope="row">{lane === '__all__' ? 'All lanes' : lane}</th>
          <td><Value r={cur} /></td><td><Value r={prev} /></td>
          <td>{delta == null ? <span>No comparison</span> : <b>{delta > 0 ? '+' : ''}{delta.toFixed(1)} pp</b>}</td></tr>
      })}</tbody>
    </table>
  })}</div>
}
export function RateComparisonRead({ dates, seat }: { dates: RateDates; seat: Seat }) {
  const [read, retry] = useRetryRead(() => fetchRateComparison(dates), `rate-comparison:${dates.from}:${dates.to}`)
  // A new selection cannot render counts cached by the previous selection.
  return <div key={`${dates.from}:${dates.to}`} aria-live="polite">
    {read.kind === 'ready' ? <RateComparisonTables rows={read.data} seat={seat} />
      : read.kind === 'failed' ? <p role="status">Rates could not be read. <button type="button" onClick={retry}>Retry rates</button></p>
        : <p role="status">Reading rates…</p>}
  </div>
}
export function RatePeriodNote({ dates }: { dates: RateDates }) {
  const prev = previousRateDates(dates)
  return <p className="dl-date-period">Selected: {dates.from} to {dates.to}. Previous: {prev.from} to {prev.to}. Warsaw dates, inclusive.</p>
}
export function DateRates({ seat, range, now }: { seat: Seat; range: Range; now: number }) {
  const [dates, setDates] = useState(() => presetRateDates(RANGE_DAYS[range], now))
  const [draft, setDraft] = useState(dates)
  // A monitor refresh must preserve a custom selection. A changed top-level
  // preset selects the matching rates window.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const next = presetRateDates(RANGE_DAYS[range], now); setDates(next); setDraft(next) }, [range])
  const today = warsawDate(now)
  const choose = (days: number) => { const next = presetRateDates(days, now); setDates(next); setDraft(next) }
  return <section className="dl-date-rates" aria-label="Reply and acceptance rates">
    <h2>Reply and acceptance rates</h2>
    <fieldset className="dl-date-presets"><legend>Dates for rates</legend>{[7,30,90].map(days => {
      const p = presetRateDates(days, now)
      return <button type="button" key={days} aria-pressed={p.from === dates.from && p.to === dates.to} onClick={() => choose(days)}>{days} days</button>
    })}</fieldset>
    <form className="dl-date-form" onSubmit={e => { e.preventDefault(); if (validRateDates(draft, today)) setDates(draft) }}>
      <label>Rates from<input type="date" required value={draft.from} max={draft.to} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} /></label>
      <label>Rates to<input type="date" required value={draft.to} min={draft.from} max={today} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} /></label>
      <button type="submit" disabled={!validRateDates(draft, today)}>Show rates</button>
    </form>
    {!validRateDates(draft, today) && <p role="status" className="dl-date-note">Pick a valid date range ending today or earlier.</p>}
    <RatePeriodNote dates={dates} />
    <RateComparisonRead key={`${dates.from}:${dates.to}`} dates={dates} seat={seat} />
    <p className="dl-date-note">Outcomes within 72 hours of the first confirmed invite or DM. Rates use people who have had the full 72 hours. Pending sends stay separate. Changes are percentage points. Lanes follow current campaign membership. Counts below 20 are a small sample.</p>
  </section>
}
