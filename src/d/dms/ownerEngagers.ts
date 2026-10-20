import { supabase } from '../../lib/supabase'
import type { CameBackSignal } from '../../wb/dms/cameBackData'
import type { Seat } from '../seats'

export type OwnerEngagerCard = {
  tenant: Seat
  profile_id: string
  name: string
  headline: string | null
  linkedin_url: string
  icp_score: number
  why: string | null
  n_engagements: number
  last_signal_at: string
  signals: CameBackSignal[] | null
}

export async function fetchOwnerEngagers(): Promise<OwnerEngagerCard[]> {
  const { data, error } = await supabase.rpc('owner_engager_cards')
  if (error) throw error
  return data ?? []
}

export async function dismissOwnerEngager(c: OwnerEngagerCard): Promise<boolean> {
  const { data, error } = await supabase.rpc('owner_engager_dismiss', { p_client_id: c.tenant, p_profile_id: c.profile_id })
  if (error) throw error
  return data === true
}
