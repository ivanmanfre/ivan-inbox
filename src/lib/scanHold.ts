import { supabase } from './supabase'

/** RISE Reply Drafter (uee9FUFHxdRrhjMB) stamps enrichment_data.scan_delivery_hold when someone said
 *  yes to the scan but the page failed the ship gate. It drafts nothing while that holds. */
export type ScanHold = { reason: string; url: string | null }

export async function fetchScanHold(prospectId: string): Promise<ScanHold | null> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('hold:enrichment_data->scan_delivery_hold').eq('id', prospectId).single()
  if (error) throw error
  const h = (data as { hold: { status?: string; reason?: string; report_url?: string | null } | null }).hold
  if (!h || h.status !== 'needs_review') return null
  return { reason: String(h.reason ?? '').split(' | ')[0].replace(/^Held:\s*/, ''), url: h.report_url ?? null }
}
