import { editHeldDm, sendRejectedDm } from '../../lib/rejectedDm'
import { parseEmailCc } from '../../lib/emailCc'
// Every DM write, wired to TODAY'S lib calls with today's payloads, guards and order
// (src/wb/thread/Conversation.tsx, RestoreStrip, FollowUpStrip, CameBack). Nothing here
// invents a write path: each verb names the lib function it calls.
import { createElement, useMemo, useRef } from 'react'
import {
  draftSendVia, approveDraft, composeReply, deleteThread, discardLegs, dismissConfirmation, draftLegs, escalateDraftToClient,
  emailSenderLabel, heldReasonText, isFollowUp, isHeldSend, isStoppedOnPurpose, isSwishdmReply, isSwishdmRow, legFailureText, markNotSpam, markSpam, messageChannel, offersReplyMyself, restoreConfirmation, restoreDraft, swishdmPageUrl,
  saveDraftEmailCc, setDraftSendVia, saveDraftText, snoozeDraft, threadChatId, unsnoozeDraft, REPLY_MYSELF, REDRAFT_REASON, requestRedraft,
  findLandedReply, readSendState, type DraftSendVia, type InboxMessage, type SendState, type Thread,
  type EmailReplyTarget,
} from '../../lib/inbox'
import { isNoAnswer } from '../../lib/noAnswer'
import { clearFollowUp, fetchFollowUp, followUpSuggestion, setFollowUp, type FollowUp } from '../../lib/followUp'
import { laterPath } from './later'
import { formatReturn } from '../../lib/pushLater'
import { dismissCameBack, undismissCameBack } from '../../wb/dms/cameBackData'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { useAsks } from './asks'
import { canMarkSolved, writeSolved } from './solved'
import { watchSend } from './sendWatch'
import { splitEmailDraft } from '../../lib/emailSubject'
import { emailPreview } from '../../lib/emailPresentation'
import { emailRowSender, threadKind } from '../../lib/inbox'
import { saveEmailComposition, sameEmailComposition } from '../../lib/emailCompositionSave'
import { buildEmailComposition } from '../../lib/emailCompositionDraft'
import { renderEmailComposition, renderEmailDocument, type EmailComposition } from '../../lib/emailRichText'
import { EmailPreview } from './EmailMessage'

export type Edits = { main: string; email: string | null; companion: string | null; cc?: string; companionCc?: string
  mainComposition?: EmailComposition | null; emailComposition?: EmailComposition | null; companionComposition?: EmailComposition | null }

export type VerbCtx = {
  /** Preserve the open editor before a row can leave the queue. */
  prepareQuickDiscard?: () => boolean
  /** Re-read the list (and the frame's DM counts). */
  refresh: () => void
  /** Optimistic: show these rows changed until the next read lands. */
  patch: (ids: string[], p: Partial<InboxMessage>) => void
  /** Show a solve (or its undo) at once on every reader of the frame's inbox. */
  solved?: (pid: string, at: string | null) => void
  /** Re-read the dated follow-ups (the Later section). */
  dated?: () => void
}

// supabase-js hands back a plain PostgrestError object ({message, code}), not an Error: read its
// message, or a failed write would say "[object Object]".
const errText = (e: unknown) => (e instanceof Error ? e.message
  : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : String(e)).replace(/^(AbortError|TimeoutError): /, '')

// Ivan 10-21 (Diane O'Brien): a write that got no answer (src/lib/noAnswer.ts) may still have landed.
// The rows are read before anything is said, and before the key is offered again.
export const NO_ANSWER_NOT_SENT = 'No answer from the server. It is not queued and nothing was sent: try again.'
export const NO_ANSWER_UNCHECKED = 'No answer from the server, and the check did not answer either. Look at the thread before you try again.'
/** Queued for the sender (approved, no hold) or already sent. */
const queued = (r: SendState) => Boolean(r.sent_at || (r.approved_at && !r.send_blocked_reason))
/** After a no-answer: true = every row landed, false = at least one did not, null = the check failed too. */
async function landed(ids: string[], ok: (r: SendState) => boolean = queued): Promise<boolean | null> {
  try {
    const rows = await readSendState(ids)
    return ids.every(id => rows.some(r => r.id === id && ok(r)))
  } catch { return null }
}
/** A hand reply whose insert got no answer: the next press of Send checks the thread first. */
const composeUnsure = new Map<string, string>()
const first = (t: Thread) => t.prospect_name.split(' ')[0] || t.prospect_name

export function legName(m: InboxMessage): string {
  const c = messageChannel(m)
  if (c === 'email') return m.recipient_email ? `email to ${m.recipient_email}` : 'email'
  if (c === 'inmail') return 'InMail'
  if (c === 'invite') return 'connection note'
  return 'LinkedIn DM'
}

const isBump = (m: InboxMessage) => /stall_bump|_bump_|bump_v/.test(m.ai_model ?? '')

export function useDmVerbs(ctx: VerbCtx) {
  const quickPending = useRef(new Set<string>())
  const confirm = useDConfirm()
  const toast = useToast()
  const { askDiscard, askDate } = useAsks()
  return useMemo(() => {
    const fail = (message: string) => { toast.show({ message, tone: 'failed' }) }
    // Ivan 10-21 (Leighton Penrose): after Send, watch the row; a hold that comes back says so.
    const watch = (t: Thread, ids: string[]) => watchSend(ids, (r, kind) => {
      // LinkedIn will not deliver to this person: one neutral line, never a failure (Ivan 10-21).
      if (kind === 'unreachable') {
        toast.show({ message: `Not delivered: ${t.prospect_name} ${(r.send_blocked_reason ?? '').includes('blocked_recipient') ? 'blocked messages' : 'can\u2019t receive messages'} on LinkedIn` })
        ctx.refresh()
        return
      }
      // Every hold that reaches here is final: nothing retries it (dispatch_error is written on the 3rd and last try).
      toast.show({ tone: 'failed', ms: 15_000,
        message: `Not sent to ${t.prospect_name}: ${heldReasonText(r.send_blocked_reason)}`,
        sub: 'It was held after you pressed Send. Your text is kept: open the thread to edit it or send anyway.' })
      ctx.refresh()
    })

    async function saveCcs(t: Thread, ed: Edits) {
      const legs = [[t.draft, ed.cc], [t.companionDraft, ed.companionCc]] as const
      // Validate every leg before approving any leg.
      for (const [row, value] of legs) if (row?.recipient_email && value !== undefined) parseEmailCc(value)
      for (const [row, value] of legs) {
        if (!row?.recipient_email || value === undefined) continue
        if (row.email_stamp_unavailable) throw new Error('Refresh to check the email recipients before approving.')
        const cc = parseEmailCc(value)
        // Re-check persisted evidence even when the visible recipients are unchanged.
        await saveDraftEmailCc(row.id, value)
        ctx.patch([row.id], { email_cc: cc })
      }
    }

    /** Save a displayed email with the same source and structured body in one guarded write. */
    async function saveEmailLeg(row: InboxMessage, text: string, composition: EmailComposition | null | undefined,
      mirror: boolean, from: string, prepareForSend = false): Promise<InboxMessage> {
      const oldText = mirror ? row.email_mirror_text : row.message_text
      if (oldText == null) throw new Error('The email draft is unavailable. Refresh before saving.')
      const key = mirror ? 'email_mirror_composition' : 'email_composition'
      const oldComposition = row.draft_evidence?.[key] ?? null
      const desiredComposition = composition === undefined ? oldComposition : composition
      if (!prepareForSend && text === oldText && sameEmailComposition(desiredComposition, oldComposition)) return row
      const next = buildEmailComposition(text, from, { transport: mirror ? 'mirror' : 'native', composition: desiredComposition })
      if (next.source_text === oldText && sameEmailComposition(next, oldComposition)) return row
      const saved = await saveEmailComposition(row.id, next.source_text, next, mirror, oldText, oldComposition)
      ctx.patch([row.id], saved)
      return { ...row, ...saved }
    }

    async function saveEditedLegs(t: Thread, ed: Edits, prepareForSend = false) {
      const draft = t.draft
      if (!draft) throw new Error('The draft is unavailable.')
      const from = emailRowSender(t.client_id)
      let main = draft
      let companion = t.companionDraft
      if (messageChannel(main) === 'email') main = await saveEmailLeg(main, ed.main, ed.mainComposition, false, from, prepareForSend)
      else if (ed.main !== main.message_text) {
        await saveDraftText(main.id, ed.main)
        ctx.patch([main.id], { message_text: ed.main })
        main = { ...main, message_text: ed.main }
      }
      if (main.email_mirror_text != null && ed.email != null) {
        main = await saveEmailLeg(main, ed.email, ed.emailComposition, true, from, prepareForSend)
      }
      if (companion && ed.companion != null) {
        if (messageChannel(companion) === 'email') companion = await saveEmailLeg(companion, ed.companion, ed.companionComposition, false, from, prepareForSend)
        else if (ed.companion !== companion.message_text) {
          await saveDraftText(companion.id, ed.companion)
          ctx.patch([companion.id], { message_text: ed.companion })
          companion = { ...companion, message_text: ed.companion }
        }
      }
      return { main, companion }
    }

    async function sendVia(t: Thread, mode: DraftSendVia): Promise<boolean> {
      if (!t.draft || t.draft.email_stamp_unavailable) { fail('Refresh to check the email recipients.'); return false }
      try {
        const saved = await setDraftSendVia(t.draft.id, mode)
        ctx.patch([t.draft.id], saved)
        ctx.refresh()
        return true
      } catch (e) { fail(`Channel choice not saved: ${errText(e)}`); return false }
    }

    /** Approve & send (both legs on a pair). Always asks first, as today's thread does. */
    async function send(t: Thread, ed: Edits): Promise<string | null> {
      const draft = t.draft
      if (!draft) return null
      const comp = t.companionDraft
      const mode = draftSendVia(draft)
      const channelChoice = !!(draft.email_delivery_recipient || draft.email_mirror_text && draft.recipient_email)
      const swish = isSwishdmReply(draft)
      if (swish) {
        // Jonathan's seat has its own sender (not the two-minute dispatcher): approval releases this one row to it.
        const page = swishdmPageUrl(draft)
        const ok = await confirm({
          title: `Approve the reply to ${t.prospect_name}?`,
          message: (page ? 'The scan page is already live. ' : '') + (draft.recipient_email && draft.email_mirror_text
            ? `Approving releases the email to ${draft.recipient_email}${emailSenderLabel(t.client_id)} and Jonathan’s LinkedIn acknowledgement.`
            : 'Approving releases this reply to Jonathan’s LinkedIn sender.'),
          confirmText: 'Approve reply',
          verb: 'confirm-send',
        })
        if (!ok) return null
      } else {
        const ok = await confirm({
          title: `Send to ${t.prospect_name}?`,
          message: comp ? `Both legs go out: the ${legName(draft)} and the ${legName(comp)}. The sender picks them up within about 2 minutes.`
            : channelChoice ? `${mode === 'email' ? `Only the email to ${draft.recipient_email}${emailSenderLabel(t.client_id)}` : mode === 'both' ? `The LinkedIn DM and email to ${draft.recipient_email}${emailSenderLabel(t.client_id)}` : 'Only the LinkedIn DM'} will be sent. The sender picks it up within about 2 minutes.`
              : 'The sender picks it up within about 2 minutes.',
          confirmText: comp ? 'Approve & send both' : channelChoice ? mode === 'email' ? 'Send email' : mode === 'both' ? 'Send both' : 'Send DM' : 'Approve & send',
          verb: 'confirm-send',
        })
        if (!ok) return null
      }
      let companionForApproval: InboxMessage | null = null
      try {
        if (draft.email_stamp_unavailable || comp?.email_stamp_unavailable) throw new Error('Refresh to check the email recipients before approving.')
        await saveCcs(t, ed)
        // All rich legs are persisted before either approval; approval may queue immediately.
        const saved = await saveEditedLegs(t, ed, true)
        await approveDraft(draft.id, saved.main.message_text, messageChannel(draft) === 'email' ? null : threadChatId(t), {
          ...saved.main,
          email_cc: ed.cc === undefined ? draft.email_cc : parseEmailCc(ed.cc),
        })
        if (saved.companion) {
          // Carry the fresh evidence into the second approval below.
          companionForApproval = saved.companion
        }
      } catch (e) {
        if (!isNoAnswer(e)) { const m = errText(e); fail(`Not sent: ${m}`); return m }
        const ok = await landed([draft.id])
        if (!ok) { const m = ok === false ? NO_ANSWER_NOT_SENT : NO_ANSWER_UNCHECKED; fail(m); ctx.refresh(); return m }
      }
      ctx.patch([draft.id], { approved_at: new Date().toISOString() })
      let half: string | null = null
      if (comp) {
        try {
          const approvedCompanion = companionForApproval ?? comp
          await approveDraft(comp.id, approvedCompanion.message_text, messageChannel(comp) === 'email' ? null : threadChatId(t), {
            ...approvedCompanion, email_cc: ed.companionCc === undefined ? comp.email_cc : parseEmailCc(ed.companionCc),
          })
          ctx.patch([comp.id], { approved_at: new Date().toISOString() })
        } catch (e) {
          const ok = isNoAnswer(e) ? await landed([comp.id]) : false
          if (ok) ctx.patch([comp.id], { approved_at: new Date().toISOString() })
          else {
            half = isNoAnswer(e) && ok === null
              ? `The ${legName(draft)} is queued. The ${legName(comp)} got no answer from the server and could not be checked: look at the thread before you send it.`
              : `The ${legName(draft)} is queued, but the ${legName(comp)} did not go through: ${isNoAnswer(e) ? 'no answer from the server.' : errText(e)} It is still waiting here.`
            fail(half)
          }
        }
      }
      if (!half) toast.show(swish
        ? { message: `Approved the reply to ${t.prospect_name}.`, sub: 'It goes out from Jonathan\u2019s LinkedIn in the next send window (Sun-Fri 9am-5pm UK).' }
        : { message: `Queued to ${t.prospect_name}.`, sub: 'The sender picks it up within about 2 minutes.' })
      if (!swish) watch(t, half ? [draft.id] : [draft.id, ...(comp ? [comp.id] : [])])
      ctx.refresh()
      return half
    }

    async function sendAnyways(t: Thread, m: InboxMessage): Promise<void> {
      // Jonathan's seat is sent only by the SwishDM senders: no override, no "about 2 minutes" promise.
      if (isSwishdmRow(m) || t.client_id === 'swishdm') { fail('SwishDM messages are sent only by the SwishDM senders. Nothing was sent.'); return }
      const ok = await confirm({ title: `Send anyway to ${t.prospect_name}?`,
        message: createElement('div', null, createElement('p', null, `${isHeldSend(m) ? 'Held' : 'Rejected'}: ${heldReasonText(m.send_blocked_reason)}`), createElement('p', null, m.message_text), createElement('p', null, 'Your approval overrides the copy rejection. Delivery and account checks still apply.')),
        confirmText: 'Send anyway', verb: 'confirm-send-anyways' })
      if (!ok) return
      let went: boolean | null = true
      try { await sendRejectedDm(m, threadChatId(t)) } catch (e) {
        if (!isNoAnswer(e)) { fail(`Not queued: ${errText(e)}`); ctx.refresh(); return }
        went = await landed([m.id])
        if (!went) fail(went === false ? NO_ANSWER_NOT_SENT : NO_ANSWER_UNCHECKED)
      }
      if (went) {
        ctx.patch([m.id], { approved_at: new Date().toISOString(), send_blocked_at: null, send_blocked_reason: null })
        toast.show({ message: `Queued to ${t.prospect_name}.`, sub: 'The sender picks it up within about 2 minutes.' })
        watch(t, [m.id])
      }
      ctx.refresh()
    }

    /** Ivan 10-21 (Leighton Penrose): save an edit to a held message. It stays held, nothing is sent; Send
     *  anyway (or a schedule) then goes out with the new words. Returns the row as it now is, or null. */
    async function editHeld(t: Thread, m: InboxMessage, text: string, opts: { quiet?: boolean } = {}): Promise<InboxMessage | null> {
      if (isSwishdmRow(m) || t.client_id === 'swishdm') { fail('SwishDM messages are sent only by the SwishDM senders. Nothing was sent.'); return null }
      if (!text.trim()) { fail('The message is empty. Nothing was saved.'); return null }
      if (text === m.message_text) return m
      try { await editHeldDm(m, text) } catch (e) {
        if (!isNoAnswer(e)) { fail(`Not saved: ${errText(e)}`); ctx.refresh(); return null }
        const ok = await landed([m.id], r => r.message_text === text)
        if (!ok) { fail(ok === false ? 'No answer from the server. The edit was not saved and nothing was sent: try again.' : NO_ANSWER_UNCHECKED); ctx.refresh(); return null }
      }
      ctx.patch([m.id], { message_text: text, approved_at: null })
      if (!opts.quiet) toast.show({ message: `Saved the held message to ${t.prospect_name}.`, sub: 'Still held. Nothing was sent.' })
      ctx.refresh()
      return { ...m, message_text: text, approved_at: null }
    }

    /** Discard one held message from the timeline (the same guarded discard as a draft: unsent and
     *  unapproved only). Undo brings it back as a draft. */
    async function discardHeld(t: Thread, m: InboxMessage): Promise<void> {
      const stopped = isStoppedOnPurpose(m)
      const ok = await confirm({ title: `Discard the ${stopped ? 'stopped' : 'held'} message to ${t.prospect_name}?`,
        message: 'It will not be sent. It stays under Discarded for 3 days.', confirmText: 'Discard', verb: 'confirm-discard-held' })
      if (!ok) return
      let failed
      try { failed = await discardLegs([m]) } catch (e) { fail(`Not discarded: ${errText(e)}`); ctx.refresh(); return }
      if (failed.length) { fail(failed.map(legFailureText).join(' ')); ctx.refresh(); return }
      ctx.patch([m.id], { send_blocked_reason: 'discarded_in_inbox', send_blocked_at: new Date().toISOString(), discard_mode: null })
      ctx.refresh()
      // A message stopped on purpose is never brought back as a sendable draft by Undo.
      toast.show({ message: `Discarded the ${stopped ? 'stopped' : 'held'} message to ${t.prospect_name}.`, sub: 'It stays under Discarded for 3 days.',
        action: stopped ? undefined : { label: 'Undo', verb: 'undo', run: () => { void undoDiscard([m]) } } })
    }

    /** Draft again: retire the follow-up (both legs) as a redraft request the stall bump answers. */
    async function redraft(t: Thread, note: string, ed: Edits): Promise<string | null> {
      const draft = t.draft
      if (!draft) return null
      const legs = draftLegs(t)
      const done: string[] = []
      try {
        for (const leg of legs) {
          const shown = leg.id === draft.id ? ed.main : (ed.companion ?? leg.message_text)
          if (!(await requestRedraft(leg.id, shown, note))) throw new Error('This draft changed (approved, sent or edited somewhere else). Refresh and try again.')
          done.push(leg.id)
        }
      } catch (e) { const m = errText(e); fail(m); ctx.refresh(); return m }
      ctx.patch(done, { send_blocked_reason: REDRAFT_REASON, send_blocked_at: new Date().toISOString() })
      ctx.refresh()
      toast.show({ message: `Writing a new follow-up for ${first(t)}.`, sub: 'It shows up here within about 15 minutes. Nothing is sent until you approve it.' })
      return null
    }

    async function discard(t: Thread): Promise<string | null> {
      const draft = t.draft
      if (!draft) return null
      const comp = t.companionDraft
      const bump = isBump(draft)
      const ans = await askDiscard({
        title: comp ? 'Discard both drafts?' : bump ? 'Discard this follow-up?' : 'Discard this draft?',
        message: (comp ? `Neither the ${legName(draft)} nor the ${legName(comp)} will be sent.` : 'It will not be sent.')
          + (bump ? ` A discarded follow-up is never redrafted for ${first(t)}. Later keeps it for another day.` : ''),
        myself: offersReplyMyself(t),
      })
      if (!ans) return null
      const legs = draftLegs(t)
      let failed
      try { failed = await discardLegs(legs, ans === 'myself' ? REPLY_MYSELF : null) } catch (e) { const m = errText(e); fail(m); return m }
      const gone = legs.filter(l => !failed.some(f => f.leg.id === l.id))
      ctx.patch(gone.map(l => l.id), { send_blocked_reason: 'discarded_in_inbox', send_blocked_at: new Date().toISOString(), discard_mode: ans === 'myself' ? REPLY_MYSELF : null })
      ctx.refresh()
      if (failed.length) { const m = failed.map(legFailureText).join(' '); fail(m); return m }
      toast.show({
        message: `Discarded the draft to ${t.prospect_name}.`,
        sub: ans === 'myself' ? 'The reply stays owed. It stays under Discarded for 3 days.' : 'It stays under Discarded for 3 days.',
        action: { label: 'Undo', verb: 'undo', run: () => { void undoDiscard(gone) } },
      })
      return null
    }

    /** One-motion row discard. Every successful leg gets its own guarded Undo. */
    async function quickDiscard(t: Thread): Promise<void> {
      const legs = draftLegs(t)
      if (!legs.length || quickPending.current.has(t.prospect_id)) return
      if (ctx.prepareQuickDiscard && !ctx.prepareQuickDiscard()) {
        fail('Finish or clear your unsent reply, and let draft changes save before discarding from the list.')
        return
      }
      quickPending.current.add(t.prospect_id)
      try {
        const failed = await discardLegs(legs, null)
        const gone = legs.filter(l => !failed.some(f => f.leg.id === l.id))
        if (gone.length) {
          ctx.patch(gone.map(l => l.id), { send_blocked_reason: 'discarded_in_inbox', send_blocked_at: new Date().toISOString(), discard_mode: null })
          toast.show({
            message: `Discarded ${gone.length > 1 ? 'both drafts' : 'the draft'} to ${t.prospect_name}.`,
            sub: 'You can also bring it back from Discarded.', ms: 12000,
            action: { label: 'Undo', verb: 'undo', run: () => { void undoQuickDiscard(t.prospect_id, gone) } },
          })
        }
        if (failed.length) fail(failed.map(legFailureText).join(' '))
      } catch (e) { fail(`Could not discard: ${errText(e)}`) }
      finally { quickPending.current.delete(t.prospect_id); ctx.refresh() }
    }

    async function undoQuickDiscard(prospectId: string, legs: InboxMessage[]) {
      for (const leg of legs) {
        try {
          if (!(await restoreDraft(leg.id, prospectId))) throw new Error('This draft changed. Refresh the conversation to check it.')
          ctx.patch([leg.id], { send_blocked_reason: leg.send_blocked_reason, send_blocked_at: leg.send_blocked_at, discard_mode: leg.discard_mode ?? null })
        } catch (e) { fail(`Could not bring it back: ${errText(e)}`) }
      }
      ctx.refresh()
    }

    /** Mark as solved: no answer needed. solved_at on the prospect; any pending legs discarded (plain)
     *  first; the reply flag lowered when a draft exists or it is raised. Undo puts all of it back. */
    async function solved(t: Thread): Promise<string | null> {
      if (!canMarkSolved(t)) return null
      const legs = draftLegs(t)
      let gone: InboxMessage[] = []
      if (legs.length) {
        let failed
        try { failed = await discardLegs(legs, null) } catch (e) { const m = errText(e); fail(`Not marked: ${m}`); return m }
        gone = legs.filter(l => !failed.some(f => f.leg.id === l.id))
        if (!gone.length) { const m = failed.map(legFailureText).join(' '); fail(m); return m }
        ctx.patch(gone.map(l => l.id), { send_blocked_reason: 'discarded_in_inbox', send_blocked_at: new Date().toISOString(), discard_mode: null })
        if (failed.length) fail(failed.map(legFailureText).join(' '))
      }
      const prevAt = t.solvedAt ?? null
      const lower = legs.length > 0 || t.needsManualReply
      const at = new Date().toISOString()
      const hold = t.ownerConfirmation
      const holdReason = hold?.send_blocked_reason === 'reply_retry_pending' ? 'reply_retry_pending' : 'owner_confirmation'
      if (hold) {
        try {
          if (!(await dismissConfirmation(hold.id, holdReason, at))) { const m = 'The internal question changed. Refresh and try again.'; fail(m); ctx.refresh(); return m }
        } catch (e) { const m = errText(e); fail(`Not marked: ${m}`); ctx.refresh(); return m }
      }
      try { await writeSolved(t.prospect_id, lower ? { solved_at: at, needs_manual_reply: false } : { solved_at: at }) } catch (e) {
        const m = errText(e)
        if (hold) {
          try {
            if (!(await restoreConfirmation(hold.id, holdReason, at, hold.send_blocked_at))) fail('Could not restore the internal question after the solve failed. Refresh this thread.')
          } catch { fail('Could not restore the internal question after the solve failed. Refresh this thread.') }
        }
        fail(gone.length ? `The draft is discarded, but the solve was not saved: ${m}` : `Not marked: ${m}`)
        ctx.refresh()
        return m
      }
      if (hold) ctx.patch([hold.id], { send_blocked_reason: 'owner_confirmation_superseded', send_blocked_at: at })
      ctx.solved?.(t.prospect_id, at)
      ctx.refresh()
      toast.show({
        message: `Marked ${t.prospect_name} as solved.`,
        sub: `It comes back if ${first(t)} writes again.${gone.length ? ' The draft stays under Discarded for 3 days.' : ''}`,
        action: { label: 'Undo', verb: 'undo', run: () => { void undoSolved(t.prospect_id, gone, prevAt, lower && t.needsManualReply, hold?.id, holdReason, at, hold?.send_blocked_at) } },
      })
      return null
    }

    async function undoSolved(pid: string, legs: InboxMessage[], prevAt: string | null, raiseFlag: boolean, holdId?: string, holdReason?: 'owner_confirmation' | 'reply_retry_pending', retiredAt?: string, previousHoldAt?: string | null) {
      try {
        for (const l of legs) await restoreDraft(l.id)
        if (legs.length) ctx.patch(legs.map(l => l.id), { send_blocked_reason: null, send_blocked_at: null, discard_mode: null })
        await writeSolved(pid, raiseFlag ? { solved_at: prevAt, needs_manual_reply: true } : { solved_at: prevAt })
        if (holdId && holdReason && retiredAt && previousHoldAt !== undefined) {
          if (!(await restoreConfirmation(holdId, holdReason, retiredAt, previousHoldAt))) throw new Error('The internal question changed; refresh this thread.')
          ctx.patch([holdId], { send_blocked_reason: holdReason, send_blocked_at: previousHoldAt })
        }
        ctx.solved?.(pid, prevAt)
      } catch (e) { fail(`Could not undo: ${errText(e)}`) }
      ctx.refresh()
    }

    async function undoDiscard(legs: InboxMessage[]) {
      try {
        for (const l of legs) await restoreDraft(l.id)
        ctx.patch(legs.map(l => l.id), { send_blocked_reason: null, send_blocked_at: null, discard_mode: null })
      } catch (e) { fail(`Could not bring it back: ${errText(e)}`) }
      ctx.refresh()
    }

    /** Later: ONE key. A pending draft is snoozed (today's push); a draftless Rise/Arch thread gets
     *  today's dated follow-up. laterPath (later.ts) picks the path; both carry Undo. */
    async function later(t: Thread, ed: Edits): Promise<string | null> {
      const path = laterPath(t)
      if (path === 'followup') { await followUp(t, null, ''); return null }
      if (path !== 'snooze') return null
      const draft = t.draft
      if (!draft) return null
      const ans = await askDate(t.prospect_name, 'draft')
      if (!ans) return null
      const until = ans.at
      const comp = t.companionDraft
      try {
        await saveCcs(t, ed)
        // His edits travel with the push before either leg is parked.
        await saveEditedLegs(t, ed)
        await snoozeDraft(draft.id, until)
        if (comp) {
          await snoozeDraft(comp.id, until)
        }
      } catch (e) { const m = errText(e); fail(m); return m }
      const ids = draftLegs(t).map(l => l.id)
      ctx.patch(ids, { snoozed_until: until, snoozed_at: new Date().toISOString() })
      ctx.refresh()
      toast.show({
        message: `Later: ${first(t)} comes back ${formatReturn(until)}.`, sub: 'Nothing is sent. It comes back sooner if they write.',
        action: { label: 'Undo', verb: 'undo', run: () => { void bringBackNow(t) } },
      })
      return null
    }

    async function bringBackNow(t: Thread) {
      try { for (const l of draftLegs(t)) await unsnoozeDraft(l.id) } catch (e) { fail(errText(e)) }
      ctx.patch(draftLegs(t).map(l => l.id), { snoozed_until: null, snoozed_at: null })
      ctx.refresh()
    }

    async function saveEdit(t: Thread, ed: Edits): Promise<string | null> {
      const draft = t.draft
      if (!draft) return null
      let saved: Awaited<ReturnType<typeof saveEditedLegs>>
      try {
        await saveCcs(t, ed)
        saved = await saveEditedLegs(t, ed)
      } catch (e) { const m = errText(e); fail(`Not saved: ${m}`); return m }
      ctx.patch([draft.id], { message_text: saved.main.message_text, email_mirror_text: saved.main.email_mirror_text })
      toast.show({ message: 'Draft saved.', sub: 'Nothing is sent until you press Send.' })
      ctx.refresh()
      return null
    }

    /** Inline edit writes quietly and returns its successful row baseline for queued local edits. */
    async function autosave(t: Thread, ed: Edits): Promise<string | { thread: Thread } | null> {
      const draft = t.draft
      if (!draft) return null
      const comp = t.companionDraft
      let saved: Awaited<ReturnType<typeof saveEditedLegs>>
      try {
        await saveCcs(t, ed)
        saved = await saveEditedLegs(t, ed)
      } catch (e) { return errText(e) }
      ctx.patch([draft.id], { message_text: saved.main.message_text, email_mirror_text: saved.main.email_mirror_text })
      if (comp && saved.companion) ctx.patch([comp.id], { message_text: saved.companion.message_text })
      return { thread: { ...t,
        draft: { ...saved.main, email_cc: ed.cc === undefined ? saved.main.email_cc : parseEmailCc(ed.cc) },
        companionDraft: saved.companion ? { ...saved.companion, email_cc: ed.companionCc === undefined ? saved.companion.email_cc : parseEmailCc(ed.companionCc) } : null } }
    }

    async function compose(t: Thread, text: string, emailTarget?: EmailReplyTarget, composition?: EmailComposition | null): Promise<boolean> {
      const body = text.trim()
      if (!body) return false
      const rich = emailTarget ? buildEmailComposition(emailTarget.message_text_prefix + text, emailRowSender(t.client_id), { composition }) : null
      const sentBody = rich ? renderEmailDocument(rich.body).text : body
      const reviewed = rich ? { ...rich, source_text: emailTarget!.message_text_prefix + sentBody } : null
      const identity = emailTarget ? sentBody : body
      {
        const rendered = reviewed ? renderEmailComposition(reviewed) : null
        const details = emailTarget && rendered ? {
          ...emailPreview(emailTarget.message_text_prefix + sentBody, { from: emailRowSender(t.client_id), to: [emailTarget.recipient_email], cc: emailTarget.cc ?? [], replyToMessageId: emailTarget.email_headers?.['In-Reply-To'] }),
          subject: emailTarget.subject ?? splitEmailDraft(emailTarget.message_text_prefix).subject,
          body: rendered.text, html: rendered.html,
        } : null
        const context = emailTarget?.context
        const preview = details ? createElement('div', { style: { maxHeight: '50vh', overflowY: 'auto' } },
          createElement('p', null, context ? `Replying to ${context.fromName || context.from}${context.isLatest ? ' · latest received email' : ' · earlier email in this thread'}` : `Replying to email ${emailTarget?.source_message_id ?? ''}`),
          createElement(EmailPreview, { details, state: 'Ready to send' })) : 'The sender picks it up within about 2 minutes.'
        const ok = await confirm({ title: `Send this to ${t.prospect_name}?`, message: preview, confirmText: 'Send it', verb: 'confirm-compose' })
        if (!ok) return false
      }
      const pid = t.prospect_id
      // A hand reply is a plain insert: after a no-answer, never insert the same words twice.
      const already = async (): Promise<boolean | null> => { try { return Boolean(await findLandedReply(pid, identity)) } catch { return null } }
      let failed: Awaited<ReturnType<typeof composeReply>> | null = null
      if (composeUnsure.get(pid) === identity) {
        const hit = await already()
        if (hit === null) { fail(`${NO_ANSWER_UNCHECKED} Your text is kept.`); return false }
        if (hit) failed = await discardLegs(draftLegs(t)).catch(() => [])
      }
      if (!failed) {
        try { failed = emailTarget ? await composeReply(t, sentBody, emailTarget, reviewed!) : await composeReply(t, body) } catch (e) {
          if (!isNoAnswer(e)) { fail(errText(e)); return false }
          composeUnsure.set(pid, identity)
          const hit = await already()
          if (!hit) {
            fail(hit === false ? 'No answer from the server, and your reply is not on the thread: nothing was sent. Press Send again: it checks first, so it never goes twice.'
              : `${NO_ANSWER_UNCHECKED} Your text is kept.`)
            ctx.refresh(); return false
          }
          failed = await discardLegs(draftLegs(t)).catch(() => [])
        }
      }
      composeUnsure.delete(pid)
      // Ivan 10-21 (Barak): an internal question never stops his own hand reply. Once his words
      // are queued, the question is answered by them, so it is retired and the drafter stays quiet.
      const hold = t.ownerConfirmation
      if (hold) await dismissConfirmation(hold.id, hold.send_blocked_reason === 'reply_retry_pending' ? 'reply_retry_pending' : 'owner_confirmation').catch(e => fail(`Your reply is queued, but the internal question stayed open: ${errText(e)}`))
      if (failed.length) fail(`Your reply is queued. ${failed.map(legFailureText).join(' ')}`)
      else toast.show({ message: `Queued your reply to ${t.prospect_name}.`, sub: 'The sender picks it up within about 2 minutes.' })
      ctx.refresh()
      return true
    }

    async function bringBack(t: Thread, m: InboxMessage) {
      try {
        const did = await restoreDraft(m.id)
        if (!did) fail('Nothing changed. This row moved on since the screen loaded, so the draft was left alone.')
        else { ctx.patch([m.id], { send_blocked_reason: null, send_blocked_at: null, discard_mode: null }); toast.show({ message: `The draft to ${t.prospect_name} is back.`, sub: 'It waits on you. Nothing is sent until you approve it.' }) }
      } catch (e) { fail(errText(e)) }
      ctx.refresh()
    }

    async function cameBackDismiss(pid: string, name: string, after: () => void) {
      try {
        if (!(await dismissCameBack(pid))) { fail('Nothing changed.'); return }
      } catch (e) { fail(errText(e)); return }
      after()
      toast.show({ message: `Dismissed ${name}.`, action: { label: 'Undo', verb: 'undo', run: () => { void undismissCameBack(pid).then(after).catch(e => fail(errText(e))) } } })
    }

    async function spam(t: Thread) {
      const ok = await confirm({ title: 'File as likely spam?', message: `${t.prospect_name} leaves the inbox and the reply lane, and any pending draft is discarded. "Not spam" on the thread brings it back.`, confirmText: 'File as spam', verb: 'confirm-spam', danger: true })
      if (!ok) return
      try { await markSpam(t); toast.show({ message: `Filed ${t.prospect_name} as likely spam.` }) } catch (e) { fail(errText(e)) }
      ctx.refresh()
    }

    async function notSpam(t: Thread) {
      try { await markNotSpam(t); toast.show({ message: `${t.prospect_name} is back in Needs you.` }) } catch (e) { fail(errText(e)) }
      ctx.refresh()
    }

    async function deleteSeat(t: Thread): Promise<boolean> {
      const inmail = threadKind(t) === 'inmail'
      const ok = await confirm({ title: 'Delete from the seat on LinkedIn?', message: `The conversation with ${t.prospect_name} is deleted from the seat's LinkedIn inbox and this person is closed for every lane. It cannot be undone, and ${t.prospect_name} still has their own copy.` + (inmail ? ' LinkedIn has no delete for Sales Navigator InMails, so an InMail stays there.' : ''), confirmText: 'Delete from seat', verb: 'confirm-delete', danger: true })
      if (!ok) return false
      try {
        const { keptOnLinkedIn } = await deleteThread(t)
        toast.show(keptOnLinkedIn
          ? { message: `Closed ${t.prospect_name} and removed the thread from the inbox.`, sub: 'LinkedIn has no delete for Sales Navigator InMails, so that conversation stays in Sales Navigator.' }
          : { message: `Deleted ${t.prospect_name} from the seat.` })
      } catch (e) { fail(`Not deleted: ${errText(e)}`); return false }
      ctx.refresh()
      return true
    }

    /** Today's dated follow-up (setFollowUp). `at` given = the one-tap suggestion; null asks the
     *  Later picker (with the note). Undo puts the previous date back, or clears it. */
    async function followUp(t: Thread, at: string | null, why: string): Promise<boolean> {
      let prev: FollowUp | null = null
      try { prev = await fetchFollowUp(t.prospect_id) } catch { prev = null }
      let when = at, note = why
      if (!when) {
        const ans = await askDate(t.prospect_name, 'followup', { note: true, noteInit: why || prev?.note || '', suggest: followUpSuggestion(t.draft?.draft_evidence) })
        if (!ans) return false
        when = ans.at; note = ans.note
      }
      try { await setFollowUp(t.prospect_id, when, note) } catch (e) { fail(errText(e)); return false }
      ctx.dated?.()
      toast.show({
        message: `Later: a follow-up to ${first(t)} drafts ${formatReturn(when)}.`, sub: `If ${first(t)} writes first, the date is dropped.`,
        action: { label: 'Undo', verb: 'undo', run: () => { void (prev ? setFollowUp(t.prospect_id, prev.at, prev.note ?? '') : clearFollowUp(t.prospect_id)).then(() => ctx.dated?.()).catch(e => fail(`Could not undo: ${errText(e)}`)) } },
      })
      return true
    }

    async function followUpClear(t: Thread): Promise<boolean> {
      try { await clearFollowUp(t.prospect_id); ctx.dated?.(); return true } catch (e) { fail(errText(e)); return false }
    }

    async function holdDiscard(t: Thread) {
      const hold = t.ownerConfirmation
      if (!hold) return
      const ok = await confirm({ title: 'Discard this internal question?', message: 'No reply will be drafted for it. The thread stays reachable, and a new message from them starts a fresh draft.', confirmText: 'Discard', verb: 'confirm-hold-discard', danger: true })
      if (!ok) return
      try { if (!(await dismissConfirmation(hold.id))) fail('This question was already retired or answered. Nothing was changed.') } catch (e) { fail(errText(e)) }
      ctx.refresh()
    }

    /** Release hold (Ivan 09-29): he has the owner's answer and writes the reply himself. The same
     *  guarded retire as Discard, without the danger confirm; the compose box opens at once. Undo
     *  puts the question back. */
    async function holdRelease(t: Thread) {
      const hold = t.ownerConfirmation
      if (!hold) return
      const at = new Date().toISOString()
      try {
        if (!(await dismissConfirmation(hold.id, 'owner_confirmation', at))) { fail('This question was already retired or answered. Nothing was changed.'); ctx.refresh(); return }
      } catch (e) { fail(errText(e)); return }
      ctx.patch([hold.id], { send_blocked_reason: 'owner_confirmation_superseded', send_blocked_at: at })
      ctx.refresh()
      toast.show({
        message: `Hold released on ${t.prospect_name}.`, sub: 'Write the reply below. Nothing is sent until you press Send.',
        action: { label: 'Undo', verb: 'undo', run: () => {
          void restoreConfirmation(hold.id, 'owner_confirmation', at, hold.send_blocked_at)
            .then(ok => { if (!ok) fail('The question changed since. Refresh this thread.'); ctx.refresh() })
            .catch(e => fail(`Could not undo: ${errText(e)}`))
        } },
      })
    }

    async function askOwner(t: Thread): Promise<string> {
      if (!t.draft) return ''
      try { return await escalateDraftToClient(t.draft.id) } catch (e) { const m = errText(e) || 'Could not prepare that question.'; fail(m); throw new Error(m) }
    }

    async function bulkDiscard(ts: Thread[], what: string, o: { title?: string; confirmText?: string; message?: string } = {}): Promise<void> {
      const legs = ts.flatMap(draftLegs)
      if (!legs.length) return
      const ok = await confirm({ title: o.title ?? `Discard ${ts.length} draft${ts.length === 1 ? '' : 's'}?`, message: o.message ?? `${what} None of them will be sent.`, confirmText: o.confirmText ?? 'Discard them', verb: 'confirm-bulk', danger: true })
      if (!ok) return
      try {
        const failed = await discardLegs(legs)
        if (failed.length) fail(failed.map(legFailureText).join(' '))
        else toast.show({ message: `Discarded ${ts.length} draft${ts.length === 1 ? '' : 's'}.`, sub: 'Each stays under Discarded for 3 days.' })
      } catch (e) { fail(errText(e)) }
      ctx.refresh()
    }

    /** Today's list-row Discard (InboxList onRowDiscard): every leg, danger confirm, today's words. */
    async function rowDiscard(t: Thread): Promise<void> {
      if (!t.draft) return
      const pair = t.companionDraft != null
      await bulkDiscard([t], '', { title: pair ? 'Discard both drafts?' : 'Discard this draft?', message: pair ? 'Neither the LinkedIn message nor the email will be sent.' : 'It will not be sent.', confirmText: 'Discard' })
    }

    /** Today's StaleBar: the seat's drafts answering a message he already replied to. */
    async function discardStale(stale: Thread[]): Promise<void> {
      await bulkDiscard(stale, '', { title: `Discard ${stale.length} stale draft${stale.length === 1 ? '' : 's'}?`, message: 'These threads already have your own reply after the last inbound message. Nothing is sent.', confirmText: 'Discard stale' })
    }

    return { quickDiscard, sendVia, rowDiscard, discardStale, send, redraft, sendAnyways, editHeld, discardHeld, discard, solved, later, bringBackNow, saveEdit, autosave, compose, bringBack, cameBackDismiss, spam, notSpam, deleteSeat, followUp, followUpClear, holdDiscard, holdRelease, askOwner, bulkDiscard, isFollowUp }
  }, [ctx, confirm, toast, askDiscard, askDate])
}

export type DmVerbs = ReturnType<typeof useDmVerbs>
