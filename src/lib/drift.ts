import { supabase } from './supabase'
import { CLIENT_OPS_GATE, type ContentLane } from './content'
import { summarizeReach, type PostAudienceRow } from './reach'

// WHO JOINED THE NETWORK. The Zagreb finding (memory 2026-09-16): going out of
// network does not move where a post lands, the network itself does. The
// outreach engine reshapes that network one accepted invite at a time, so this
// module reads the accepts (operator_network_drift, db/072) and lays the last
// 90 days next to the 90 before, plus the one city the posts still reach most.

export type JoinedRow = {
  connected_at: string | null
  title: string | null
  country: string | null
  location: string | null
  company: string | null
}

export type DriftRead =
  | { kind: 'ready'; joined: JoinedRow[]; readAt: string }
  | { kind: 'denied' | 'failed'; message: string }

export type DriftBucket = { label: string; n: number; pct: number }
export type DriftWindow = {
  n: number
  /** Rows with a resolved country. */
  placed: number
  /** Rows with a title. */
  titled: number
  /** `placed >= DRIFT_FLOOR`; when false, `countries` and `titles` are empty (the counts still hold). */
  hasShares: boolean
  countries: DriftBucket[]
  titles: DriftBucket[]
}
export type DriftShift = { label: string; recentPct: number; priorPct: number }
export type DriftReachTop = { label: string; pct: number; city: string; joinedInCity: number; posts: number; reached: number }
export type DriftSummary = { recent: DriftWindow; prior: DriftWindow; shifts: DriftShift[]; reachTop: DriftReachTop | null }

export const DRIFT_DAYS = 90
export const DRIFT_FLOOR = 10   // a window under this many accepts shows counts, never shares
export const DRIFT_TOP = 5
export const REACH_LINE_MIN_POSTS = 3   // a reach reading off fewer located posts than this shows no line
const SHIFT_POINTS = 5

// The outreach tables hold ISO-2 codes, full names and metro strings in the
// same column. One label per country for display; anything unrecognised that
// looks like a metro string is "unplaced" and counts only in `n`.
const COUNTRY: Record<string, string> = {
  US: 'United States', USA: 'United States', 'UNITED STATES': 'United States', 'UNITED STATES OF AMERICA': 'United States',
  UK: 'United Kingdom', GB: 'United Kingdom', 'UNITED KINGDOM': 'United Kingdom',
  CA: 'Canada', CANADA: 'Canada', AU: 'Australia', AUSTRALIA: 'Australia', DE: 'Germany', GERMANY: 'Germany',
  FR: 'France', FRANCE: 'France', NL: 'Netherlands', NETHERLANDS: 'Netherlands', NZ: 'New Zealand', 'NEW ZEALAND': 'New Zealand',
  AE: 'United Arab Emirates', 'UNITED ARAB EMIRATES': 'United Arab Emirates', BE: 'Belgium', BELGIUM: 'Belgium',
  IL: 'Israel', ISRAEL: 'Israel', SG: 'Singapore', SINGAPORE: 'Singapore', IE: 'Ireland', IRELAND: 'Ireland',
  ES: 'Spain', SPAIN: 'Spain', TR: 'Türkiye', TURKEY: 'Türkiye', 'TÜRKIYE': 'Türkiye', PL: 'Poland', POLAND: 'Poland',
  RU: 'Russia', RUSSIA: 'Russia', LV: 'Latvia', LATVIA: 'Latvia', IT: 'Italy', ITALY: 'Italy', SE: 'Sweden', SWEDEN: 'Sweden',
  CH: 'Switzerland', SWITZERLAND: 'Switzerland', AT: 'Austria', AUSTRIA: 'Austria', DK: 'Denmark', DENMARK: 'Denmark',
  PT: 'Portugal', PORTUGAL: 'Portugal', BR: 'Brazil', BRAZIL: 'Brazil', IN: 'India', INDIA: 'India',
  HR: 'Croatia', CROATIA: 'Croatia', RS: 'Serbia', SERBIA: 'Serbia', SI: 'Slovenia', SLOVENIA: 'Slovenia',
  RO: 'Romania', ROMANIA: 'Romania', BG: 'Bulgaria', BULGARIA: 'Bulgaria', FI: 'Finland', FINLAND: 'Finland',
  NO: 'Norway', NORWAY: 'Norway', CZ: 'Czech Republic', 'CZECH REPUBLIC': 'Czech Republic', GR: 'Greece', GREECE: 'Greece',
  CY: 'Cyprus', CYPRUS: 'Cyprus', UA: 'Ukraine', UKRAINE: 'Ukraine', LT: 'Lithuania', LITHUANIA: 'Lithuania',
  EE: 'Estonia', ESTONIA: 'Estonia', SK: 'Slovakia', SLOVAKIA: 'Slovakia', ZA: 'South Africa', 'SOUTH AFRICA': 'South Africa',
  CO: 'Colombia', COLOMBIA: 'Colombia', MX: 'Mexico', MEXICO: 'Mexico', AR: 'Argentina', ARGENTINA: 'Argentina',
  KR: 'South Korea', 'SOUTH KOREA': 'South Korea', JP: 'Japan', JAPAN: 'Japan', CN: 'China', CHINA: 'China',
  MY: 'Malaysia', MALAYSIA: 'Malaysia', SA: 'Saudi Arabia', 'SAUDI ARABIA': 'Saudi Arabia', BY: 'Belarus', BELARUS: 'Belarus',
  IQ: 'Iraq', IRAQ: 'Iraq', 'NORTH MACEDONIA': 'North Macedonia', MK: 'North Macedonia',
}
const METRO = /\b(AREA|METROPOLITAN|REGION|METROPLEX|GREATER)\b/

export function normalizeCountry(country: string | null, location: string | null): string | null {
  const c = country?.trim()
  if (c) {
    const key = c.toUpperCase()
    if (COUNTRY[key]) return COUNTRY[key]
    return METRO.test(key) ? null : c
  }
  if (!location) return null
  const parts = location.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return null
  return COUNTRY[parts[parts.length - 1].toUpperCase()] ?? null
}

/** "Zagreb Metropolitan Area" -> "Zagreb"; "London Area, United Kingdom" -> "London". */
export function cityOf(label: string): string {
  const s = label.replace(/^Greater\s+/i, '')
  const cut = s.search(/\s+(Metropolitan|Area|Region|Bay|Metroplex)\b|,/)
  return (cut >= 0 ? s.slice(0, cut) : s).trim()
}

/** Whether `text`'s own city (its first comma segment, metro suffix stripped via
    `cityOf`) is `city`. A boundary match, not a substring one, so "Rome" does
    not match a `text` of "Romeoville, Illinois, United States". */
function cityMatches(text: string | null, city: string): boolean {
  if (!text) return false
  return cityOf(text).toLowerCase() === city.toLowerCase()
}

// Forced lowercase when not the first word ("Head of Growth", not "Head Of Growth",
// and "Head OF Growth" corrects the same way).
const MINOR_WORDS = new Set(['of', 'and', 'the', 'at', 'in', 'for', 'to', 'a', 'an', 'on', 'with'])
// Display casing only, not a gate: a whole word that is one of these common role
// acronyms is shown upper-cased, whatever case it arrived in.
const ALL_CAPS_WORDS = new Set(['ceo', 'cmo', 'cto', 'coo', 'cfo', 'vp', 'svp', 'evp', 'hr'])

/** Upper-cases the first letter of each space-separated word; forces a non-first
    minor word (see `MINOR_WORDS`) to lowercase, and a recognised acronym (see
    `ALL_CAPS_WORDS`) to upper-case, at any position. Anything else keeps the
    rest of the word untouched, so an already-normalised name ("USA"/"UK" from
    the COUNTRY table) survives as-is. Applied to every group's canonical label
    (Finding 1) so the display casing never depends on which spelling of a
    case-insensitive group happened to arrive first, or how many times. */
function titleCase(label: string): string {
  return label
    .split(' ')
    .map((w, i) => {
      if (!w) return w
      const lower = w.toLowerCase()
      if (ALL_CAPS_WORDS.has(lower)) return w.toUpperCase()
      if (i > 0 && MINOR_WORDS.has(lower)) return lower
      return w[0].toUpperCase() + w.slice(1)
    })
    .join(' ')
}

/** Full ranked list, un-truncated: shifts (Finding 1) need shares beyond the top-`DRIFT_TOP` display slice.
    Each case-insensitive group's canonical spelling is the exact text seen most often within that
    group (ties broken by localeCompare), title-cased on top — so the label never depends on which
    spelling of the group happened to be inserted first. */
function buckets(values: Array<string | null>): { placed: number; list: DriftBucket[] } {
  const groups = new Map<string, Map<string, number>>()
  let placed = 0
  for (const v of values) {
    if (!v) continue
    placed++
    const key = v.toLowerCase()
    let spellings = groups.get(key)
    if (!spellings) { spellings = new Map(); groups.set(key, spellings) }
    spellings.set(v, (spellings.get(v) ?? 0) + 1)
  }
  const list = [...groups.values()]
    .map(spellings => {
      const n = [...spellings.values()].reduce((sum, c) => sum + c, 0)
      const [canonical] = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
      return { label: titleCase(canonical), n, pct: placed ? Math.round((100 * n) / placed) : 0 }
    })
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  return { placed, list }
}

/** `window` is the published shape; `countryShares` is the full un-truncated list, kept only for shift math. */
function windowOf(rows: JoinedRow[]): { window: DriftWindow; countryShares: DriftBucket[] } {
  const countries = buckets(rows.map(r => normalizeCountry(r.country, r.location)))
  const titles = buckets(rows.map(r => (r.title?.trim() ? r.title.trim().replace(/\s+/g, ' ') : null)))
  const hasShares = countries.placed >= DRIFT_FLOOR
  return {
    window: {
      n: rows.length,
      placed: countries.placed,
      titled: titles.placed,
      hasShares,
      countries: hasShares ? countries.list.slice(0, DRIFT_TOP) : [],
      titles: hasShares ? titles.list.slice(0, DRIFT_TOP) : [],
    },
    countryShares: countries.list,
  }
}

function pctOf(list: DriftBucket[], label: string): number {
  return list.find(b => b.label === label)?.pct ?? 0
}

export function driftSummary(joined: JoinedRow[], own: PostAudienceRow[], now: number = Date.now()): DriftSummary {
  const day = 86400e3
  const recentFrom = now - DRIFT_DAYS * day
  const priorFrom = now - 2 * DRIFT_DAYS * day
  const stamped = joined.filter(r => r.connected_at && Number.isFinite(Date.parse(r.connected_at)))
  const recentRows = stamped.filter(r => Date.parse(r.connected_at as string) >= recentFrom)
  const priorRows = stamped.filter(r => { const t = Date.parse(r.connected_at as string); return t >= priorFrom && t < recentFrom })
  const recentResult = windowOf(recentRows)
  const priorResult = windowOf(priorRows)
  const recent = recentResult.window
  const prior = priorResult.window

  const shifts: DriftShift[] = []
  if (recent.hasShares && prior.hasShares) {
    const labels = new Set([...recentResult.countryShares, ...priorResult.countryShares].map(b => b.label))
    for (const label of labels) {
      const r = pctOf(recentResult.countryShares, label)
      const p = pctOf(priorResult.countryShares, label)
      if (Math.abs(r - p) >= SHIFT_POINTS) shifts.push({ label, recentPct: r, priorPct: p })
    }
    shifts.sort((a, b) => Math.abs(b.recentPct - b.priorPct) - Math.abs(a.recentPct - a.priorPct) || a.label.localeCompare(b.label))
  }

  let reachTop: DriftReachTop | null = null
  const reachLoc = summarizeReach(own, now).recent.shares.location
  const top = reachLoc?.labels[0]
  if (top && reachLoc && reachLoc.posts >= REACH_LINE_MIN_POSTS) {
    const city = cityOf(top.label)
    // The outreach tables sometimes put the metro string in `country` rather than `location`
    // (Finding 3), so a joined row counts toward the city if either column carries it. Matched
    // on the FIRST segment of that column, run through `cityOf` (so "Zagreb, Croatia" and
    // "Zagreb Metropolitan Area" both resolve to "Zagreb") rather than a raw substring test,
    // which let "Rome" match "Romeoville".
    const joinedInCity = city
      ? recentRows.filter(r => cityMatches(r.location, city) || cityMatches(r.country, city)).length
      : 0
    reachTop = { label: top.label, pct: top.pct, city, joinedInCity, posts: reachLoc.posts, reached: reachLoc.reached }
  }
  return { recent, prior, shifts, reachTop }
}

export async function fetchNetworkDrift(lane: ContentLane): Promise<DriftRead> {
  const { data, error } = await supabase.rpc('operator_network_drift', { p_gate: CLIENT_OPS_GATE, p_client_id: lane })
  if (error) {
    const message = error.message || 'The network read failed.'
    return /permission|denied|not authorized|unauthorized|not_authenticated/i.test(message)
      ? { kind: 'denied', message }
      : { kind: 'failed', message }
  }
  const d = data as { joined?: unknown } | null
  if (!d || !Array.isArray(d.joined)) return { kind: 'failed', message: 'The network read returned no usable list.' }
  return { kind: 'ready', joined: d.joined as JoinedRow[], readAt: new Date().toISOString() }
}
