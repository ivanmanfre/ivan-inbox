import { supabase } from '../../lib/supabase'
import { SEATS, type Seat } from '../seats'

export type CostPeriod = 7 | 30
export type Provider = 'apify' | 'harvestapi' | 'scrapecreators'
export type Scope = Seat | 'unassigned_shared'
export type Coverage = 'complete' | 'partial' | 'missing'
export type Freshness = 'fresh' | 'stale' | 'missing'
export type Flag = 'history_gap' | 'daily_mismatch' | 'unjoined_producer' | 'legacy_inferred_owner' | 'meter_reset' | 'meter_sampling_gap' | 'supplier_receipt_stale' | 'telemetry_gap' | 'missing_feed' | 'partial_window' | 'settlement_pending' | 'duplicate_attempt_conflict'
export type Basis = 'apify_usage_settled' | 'apify_usage_presettle' | 'harvest_attempt_booked' | 'harvest_meter_booked' | 'scrapecreators_supplier_credits' | 'scrapecreators_producer_credits' | 'cache_observation' | 'anthropic_token_estimate'
export type Method = 'runs_ledger' | 'input_identity' | 'structural' | 'time_fingerprint' | 'unattributed' | 'supplier_request_id' | 'producer_context' | 'dedicated_rise_ledger' | 'cumulative_meter' | 'shared_account' | 'cache_branch' | 'token_pricing'
export type Source = 'vendor_spend' | 'harvest_direct_ledger' | 'rise_supply_direct_attempts' | 'provider_cost_events' | 'provider_cost_observations'
export type Evidence = { basis: Basis; ownership: 'exact_supplier_join' | 'exact_producer' | 'inferred' | 'unassigned'; confidence: 'exact' | 'inferred' | 'unknown'; method: Method; source: Source; observed_at: string | null; coverage: Coverage; freshness: Freshness }
export type Measures = { apify_settled_usd: number | null; apify_presettle_usd: number | null; harvest_booked_usd: number | null; supplier_credits: number | null; producer_credits: number | null; supplier_credit_value_usd: number | null; producer_credit_value_usd: number | null; cash_paid_usd: number | null; requests: number | null; producer_attempts: number | null; cache_hits: number | null; unsettled_runs: number | null }
export type ProviderCostRow = { scope: Scope; provider: Provider; measures: Measures; evidence: Evidence[]; coverage: Coverage; coverage_start: string | null; coverage_end: string | null; freshness: Freshness; last_success_at: string | null; last_event_at: string | null; flags: Flag[] }
export type AccountDay = { day: string; supplier_usd: number | null; supplier_credits: number | null; supplier_requests: number | null; history_usd: number | null; history_credits: number | null; history_requests: number | null; allocated_exact_usd: number | null; allocated_inferred_usd: number | null; allocated_exact_credits: number | null; unassigned_usd: number | null; unassigned_credits: number | null; producer_observed_credits: number | null; booked_usd: number | null; credit_discrepancy: number | null; request_discrepancy: number | null; comparison: 'matched' | 'mismatch' | 'not_comparable' | 'missing'; complete_day: boolean; coverage_start: string | null; coverage_end: string | null; source_observed_at: string | null; flags: Flag[] }
export type ProviderAccount = { provider: Provider; account_label: 'Shared account'; coverage: Coverage; freshness: Freshness; last_success_at: string | null; source_observed_at: string | null; history_usd: number | null; history_credits: number | null; supplier_usd: number | null; supplier_credits: number | null; allocated_exact_usd: number | null; allocated_inferred_usd: number | null; allocated_exact_credits: number | null; unassigned_usd: number | null; unassigned_credits: number | null; producer_observed_credits: number | null; booked_usd: number | null; comparison: AccountDay['comparison']; flags: Flag[]; days: AccountDay[] }
export type LegacyRow = { scope: Scope; provider: 'anthropic_api'; basis: 'anthropic_token_estimate'; usd_estimate: number | null; coverage: Coverage; observed_at: string | null }
export type ClientProviderCosts = { schema_version: 1; generated_at: string; window: { start: string; end: string; timezone: 'UTC' }; rows: ProviderCostRow[]; accounts: ProviderAccount[]; legacy_rows: LegacyRow[]; credit_value_rate: { usd_per_credit: number; as_of: string; basis: 'dated_replacement_value_forecast' } }
export type CostSummary = { bySeat: Record<Seat, ProviderCostRow[]>; shared: ProviderCostRow[]; accounts: ProviderAccount[]; legacyBySeat: Record<Seat, LegacyRow[]>; legacyShared: LegacyRow[]; creditValueRate: ClientProviderCosts['credit_value_rate'] }

const PROVIDERS: Provider[] = ['apify', 'harvestapi', 'scrapecreators']
const SCOPES: Scope[] = [...SEATS, 'unassigned_shared']
const COVERAGES: Coverage[] = ['complete', 'partial', 'missing']
const FRESHNESS: Freshness[] = ['fresh', 'stale', 'missing']
const FLAGS: Flag[] = ['history_gap', 'daily_mismatch', 'unjoined_producer', 'legacy_inferred_owner', 'meter_reset', 'meter_sampling_gap', 'supplier_receipt_stale', 'telemetry_gap', 'missing_feed', 'partial_window', 'settlement_pending', 'duplicate_attempt_conflict']
const BASES: Basis[] = ['apify_usage_settled', 'apify_usage_presettle', 'harvest_attempt_booked', 'harvest_meter_booked', 'scrapecreators_supplier_credits', 'scrapecreators_producer_credits', 'cache_observation', 'anthropic_token_estimate']
const METHODS: Method[] = ['runs_ledger', 'input_identity', 'structural', 'time_fingerprint', 'unattributed', 'supplier_request_id', 'producer_context', 'dedicated_rise_ledger', 'cumulative_meter', 'shared_account', 'cache_branch', 'token_pricing']
const SOURCES: Source[] = ['vendor_spend', 'harvest_direct_ledger', 'rise_supply_direct_attempts', 'provider_cost_events', 'provider_cost_observations']
const MEASURE_KEYS: (keyof Measures)[] = ['apify_settled_usd', 'apify_presettle_usd', 'harvest_booked_usd', 'supplier_credits', 'producer_credits', 'supplier_credit_value_usd', 'producer_credit_value_usd', 'cash_paid_usd', 'requests', 'producer_attempts', 'cache_hits', 'unsettled_runs']
const ACCOUNT_NUMBERS = ['history_usd', 'history_credits', 'supplier_usd', 'supplier_credits', 'allocated_exact_usd', 'allocated_inferred_usd', 'allocated_exact_credits', 'unassigned_usd', 'unassigned_credits', 'producer_observed_credits', 'booked_usd'] as const
const DAY_NUMBERS = ['supplier_usd', 'supplier_credits', 'supplier_requests', 'history_usd', 'history_credits', 'history_requests', 'allocated_exact_usd', 'allocated_inferred_usd', 'allocated_exact_credits', 'unassigned_usd', 'unassigned_credits', 'producer_observed_credits', 'booked_usd', 'credit_discrepancy', 'request_discrepancy'] as const
const COUNT_KEYS = new Set(['supplier_credits', 'producer_credits', 'requests', 'producer_attempts', 'cache_hits', 'unsettled_runs', 'history_credits', 'supplier_requests', 'history_requests', 'allocated_exact_credits', 'unassigned_credits', 'producer_observed_credits', 'credit_discrepancy', 'request_discrepancy'])

/** UTC calendar days, inclusive of today. */
export function costWindow(days: CostPeriod, now: number) {
  const today = new Date(now).toISOString().slice(0, 10)
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days + 1)
  const end = new Date(`${today}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

function invalid(field: string): never { throw new Error(`Cost feed is malformed at ${field}`) }
function record(value: unknown, field: string): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid(field)
}
function enumeration<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : invalid(field)
}
function string(value: unknown, field: string): string { return typeof value === 'string' && value.length > 0 ? value : invalid(field) }
function date(value: unknown, field: string): string {
  const v = string(value, field)
  const parsed = Date.parse(`${v}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === v ? v : invalid(field)
}
function stamp(value: unknown, field: string): string | null {
  if (value === null) return null
  const v = string(value, field)
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)) && date(v.slice(0, 10), field) ? v : invalid(field)
}
function orderedBounds(start: string | null, end: string | null, field: string) {
  if (start !== null && end !== null && Date.parse(start) >= Date.parse(end)) invalid(field)
}
function amount(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || (!['credit_discrepancy', 'request_discrepancy'].includes(field) && value < 0) || (COUNT_KEYS.has(field) && !Number.isSafeInteger(value))) invalid(field)
  return value as number
}
function list<T>(value: unknown, field: string, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) invalid(field)
  return value.map(parse)
}
function flags(value: unknown): Flag[] { return list(value, 'flags', v => enumeration(v, FLAGS, 'flags')) }
function coverage(value: unknown): Coverage { return enumeration(value, COVERAGES, 'coverage') }
function freshness(value: unknown): Freshness { return enumeration(value, FRESHNESS, 'freshness') }
function comparison(value: unknown): AccountDay['comparison'] { return enumeration(value, ['matched', 'mismatch', 'not_comparable', 'missing'], 'comparison') }
function numbers<T extends string>(r: Record<string, unknown>, keys: readonly T[]): Record<T, number | null> {
  return Object.fromEntries(keys.map(key => [key, amount(r[key], key)])) as Record<T, number | null>
}
function evidence(value: unknown): Evidence {
  const r = record(value, 'evidence')
  return { basis: enumeration(r.basis, BASES, 'basis'), ownership: enumeration(r.ownership, ['exact_supplier_join', 'exact_producer', 'inferred', 'unassigned'], 'ownership'), confidence: enumeration(r.confidence, ['exact', 'inferred', 'unknown'], 'confidence'), method: enumeration(r.method, METHODS, 'method'), source: enumeration(r.source, SOURCES, 'source'), observed_at: stamp(r.observed_at, 'observed_at'), coverage: coverage(r.coverage), freshness: freshness(r.freshness) }
}
function row(value: unknown): ProviderCostRow {
  const r = record(value, 'row')
  const parsed: ProviderCostRow = { scope: enumeration(r.scope, SCOPES, 'scope'), provider: enumeration(r.provider, PROVIDERS, 'provider'), measures: numbers(record(r.measures, 'measures'), MEASURE_KEYS) as Measures, evidence: list(r.evidence, 'evidence', evidence), coverage: coverage(r.coverage), coverage_start: stamp(r.coverage_start, 'coverage_start'), coverage_end: stamp(r.coverage_end, 'coverage_end'), freshness: freshness(r.freshness), last_success_at: stamp(r.last_success_at, 'last_success_at'), last_event_at: stamp(r.last_event_at, 'last_event_at'), flags: flags(r.flags) }
  orderedBounds(parsed.coverage_start, parsed.coverage_end, 'row coverage')
  if (parsed.coverage === 'missing' && (parsed.evidence.length > 0 || MEASURE_KEYS.some(key => parsed.measures[key] !== null))) invalid('missing row')
  return parsed
}
function accountDay(value: unknown): AccountDay {
  const r = record(value, 'account day')
  const parsed: AccountDay = { day: date(r.day, 'day'), ...numbers(r, DAY_NUMBERS), comparison: comparison(r.comparison), complete_day: typeof r.complete_day === 'boolean' ? r.complete_day : invalid('complete_day'), coverage_start: stamp(r.coverage_start, 'coverage_start'), coverage_end: stamp(r.coverage_end, 'coverage_end'), source_observed_at: stamp(r.source_observed_at, 'source_observed_at'), flags: flags(r.flags) }
  orderedBounds(parsed.coverage_start, parsed.coverage_end, 'account day coverage')
  if (parsed.complete_day) {
    const start = Date.parse(`${parsed.day}T00:00:00Z`)
    if (parsed.coverage_start === null || parsed.coverage_end === null || Date.parse(parsed.coverage_start) !== start || Date.parse(parsed.coverage_end) !== start + 86400000) invalid('complete_day coverage')
  }
  return parsed
}
function account(value: unknown): ProviderAccount {
  const r = record(value, 'account')
  return { provider: enumeration(r.provider, PROVIDERS, 'provider'), account_label: enumeration(r.account_label, ['Shared account'], 'account_label'), coverage: coverage(r.coverage), freshness: freshness(r.freshness), last_success_at: stamp(r.last_success_at, 'last_success_at'), source_observed_at: stamp(r.source_observed_at, 'source_observed_at'), ...numbers(r, ACCOUNT_NUMBERS), comparison: comparison(r.comparison), flags: flags(r.flags), days: list(r.days, 'days', accountDay) }
}
function legacyRow(value: unknown): LegacyRow {
  const r = record(value, 'legacy row')
  return { scope: enumeration(r.scope, SCOPES, 'scope'), provider: enumeration(r.provider, ['anthropic_api'], 'legacy provider'), basis: enumeration(r.basis, ['anthropic_token_estimate'], 'legacy basis'), usd_estimate: amount(r.usd_estimate, 'usd_estimate'), coverage: coverage(r.coverage), observed_at: stamp(r.observed_at, 'observed_at') }
}
export function parseClientProviderCosts(value: unknown): ClientProviderCosts {
  const r = record(value, 'root')
  if (r.schema_version !== 1) throw new Error('Cost feed version is unsupported')
  const window = record(r.window, 'window')
  const rate = record(r.credit_value_rate, 'credit_value_rate')
  const start = date(window.start, 'window.start')
  const end = date(window.end, 'window.end')
  if (start >= end) invalid('window')
  const rows = list(r.rows, 'rows', row)
  const accounts = list(r.accounts, 'accounts', account)
  const keys = new Set(rows.map(x => `${x.scope}:${x.provider}`))
  if (rows.length !== 15 || keys.size !== 15 || SCOPES.some(s => PROVIDERS.some(p => !keys.has(`${s}:${p}`)))) invalid('rows')
  if (accounts.length !== 3 || new Set(accounts.map(x => x.provider)).size !== 3) invalid('accounts')
  if (accounts.some(account => account.days.some(day => day.day < start || day.day >= end))) invalid('account day window')
  return { schema_version: 1, generated_at: stamp(r.generated_at, 'generated_at') ?? invalid('generated_at'), window: { start, end, timezone: enumeration(window.timezone, ['UTC'], 'timezone') }, rows, accounts, legacy_rows: list(r.legacy_rows, 'legacy_rows', legacyRow), credit_value_rate: { usd_per_credit: amount(rate.usd_per_credit, 'usd_per_credit') ?? invalid('usd_per_credit'), as_of: date(rate.as_of, 'as_of'), basis: enumeration(rate.basis, ['dated_replacement_value_forecast'], 'basis') } }
}

/** Operator-only aggregate. The browser never reads raw ledgers or account receipts. */
export async function fetchClientProviderCosts(days: CostPeriod, now = Date.now(), signal?: AbortSignal): Promise<ClientProviderCosts> {
  if (signal?.aborted) throw new DOMException('Cost read cancelled', 'AbortError')
  const { start, end } = costWindow(days, now)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 12000)
  try {
    const result = await supabase.rpc('client_provider_costs', { p_start: start, p_end: end }).abortSignal(controller.signal)
    if (controller.signal.aborted) throw new DOMException('Cost read cancelled', 'AbortError')
    if (result.error) throw new Error(result.error.message)
    const feed = parseClientProviderCosts(result.data)
    if (feed.window.start !== start || feed.window.end !== end) invalid('window')
    return feed
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export function summarizeClientCost(feed: ClientProviderCosts): CostSummary {
  return {
    bySeat: Object.fromEntries(SEATS.map(seat => [seat, feed.rows.filter(r => r.scope === seat)])) as Record<Seat, ProviderCostRow[]>,
    shared: feed.rows.filter(r => r.scope === 'unassigned_shared'),
    accounts: feed.accounts,
    legacyBySeat: Object.fromEntries(SEATS.map(seat => [seat, feed.legacy_rows.filter(r => r.scope === seat)])) as Record<Seat, LegacyRow[]>,
    legacyShared: feed.legacy_rows.filter(r => r.scope === 'unassigned_shared'),
    creditValueRate: feed.credit_value_rate,
  }
}
