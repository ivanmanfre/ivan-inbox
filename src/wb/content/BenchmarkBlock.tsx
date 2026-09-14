import { useEffect, useState } from 'react'
import { Group } from '../kit'
import { Button, Segmented } from '../../ds'
import { CalmEmpty, Failed } from './parts'
import { fetchBenchmark, num, shortDate, ROLE_LABEL, ROLE_EXPLAINER, type Benchmark, type BenchmarkState } from '../../lib/benchmark'
import { fetchMeasurement, type MeasurementPayload, type MeasurementRead, type MeasurementMetric } from '../../lib/audience'
import { evidenceUrl, measurementSummary } from '../../lib/measurement-summary'
import type { ContentLane } from '../../lib/content'
import './content.css'
import './benchmark-evidence.css'

const metrics: MeasurementMetric[] = ['impressions', 'engagement_count', 'engagement_per_1000']
function metricLabel(metric: MeasurementMetric) {
  return metric === 'engagement_count' ? 'Engagement count' : metric === 'engagement_per_1000' ? 'Engagement per 1,000 impressions' : 'Impressions'
}
function SourceLink({ url, label = 'Open source' }: { url?: string | null; label?: string }) {
  const href = evidenceUrl(url)
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span className="a-dim">Source link unavailable</span>
}

function MeasurementReady({ p }: { p: MeasurementPayload }) {
  const ages = Array.from(new Set([...p.targets, ...p.matched_age.flatMap(r => r.target_age_days == null ? [] : [r.target_age_days])])).sort((a, b) => a - b)
  const [selectedAge, setAge] = useState(ages[0] ?? 7)
  const [metric, setMetric] = useState<MeasurementMetric>('impressions')
  const age = ages.includes(selectedAge) ? selectedAge : ages[0] ?? 7
  const { rows, cohort, conflicting } = measurementSummary(p, age, metric)
  const cohortCounts = Array.from(new Set(rows.map(r => `eligible n=${r.eligible_n ?? 'unknown'} / minimum ${r.minimum_n ?? p.minimum_n}`)))
  const monthly = p.monthly_trend.filter(r => r.target_age_days === age && r.metric === metric)
  return <>
    <div className="a-ct-sub">Your posts at the same age, against this lane's last {p.cohort_days} days. Capture tolerance ±{p.tolerance_days} day. {p.self_inclusive ? 'Each post is included in its own cohort.' : 'The measured post is excluded from its cohort.'} These measurements describe observed performance; they do not predict the next post.</div>
    <Segmented label="Measurement age" markerId={`benchmark-age-${p.client_id}`} value={String(age)} onChange={k => setAge(Number(k))} options={ages.map(a => ({ id: String(a), label: `${a} days` }))} />
    <Segmented label="Measurement metric" className="a-bm-metric-tabs" markerId={`benchmark-metric-${p.client_id}`} value={metric} onChange={k => setMetric(k as MeasurementMetric)} options={metrics.map(m => ({ id: m, label: metricLabel(m) }))} />
    <div className="a-bm-measure">
      <div className="a-bm-h">{metricLabel(metric)} · {age} days</div>
      {!cohort && <div className="a-ct-sub">{cohortCounts.length ? cohortCounts.join('; ') : `Eligible n=0 · minimum ${p.minimum_n}`}</div>}
      {cohort ? <><div className="a-mono">p50 {num(cohort.p50)} · p75 {num(cohort.p75)} · p90 {num(cohort.p90)}</div><div className="a-ct-sub">Eligible n={cohort.eligible_n} · minimum {cohort.minimum_n ?? p.minimum_n}. p50 is the median; p90 is the value at the 90th percentile.</div></> : <div className="a-ct-sub">{conflicting ? 'Returned rows have different cohort baselines. Review each post below; no combined percentile is shown.' : rows.length ? `No supported cohort summary for this selection. Percentiles require at least ${p.minimum_n} eligible posts with this metric.` : 'No captured measurements for this age and metric. Historical values have not been reconstructed.'}</div>}
    </div>
    <details className="a-bm-measure"><summary className="a-bm-h">Post measurements ({rows.length})</summary>
      {rows.map((r, i) => <div className="a-bm-measure-row" key={`${r.canonical_post_id ?? r.raw_snapshot_id ?? i}-${i}`}>
        <div><strong>Post {shortDate(r.published_at) || 'date unknown'}</strong><span>Captured {shortDate(r.captured_at) || 'unknown'} · actual age {r.actual_age_days ?? 'unknown'} days · {r.canonical_post_id ? `id ${r.canonical_post_id.slice(-8)}` : 'canonical identity unavailable'}</span><SourceLink url={p.classifications.find(c => c.canonical_post_id && c.canonical_post_id === r.canonical_post_id)?.source_ref} /></div>
        <div className="a-mono">{r.value == null ? 'unknown' : num(r.value)}</div>
        <div className="a-bm-measure-detail">{r.status === 'supported' && (r.eligible_n ?? 0) >= (r.minimum_n ?? p.minimum_n) ? `p50 ${num(r.p50)} · p75 ${num(r.p75)} · p90 ${num(r.p90)} · standing ${r.standing_pct == null ? 'unknown' : `${num(r.standing_pct)}%`} · eligible n=${r.eligible_n}` : `Eligible n=${r.eligible_n ?? 0} · minimum ${r.minimum_n ?? p.minimum_n} · ${r.status === 'metric_missing' ? 'metric missing' : 'below cohort floor'}; no percentile shown.`}{` Missing metrics: ${r.missing_n ?? 'unknown'}.`}</div>
      </div>)}
    </details>
    <details className="a-bm-measure"><summary className="a-bm-h">Monthly trend ({monthly.length})</summary><div className="a-ct-sub">Separate calendar-month medians at {age} days; months are never pooled.</div>{monthly.map((r, i) => <div className="a-bm-measure-row" key={`${r.month}-${i}`}><div><strong>{shortDate(r.month)}</strong><span>n={r.n} · captured through {shortDate(r.captured_through) || 'unknown'}</span></div><div>Median {num(r.median)}</div></div>)}</details>
    <details className="a-bm-measure"><summary className="a-bm-h">Coverage and classifications ({p.coverage.length} / {p.classifications.length})</summary>
      {p.coverage.map((r, i) => <div className="a-ct-sub" key={i}>{r.canonical_post_id ?? r.raw_snapshot_id ?? 'Identity unknown'} · {r.collection_status ?? 'collection status unknown'} · {r.unresolved_reason ?? r.resolution_status ?? 'resolution unknown'}</div>)}
      {p.classifications.map((r, i) => <div className="a-bm-measure-row" key={i}><div>{r.canonical_post_id ?? 'Identity unknown'}<span>{[r.subject, r.purpose, r.hook, r.format].map(v => v ?? 'unknown').join(' · ')}</span></div><SourceLink url={r.source_ref} /></div>)}
    </details>
  </>
}

function Competitors({ benchmark: b }: { benchmark: Benchmark }) {
  const floor = b.floors?.author_min ?? 8
  const posts = [...(b.outliers ?? []), ...(b.top ?? [])].filter((p, i, all) => all.findIndex(q => q.who === p.who && q.at === p.at && q.url === p.url) === i)
  return <>
    <div className="a-ct-sub">Observed engagement across mixed post ages in the last {b.days} days, read {shortDate(b.read_at)}. These are descriptive counts, not matched-age comparisons with your posts or forecasts. Competitor impressions are unavailable unless supplied by the source.</div>
    <div className="a-ct-sub">{ROLE_EXPLAINER}</div>
    <div className="a-bm-h">Accounts ({b.accounts.length})</div>
    {b.accounts.map((a, i) => <div className="a-bm-measure-row" key={`${a.who}-${i}`}><div><strong>{a.who}</strong><span>{ROLE_LABEL[a.role] ?? a.role} · {a.n} observed posts · {a.per_wk} posts/week · {a.media || 'format unknown'}</span><SourceLink url={a.best?.url} label="Open observed best post" /></div><div className="a-bm-measure-detail">{a.n >= floor ? `Engagement median ${num(a.median)} · p90 ${a.p90 == null ? 'unavailable' : num(a.p90)}` : `n=${a.n}; below ${floor}-post floor. No percentile shown.`}</div></div>)}
    <details className="a-bm-measure"><summary className="a-bm-h">Full watch roster ({b.roster.length})</summary>{b.roster.map((r, i) => <div className="a-ct-sub" key={i}>{r.account} · {ROLE_LABEL[r.role] ?? r.role}{!b.accounts.some(a => a.who === r.account) ? ' · account-level measurements may be unavailable or recorded under its display name' : ''}</div>)}</details>
    <details className="a-bm-measure"><summary className="a-bm-h">Source posts to review ({posts.length})</summary><div className="a-ct-sub">Ratios use only the author's own observed baseline. Post ages may differ; an observed ratio is not predicted lift.</div>{posts.map((p, i) => <div className="a-bm-measure-row" key={i}><div><strong>{p.who} · {shortDate(p.at)}</strong><span>{p.media} · {p.role} · author n={p.author_n ?? 'unknown'}</span><SourceLink url={p.url} /><p>{p.text || p.angle || p.why || 'Post text unavailable.'}</p></div><div className="a-mono">{num(p.eng)} engagement</div><div className="a-bm-measure-detail">{(p.author_n ?? 0) >= floor && p.author_med != null ? `Own-author median ${num(p.author_med)} · ${p.lift == null ? 'ratio unavailable' : `${p.lift.toFixed(1)}× that median`}` : 'Own-author baseline below floor or unavailable.'}</div></div>)}</details>
    <details className="a-bm-measure"><summary className="a-bm-h">Source categories ({b.source_classifications?.length ?? 0})</summary>{(b.source_classifications ?? []).map((r, i) => <div className="a-bm-measure-row" key={i}><div><strong>{r.author_name}</strong><span>{r.roster_role} · {r.roster_reason}</span></div><div>{[r.subject, r.purpose, r.hook, r.format].map(v => v ?? 'unknown').join(' · ')} · n={r.n}<div className="a-ct-sub">Observed {shortDate(r.observed_from) || 'unknown'} to {shortDate(r.observed_to) || 'unknown'} · taxonomy {r.taxonomy_version ?? 'unknown'}</div></div></div>)}<div className="a-ct-sub">Excluded unreviewed rows: {b.source_classification_excluded_count ?? 0}. Unknown observation time: {b.source_classification_unknown_time ?? 0}.</div></details>
  </>
}

export function BenchmarkView({ lane, state, measurement = { kind: 'loading' }, view = 'results', onRetry }: { lane: ContentLane; state: BenchmarkState; measurement?: MeasurementRead; view?: 'results' | 'competitors'; onRetry?: () => void }) {
  const label = view === 'results' ? 'Your results at 7 and 14 days' : 'Competitors and reference accounts'
  let body
  if (view === 'results') {
    body = measurement.kind === 'loading' ? <div className="a-ct-sub">Reading measurements…</div> : measurement.kind === 'ready' ? measurement.data.client_id !== lane || measurement.data.matched_age.some(r => r.client_id !== lane) ? <Failed what="measurements" message="Measurement returned a different lane." onRetry={onRetry} /> : <MeasurementReady key={lane} p={measurement.data} /> : measurement.kind === 'empty' ? <><CalmEmpty line={measurement.message} /><Button onClick={onRetry}>Refresh measurements</Button></> : <Failed what="measurements" message={measurement.message} onRetry={onRetry} />
  } else {
    body = state.kind === 'loading' ? <div className="a-ct-sub">Reading reference accounts…</div> : state.kind === 'ready' ? state.data.client_id === lane ? <Competitors benchmark={state.data} /> : <Failed what="reference accounts" message="Benchmark returned a different lane." onRetry={onRetry} /> : state.kind === 'empty' ? <><CalmEmpty line={state.reason} /><Button onClick={onRetry}>Refresh reference accounts</Button></> : <Failed what="reference accounts" message={state.message} onRetry={onRetry} />
  }
  return <Group className="a-bm-g" label={label} pad>{body}</Group>
}

export function BenchmarkBlock({ lane, view = 'results' }: { lane: ContentLane; view?: 'results' | 'competitors' }) {
  const [read, setRead] = useState<{ lane: ContentLane; view: string; state: BenchmarkState; measurement: MeasurementRead } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setRead(null)
    const load = async () => {
      try {
        const state: BenchmarkState = view === 'competitors' ? await fetchBenchmark(lane) : { kind: 'loading' }
        const measurement: MeasurementRead = view === 'results' ? await fetchMeasurement(lane) : { kind: 'loading' }
        if (live) setRead({ lane, view, state, measurement })
      } catch (error) {
        const failed = { kind: 'failed' as const, message: error instanceof Error ? error.message : 'The source could not be read.' }
        if (live) setRead({ lane, view, state: failed, measurement: failed })
      }
    }
    void load()
    return () => { live = false }
  }, [lane, view, tick])
  const current = read?.lane === lane && read.view === view ? read : null
  return <BenchmarkView lane={lane} view={view} state={current?.state ?? { kind: 'loading' }} measurement={current?.measurement ?? { kind: 'loading' }} onRetry={() => setTick(t => t + 1)} />
}
