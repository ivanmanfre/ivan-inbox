import { fetchDraftContextGaps, fetchDraftEmailStamps, fetchEmailRecipients, fetchDraftEvidence, fetchManualReplyIds, fetchMessages, groupThreads, type DraftContextGap, type InboxMessage, type Thread } from './inbox'

/**
 * The DMs list exactly as the screen assembles it: the message read, the four
 * side probes, and the grouping into threads. Lifted out of useInbox so the
 * service worker's push-time prefetch (src/sw.ts) builds the SAME rows the
 * open app does; a second assembly would drift and the saved copy would lie.
 */
export async function loadInbox(knownRows: number): Promise<{ rows: InboxMessage[]; threads: Thread[] }> {
  // The needs_manual_reply probe rides alongside the message fetch, never in
  // front of it: a failed flag read degrades the badge (those threads drop to
  // "waiting"), it must not take the whole inbox down with it.
  const [rows, manualReplyIds, emailStamps, emailTo] = await Promise.all([
    fetchMessages(knownRows),
    fetchManualReplyIds().catch(() => new Set<string>()),
    // Same degrade rule as the flag probe: a failed stamp read must never take
    // the inbox down. But it is no longer SILENT: null marks every pending
    // draft below, and the card says it cannot tell whether an email rides
    // along, because approving still mails it (check3-drafts E1.5).
    fetchDraftEmailStamps().catch(() => null),
    fetchEmailRecipients().catch(() => new Map<string, string>()),
  ])
  const draftIds = groupThreads(rows, manualReplyIds).flatMap(t =>
    [t.draft, t.companionDraft, t.ownerConfirmation].flatMap(m => m ? [m.id] : []))
  const [evidence, contextGaps] = await Promise.all([
    fetchDraftEvidence(draftIds).catch(() => null),
    fetchDraftContextGaps(draftIds).catch(() => new Map<string, DraftContextGap>()),
  ])
  const pendingIds = new Set(draftIds)
  for (const m of rows) {
    const em = emailStamps?.get(m.id)
    if (em) { m.recipient_email = em.recipient_email; m.email_mirror_text = em.email_mirror_text }
    else if (m.recipient_email == null) m.recipient_email = emailTo.get(m.id) ?? m.recipient_email
    m.email_stamp_unavailable = emailStamps === null && pendingIds.has(m.id)
    const cg = contextGaps.get(m.id)
    if (cg) m.context_gap = cg
    m.draft_evidence_unavailable = evidence === null && pendingIds.has(m.id)
    const ev = evidence?.get(m.id)
    if (ev) m.draft_evidence = ev
  }
  return { rows, threads: groupThreads(rows, manualReplyIds) }
}
