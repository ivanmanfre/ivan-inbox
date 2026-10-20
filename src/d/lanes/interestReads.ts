import { supabase } from '../../lib/supabase'
import type { ReplacementRow } from '../../lib/kpis'
import type { Seat } from '../seats'
import type { InterestSource } from './interest'

export type InterestPerf = {
  client_id: Seat; source_lane: InterestSource; invites_7d: number; dms_7d: number
  replied_7d: number; positive_7d: number; calls_30d: number; accept_judged: number; accept_72h: number
}

export async function fetchInterestPerf(): Promise<InterestPerf[]> {
  const { data, error } = await supabase.from('inbox_interest_perf_v').select('*')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({ ...r,
    invites_7d: Number(r.invites_7d), dms_7d: Number(r.dms_7d), replied_7d: Number(r.replied_7d),
    positive_7d: Number(r.positive_7d), calls_30d: Number(r.calls_30d),
    accept_judged: Number(r.accept_judged), accept_72h: Number(r.accept_72h),
  })) as InterestPerf[]
}

export async function fetchInterestReplacement(): Promise<ReplacementRow[]> {
  const { data, error } = await supabase.from('inbox_interest_replacement_v').select('*')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    client_id: String(r.client_id), lane: String(r.lane), day: String(r.day),
    qualified_in: Number(r.qualified_in), sent_out: Number(r.sent_out),
  }))
}
