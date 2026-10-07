/* The campaign sheet's "Reply rate by DM step" block: the rebuild sheet's
   Performance (wb/sends/CampaignSheet.tsx) as a D view. Drift / sibling alarm
   cards, per step: sent, replied %, positive %, viewed back %, prior 60 days;
   the copy variants (a fold, never default-open data hidden: the count is on
   the fold), and who got the busiest step and who replied, by source,
   country and vertical. Measured per LANE, so it names the campaigns sharing it. */
import { shortName, type CampaignPerf } from '../../lib/campaignPerf'
import { alarmLine, pct, stepLabel, type PerfLane, type PerfSplit, type PerfState } from '../../lib/outreachPerf'
import { LoadLine } from './CampaignSheet'
import type { Load } from './useRead'

const DIM: Record<string, string> = { source: 'Source', country: 'Country', vertical: 'Vertical' }

/** Per dimension, the busiest values of the lane's biggest step (variant left out: the list carries it). */
export function splitsFor(l: PerfLane): { step: string; dims: { dim: string; rows: PerfSplit[] }[] } | null {
  const step = [...l.cells].sort((a, b) => b.n - a.n)[0]?.step
  if (!step) return null
  const dims = (['source', 'country', 'vertical'] as const)
    .map(dim => ({ dim, rows: l.splits.filter(s => s.step === step && s.dim === dim && s.value !== 'unknown').sort((a, b) => b.n - a.n).slice(0, 4) }))
    .filter(d => d.rows.length > 0)
  return dims.length ? { step, dims } : null
}

export function CampaignPerfBlock({ state, c }: { state: Load<PerfState>; c: CampaignPerf }) {
  return (
    <LoadLine l={state} what="reply rates">{s => {
      if (s.kind === 'failed') return <p className="dl-sl dl-bad">Could not read reply rates: {s.message}</p>
      const lane = s.kind === 'ready' ? s.data.lanes.find(l => l.campaigns.includes(c.campaign_name)) : null
      if (!lane) return <p className="dl-sl">No DM from this campaign is old enough to judge yet. A DM counts 7 days after it went out.</p>
      const others = lane.campaigns.filter(n => n !== c.campaign_name).map(shortName)
      const split = splitsFor(lane)
      return <>
        <p className="dl-sl">Shared lane comparison. Measured on the {lane.lane} lane{others.length ? `, shared with ${others.join(', ')}` : ''}. Last 14 matured days against the 60 before. Viewed back is a floor: LinkedIn shows only some viewers.</p>
        {lane.alarms.map((a, i) => (
          <div className="dl-inc dl-alarm" key={`${a.kind}-${a.step}-${a.variant ?? ''}-${i}`}>
            <p className="dl-lead">{stepLabel(a.step)}{a.variant ? ` · ${a.variant}` : ''} is below {a.kind === 'drift' ? 'its prior 60 days' : 'its siblings'}</p>
            <p className="dl-kv">{alarmLine(a)}</p>
          </div>
        ))}
        <table className="dl-steps"><thead><tr><th>Step</th><th>Sent</th><th>Replied</th><th>Positive</th><th>Viewed back</th><th>Prior 60d</th></tr></thead><tbody>
          {lane.cells.map(x => (
            <tr key={x.step}><td>{stepLabel(x.step)}{x.status === 'drift' ? <span className="dl-al"> below prior</span> : x.status === 'thin' ? <span className="dl-dimt"> too few</span> : null}</td>
              <td className="dl-m">{x.n}</td><td className="dl-m">{x.replies} ({pct(x.rate)})</td>
              <td className="dl-m">{x.positive_rate == null ? <span className="dl-dimt">not classified</span> : pct(x.positive_rate)}</td>
              <td className="dl-m">{x.viewed_rate == null ? '—' : `${pct(x.viewed_rate)} (${x.viewed_n})`}</td>
              <td className="dl-m">{x.base_n ? pct(x.base_rate) : 'none'}</td></tr>
          ))}
        </tbody></table>
        {lane.variants.length > 0 && (
          <details className="dl-fold2">
            <summary>{lane.variants.length} copy variants</summary>
            {lane.variants.map(v => (
              <div className="dl-ev" key={`${v.step}-${v.variant}`}><span className="dl-t1">{stepLabel(v.step)} · {v.variant}{v.status === 'sibling' ? <span className="dl-al"> · below siblings</span> : v.status === 'thin' ? ' · too few to call' : ''}</span>
                <time>{v.replies} of {v.n} ({pct(v.rate)}){v.viewed_n > 0 && v.viewed_rate != null ? ` · viewed back ${pct(v.viewed_rate)}` : ''}</time></div>
            ))}
          </details>
        )}
        {split && <>
          <p className="dl-sl">Who got {stepLabel(split.step)}, and who replied</p>
          <div className="dl-splits">{split.dims.map(d => (
            <div key={d.dim}><small>{DIM[d.dim] ?? d.dim}</small>
              {d.rows.map(r => <div key={r.value} className="dl-spr"><span>{r.value}</span><b>{r.replies} of {r.n} ({pct(r.rate)})</b></div>)}
            </div>
          ))}</div>
        </>}
      </>
    }}</LoadLine>
  )
}
