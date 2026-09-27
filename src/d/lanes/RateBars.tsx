/* A rate chart, one row per lane (or campaign): label, a bar, the percentage
   and the two counts it came from ("109 of 360"). The whole-seat row sits on
   top. The formula is the chart's tooltip and one tap away on the phone (the
   "How" key). A row with nothing to judge says so, never 0%. */
import { useState } from 'react'
import type { RateRow, Rates } from './rates'

function scaleMax(rows: RateRow[]): number {
  const top = Math.max(0, ...rows.map(r => r.pct ?? 0))
  return Math.max(10, Math.ceil(top / 10) * 10)
}

function Row({ r, max, unit, total }: { r: RateRow; max: number; unit: string; total?: boolean }) {
  const w = r.pct == null ? 0 : Math.max(r.pct > 0 ? 1.5 : 0, (r.pct / max) * 100)
  return (
    <div className={`dl-rb${total ? ' dl-rbt' : ''}`} data-rate={r.key} title={`${r.label}: ${r.hit} of ${r.base} ${unit}${r.pct == null ? '' : ` = ${r.pct}%`}`}>
      <span className="dl-rbl">{r.label}</span>
      <span className="dl-rbk"><i style={{ width: `${w}%` }} /></span>
      {r.pct == null
        ? <span className="dl-rbv dl-dimt">nothing to judge yet</span>
        : <span className="dl-rbv"><b>{r.pct}%</b><small>{r.hit} of {r.base}</small></span>}
    </div>
  )
}

export function RateBars({ title, rates, formula, unit, empty, failed }: {
  title: string; rates: Rates | null; formula: string; unit: string; empty: string; failed?: string | null
}) {
  const [how, setHow] = useState(false)
  const rows = rates ? [...(rates.total ? [rates.total] : []), ...rates.lanes] : []
  const max = scaleMax(rows)
  return (
    <div className="dl-rc" title={formula}>
      <div className="dl-rch">
        <b>{title}</b>
        <button type="button" className="dl-how" aria-expanded={how} onClick={() => setHow(v => !v)}>How it is counted</button>
      </div>
      {how && <p className="dl-sl dl-formula">{formula}</p>}
      {!rates ? <p className={`dl-sl ${failed ? 'dl-bad' : 'dl-unk'}`}>{failed ? `Could not be read: ${failed}` : 'Reading…'}</p>
        : rows.length === 0 ? <p className="dl-sl">{empty}</p>
          : <>
            {rates.total && <Row r={rates.total} max={max} unit={unit} total />}
            {rates.lanes.map(r => <Row key={r.key} r={r} max={max} unit={unit} />)}
            <p className="dl-rbs">bar length: 0 to {max}%</p>
          </>}
    </div>
  )
}
