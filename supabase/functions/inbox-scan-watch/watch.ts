import { readReceipts, type ScanCase } from '../inbox-claude/scan-email.ts'

export async function observeScanEmails(
  rows: ScanCase[],
  providerKey: () => Promise<string | undefined>,
  now: Date,
  request = fetch,
) {
  const initial = rows.map((r) => {
    let decision = 'check_provider'
    if (r.disposition) decision = 'operator_disposition'
    else if (r.email_report_at) decision = 'correct_email_logged'
    else if (r.email_at) decision = 'existing_email_review'
    else if (!r.sender || r.address_count !== 1) decision = 'ambiguous_destination'
    else if (!['address_after_acceptance_phrase', 'mentions_sending_scan'].includes(r.request_signal)) {
      decision = 'unclear_promise'
    } else if (!r.report_url || !r.linkedin_report_at) decision = 'no_verified_linkedin_report'
    else if (now.getTime() - Date.parse(r.asked_at) < 86400000) decision = 'within_first_day'
    return { r, decision }
  })
  const pending = initial.filter((x) => x.decision === 'check_provider').map((x) => x.r)
  const receipts = await readReceipts(pending, pending.length ? await providerKey() : undefined, request)
  return initial.map(({ r, decision }) => {
    if (decision === 'check_provider') {
      const receipt = receipts.get(r.inbound_id)?.state
      decision = receipt === 'no_matching_email_in_connected_sender'
        ? 'missing_email'
        : receipt ?? 'provider_unavailable'
    }
    return {
      inbound_id: r.inbound_id,
      decision,
      expected_report: r.report_url,
      expected_address: r.address,
      expected_sender: r.sender,
    }
  })
}
