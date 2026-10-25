import { supabase } from './supabase'

/** RISE Reply Drafter (uee9FUFHxdRrhjMB) stamps enrichment_data.scan_delivery_hold when someone said
 *  yes to the scan but the page failed the ship gate. Since 10-25 it stamps scan_owed instead: the scan is
 *  being built and repaired automatically, and the reply with the link drafts itself once it passes. */
export type ScanHold = { reason: string; url: string | null; owed?: boolean }

type Raw = { status?: string; reason?: string; report_url?: string | null }

export function readScanHold(hold: Raw | null, owed: Raw | null): ScanHold | null {
  if (owed && owed.status) return { reason: String(owed.reason ?? '').split(' | ')[0], url: null, owed: true }
  if (!hold || hold.status !== 'needs_review') return null
  return { reason: String(hold.reason ?? '').split(' | ')[0].replace(/^Held:\s*/, ''), url: hold.report_url ?? null }
}

export async function fetchScanHold(prospectId: string): Promise<ScanHold | null> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('hold:enrichment_data->scan_delivery_hold,owed:enrichment_data->scan_owed').eq('id', prospectId).single()
  if (error) throw error
  const d = data as { hold: Raw | null; owed: Raw | null }
  return readScanHold(d.hold, d.owed)
}
