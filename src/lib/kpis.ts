import { supabase } from './supabase'

export type AcceptRow = {
  client_id: string
  sent_7d: number; accepted_7d: number; rate_7d: number | null
  sent_30d: number; accepted_30d: number; rate_30d: number | null
  sent_total: number; accepted_total: number
}
export type PipelineRow = {
  client_id: string; lane: string; sendable: number; sent_7d: number; sent_30d: number
}
export type GovernorRow = {
  client_id: string; model: 'weekly_adaptive' | 'monthly_fixed'
  cap: number; used: number; window_label: string
  mode: 'normal' | 'warm_only' | 'cold_paused'
  daily_used: number; daily_cap: number
  accept_rate: number | null // cohort accept percent; null when cohort is still empty
  headroom_week: number; headroom_day: number
  monthly_cap: number | null; monthly_used: number | null
  // Governor v2 (absent on the legacy RPC → all optional):
  cohort?: number | null; accepted?: number | null
  gov_used?: number | null; gov_cap?: number | null // raw shared enforcement counter
  cohort_opens_at?: string | null // date the Rise cohort starts maturing
}
// Daily inflow (rows crossing their lane's ICP floor) vs outflow (invites sent).
// db/029_replacement_rate.sql. Absent until that file is applied → fetch returns [].
export type ReplacementRow = {
  client_id: string; lane: string; day: string
  qualified_in: number; sent_out: number
}
export type ScanOpenRow = {
  client_id: string; opens_7d: number; opens_30d: number; opens_total: number
  distinct_prospects: number; last_open: string | null
}
export type OutcomeRow = {
  client_id: string
  convos_7d: number; convos_30d: number; convos_total: number
  calls_7d: number; calls_30d: number; calls_total: number
}

async function selectAll<T>(view: string): Promise<T[]> {
  const { data, error } = await supabase.from(view).select('*')
  if (error) throw error
  return (data ?? []) as T[]
}

// v2 = warm-era scoped: Ivan counts only sends since 2026-07-11 (era cutoff
// lives in db/017_kpi_outcomes.sql). Rise keeps full history.
export const fetchAccept = () => selectAll<AcceptRow>('inbox_accept_v2')
export const fetchPipeline = () => selectAll<PipelineRow>('inbox_pipeline_v')
export const fetchScanOpens = () => selectAll<ScanOpenRow>('inbox_scan_opens_v')
export const fetchOutcomes = () => selectAll<OutcomeRow>('inbox_outcomes_v')

// Soft-fails to [] when the view is not applied yet, so the Overview keeps rendering
// its other three tiles instead of erroring the whole screen on one missing relation.
// Same pre-apply discipline as fetchCampaignSends.
export async function fetchReplacement(): Promise<ReplacementRow[]> {
  const { data, error } = await supabase.from('inbox_replacement_v').select('*')
  if (error) return []
  return (data ?? []) as ReplacementRow[]
}

// Reply rate per client (db/042_reply_rate.sql). COHORT basis: of the people
// DM'd inside the window, how many have replied by now. rate_7d therefore reads
// LOW by construction — a DM sent yesterday has not had time to earn an answer —
// which is why the UI labels the 30d figure and not the 7d one.
export type ReplyRow = {
  client_id: string
  dmd_7d: number; replied_7d: number; rate_7d: number | null
  dmd_30d: number; replied_30d: number; rate_30d: number | null
  dmd_total: number; replied_total: number; rate_total: number | null
}
// Soft-fails to [] when the view is not applied yet, same pre-apply discipline as
// fetchReplacement: one missing relation must not blank the whole Overview.
export async function fetchReply(): Promise<ReplyRow[]> {
  const { data, error } = await supabase.from('inbox_reply_v').select('*')
  if (error) return []
  return (data ?? []) as ReplyRow[]
}

export type RangeKpiRow = {
  client_id: string; sent: number; accepted: number; convos: number; calls: number
}
// Explicit-range KPIs (custom date selector). No era cutoff: picked dates ARE
// the scope. p_from/p_to inclusive, YYYY-MM-DD.
export async function fetchRangeKpis(from: string, to: string): Promise<RangeKpiRow[]> {
  const { data, error } = await supabase.rpc('inbox_range_kpis', { p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as RangeKpiRow[]
}

export async function fetchGovernor(): Promise<GovernorRow[]> {
  const { data, error } = await supabase.rpc('inbox_governor')
  if (error) throw error
  return (data ?? []) as GovernorRow[]
}

export function acceptRate(sent: number, accepted: number): number {
  if (sent <= 0) return 0
  return Math.round((accepted / sent) * 100)
}

export function runwayDays(sendable: number, dailyRate: number): number {
  if (dailyRate <= 0) return 999
  return Math.floor(sendable / dailyRate)
}

// Replacement rate = qualified IN / invites OUT over the window.
// null when nothing went out (a rate against zero sends is not a fact about the pipeline).
// Deliberately NOT clamped: 3.4x is a real and useful reading on a backfill day.
export function replacementRate(qualifiedIn: number, sentOut: number): number | null {
  if (sentOut <= 0) return null
  return Math.round((qualifiedIn / sentOut) * 100) / 100
}

// Days until the pool empties at the CURRENT net drain, given today's send rate.
// Only meaningful while draining (rate < 1): above 1.0 the pool is growing and there is
// no depletion date. Returns null when it does not apply, so the tile can say so rather
// than print a confident number about an event that is not going to happen.
export function daysToEmpty(sendable: number, dailyOut: number, rate: number | null): number | null {
  if (rate == null || rate >= 1 || dailyOut <= 0) return null
  const net = dailyOut * (1 - rate)   // rows lost per day
  if (net <= 0) return null
  return Math.floor(sendable / net)
}

export function governorHeadroomPct(used: number, cap: number): number {
  if (cap <= 0) return 0
  return Math.min(100, Math.round((used / cap) * 100))
}

// True when the shared enforcement counter (gov_used/gov_cap, from the unscoped
// sender_health) has hit its cap but THIS client is under it — i.e. the client's
// own cold sends are being gated by another client's volume on the same counter.
// gov_used/gov_cap are absent on the legacy RPC, so null in → false out.
export function governorEnforcementGap(
  used: number, _cap: number,
  gov_used: number | null | undefined, gov_cap: number | null | undefined,
): boolean {
  if (gov_used == null || gov_cap == null) return false
  return gov_used >= gov_cap && used < gov_used
}

const LANE_LABELS: Record<string, string> = {
  cold: 'Cold', warm: 'Warm / Orbit', engager: 'Engager', harvest: 'Harvested', other: 'Other',
}
export function laneLabel(lane: string): string {
  return LANE_LABELS[lane] ?? lane
}
