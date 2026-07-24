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
export type ScanOpenRow = {
  client_id: string; opens_7d: number; opens_30d: number; opens_total: number
  distinct_prospects: number; last_open: string | null
}

async function selectAll<T>(view: string): Promise<T[]> {
  const { data, error } = await supabase.from(view).select('*')
  if (error) throw error
  return (data ?? []) as T[]
}

export const fetchAccept = () => selectAll<AcceptRow>('inbox_accept_v')
export const fetchPipeline = () => selectAll<PipelineRow>('inbox_pipeline_v')
export const fetchScanOpens = () => selectAll<ScanOpenRow>('inbox_scan_opens_v')

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
