import { supabase } from './supabase'

export const ANNA_BOOKING_URL = 'https://calendly.com/im-ivanmanfredi/30min'
export const ANNA_BOOKING_LINE = `You can book a call with Ivan here: ${ANNA_BOOKING_URL}`
export type AnnaScanReview = {
  warnings?: unknown[]; blockers?: unknown[]; blockers_overridden?: boolean
  revision_id?: string; scan_id?: string; request_fingerprint?: string
}
export type AnnaScanStatus = { status: string; url?: string | null; error?: string | null; review?: AnnaScanReview | null }

export async function fetchAnnaScan(prospectId: string): Promise<AnnaScanStatus | null> {
  const { data, error } = await supabase.rpc('anna_scan_status', { p_prospect: prospectId })
  if (error) throw error
  return data as AnnaScanStatus | null
}

export async function requestAnnaScan(prospectId: string): Promise<AnnaScanStatus> {
  const { data, error } = await supabase.rpc('anna_request_scan', { p_prospect: prospectId })
  if (error) throw error
  return data as AnnaScanStatus
}
