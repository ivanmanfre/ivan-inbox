// Ivan 2026-11-26: a real open of the report we sent shows in that person's thread as "Opened the report", at
// its time. Display only. Reads rpc inbox_report_opens() (db/20261126b): one row per report per Warsaw day, at the
// first open that passed open_is_signal, so scanners, link previews and our own tools never show.
import { supabase } from '../../lib/supabase'

export type ReportOpen = { prospect_id: string; report: string; at: string; place: string | null }

export async function fetchReportOpens(): Promise<ReportOpen[]> {
  const { data, error } = await supabase.rpc('inbox_report_opens')
  if (error) throw error
  return (data ?? []) as ReportOpen[]
}
