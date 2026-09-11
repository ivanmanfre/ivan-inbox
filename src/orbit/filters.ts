// src/orbit/filters.ts — pure filter/stat/range logic for the Orbit shell.
// Nothing here touches the DOM or Supabase: every function is a plain
// transform over OrbitGraph/OrbitPerson, so it is testable without a mount
// (filters.test.ts) and safe to call on every keystroke/tap.

import type { OrbitLane, OrbitNeverReached, OrbitPerson } from './types'

export type DatePreset = '7d' | '30d' | '90d' | 'all' | 'custom'

export interface OrbitFilters {
  tenant: 'ivan' | 'arch' | 'risedtc'
  preset: DatePreset
  /** Only meaningful when preset === 'custom'; 'YYYY-MM-DD'. */
  from: string
  to: string
  /** Selected campaign ids (OrbitLane.id). Empty set = every lane. */
  lanes: Set<string>
  /** Only people with no prospect row (pid === null) — the "never reached, no campaign" population. */
  contentOnly: boolean
  /** Only people who moved first (person.inb). */
  movedFirst: boolean
  /** Only people whose never-reached bucket (person.nr) is in this set. Empty
   *  set = no never-reached filter applied (the three chips are independent
   *  toggles, not a single on/off switch — see db/062 for the bucket defs). */
  neverReached: Set<Exclude<OrbitNeverReached, null>>
  /** Minimum ICP score, inclusive. null = no floor. */
  icpMin: number | null
  /** Free-text search over name / company / headline, case-insensitive. */
  q: string
}

export function defaultFilters(tenant: OrbitFilters['tenant'] = 'ivan'): OrbitFilters {
  return {
    tenant, preset: '30d', from: '', to: '',
    lanes: new Set(), contentOnly: false, movedFirst: false, neverReached: new Set(),
    icpMin: null, q: '',
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Before any real data in this system — a plain floor, not a "genesis" date
// that means anything. p_from/p_to are `date` columns so any far-past value
// is a safe "no lower bound".
const ALL_TIME_FROM = '2015-01-01'

/** The [from, to] a date preset resolves to, anchored on `now`. Pure — the
 *  only reason `now` is a parameter is so a test can freeze the clock. */
export function presetRange(preset: Exclude<DatePreset, 'custom'>, now: Date = new Date()): { from: string; to: string } {
  const to = ymd(now)
  if (preset === 'all') return { from: ALL_TIME_FROM, to }
  const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30
  const from = new Date(now)
  from.setDate(from.getDate() - (days - 1))
  return { from: ymd(from), to }
}

/** The [from, to] a filters object resolves to — custom wins when set, every
 *  other preset is computed fresh from `now` so a stale filters object never
 *  serves a stale range. */
export function rangeOf(f: Pick<OrbitFilters, 'preset' | 'from' | 'to'>, now: Date = new Date()): { from: string; to: string } {
  if (f.preset === 'custom' && f.from && f.to) return { from: f.from, to: f.to }
  return presetRange(f.preset === 'custom' ? '30d' : f.preset, now)
}

/** Whether one person survives the current filter set. Order matters only
 *  for short-circuiting, not for the result. */
export function matchesFilters(p: OrbitPerson, f: OrbitFilters): boolean {
  if (f.lanes.size > 0 && !(p.camp && f.lanes.has(p.camp))) return false
  if (f.contentOnly && p.pid) return false
  if (f.movedFirst && !p.inb) return false
  if (f.neverReached.size > 0 && !(p.nr && f.neverReached.has(p.nr))) return false
  if (f.icpMin != null && (p.i == null || p.i < f.icpMin)) return false
  if (f.q.trim()) {
    const q = f.q.trim().toLowerCase()
    const hay = `${p.n} ${p.c} ${p.ti}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/** Lane chips for the horizontal strip: every campaign in the window,
 *  clustered by `lane` (cold/warm/engager/…) then alphabetically within it —
 *  a single scrolling row, not a grouped list, so like lanes sit together. */
export function sortedLaneChips(lanes: OrbitLane[]): OrbitLane[] {
  return [...lanes].sort((a, b) => (a.lane === b.lane ? a.name.localeCompare(b.name) : a.lane.localeCompare(b.lane)))
}

/** Campaigns the "Add to lane" picker may target — active and never the cold
 *  lane, per the brief: add-to-lane must never aim a person at a cold campaign. */
export function pickableLanes(lanes: OrbitLane[]): OrbitLane[] {
  return lanes.filter(l => l.active && l.lane !== 'cold')
}

/** A chip-sized campaign label: cut at the last whole word inside `max`
 *  characters, never mid-word, never with an ellipsis (the coordinator's
 *  fix: "Accounting & Tax Advisory Firms" -> "Accounting & Tax"). The full
 *  name is never lost — callers put it in the chip's `title` tooltip. */
export function shortLaneLabel(name: string, max = 18): string {
  if (name.length <= max) return name
  const cut = name.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 4 ? cut.slice(0, lastSpace) : cut).trim()
}

export interface OrbitStatsView {
  people: number
  reached: number
  replied: number
  booked: number
  /** Never-reached AND has a positive ICP judgement — the headline number for
   *  the never-reached split (see filters.ts' neverReached / db/062). */
  icpUnasked: number
  /** Never-reached AND judged not-ICP. */
  judgedOut: number
  /** Never-reached with no score anywhere. */
  unjudged: number
  /** % of reached people who moved first (inb) and went on to reply (st>=3). null = no reached-and-moved-first population to rate. */
  movedFirstRate: number | null
  /** Same rate for reached people we moved on first (not inb). */
  coldFirstRate: number | null
}

/** The stats strip's numbers, computed fresh from whatever the shell is
 *  currently showing (the filtered set) — never hardcoded, never cached
 *  separately from the graph. */
export function computeStats(people: OrbitPerson[]): OrbitStatsView {
  let reached = 0, replied = 0, booked = 0
  let icpUnasked = 0, judgedOut = 0, unjudged = 0
  let movedReached = 0, movedReplied = 0, coldReached = 0, coldReplied = 0
  for (const p of people) {
    if (p.reached) {
      reached++
      if (p.inb) { movedReached++; if (p.st >= 3) movedReplied++ }
      else { coldReached++; if (p.st >= 3) coldReplied++ }
    }
    if (p.nr === 'icp_unasked') icpUnasked++
    else if (p.nr === 'judged_out') judgedOut++
    else if (p.nr === 'unjudged') unjudged++
    if (p.st >= 3) replied++
    if (p.st === 4) booked++
  }
  return {
    people: people.length, reached, replied, booked, icpUnasked, judgedOut, unjudged,
    movedFirstRate: movedReached > 0 ? movedReplied / movedReached : null,
    coldFirstRate: coldReached > 0 ? coldReplied / coldReached : null,
  }
}
