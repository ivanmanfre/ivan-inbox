/* ==========================================================================
   src/wb/ops/batchActs.ts - the quick batch's writes and confirms.

   One module for the Ops quick batch (QuickBatch.tsx) and the stock Today
   FocusBlock, so a batch tap is never a second, divergent send path. Every
   write is the SAME function PendingCard calls for that kind. Moved out of
   wb/today/FocusBlock.tsx unchanged in substance (rebuild, 2026-09-26), plus
   the confirm the manual-invite approve never had.
   ========================================================================== */
import {
  approveWeeklyReport, discardOpsDraft, dispatchCommentGate, outboundApproveUrl,
  outboundSkipUrl, type GateOutcome, type OpsDraft,
} from '../../lib/ops'

/** The card's own gate confirm (PendingCard), for one comment or several. */
export function gateConfirm(where: string, n = 1) {
  return {
    title: n === 1 ? `Send this to the ${where} comment gate?` : `Send these ${n} to the ${where} comment gate?`,
    message: 'The poster’s rate caps, cooldown and jitter still decide. You get their answer on the card, no new tab.',
    confirmText: 'Approve & queue',
  }
}

/** The card's manual-invite confirm, for one or several. Nothing is sent. */
export function inviteConfirm(n = 1) {
  return {
    title: n === 1 ? 'Mark this attribution handled?' : `Mark these ${n} attributions handled?`,
    message: 'Nothing is sent. Close these once the booking is stamped in booking_attributions + call_booked_at.',
    confirmText: 'Mark handled',
  }
}

/** Every discard asks first, and names what goes. */
export function discardConfirm(n: number) {
  return {
    title: n === 1 ? 'Discard this one?' : `Discard these ${n}?`,
    message: n === 1
      ? 'Nothing gets posted. The draft is dropped.'
      : `Nothing gets posted. All ${n} drafts are dropped.`,
    confirmText: 'Discard',
    danger: true,
  }
}

export type ApproveResult =
  | { ok: true }
  | { ok: false; message: string; outcome: GateOutcome | 'error' }

/**
 * manual_invite double-stamps (nothing is sent). comment_outbound fires the
 * ivan-lane gate and stamps only on accepted/already; with no gate link it
 * copies and stamps. Never throws on a gate refusal: the caller reads `ok`,
 * and a `timing` refusal is a queue position, not an error.
 */
export async function dispatchApprove(d: OpsDraft): Promise<ApproveResult> {
  if (d.kind === 'manual_invite') {
    await approveWeeklyReport(d.id, d.body)
    return { ok: true }
  }
  if (d.kind === 'comment_outbound') {
    const approveUrl = outboundApproveUrl(d)
    if (approveUrl) {
      const v = await dispatchCommentGate(approveUrl)
      if (v.outcome === 'accepted' || v.outcome === 'already') {
        await approveWeeklyReport(d.id, d.body)
        return { ok: true }
      }
      return { ok: false, message: v.message, outcome: v.outcome }
    }
    await navigator.clipboard.writeText(d.body)
    await approveWeeklyReport(d.id, d.body)
    return { ok: true }
  }
  return { ok: false, message: `kind ${d.kind} has no batch approve path`, outcome: 'error' }
}

/** Best-effort cancel of the feed row (ivan-lane comments), then the real discard. */
export async function dispatchDiscard(d: OpsDraft): Promise<void> {
  const skip = outboundSkipUrl(d)
  if (skip) { try { void fetch(skip, { mode: 'no-cors' }) } catch { /* fire and forget */ } }
  await discardOpsDraft(d.id, d.kind)
}
