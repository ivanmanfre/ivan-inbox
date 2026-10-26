import { supabase } from './supabase'
import type { EmailDetailRow } from './emailPresentation'

/** Envelope metadata belongs to the open thread, never a second full inbox/research read. */
export async function fetchEmailDetails(prospectId: string, ids: readonly string[]): Promise<EmailDetailRow[]> {
  const rows: EmailDetailRow[] = []
  const unique = [...new Set(ids)]
  for (let start = 0; start < unique.length; start += 100) {
    const { data, error } = await supabase.from('outreach_messages')
      .select('id,prospect_id,recipient_email,email_mirror_text,email_metadata:draft_evidence->email,email_subject:draft_evidence->email_subject,email_cc:draft_evidence->email_cc,email_headers:draft_evidence->email_headers')
      .eq('prospect_id', prospectId).in('id', unique.slice(start, start + 100))
      .abortSignal(AbortSignal.timeout(15_000))
    if (error) throw error
    rows.push(...(data ?? []) as EmailDetailRow[])
  }
  return rows
}
