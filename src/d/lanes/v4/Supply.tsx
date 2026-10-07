import { useState } from 'react'
import type { Seat } from '../../seats'
import { Figure, slotRead } from '../../ui/Figure'
import { laneInfo } from '../laneInfo'
import { dayKey, dm } from '../model'
import { verdict } from '../Refill'
import type { Supply as SupplyData, SupplyDay } from '../supply'
import type { LanesData } from '../useLanesData'

export function mirror(days: SupplyDay[] | null, now: number) {
  return { days, max: Math.max(1, ...(days ?? []).flatMap(d => [d.inn, d.out])), today: (days ?? []).findIndex(d => d.day === dayKey(now)) }
}
export function barPct(n: number, max: number) { return n > 0 ? Math.max(2, n / max * 100) : 0 }
export function supplyVerdict(s: SupplyData, flowKnown: boolean) { return flowKnown || s.ready === 0 ? verdict(s) : null }
function Mirror({ s, now }: { s: SupplyData; now: number }) {
  const m = mirror(s.days, now)
  return <div className="dl4-mirror" aria-label="People qualified in and invited out, last 14 days">
    <div className="dl4-mirror-label"><span>In <b>{m.days?.reduce((a, d) => a + d.inn, 0)}</b></span><small>Last 14 days</small></div>
    <div className="dl4-mirror-cols">{m.days?.map((d, i) => <button type="button" key={d.day} className={`dl4-mirror-day${i === m.today ? ' dl4-now' : ''}`} title={`${dm(d.day + 'T12:00:00Z')}: ${d.inn} in · ${d.out} out`} aria-label={`${d.day}: ${d.inn} in · ${d.out} out`}>
      <span className="dl4-mirror-top"><i style={{ height: `${barPct(d.inn,m.max)}%` }} /></span>
      <span className="dl4-mirror-bottom"><i style={{ height: `${barPct(d.out,m.max)}%` }} /></span>
      <small>{new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })}</small>
    </button>)}</div>
    <div className="dl4-mirror-label"><span>Out <b>{m.days?.reduce((a, d) => a + d.out, 0)}</b></span></div>
  </div>
}
export function Supply({ seat, d, s, now, retry }: { seat: Seat; d: LanesData; s: SupplyData; now: number; retry: () => void }) {
  const [explain, setExplain] = useState<string | null>(null)
  const v = supplyVerdict(s, d.replacement.value != null)
  const runway = d.ready.value != null ? slotRead(d.replacement, () => s.runwayDays) : slotRead(d.ready, () => s.runwayDays)
  const noPace = d.ready.value != null && d.replacement.value != null && s.runwayDays == null
  const noRefill = d.replacement.value != null && s.refill == null
  const max = Math.max(1, ...s.lanes.filter(l => !l.off).map(l => l.n))
  return <section className="dl4-panel dl4-supply" data-band="refill" data-seat={seat} data-bx-block>
    <h2>Supply</h2>
    <div className="dl4-supply-numbers">
      <div><small>Ready</small><Figure r={slotRead(d.ready, () => s.ready)} retry={retry} /></div>
      <div className={s.runwayDays != null && s.runwayDays < 3 ? 'dl4-warn' : ''}><small>Runway</small>{noPace ? <span className="dl4-no-pace">No sending pace</span> : <Figure r={runway} retry={retry} size="m" unit="days" />}</div>
      <div className={s.refill != null && s.refill < 1 ? 'dl4-warn' : ''}><small>Refill · 7 days</small>{noRefill ? <span className="dl4-no-pace">No invites out</span> : <Figure r={slotRead(d.replacement, () => s.refill)} retry={retry} size="m" format={n => n.toFixed(2)} unit="x" />}</div>
    </div>
    {v && d.ready.value && <p className={`dl4-verdict${v.bad ? ' dl4-warn' : ''}`}>{v.text}</p>}
    <div className="dl4-supply-charts">
      <div className="dl4-stock"><h3>Ready by lane</h3>
        {!d.ready.value ? <div className="dl4-read"><Figure r={slotRead(d.ready, () => 0)} retry={retry} /><p>Who is ready {d.ready.failed ? 'could not be read' : 'is being read'}.</p></div>
          : s.lanes.length ? s.lanes.map(l => { const info = laneInfo(seat, l.lane); return <div key={l.lane} className={`dl4-stock-row${l.off || l.candidate ? ' dl4-stock-dim' : ''}`}>
            <button type="button" title={info ?? l.off ?? l.label} aria-expanded={explain === l.lane} onClick={() => setExplain(explain === l.lane ? null : l.lane)}>{l.label}</button>
            <span className="dl4-bar"><i style={{ width: `${l.off ? 0 : l.n / max * 100}%` }} /></span><b>{l.off ? 'Excluded' : `${l.capped ? '≥' : ''}${l.n}`}</b>
            {l.candidate && <small className="dl4-explain">Candidates, not verified ready</small>}{explain === l.lane && <p className="dl4-explain">{[l.off, info].filter(Boolean).join(' · ')}</p>}
          </div> }) : <p>No lane has anyone ready.</p>}
      </div>
      {s.days ? <Mirror s={s} now={now} /> : <div className="dl4-read"><Figure r={slotRead(d.replacement, () => null)} retry={retry} /><p>The refill {d.replacement.failed ? 'could not be read.' : 'is being read.'}</p></div>}
    </div>
    <p className="dl4-supply-foot">New people found this week <Figure size="m" r={slotRead(d.engagers, x => x[seat] ?? 0)} retry={retry} /></p>
  </section>
}
