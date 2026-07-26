import { supabase } from './supabase'

export interface SeatHealth {
  id: string
  name: string
  account: string
  sn: string | null
  degraded: boolean
  link: string | null
}

export interface SeatHealthSummary {
  seats: SeatHealth[]
  updated_at: string
}

export async function fetchSeatHealth(): Promise<SeatHealthSummary | null> {
  const { data, error } = await supabase
    .from('integration_config')
    .select('value')
    .eq('key', 'seat_health_summary')
    .maybeSingle()
  if (error || !data?.value) return null
  try { return JSON.parse(data.value) as SeatHealthSummary } catch { return null }
}
