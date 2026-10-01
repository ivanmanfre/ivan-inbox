import { useEffect, useState } from 'react'
import { fetchBrainScoreboard } from '../../lib/brainAccount'
import type { BrainMetrics, BrainScoreboardData } from '../../lib/brainAccount'
import { brainDate, brainNumber } from '../../lib/brainAccount'
import { Failed, Skeleton } from '../ui/states'
import type { Lane } from './model'
import './brain-account.css'

const percent = (n: number | null) => n == null ? 'Not recorded' : `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
const ratio = (n: number | null, reason: string | null) => n == null ? reason === 'zero_floor' ? 'Floor is zero; ratio unavailable' : 'Comparison unavailable' : `${brainNumber(n)}× the frozen floor`
function metricRows(m: BrainMetrics) {
  return [
    { label: 'Median engagement', value: brainNumber(m.engagement_median), count: m.engagement_n },
    { label: 'Median impressions', value: brainNumber(m.impressions_median), count: m.impressions_n },
    { label: 'Above floor engagement p75', value: percent(m.above_floor_p75_share), count: m.above_floor_p75_eligible_n },
    { label: 'Relevant engagers per post', value: brainNumber(m.relevant_engagers_per_post), count: m.relevant_scored_engager_posts_n },
  ]
}
export function BrainScoreboardBody({ lane, data, error, onRetry }: { lane: Lane; data: BrainScoreboardData | null; error: string | null; onRetry: () => void }) {
  const checked = data?.client === lane ? data : null
  const mismatch = data && !checked ? 'The scoreboard returned a different client.' : null
  const c = checked?.cohort, rolling = checked?.rolling_4w, floor = checked?.floor
  return <section className="cn-result-section cn-brain-scoreboard" aria-label="Brain scoreboard">
    <div className="cn-brain-heading"><h2>Brain scoreboard</h2>{c && <span className="cn-brain-status">{c.status === 'no_cohort' ? 'No published brain posts' : c.status === 'early' ? 'Early · fewer than 8 brain posts' : c.status === 'inconclusive' ? 'Inconclusive' : 'Observed results'}</span>}</div>
    <p className="cn-brain-note">Observed account results. These comparisons are correlation, with mixed post ages; they describe recorded outcomes.</p>
    {error || mismatch ? <Failed what="the brain scoreboard" detail={error || mismatch!} onRetry={onRetry} /> : !checked ? <Skeleton lines={4} label="Reading the brain scoreboard" /> : <>
      {checked.stale && <p className="cn-brain-notice" role="status">Showing the saved scoreboard. The weekly refresh is overdue.</p>}
      {floor ? <p className="cn-brain-floor-note">Frozen floor: {brainDate(floor.window_start)} to {brainDate(floor.window_end_exclusive)} (end exclusive) · {floor.published_n} published posts · {floor.window_complete ? 'complete window' : <strong>Partial window</strong>}. Observed through {brainDate(floor.observed_through)} · frozen {brainDate(floor.frozen_at)}.{floor.limitation && ` ${floor.limitation}`}</p> : <p className="cn-brain-notice">The frozen floor is unavailable. No floor comparison is established.</p>}
      {floor && <dl className="cn-brain-floor-metrics" aria-label="Frozen baseline metrics"><div><dt>Floor median engagement</dt><dd>{brainNumber(floor.engagement_median)} <small>n={floor.engagement_n}</small></dd></div><div><dt>Floor engagement p75</dt><dd>{brainNumber(floor.engagement_p75)} <small>n={floor.engagement_n}</small></dd></div><div><dt>Floor median impressions</dt><dd>{brainNumber(floor.impressions_median)} <small>n={floor.impressions_n}</small></dd></div></dl>}
      {checked.refresh_status === 'not_refreshed' && <p className="cn-brain-notice">The first scoreboard refresh has not been recorded. <button type="button" className="cn-quiet-link" onClick={onRetry}>Read again</button></p>}
      {c?.status === 'no_cohort' ? <p className="cn-brain-empty">No brain posts are published for this client yet (n=0). A comparison with other posts will appear once there is a shared publication week.</p> : c && <>
        <p className="cn-brain-note">Published in the same UTC weeks: {c.weeks_utc.map(brainDate).join(', ')}. Brain n={c.brain.published_n} · other n={c.other.published_n}.</p>
        {!c.comparison_available ? <p className="cn-brain-notice">{c.comparison_status === 'identity_unresolved' ? `${c.unlinked_brain_n} brain publication${c.unlinked_brain_n === 1 ? '' : 's'} cannot yet be linked to an own-post metric identity. The paired comparison is unavailable.` : c.comparison_status === 'no_other_posts' ? 'No other posts are recorded in these publication weeks.' : 'There are not enough recorded metrics for a paired comparison.'}</p> : <div className="cn-brain-comparison"><table><caption>Brain posts and other posts in the same publication weeks</caption><thead><tr><th scope="col">Observed metric</th><th scope="col">Brain</th><th scope="col">Other posts</th></tr></thead><tbody>{metricRows(c.brain).map((r, i) => {
          const other = metricRows(c.other)[i]
          return <tr key={r.label}><th scope="row">{r.label}</th><td><b>{r.value}</b><small>n={r.count}</small></td><td><b>{other.value}</b><small>n={other.count}</small></td></tr>
        })}</tbody></table></div>}
        <p className="cn-brain-note">Engagement is reactions + comments. Above p75 means strictly above the frozen engagement p75. Missing measurements are excluded per metric; n is the number of posts with that measurement. Relevant-engager counts require scored coverage: brain {brainNumber(c.brain.scored_engagers_total)} people scored across {c.brain.relevant_scored_engager_posts_n} posts; other {brainNumber(c.other.scored_engagers_total)} across {c.other.relevant_scored_engager_posts_n}. Only scored posts enter that average. An early sample remains inconclusive.</p>
      </>}
      {rolling && <div className="cn-brain-rolling"><h3>Account · rolling four weeks</h3><p>{brainDate(rolling.start_at)} to {brainDate(rolling.end_exclusive)} (end exclusive) · published n={rolling.account.published_n}</p><dl>
        <div><dt>Median engagement</dt><dd>{brainNumber(rolling.account.engagement_median)} <small>n={rolling.account.engagement_n} · {ratio(rolling.engagement_vs_floor_ratio, rolling.engagement_ratio_reason)}</small></dd></div>
        <div><dt>Median impressions</dt><dd>{brainNumber(rolling.account.impressions_median)} <small>n={rolling.account.impressions_n} · {ratio(rolling.impressions_vs_floor_ratio, rolling.impressions_ratio_reason)}</small></dd></div>
        <div><dt>Above floor engagement p75</dt><dd>{percent(rolling.account.above_floor_p75_share)} <small>n={rolling.account.above_floor_p75_eligible_n}</small></dd></div>
      </dl><p className="cn-brain-note">This is the whole account’s context; it is separate from the brain-versus-other comparison.</p></div>}
      {checked.limitations.length > 0 && <details className="cn-brain-details"><summary>Coverage and limitations</summary><ul>{checked.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
      <p className="cn-brain-note">As of {brainDate(checked.as_of)} · refreshed {brainDate(checked.refreshed_at)}. Metric coverage and post age can change the comparison.</p>
    </>}
  </section>
}

export function BrainScoreboard({ lane }: { lane: Lane }) {
  const [data, setData] = useState<BrainScoreboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true; const controller = new AbortController()
    setData(null); setError(null)
    void fetchBrainScoreboard(lane, controller.signal).then(r => { if (live) setData(r) }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not read the brain scoreboard.') })
    return () => { live = false; controller.abort() }
  }, [lane, tick])
  return <BrainScoreboardBody lane={lane} data={data} error={error} onRetry={() => setTick(t => t + 1)} />
}
