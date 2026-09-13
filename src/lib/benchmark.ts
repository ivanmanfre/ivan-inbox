/* ==========================================================================
   AUDIENCE BENCHMARK — one lane against the accounts we watch.

   Read through ONE database function (`audn_benchmark_payload`), which does
   every sum on the server: the phone never downloads 700 competitor posts to
   add them up. The function is security-definer because two of its sources
   (client_registry for the roster, the snapshot tables for the lane's own
   posts) are not readable by the signed-in session directly.

   Everything here is pure except `fetchBenchmark`. The helpers are the
   arithmetic the block prints — ratio lines, the heat scale, the peak cell —
   kept out of the component so a phrase can be tested without a render.
   ========================================================================== */
import { supabase } from './supabase'
import type { ContentLane } from './content'

export type RosterRole = 'direct_competitor' | 'buyer_voice' | 'format_reference' | 'sweep'

export type BenchYou = {
  n: number
  per_wk: number
  median: number | null
  smart: number | null
  imp_median: number | null
}

export type BenchAccount = {
  who: string
  role: RosterRole | string
  n: number
  per_wk: number
  median: number | null
  smart: number | null
  p90?: number | null
  media: string
  best: { eng: number; url: string | null; text: string } | null
}

export type BenchPost = {
  who: string
  role: RosterRole | string
  at: string
  media: string
  eng: number
  likes: number
  comments: number
  url: string | null
  text: string
  angle: string | null
  why: string | null
  /** The median post of this post's OWN author inside the window. */
  author_med: number | null
  author_n: number | null
  /** eng / author_med. Null when the author has too few posts to have a shape. */
  lift: number | null
  /** 0-100: where this post sits among that author's own posts. */
  author_pct: number | null
}

/** The lane's own baseline: the distribution its next post will be judged against. */
export type OwnDist = {
  n: number
  p50: number | null
  p75: number | null
  p90: number | null
  best: number | null
  n_imp: number
  k50: number | null
  k75: number | null
  k90: number | null
}

export type OwnRecent = {
  published_at: string
  eng: number
  impressions: number | null
  per1k: number | null
  /** percentile of this post inside the lane's own window; null under the floor. */
  pct: number | null
  text: string | null
  url: string | null
}

export type HeatCell = { dow: number; h: number; n: number; avg: number }

export type Benchmark = {
  ok: true
  client_id: string
  days: number
  read_at: string
  roster: Array<{ account: string; role: string }>
  window: { first: string | null; last: string | null; posts: number; posts90: number; accounts90: number }
  tiles: {
    their_median: number | null
    their_smart: number | null
    top_format: string | null
    roster_pace: number | null
    you: BenchYou
  }
  formats: Record<string, { theirs: number | null; n: number }>
  heat: HeatCell[]
  accounts: BenchAccount[]
  top: BenchPost[]
  outliers: BenchPost[]
  own_dist: OwnDist
  own_recent: OwnRecent[]
  floors: { own_min: number; author_min: number }
  source_classifications?: Array<{
    author_name: string; roster_role: string; roster_reason: string | null
    subject: string | null; purpose: string | null; hook: string | null; format: string | null
    taxonomy_version: string | null; n: number; observed_from: string | null; observed_to: string | null
  }>
  source_classification_unknown_time?: number
  source_classification_excluded_count?: number
}

export type BenchmarkState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: Benchmark }
  | { kind: 'empty'; reason: string }
  | { kind: 'failed'; message: string }

export const ROLE_LABEL: Record<string, string> = {
  direct_competitor: 'competitor',
  buyer_voice: 'buyer voice',
  format_reference: 'format ref',
  sweep: 'sweep',
}

export const ROLE_EXPLAINER =
  'Roster roles: a competitor sells what this lane sells to the same buyer, a buyer voice is who the lane sells to, a format reference is copied for shape only. Sweep is every other account the harvests brought in; nobody chose it.'

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Cells with fewer posts than this are drawn as blank: an average of two posts
    is a coin toss dressed as a reading. */
export const HEAT_FLOOR = 3

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  return Math.round(v).toLocaleString('en-US')
}

/** "they get 97×" / "you get 1.3×" / null when either side is missing or zero. */
export function ratioLine(theirs: number | null, yours: number | null): string | null {
  if (!theirs || !yours) return null
  const r = theirs / yours
  if (r >= 1) return `they get ${r.toFixed(1)}×`
  return `you get ${(1 / r).toFixed(1)}×`
}

/** The strongest cell above the floor and the busiest one, as one sentence. */
export function peakLine(heat: HeatCell[]): string {
  const v = heat.filter(c => c.n >= HEAT_FLOOR)
  if (v.length === 0) return 'Too few posts per cell to name a peak.'
  const peak = [...v].sort((a, b) => b.avg - a.avg)[0]
  const busy = [...v].sort((a, b) => b.n - a.n)[0]
  return `Peak ${DAYS[peak.dow]} ${peak.h}:00 (${num(peak.avg)} on ${peak.n} posts). Busiest ${DAYS[busy.dow]} ${busy.h}:00 (${busy.n} posts).`
}

/** 0..1 intensity for a cell, 0 when under the floor. */
export function heatScale(heat: HeatCell[]): (c: HeatCell | undefined) => number {
  const max = Math.max(1, ...heat.filter(c => c.n >= HEAT_FLOOR).map(c => c.avg))
  return c => (c && c.n >= HEAT_FLOOR ? Math.min(1, c.avg / max) : 0)
}

export function heatIndex(heat: HeatCell[]): Map<string, HeatCell> {
  const m = new Map<string, HeatCell>()
  for (const c of heat) m.set(`${c.dow}-${c.h}`, c)
  return m
}

/** Formats with at least one post, strongest first. */
export function formatRows(f: Benchmark['formats']): Array<{ media: string; theirs: number | null; n: number; pct: number }> {
  const rows = Object.entries(f)
    .filter(([, v]) => v.n > 0)
    .map(([media, v]) => ({ media, theirs: v.theirs, n: v.n }))
  const max = Math.max(1, ...rows.map(r => r.theirs ?? 0))
  return rows
    .sort((a, b) => (b.theirs ?? 0) - (a.theirs ?? 0))
    .map(r => ({ ...r, pct: r.theirs === null ? 0 : Math.max(2, (100 * r.theirs) / max) }))
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return String(iso).slice(0, 10)
}

export function subLine(b: Benchmark): string {
  const w = b.window
  return `${w.accounts90} accounts · ${w.posts90} of their posts in the last ${b.days} days · collected ${w.first ?? '?'} to ${w.last ?? '?'}`
}

export async function fetchBenchmark(lane: ContentLane): Promise<BenchmarkState> {
  const { data, error } = await supabase.rpc('audn_benchmark_payload', { p_client_id: lane, p_days: 90 })
  if (error) return { kind: 'failed', message: error.message }
  const p = data as { ok: boolean; error?: string } | null
  if (!p || p.ok !== true) return { kind: 'failed', message: p?.error ?? 'No payload came back.' }
  const b = p as Benchmark
  if (!b.window || b.window.posts === 0) return { kind: 'empty', reason: 'No competitor posts collected for this lane yet.' }
  return { kind: 'ready', data: b }
}

/* ---- You vs one account ---------------------------------------------------
   Ivan, 2026-09-12: "you vs one account is good i want that". The account is
   picked on the page; the arithmetic below is what the two columns print. */

export type CompareRow = {
  label: string
  you: string
  them: string
  youPct: number
  themPct: number
  note: string | null
}

/** The saved pick if it is still on the table, else the strongest competitor,
    else the strongest account of any role. Null only when the table is empty. */
export function pickCompare(accounts: BenchAccount[], saved: string | null): BenchAccount | null {
  if (accounts.length === 0) return null
  if (saved) {
    const s = accounts.find(a => a.who === saved)
    if (s) return s
  }
  const bySmart = (a: BenchAccount, b: BenchAccount) => (b.smart ?? 0) - (a.smart ?? 0)
  const comp = accounts.filter(a => a.role === 'direct_competitor').sort(bySmart)
  return comp[0] ?? [...accounts].sort(bySmart)[0]
}

/** Two bar widths on one scale; a positive value never draws under 2%. */
export function pairPct(you: number | null, them: number | null): { you: number; them: number } {
  const max = Math.max(you ?? 0, them ?? 0)
  if (max <= 0) return { you: 0, them: 0 }
  const f = (v: number | null) => (v === null || v <= 0 ? 0 : Math.max(2, (100 * v) / max))
  return { you: f(you), them: f(them) }
}

function paceNote(you: number, them: number): string | null {
  if (!you || !them) return null
  const r = them / you
  if (r > 1.15) return `they post ${r.toFixed(1)}× more often`
  if (r < 0.87) return `you post ${(1 / r).toFixed(1)}× more often`
  return 'same pace'
}

export function compareRows(you: BenchYou, them: BenchAccount): CompareRow[] {
  const pace = pairPct(you.per_wk, them.per_wk)
  const med = pairPct(you.median, them.median)
  const typ = pairPct(you.smart, them.smart)
  return [
    { label: 'Posts per week', you: String(you.per_wk), them: String(them.per_wk), youPct: pace.you, themPct: pace.them, note: paceNote(you.per_wk, them.per_wk) },
    { label: 'Median post', you: num(you.median), them: num(them.median), youPct: med.you, themPct: med.them, note: ratioLine(them.median, you.median) },
    { label: 'Typical post', you: num(you.smart), them: num(them.smart), youPct: typ.you, themPct: typ.them, note: ratioLine(them.smart, you.smart) },
  ]
}

/** One sentence for the top of the panel. */
export function compareSummary(you: BenchYou, them: BenchAccount, youLabel: string): string {
  const r = ratioLine(them.smart, you.smart)
  const gap = r ? ` (${r})` : ''
  return `${them.who} posts ${them.per_wk} a week, ${youLabel.toLowerCase()} ${you.per_wk}. Their typical post gets ${num(them.smart)}, yours ${num(you.smart)}${gap}.`
}

/* ---- Baselines ------------------------------------------------------------
   Ivan, 2026-09-13, on the Imagine AI method: "he will measure the content on
   performance per baseline impressions... P90, P70". Their published numbers are
   percentiles ACROSS accounts and are theirs, not ours. What we borrow is the
   shape: a post is read against the distribution of the account that wrote it.
   Ours are computed on our own posts and on each competitor's own posts. */

/** "1 · 2 · 5" for p50/p75/p90, or null when the lane is under the floor. */
export function distLine(d: OwnDist, floorN: number): string | null {
  if (!d || d.n < floorN) return null
  return `${num(d.p50)} · ${num(d.p75)} · ${num(d.p90)}`
}

/** The one sentence under the baseline: what a normal post looks like here. */
export function baselineSentence(d: OwnDist, floorN: number, youLabel = 'Your'): string {
  if (!d || d.n === 0) return 'No posts with metrics in this window.'
  if (d.n < floorN) {
    return `${d.n} posts with metrics. Under ${floorN} a percentile is noise, so this lane shows counts only.`
  }
  const mid = num(d.p50)
  const hi = num(d.p90)
  return `Half of ${youLabel.toLowerCase()} posts land at or under ${mid} engagement. One in ten clears ${hi}. Best in the window ${num(d.best)}.`
}

/** Where one post sits, in words. The band around the middle is named rather than
    numbered: "top 47%" is a true statement about a completely ordinary post, and it
    reads like praise. Null under the floor. */
export function pctLabel(pct: number | null): string | null {
  if (pct === null || pct === undefined) return null
  const p = Math.round(pct)
  if (p >= 60) return `top ${Math.max(1, 100 - p)}%`
  if (p >= 40) return 'about typical'
  return `bottom ${Math.max(1, p)}%`
}

/** "3.4× their median" for a post that beat its author; null when we cannot say. */
export function liftLabel(p: { lift: number | null; author_n: number | null }): string | null {
  if (p.lift === null || p.lift === undefined) return null
  if (p.lift >= 1.15) return `${p.lift.toFixed(1)}× their median`
  if (p.lift <= 0.85) return `${(1 / p.lift).toFixed(1)}× under their median`
  return 'their normal post'
}

/** Engagement per 1,000 impressions, the only rate we can compute, and only on
    our own posts: LinkedIn gives impressions for the poster and nobody else. */
export function per1kLine(d: OwnDist, floorN: number): string | null {
  if (!d || d.n_imp < floorN || d.k50 === null) return null
  return `${num(d.k50)} · ${num(d.k75)} · ${num(d.k90)} per 1,000 impressions`
}

/** Recent posts, newest first, with the percentile resolved to a phrase. */
export function recentRows(rows: OwnRecent[]): Array<OwnRecent & { label: string | null }> {
  return (rows || []).map(r => ({ ...r, label: pctLabel(r.pct) }))
}
