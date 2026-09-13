/* ==========================================================================
   AUDIENCE BENCHMARK — this lane against the accounts we watch.

   Ivan, 2026-09-11, after seeing the proposals as a wall of text: "i want
   something better and usable". The shape is the one he pointed at (a
   benchmark dashboard: tiles, format, timing, account table, top posts), on
   our own data, one lane at a time. It sits ABOVE the proposals so the
   numbers come before the sentences written from them.

   Read-only. One RPC, one render. Nothing here writes; the proposals block
   below stays the only writer on this screen.

   HOOKS. Every hook is declared at the top of its component, before any
   branch. A hook placed after an early return blanked every DM conversation
   in this app for about an hour on 2026-09-09.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Group } from '../kit'
import { CalmEmpty, Failed } from './parts'
import {
  fetchBenchmark, num, shortDate,
  type Benchmark, type BenchmarkState,
} from '../../lib/benchmark'
import { fetchMeasurement, type MeasurementPayload, type MeasurementRead, type MeasurementRow } from '../../lib/audience'
import type { ContentLane } from '../../lib/content'
import './content.css'

function metricLabel(metric: MeasurementRow['metric']) {
  if (metric === 'engagement_count') return 'Engagement count'
  if (metric === 'engagement_per_1000') return 'Engagement per 1,000 impressions'
  return 'Impressions'
}

function MeasurementPanel({ state }: { state: MeasurementRead }) {
  if (state.kind === 'loading') return <div className="a-bm-measure"><div className="a-bm-h">Matched-age measurement</div><div className="a-ct-sub">Reading the measurement basis…</div></div>
  if (state.kind === 'denied') return <div className="a-bm-measure"><div className="a-bm-h">Matched-age measurement</div><div className="a-ct-sub a-sev-urgent">This lane's measurement was not available to this session. {state.message}</div></div>
  if (state.kind === 'failed') return <div className="a-bm-measure"><div className="a-bm-h">Matched-age measurement</div><div className="a-ct-sub a-sev-urgent">Measurement could not load. {state.message}</div></div>
  if (state.kind === 'empty') return <div className="a-bm-measure"><div className="a-bm-h">Matched-age measurement</div><div className="a-ct-sub">{state.message} The raw post history remains above; no comparable rank is implied.</div></div>
  const p: MeasurementPayload = state.data
  const rows = p.matched_age.slice(0, 12)
  const unresolved = p.coverage.filter(x => x.resolution_status === 'unresolved' || x.unresolved_reason).length
  const stale = p.coverage.filter(x => /stale/i.test(x.collection_status ?? '')).length
  return (
    <div className="a-bm-measure">
      <div className="a-bm-h">Matched-age measurement</div>
      <div className="a-ct-sub">Posts are compared at {p.targets.join(' and ')} days, within ±{p.tolerance_days} day, against this lane's last {p.cohort_days} days. Each standing includes the post itself. A percentile needs {p.minimum_n} eligible posts.</div>
      <div className="a-bm-measure-grid">
        {rows.map((r, i) => <div className="a-bm-measure-row" key={`${r.canonical_post_id ?? r.raw_snapshot_id ?? i}-${r.metric}-${r.target_age_days}`}>
          <div><strong>{metricLabel(r.metric)}</strong><span>Post {shortDate(r.published_at)} · {r.canonical_post_id ? `id ${String(r.canonical_post_id).slice(-8)}` : 'canonical identity unavailable'} · {r.target_age_days}d target · captured {shortDate(r.captured_at)} · actual age {r.actual_age_days ?? 'unknown'}d</span></div>
          <div className="a-mono">{r.value == null ? 'unknown' : num(r.value)}</div>
          <div className="a-bm-measure-detail">{r.status === 'supported' ? `p50 ${num(r.p50)} · p75 ${num(r.p75)} · p90 ${num(r.p90)} · standing ${r.standing_pct == null ? 'unknown' : `${num(r.standing_pct)}%`} of n=${r.eligible_n ?? 0}` : r.status === 'below_floor' ? `n=${r.eligible_n ?? 0}; under the ${r.minimum_n ?? p.minimum_n} post floor, so no percentile is shown.` : `Metric missing for this snapshot (${r.missing_n ?? 0} missing in its cohort).`}</div>
        </div>)}
      </div>
      {p.monthly_trend?.length ? <details className="a-bm-measure"><summary className="a-bm-h">Monthly absolute measurements ({p.monthly_trend.length})</summary><div className="a-ct-sub">Median within each calendar month at the stated target age; no months are pooled.</div>{p.monthly_trend.map((r, i) => <div className="a-bm-measure-row" key={`${r.month}-${r.metric}-${i}`}><div><strong>{metricLabel(r.metric)}</strong><span>{shortDate(r.month)} · {r.target_age_days}d target · n={r.n}</span></div><div className="a-bm-measure-detail">Median {num(r.median)}{r.captured_through ? ` · captured through ${shortDate(r.captured_through)}` : ''}</div></div>)}</details> : null}
      <div className="a-ct-sub">{unresolved ? `${unresolved} raw row${unresolved === 1 ? '' : 's'} could not be resolved to a canonical post.` : 'No unresolved raw identity rows in this read.'}{stale ? ` ${stale} row${stale === 1 ? '' : 's'} have stale collection status.` : ''} Unknown classifications and missing metrics remain visible rather than becoming zero.</div>
    </div>
  )
}

function SourceReferences({ benchmark }: { benchmark: Benchmark }) {
  const classifications = benchmark.source_classifications || []
  let categoryBlock: React.ReactNode = null
  if (classifications.length) {
    const grouped = Array.from(classifications.reduce((m, r) => {
      const key = `${r.author_name}\u0000${r.roster_role}\u0000${r.roster_reason ?? ''}`
      const previous = m.get(key) || { ...r, categories: [] as string[] }
      previous.categories.push({ label: [r.subject, r.purpose, r.hook, r.format].map(v => v || 'unknown').join(' · '), n: r.n })
      m.set(key, previous); return m
    }, new Map<string, any>()).values())
    categoryBlock = <div className="a-bm-measure">
    <div className="a-bm-h">Source categories to review</div>
    <div className="a-ct-sub">Descriptive classified post counts, grouped by author and roster role. These are not pooled performance or a universal format rule.</div>
    <div className="a-bm-measure-grid">{grouped.slice(0, 24).map((r, i) => <div className="a-bm-measure-row" key={`${r.author_name}-${r.roster_role}-${i}`}>
      <div><strong>{r.author_name}</strong><span>{r.roster_role}{r.roster_reason ? ` · ${r.roster_reason}` : ''} · {r.categories.reduce((sum: number, c: any) => sum + c.n, 0)} classified post observations</span></div>
      <div className="a-bm-measure-detail">{r.categories.slice(0, 4).map((c: any) => `${c.label} (n=${c.n})`).join(' / ')}{r.categories.length > 4 ? ` +${r.categories.length - 4} more` : ''}</div>
      <div className="a-bm-measure-detail">Observed {shortDate(r.observed_from)} to {shortDate(r.observed_to)}{r.taxonomy_version ? ` · taxonomy ${r.taxonomy_version}` : ''}</div>
    </div>)}</div>
    {grouped.length > 24 ? <div className="a-ct-sub">Showing 24 author-and-role groups; {grouped.length - 24} more remain in the captured source classification payload.</div> : null}
    {benchmark.source_classification_excluded_count ? <div className="a-ct-sub">{benchmark.source_classification_excluded_count} unreviewed source rows were excluded from this roster-only reference.</div> : null}
    {benchmark.source_classification_unknown_time ? <div className="a-ct-sub">{benchmark.source_classification_unknown_time} source classifications have no observed time and remain outside the dated window.</div> : null}
  </div>
  }
  const rows = (benchmark.outliers || []).filter(p => (p.author_n ?? 0) >= (benchmark.floors?.author_min ?? 8)).slice(0, 12)
  const postBlock = rows.length ? <div className="a-bm-measure">
    <div className="a-bm-h">Source posts to review</div>
    <div className="a-ct-sub">Each post is compared only with its own author's observed posts. Accounts remain separate; impressions are unknown here unless the source supplied them.</div>
    <div className="a-bm-measure-grid">{rows.map((p, i) => <div className="a-bm-measure-row" key={`${p.who}-${p.at}-${i}`}>
      <div><strong>{p.who}</strong><span>{p.role} · {shortDate(p.at)} · {p.media} · author n={p.author_n}</span></div>
      <div className="a-mono">{num(p.eng)} engagement</div>
      <div className="a-bm-measure-detail">{p.author_med == null ? 'Own-author baseline unavailable.' : `Own-author median ${num(p.author_med)}; this post is ${p.lift == null ? 'not ranked' : `${p.lift.toFixed(1)}× that author’s median`}.`} {p.angle || p.why || 'Reason not recorded.'}</div>
    </div>)}</div>
  </div> : null
  return <>{categoryBlock}{postBlock}</>
}

/** Exported so the suite can render the block from a fixture without a fetch. */
export function BenchmarkView({ lane, state, onRetry, measurement = { kind: 'loading' } }: {
  lane: ContentLane
  state: BenchmarkState
  onRetry?: () => void
  measurement?: MeasurementRead
}) {
  void lane
  const label = 'Against the accounts we watch'
  if (state.kind === 'loading') {
    return (
      <Group className="a-bm-g" label={label} pad>
        <div className="a-ct-sub">Reading…</div>
      </Group>
    )
  }
  if (state.kind === 'failed') {
    return (
      <Group className="a-bm-g" label={label} pad>
        <Failed what="the benchmark" message={state.message} onRetry={onRetry} />
      </Group>
    )
  }
  if (state.kind === 'empty') {
    return (
      <Group className="a-bm-g" label={label} pad>
        <CalmEmpty line={state.reason} />
      </Group>
    )
  }
  const benchmark = state.data
  return (
    <Group
      className="a-bm-g"
      label={label}
      pad
    >
      <MeasurementPanel state={measurement} />
      <SourceReferences benchmark={benchmark} />
      <div className="a-ct-sub a-bm-foot">
        Each metric stays separate. A matched-age standing is only shown when its eligible cohort meets the stated floor; it is not a forecast of the next post.
      </div>
    </Group>
  )
}

export function BenchmarkBlock({ lane }: { lane: ContentLane }) {
  // ---- hooks, all of them, before any branch ------------------------------
  const [state, setState] = useState<BenchmarkState>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [measurement, setMeasurement] = useState<MeasurementRead>({ kind: 'loading' })
  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    fetchBenchmark(lane).then(s => { if (live) setState(s) })
    setMeasurement({ kind: 'loading' })
    fetchMeasurement(lane).then(s => { if (live) setMeasurement(s) })
    return () => { live = false }
  }, [lane, tick])
  return <BenchmarkView lane={lane} state={state} measurement={measurement} onRetry={() => setTick(t => t + 1)} />
}
