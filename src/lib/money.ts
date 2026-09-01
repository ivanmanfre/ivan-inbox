import { supabase } from './supabase'
import { taskTitle } from './ops'
import { LANE_LABEL, type ContentLane } from './content'

// The Money job's data layer (goal-run money-truth-2026-09-01).
//
// The whole point of this page is that every number on it can be walked back
// to where it came from. So this file does two jobs that stay deliberately
// separate:
//
//   1. FETCHERS — plain `.from().select()` reads against tables/views that
//      already exist and already grant SELECT to `authenticated`. Nothing
//      here writes.
//   2. PROVENANCE / FORMATTING — pure functions with no Supabase dependency,
//      so the refusal rules (a stale runway figure, an unverified row, a
//      missing source row) are unit-testable without a network or a DOM. The
//      <Cell> component in MoneyView.tsx is the only thing allowed to render
//      a number, and it is built entirely out of these functions — that is
//      what makes the provenance rule impossible to bypass by accident.

// ---------------------------------------------------------------------------
// Types — the four tables/views this page reads.
// ---------------------------------------------------------------------------

export type MoneyKind = 'mrr' | 'charge' | 'invoice' | 'refund' | 'vendor_cost' | 'cash_balance'

export type MoneyLedgerRow = {
  id: string
  client_id: string | null
  kind: MoneyKind
  amount_usd: number
  currency: string
  occurred_on: string
  source_kind: string
  source_ref: string | null
  observed_at: string | null
  verified: boolean
  note: string | null
}

const MONEY_LEDGER_COLS =
  'id, client_id, kind, amount_usd, currency, occurred_on, source_kind, source_ref, observed_at, verified, note'

export type LaneDayRow = {
  day: string
  lane: 'ivan' | 'risedtc' | 'arch' | 'unattributed'
  vendor: string
  runs: number
  usd_presettle: number
  usd_settled: number
  settled_runs: number
  observed_at: string | null
}

export type ActorDayRow = LaneDayRow & { actor_or_service: string }

export type EngineCounterDayRow = {
  day: string
  action_type: string
  runs: number
  apify_usd_claimed: number
}

export type IntegrationConfigRow = { key: string; value: string | null; updated_at: string | null }

export type MoneyTaskRow = {
  id: string
  body: string
  context: { due_at?: string; run?: string } | null
}

// ---------------------------------------------------------------------------
// Provenance — the rule that makes this page the point.
// ---------------------------------------------------------------------------

export const STALE_DAYS = 7
const DAY_MS = 86_400_000

export function daysSince(iso: string | null, now: number = Date.now()): number {
  if (!iso) return Infinity
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return Infinity
  return Math.floor((now - t) / DAY_MS)
}

export function isStale(observedAt: string | null, now: number = Date.now()): boolean {
  return daysSince(observedAt, now) > STALE_DAYS
}

// Same shape as Surface.tsx's relAge (the v2c convention every other job
// uses for freshness). Reimplemented here rather than imported, because this
// file is the pure/testable data layer and money.test.ts runs in plain node —
// it must not need a .tsx component or a DOM to verify a date computation.
export function relAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'never'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export const UNVERIFIED_SUFFIX = 'unverified (source: memory, awaiting Stripe read)'
export const NO_SOURCE_TEXT = 'no source row'

// One provenance line for one numeric cell: "source_kind · source_ref ·
// observed <relAge>", with " · stale <n>d" appended past the 7-day mark.
// Deliberately does NOT fold in the unverified suffix — verified is a
// separate per-row fact the <Cell> renders as its own style + suffix, so the
// text and the trust state stay two independently testable things instead of
// one string a caller would have to parse back apart.
export function provenanceText(
  row: { source_kind: string; source_ref: string | null; observed_at: string | null },
  now: number = Date.now(),
): string {
  const base = `${row.source_kind} · ${row.source_ref ?? 'no ref'} · observed ${relAge(row.observed_at, now)}`
  const d = daysSince(row.observed_at, now)
  return Number.isFinite(d) && d > STALE_DAYS ? `${base} · stale ${d}d` : base
}

// ---------------------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------------------

export function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
}

// "29.6x" or the honest refusal when the engines claimed nothing at all — a
// bare division by zero would print "Infinity×", which reads as a bug and
// not as the fact it is (nothing to compare settled spend against).
export function deltaRatio(settledUsd: number, claimedUsd: number): string {
  if (claimedUsd === 0) return '∞ (engines claimed $0)'
  return `${(settledUsd / claimedUsd).toFixed(1)}×`
}

// ---------------------------------------------------------------------------
// Runway (Section 3) — never estimated.
// ---------------------------------------------------------------------------

export type RunwayResult =
  | { ok: true; value: number }
  | { ok: false; reason: string }

export const RUNWAY_REFUSAL = 'runway: not computable, cash figure missing or stale'
const CASH_MAX_AGE_DAYS = 30

export function computeRunway(input: {
  cashOnHandUsd: number | null
  cashAsOfDate: string | null
  vendorSpend30dUsd: number
  verifiedMrrSumUsd: number
  now?: number
}): RunwayResult {
  const now = input.now ?? Date.now()
  if (input.cashOnHandUsd === null || input.cashAsOfDate === null) {
    return { ok: false, reason: RUNWAY_REFUSAL }
  }
  if (daysSince(input.cashAsOfDate, now) > CASH_MAX_AGE_DAYS) {
    return { ok: false, reason: RUNWAY_REFUSAL }
  }
  return { ok: true, value: input.cashOnHandUsd - input.vendorSpend30dUsd + input.verifiedMrrSumUsd }
}

// ---------------------------------------------------------------------------
// Fetchers — Section 1: MRR and next charges
// ---------------------------------------------------------------------------

export async function fetchMrrRows(): Promise<MoneyLedgerRow[]> {
  const { data, error } = await supabase
    .from('money_ledger')
    .select(MONEY_LEDGER_COLS)
    .eq('kind', 'mrr')
    .order('occurred_on', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as MoneyLedgerRow[]
}

// One row per client (client_id === null means Ivan). Rows arrive newest
// occurred_on first, so "first seen per key wins" is the same thing as
// "newest wins" without a second sort pass.
export function latestPerClient(rows: MoneyLedgerRow[]): MoneyLedgerRow[] {
  const seen = new Set<string>()
  const out: MoneyLedgerRow[] = []
  for (const r of rows) {
    const key = r.client_id ?? '__ivan__'
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export function clientLabel(clientId: string | null): string {
  if (clientId === null) return 'Ivan'
  return LANE_LABEL[clientId as ContentLane] ?? clientId
}

// `billing_day:<n>` lives in the mrr row's own free-text note field — the
// only place Section 6's checklist can derive an expected charge day from.
export function billingDay(row: MoneyLedgerRow): number | null {
  const m = row.note?.match(/billing_day:(\d+)/)
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------------------
// Fetchers — Section 2: renewal and churn risk
// ---------------------------------------------------------------------------

export async function fetchRenewalRiskRows(): Promise<MoneyLedgerRow[]> {
  const { data, error } = await supabase
    .from('money_ledger')
    .select(MONEY_LEDGER_COLS)
    .not('note', 'is', null)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter((r: MoneyLedgerRow) => r.note?.startsWith('renewal:') || r.note?.startsWith('risk:')) as MoneyLedgerRow[]
}

// The free text AFTER the prefix — rendered verbatim per the data contract.
export function riskNoteText(note: string): string {
  const i = note.indexOf(':')
  return i === -1 ? note : note.slice(i + 1).trim()
}

export function riskNoteKind(note: string): 'renewal' | 'risk' {
  return note.startsWith('renewal:') ? 'renewal' : 'risk'
}

// ---------------------------------------------------------------------------
// Fetchers — Section 6: invoice and receipt checklist (this month)
// ---------------------------------------------------------------------------

export function monthBounds(now: number = Date.now()): { start: string; end: string } {
  const d = new Date(now)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
  return { start, end }
}

export async function fetchMonthChargesAndInvoices(now: number = Date.now()): Promise<MoneyLedgerRow[]> {
  const { start, end } = monthBounds(now)
  const { data, error } = await supabase
    .from('money_ledger')
    .select(MONEY_LEDGER_COLS)
    .in('kind', ['invoice', 'charge'])
    .gte('occurred_on', start)
    .lte('occurred_on', end)
  if (error) throw new Error(error.message)
  return (data ?? []) as MoneyLedgerRow[]
}

// ---------------------------------------------------------------------------
// Fetchers — Section 4/5: vendor spend and cost-to-serve
// ---------------------------------------------------------------------------

function cutoffDate(days: number, now: number = Date.now()): string {
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10)
}

export async function fetchLaneDay(days = 30, now: number = Date.now()): Promise<LaneDayRow[]> {
  const { data, error } = await supabase
    .from('vs_lane_day_v')
    .select('day, lane, vendor, runs, usd_presettle, usd_settled, settled_runs, observed_at')
    .gte('day', cutoffDate(days, now))
    .order('day', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LaneDayRow[]
}

export async function fetchActorDay(days = 30, now: number = Date.now()): Promise<ActorDayRow[]> {
  const { data, error } = await supabase
    .from('vs_actor_day_v')
    .select('day, lane, vendor, actor_or_service, runs, usd_presettle, usd_settled, settled_runs, observed_at')
    .gte('day', cutoffDate(days, now))
    .order('day', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ActorDayRow[]
}

export async function fetchEngineCounterDay(days = 30, now: number = Date.now()): Promise<EngineCounterDayRow[]> {
  const { data, error } = await supabase
    .from('engine_counter_day_v')
    .select('day, action_type, runs, apify_usd_claimed')
    .gte('day', cutoffDate(days, now))
    .order('day', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as EngineCounterDayRow[]
}

// A row that is present but carries no observed_at at all (the view itself
// never fetched fresh) is still SOME source — vs_lane_day_v / engine_counter's
// `observed_at` is the freshness stamp Section 4 cites. When a period has no
// rows at all, the caller renders NO_SOURCE_TEXT instead of a synthesised 0.
export function latestObservedAt(rows: { observed_at: string | null }[]): string | null {
  let latest: string | null = null
  for (const r of rows) {
    if (!r.observed_at) continue
    if (!latest || r.observed_at > latest) latest = r.observed_at
  }
  return latest
}

export type PeriodAgg = {
  period: string
  runs: number
  settledUsd: number
  presettleUsd: number
  claimedUsd: number
  deltaRatio: string
  observedAt: string | null
}

function aggregate(
  lane: LaneDayRow[], engine: EngineCounterDayRow[], keyFn: (day: string) => string,
): PeriodAgg[] {
  const byPeriod = new Map<string, { runs: number; settled: number; presettle: number; observedAt: string | null }>()
  for (const r of lane) {
    const k = keyFn(r.day)
    const cur = byPeriod.get(k) ?? { runs: 0, settled: 0, presettle: 0, observedAt: null }
    cur.runs += r.runs
    cur.settled += r.usd_settled
    cur.presettle += r.usd_presettle
    if (r.observed_at && (!cur.observedAt || r.observed_at > cur.observedAt)) cur.observedAt = r.observed_at
    byPeriod.set(k, cur)
  }
  const claimedByPeriod = new Map<string, number>()
  for (const r of engine) {
    const k = keyFn(r.day)
    claimedByPeriod.set(k, (claimedByPeriod.get(k) ?? 0) + r.apify_usd_claimed)
  }
  return [...byPeriod.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(period => {
      const v = byPeriod.get(period)!
      const claimed = claimedByPeriod.get(period) ?? 0
      return {
        period, runs: v.runs, settledUsd: v.settled, presettleUsd: v.presettle,
        claimedUsd: claimed, deltaRatio: deltaRatio(v.settled, claimed), observedAt: v.observedAt,
      }
    })
}

export function aggregateByDay(lane: LaneDayRow[], engine: EngineCounterDayRow[]): PeriodAgg[] {
  return aggregate(lane, engine, d => d)
}

// ISO 8601 week key ("2026-W36"), ISO-Thursday algorithm — the standard one,
// not a rolling 7-day bucket, so a week's number matches any calendar Ivan
// glances at.
export function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const target = new Date(d.valueOf())
  const dayNr = (d.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(
    ((target.valueOf() - firstThursday.valueOf()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  )
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function aggregateByWeek(lane: LaneDayRow[], engine: EngineCounterDayRow[]): PeriodAgg[] {
  return aggregate(lane, engine, isoWeekKey)
}

export function lastNDays<T extends { day: string }>(rows: T[], n: number, now: number = Date.now()): T[] {
  const cutoff = cutoffDate(n, now)
  return rows.filter(r => r.day >= cutoff)
}

export type ActorAgg = {
  actor: string
  runs: number
  usd: number
  usdPerRun: number
  observedAt: string | null
}

export function topActors(rows: ActorDayRow[], limit = 12): ActorAgg[] {
  const byActor = new Map<string, { runs: number; usd: number; observedAt: string | null }>()
  for (const r of rows) {
    const cur = byActor.get(r.actor_or_service) ?? { runs: 0, usd: 0, observedAt: null }
    cur.runs += r.runs
    cur.usd += r.usd_settled
    if (r.observed_at && (!cur.observedAt || r.observed_at > cur.observedAt)) cur.observedAt = r.observed_at
    byActor.set(r.actor_or_service, cur)
  }
  return [...byActor.entries()]
    .map(([actor, v]) => ({
      actor, runs: v.runs, usd: v.usd, usdPerRun: v.runs > 0 ? v.usd / v.runs : 0, observedAt: v.observedAt,
    }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, limit)
}

export type LaneTotal = { lane: string; usd: number; runs: number; observedAt: string | null }

export function laneTotals(rows: LaneDayRow[]): LaneTotal[] {
  const byLane = new Map<string, { usd: number; runs: number; observedAt: string | null }>()
  for (const r of rows) {
    const cur = byLane.get(r.lane) ?? { usd: 0, runs: 0, observedAt: null }
    cur.usd += r.usd_settled
    cur.runs += r.runs
    if (r.observed_at && (!cur.observedAt || r.observed_at > cur.observedAt)) cur.observedAt = r.observed_at
    byLane.set(r.lane, cur)
  }
  return [...byLane.entries()].map(([lane, v]) => ({ lane, usd: v.usd, runs: v.runs, observedAt: v.observedAt }))
}

// ---------------------------------------------------------------------------
// Fetchers — Section 3: runway inputs (integration_config)
// ---------------------------------------------------------------------------

export async function fetchCashConfig(): Promise<{
  cashOnHandUsd: number | null
  cashAsOfDate: string | null
  observedAt: string | null
}> {
  const { data, error } = await supabase
    .from('integration_config')
    .select('key, value, updated_at')
    .in('key', ['cash_on_hand_usd', 'cash_as_of_date'])
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as IntegrationConfigRow[]
  const cash = rows.find(r => r.key === 'cash_on_hand_usd')
  const asOf = rows.find(r => r.key === 'cash_as_of_date')
  return {
    cashOnHandUsd: cash?.value != null && cash.value !== '' ? Number(cash.value) : null,
    cashAsOfDate: asOf?.value ?? null,
    observedAt: cash?.updated_at ?? asOf?.updated_at ?? null,
  }
}

export const STRIPE_UNVERIFIED_BANNER = 'Stripe cells: unverified (source: memory, awaiting Stripe read)'

// EXISTENCE ONLY — the value column is never selected, so the key can never
// reach the client even by an editing mistake later in this file.
export async function fetchStripeKeyExists(): Promise<boolean> {
  const { data, error } = await supabase
    .from('integration_config')
    .select('key')
    .eq('key', 'stripe_restricted_read_key')
    .maybeSingle()
  if (error) return false
  return !!data
}

// ---------------------------------------------------------------------------
// Fetchers — Section 7: open money decisions (read-only here)
// ---------------------------------------------------------------------------

export const MONEY_TRUTH_RUN = 'money-truth-2026-09-01'

export async function fetchOpenMoneyDecisions(): Promise<MoneyTaskRow[]> {
  const { data, error } = await supabase
    .from('ops_drafts')
    .select('id, body, context')
    .eq('kind', 'task')
    .is('approved_at', null)
    .is('sent_at', null)
  if (error) throw new Error(error.message)
  return ((data ?? []) as MoneyTaskRow[]).filter(r => r.context?.run === MONEY_TRUTH_RUN)
}

// Re-exported so MoneyView never reaches into lib/ops for one function — the
// title derivation (first non-empty line, capped) is the Ops job's own rule
// and this page reuses it verbatim rather than forking a second copy.
export { taskTitle }
