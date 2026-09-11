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
