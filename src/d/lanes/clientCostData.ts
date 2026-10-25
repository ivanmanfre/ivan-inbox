import { supabase } from '../../lib/supabase'
import type { LaneDayRow } from '../../lib/money'
import { SEATS, type Seat } from '../seats'

export type CostPeriod = 7 | 30
export const COST_PAGE_SIZE = 500
export const COST_MAX_ROWS = 5000

/** UTC calendar days, inclusive of today. `day` is a date column in the existing view. */
export function costWindow(days: CostPeriod, now: number) {
  const today = new Date(now).toISOString().slice(0, 10)
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days + 1)
  const end = new Date(`${today}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/** Reads only daily provider aggregates. No raw run, person, or source IDs cross into the browser. */
export async function fetchCostLaneDays(days: CostPeriod, now = Date.now(), signal?: AbortSignal): Promise<LaneDayRow[]> {
  if (signal?.aborted) throw new DOMException('Cost read cancelled', 'AbortError')
  const { start, end } = costWindow(days, now)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 12000)
  try {
    const rows: LaneDayRow[] = []
    for (let from = 0; from <= COST_MAX_ROWS; from += COST_PAGE_SIZE) {
      const page = await supabase.from('vs_lane_day_v')
        .select('day,lane,vendor,runs,usd_presettle,usd_settled,settled_runs,observed_at')
        .gte('day', start).lt('day', end)
        .order('day', { ascending: false }).order('lane', { ascending: true }).order('vendor', { ascending: true })
        .range(from, from + COST_PAGE_SIZE - 1).abortSignal(controller.signal)
      if (page.error) throw new Error(page.error.message)
      const batch = (page.data ?? []) as LaneDayRow[]
      rows.push(...batch)
      if (rows.length > COST_MAX_ROWS) throw new Error('Cost aggregate exceeds the safe read limit; open Money for details')
      if (batch.length < COST_PAGE_SIZE) return rows
    }
    throw new Error('Cost aggregate exceeds the safe read limit; open Money for details')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export type CostBucket = {
  vendor: string
  recorded: number | null
  tokenEstimate: number | null
  presettle: number | null
  runs: number
  unsettledRuns: number
  malformed: number
  observedAt: string | null
}
export type CostSummary = { bySeat: Record<Seat, CostBucket[]>; unassigned: CostBucket[] }

function seatOfLane(lane: string): Seat | null {
  if (lane === 'rise') return 'risedtc'
  return (SEATS as readonly string[]).includes(lane) ? lane as Seat : null
}

export function summarizeClientCost(rows: LaneDayRow[]): CostSummary {
  const maps: Record<Seat, Map<string, CostBucket>> = { ivan: new Map(), risedtc: new Map(), arch: new Map(), swishdm: new Map() }
  const unassigned = new Map<string, CostBucket>()
  for (const row of rows) {
    const seat = seatOfLane(row.lane)
    const map = seat ? maps[seat] : unassigned
    const vendor = row.vendor?.trim() || 'Unknown provider'
    const bucket = map.get(vendor) ?? { vendor, recorded: null, tokenEstimate: null, presettle: null, runs: 0, unsettledRuns: 0, malformed: 0, observedAt: null }
    bucket.runs += row.runs
    bucket.unsettledRuns += Math.max(0, row.runs - row.settled_runs)
    const amount = row.usd_settled
    const presettle = row.usd_presettle
    if (vendor === 'anthropic_api') {
      // Money's Anthropic source is token-priced usage in presettle; a settled
      // field is only a fallback estimate and never an amount to add to it.
      const estimate = presettle ?? amount
      if (estimate !== null) {
        if (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate < 0) bucket.malformed++
        else bucket.tokenEstimate = (bucket.tokenEstimate ?? 0) + estimate
      }
    } else {
      if (amount !== null) {
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) bucket.malformed++
        else bucket.recorded = (bucket.recorded ?? 0) + amount
      }
      if (presettle !== null) {
        if (typeof presettle !== 'number' || !Number.isFinite(presettle) || presettle < 0) bucket.malformed++
        else bucket.presettle = (bucket.presettle ?? 0) + presettle
      }
    }
    const observed = row.observed_at && Date.parse(row.observed_at)
    if (observed && Number.isFinite(observed) && (!bucket.observedAt || observed > Date.parse(bucket.observedAt))) bucket.observedAt = row.observed_at
    map.set(vendor, bucket)
  }
  const list = (m: Map<string, CostBucket>) => [...m.values()].sort((a, b) => a.vendor.localeCompare(b.vendor))
  return { bySeat: { ivan: list(maps.ivan), risedtc: list(maps.risedtc), arch: list(maps.arch), swishdm: list(maps.swishdm) }, unassigned: list(unassigned) }
}
