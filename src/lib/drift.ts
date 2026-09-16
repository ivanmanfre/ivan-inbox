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
export type DriftWindow = { n: number; placed: number; countries: DriftBucket[]; titles: DriftBucket[] }
export type DriftShift = { label: string; recentPct: number; priorPct: number }
export type DriftReachTop = { label: string; pct: number; city: string; joinedInCity: number }
export type DriftSummary = { recent: DriftWindow; prior: DriftWindow; shifts: DriftShift[]; reachTop: DriftReachTop | null }

export const DRIFT_DAYS = 90
export const DRIFT_FLOOR = 10   // a window under this many accepts shows counts, never shares
export const DRIFT_TOP = 5
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

function buckets(values: Array<string | null>, top: number): { placed: number; list: DriftBucket[] } {
  const count = new Map<string, { label: string; n: number }>()
  let placed = 0
  for (const v of values) {
    if (!v) continue
    placed++
    const key = v.toLowerCase()
    const cur = count.get(key)
    if (cur) cur.n++
    else count.set(key, { label: v, n: 1 })
  }
  const list = [...count.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, top)
    .map(b => ({ label: b.label, n: b.n, pct: placed ? Math.round((100 * b.n) / placed) : 0 }))
  return { placed, list }
}

function windowOf(rows: JoinedRow[]): DriftWindow {
  const countries = buckets(rows.map(r => normalizeCountry(r.country, r.location)), DRIFT_TOP)
  const titles = buckets(rows.map(r => (r.title?.trim() ? r.title.trim().replace(/\s+/g, ' ') : null)), DRIFT_TOP)
  return { n: rows.length, placed: countries.placed, countries: countries.list, titles: titles.list }
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
  const recent = windowOf(recentRows)
  const prior = windowOf(priorRows)

  const shifts: DriftShift[] = []
  if (recent.placed >= DRIFT_FLOOR && prior.placed >= DRIFT_FLOOR) {
    const labels = new Set([...recent.countries, ...prior.countries].map(b => b.label))
    for (const label of labels) {
      const r = pctOf(recent.countries, label)
      const p = pctOf(prior.countries, label)
      if (Math.abs(r - p) >= SHIFT_POINTS) shifts.push({ label, recentPct: r, priorPct: p })
    }
    shifts.sort((a, b) => Math.abs(b.recentPct - b.priorPct) - Math.abs(a.recentPct - a.priorPct) || a.label.localeCompare(b.label))
  }

  let reachTop: DriftReachTop | null = null
  const top = summarizeReach(own, now).recent.shares.location?.labels[0]
  if (top) {
    const city = cityOf(top.label)
    const needle = city.toLowerCase()
    const joinedInCity = recentRows.filter(r => (r.location ?? '').toLowerCase().includes(needle)).length
    reachTop = { label: top.label, pct: top.pct, city, joinedInCity }
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
