import { withReactionQueues } from './swishdmReactionQueue'
import { withTimeout } from '../d/ui/timeout'
import { readFirstRows } from './firstRows'
import { scheduleHeld } from './dmSchedule'
import { dedupeMessages, fetchDraftContextGaps, fetchDraftEmailStamps, fetchEmailRecipients, fetchDraftEvidence, fetchManualReplyIds, fetchMessages, groupThreads, isHeldSend, type DraftContextGap, type DraftEmailStamp, type InboxMessage, type Thread } from './inbox'

/**
 * The DMs list exactly as the screen assembles it: the message read, the four
 * side probes, and the grouping into threads. Lifted out of useInbox so the
 * service worker's push-time prefetch (src/sw.ts) builds the SAME rows the
 * open app does; a second assembly would drift and the saved copy would lie.
 */
const FIRST_ROWS_REUSE_MS = 10_000

export async function loadInbox(knownRows: number, onNewest?: (threads: Thread[], priority?: boolean) => void): Promise<{ viewRows: InboxMessage[]; rows: InboxMessage[]; threads: Thread[] }> {
  let settled = false
  let priorityPainted = false
  const early = onNewest ? sideProbes() : null
  // Complete histories for every Needs-you and Coming-up candidate go first.
  // Classification remains the existing client rule; the full archive follows.
  if (early && onNewest) {
    try {
      // A read the frame's DM counts started up to 10 s ago is the same answer (lib/firstRows).
      const data = await withTimeout(readFirstRows(FIRST_ROWS_REUSE_MS), 4000)
      if (!data) throw new Error('Could not read priority conversations')
      const first = await assembleInbox(data, early)
      if (first.threads.length) { priorityPainted = true; onNewest(first.threads, true) }
    } catch { /* The complete read below owns failure and the existing fallback. */ }
  }
  const viewRows = await fetchMessages(knownRows, !priorityPainted && early && onNewest ? rows =>
    assembleInbox(rows, early).then(r => { if (!settled) onNewest(r.threads, false) }, () => {}) : undefined)
  const full = await assembleInbox(viewRows)
  settled = true
  return { viewRows, ...full }
}

/**
 * 2026-11-17 speed pass: off the DMs page the frame's inbox reads only this, the complete
 * conversations of every Needs-you and Coming-up candidate (the same first-rows read the frame's DM
 * counts make, shared with them), never the whole message view (~25 pages of ~2 s each on every
 * place). Null = the first-rows RPC is absent, so the caller takes the whole read instead.
 */
export async function loadPriority(): Promise<{ viewRows: InboxMessage[]; rows: InboxMessage[]; threads: Thread[] } | null> {
  const read = await readFirstRows(FIRST_ROWS_REUSE_MS)
  if (!read) return null
  // Deduped the way the whole read (fetchMessages) and the per-seat counts dedupe their rows.
  const viewRows = dedupeMessages(read)
  return { viewRows, ...(await assembleInbox(viewRows)) }
}

type Probes = [Set<string>, Map<string, DraftEmailStamp> | null, Map<string, { recipient_email: string; email_cc: string[] }>]

/** The three row-independent side probes, each degrading on its own (see assembleInbox). */
function sideProbes(): Promise<Probes> {
  return Promise.all([
    fetchManualReplyIds().catch(() => new Set<string>()),
    fetchDraftEmailStamps().catch(() => null),
    fetchEmailRecipients().catch(() => new Map<string, { recipient_email: string; email_cc: string[] }>()),
  ])
}

/**
 * The side probes and grouping over rows already read (the full read, or the
 * rows an incremental read merged). `viewRows` are the view's rows as read and
 * are never written to: the annotations go on copies, so an incremental read
 * can re-assemble the same rows later without last time's annotations sticking.
 */
export async function assembleInbox(viewRows: readonly InboxMessage[], probes?: Promise<Probes> | null): Promise<{ rows: InboxMessage[]; threads: Thread[] }> {
  const copies = viewRows.map(m => ({ ...m }))
  // The needs_manual_reply probe rides alongside the message fetch, never in
  // front of it: a failed flag read degrades the badge (those threads drop to
  // "waiting"), it must not take the whole inbox down with it.
  // Same degrade rule for the stamp read (sideProbes): a failed stamp read must
  // never take the inbox down. But it is no longer SILENT: null marks every
  // pending draft below, and the card says it cannot tell whether an email
  // rides along, because approving still mails it (check3-drafts E1.5).
  const [[manualReplyIds, emailStamps, emailTo], rows] = await Promise.all([
    probes ?? sideProbes(), withReactionQueues(copies).catch(() => copies),
  ])
  const draftIds = groupThreads(rows, manualReplyIds).flatMap(t =>
    [t.draft, t.companionDraft, t.ownerConfirmation].flatMap(m => m ? [m.id] : []))
  // Scheduled messages are held, not drafts, but their exact send time belongs in the list.
  const scheduledIds = rows.filter(m => scheduleHeld(m.send_blocked_reason) && !m.sent_at && !m.approved_at).map(m => m.id)
  // A held row says when he sent it before the hold (History heldWhy): that time lives in its evidence.
  const heldIds = rows.filter(isHeldSend).map(m => m.id)
  const [evidence, contextGaps] = await Promise.all([
    fetchDraftEvidence([...draftIds, ...scheduledIds, ...heldIds]).catch(() => null),
    fetchDraftContextGaps(draftIds).catch(() => new Map<string, DraftContextGap>()),
  ])
  const pendingIds = new Set(draftIds)
  for (const m of rows) {
    const em = emailStamps?.get(m.id)
    if (em) { m.recipient_email = em.recipient_email; m.email_mirror_text = em.email_mirror_text; m.email_cc = em.email_cc ?? []; m.email_delivery_recipient = em.email_delivery_recipient; m.send_via = em.send_via }
    else { const sent = emailTo.get(m.id); if (sent) { m.recipient_email = sent.recipient_email; m.email_cc = sent.email_cc } }
    m.email_stamp_unavailable = emailStamps === null && pendingIds.has(m.id)
    const cg = contextGaps.get(m.id)
    if (cg) m.context_gap = cg
    m.draft_evidence_unavailable = evidence === null && pendingIds.has(m.id)
    const ev = evidence?.get(m.id)
    if (ev) m.draft_evidence = ev
  }
  return { rows, threads: groupThreads(rows, manualReplyIds) }
}
