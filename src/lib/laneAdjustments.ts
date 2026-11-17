import { supabase } from './supabase'
import { retryOnTimeout } from './rateComparison'

/** One week of invites and what they did. `label` names a targeting change that took effect that week, or ''. */
export type AdjustmentCohort = {
  client_id: string; period_from: string; period_to: string | null; label: string
  invites: number; accept_base: number; accepted: number
  reply_base: number; replied: number; replied_so_far: number; calls: number
}
export async function fetchAdjustmentCohorts(): Promise<AdjustmentCohort[]> {
  const { data, error } = await retryOnTimeout(() => supabase.rpc('inbox_lane_adjustment_cohorts'))
  if (error) throw error
  return (data ?? []) as AdjustmentCohort[]
}
