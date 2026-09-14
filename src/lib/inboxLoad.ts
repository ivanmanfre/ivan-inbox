import { fetchDraftContextGaps, fetchDraftEmailStamps, fetchDraftEvidence, fetchManualReplyIds, fetchMessages, groupThreads, type DraftContextGap, type DraftEmailStamp, type InboxMessage, type Thread } from './inbox'

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
  const [rows, manualReplyIds, emailStamps] = await Promise.all([
    fetchMessages(knownRows),
    fetchManualReplyIds().catch(() => new Set<string>()),
    // Same degrade rule as the flag probe: a failed stamp read only loses the
    // "also emails" badge, it must never take the inbox down.
    fetchDraftEmailStamps().catch(() => new Map<string, DraftEmailStamp>()),
  ])
  const draftIds = groupThreads(rows, manualReplyIds).flatMap(t =>
    [t.draft, t.companionDraft, t.ownerConfirmation].flatMap(m => m ? [m.id] : []))
  const [evidence, contextGaps] = await Promise.all([
    fetchDraftEvidence(draftIds).catch(() => null),
    fetchDraftContextGaps(draftIds).catch(() => new Map<string, DraftContextGap>()),
  ])
  const pendingIds = new Set(draftIds)
  for (const m of rows) {
    const em = emailStamps.get(m.id)
    if (em) { m.recipient_email = em.recipient_email; m.email_mirror_text = em.email_mirror_text }
    const cg = contextGaps.get(m.id)
    if (cg) m.context_gap = cg
    m.draft_evidence_unavailable = evidence === null && pendingIds.has(m.id)
    const ev = evidence?.get(m.id)
    if (ev) m.draft_evidence = ev
  }
  return { rows, threads: groupThreads(rows, manualReplyIds) }
}
