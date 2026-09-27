// Every DM write, wired to TODAY'S lib calls with today's payloads, guards and order
// (src/wb/thread/Conversation.tsx, RestoreStrip, FollowUpStrip, CameBack). Nothing here
// invents a write path: each verb names the lib function it calls.
import { useMemo } from 'react'
import {
  approveDraft, composeReply, deleteThread, discardLegs, dismissConfirmation, draftLegs, escalateDraftToClient,
  isFollowUp, legFailureText, markNotSpam, markSpam, messageChannel, offersReplyMyself, restoreDraft,
  saveDraftEmail, saveDraftText, snoozeDraft, threadChatId, unsnoozeDraft, REPLY_MYSELF,
  type InboxMessage, type Thread,
} from '../../lib/inbox'
import { clearFollowUp, setFollowUp } from '../../lib/followUp'
import { formatReturn } from '../../lib/pushLater'
import { dismissCameBack, undismissCameBack } from '../../wb/dms/cameBackData'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { useAsks } from './asks'
import { canMarkSolved, writeSolved } from './solved'

export type Edits = { main: string; email: string | null; companion: string | null }

export type VerbCtx = {
  /** Re-read the list (and the frame's DM counts). */
  refresh: () => void
  /** Optimistic: show these rows changed until the next read lands. */
  patch: (ids: string[], p: Partial<InboxMessage>) => void
  /** Show a solve (or its undo) at once on every reader of the frame's inbox. */
  solved?: (pid: string, at: string | null) => void
}

// supabase-js hands back a plain PostgrestError object ({message, code}), not an Error: read its
// message, or a failed write would say "[object Object]".
const errText = (e: unknown) => (e instanceof Error ? e.message
  : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : String(e))
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
  const confirm = useDConfirm()
  const toast = useToast()
  const { askDiscard, askDate } = useAsks()
  return useMemo(() => {
    const fail = (message: string) => { toast.show({ message, tone: 'failed' }) }

    /** Approve & send (both legs on a pair). Always asks first, as today's thread does. */
    async function send(t: Thread, ed: Edits): Promise<string | null> {
      const draft = t.draft
      if (!draft) return null
      const comp = t.companionDraft
      {
        const ok = await confirm({
          title: `Send to ${t.prospect_name}?`,
          message: comp ? `Both legs go out: the ${legName(draft)} and the ${legName(comp)}. The sender picks them up within about 2 minutes.`
            : 'The sender picks it up within about 2 minutes.',
          confirmText: comp ? 'Approve & send both' : 'Approve & send',
          verb: 'confirm-send',
        })
        if (!ok) return null
      }
      try {
        // Email first: approveDraft stamps approved_at and the email save guards on it being null.
        if (draft.email_mirror_text != null && ed.email != null && ed.email !== draft.email_mirror_text) await saveDraftEmail(draft.id, ed.email)
        await approveDraft(draft.id, ed.main, threadChatId(t))
      } catch (e) { const m = errText(e); fail(`Not sent: ${m}`); return m }
      ctx.patch([draft.id], { approved_at: new Date().toISOString() })
      let half: string | null = null
      if (comp) {
        try {
          await approveDraft(comp.id, ed.companion ?? comp.message_text, messageChannel(comp) === 'email' ? null : threadChatId(t))
          ctx.patch([comp.id], { approved_at: new Date().toISOString() })
        } catch (e) {
          half = `The ${legName(draft)} is queued, but the ${legName(comp)} did not go through: ${errText(e)} It is still waiting here.`
          fail(half)
        }
      }
      if (!half) toast.show({ message: `Sent to ${t.prospect_name}.`, sub: 'The sender picks it up within about 2 minutes.' })
      ctx.refresh()
      return half
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
      try { await writeSolved(t.prospect_id, lower ? { solved_at: at, needs_manual_reply: false } : { solved_at: at }) } catch (e) {
        const m = errText(e)
        fail(gone.length ? `The draft is discarded, but the solve was not saved: ${m}` : `Not marked: ${m}`)
        ctx.refresh()
        return m
      }
      ctx.solved?.(t.prospect_id, at)
      ctx.refresh()
      toast.show({
        message: `Marked ${t.prospect_name} as solved.`,
        sub: `It comes back if ${first(t)} writes again.${gone.length ? ' The draft stays under Discarded for 3 days.' : ''}`,
        action: { label: 'Undo', verb: 'undo', run: () => { void undoSolved(t.prospect_id, gone, prevAt, lower && t.needsManualReply) } },
      })
      return null
    }

    async function undoSolved(pid: string, legs: InboxMessage[], prevAt: string | null, raiseFlag: boolean) {
      try {
        for (const l of legs) await restoreDraft(l.id)
        if (legs.length) ctx.patch(legs.map(l => l.id), { send_blocked_reason: null, send_blocked_at: null, discard_mode: null })
        await writeSolved(pid, raiseFlag ? { solved_at: prevAt, needs_manual_reply: true } : { solved_at: prevAt })
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

    async function later(t: Thread, ed: Edits): Promise<string | null> {
      const draft = t.draft
      if (!draft) return null
      const until = await askDate(t.prospect_name, 'draft')
      if (!until) return null
      const comp = t.companionDraft
      try {
        // His edits travel with the push (today's order: text, email, park; then the other leg).
        if (ed.main !== draft.message_text) await saveDraftText(draft.id, ed.main)
        if (draft.email_mirror_text != null && ed.email != null && ed.email !== draft.email_mirror_text) await saveDraftEmail(draft.id, ed.email)
        await snoozeDraft(draft.id, until)
        if (comp) {
          if (ed.companion != null && ed.companion !== comp.message_text) await saveDraftText(comp.id, ed.companion)
          await snoozeDraft(comp.id, until)
        }
      } catch (e) { const m = errText(e); fail(m); return m }
      const ids = draftLegs(t).map(l => l.id)
      ctx.patch(ids, { snoozed_until: until, snoozed_at: new Date().toISOString() })
      ctx.refresh()
      toast.show({
        message: `Pushed ${first(t)} to ${formatReturn(until)}.`, sub: 'Nothing is sent. It comes back sooner if they write.',
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
      try {
        if (ed.main !== draft.message_text) await saveDraftText(draft.id, ed.main)
        if (draft.email_mirror_text != null && ed.email != null && ed.email !== draft.email_mirror_text) await saveDraftEmail(draft.id, ed.email)
        if (t.companionDraft && ed.companion != null && ed.companion !== t.companionDraft.message_text) await saveDraftText(t.companionDraft.id, ed.companion)
      } catch (e) { const m = errText(e); fail(`Not saved: ${m}`); return m }
      ctx.patch([draft.id], { message_text: ed.main })
      toast.show({ message: 'Draft saved.', sub: 'Nothing is sent until you press Send.' })
      ctx.refresh()
      return null
    }

    async function compose(t: Thread, text: string): Promise<boolean> {
      const body = text.trim()
      if (!body) return false
      {
        const ok = await confirm({ title: `Send this to ${t.prospect_name}?`, message: 'Your own words, not a reviewed draft. The sender picks it up within about 2 minutes.', confirmText: 'Send it', verb: 'confirm-compose' })
        if (!ok) return false
      }
      try {
        const failed = await composeReply(t, body)
        if (failed.length) fail(`Your reply is queued. ${failed.map(legFailureText).join(' ')}`)
        else toast.show({ message: `Queued your reply to ${t.prospect_name}.`, sub: 'The sender picks it up within about 2 minutes.' })
      } catch (e) { fail(errText(e)); return false }
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
      const ok = await confirm({ title: 'Delete from the seat on LinkedIn?', message: `The conversation with ${t.prospect_name} is deleted from the seat's LinkedIn inbox and this person is closed for every lane. It cannot be undone, and ${t.prospect_name} still has their own copy.`, confirmText: 'Delete from seat', verb: 'confirm-delete', danger: true })
      if (!ok) return false
      try { await deleteThread(t); toast.show({ message: `Deleted ${t.prospect_name} from the seat.` }) } catch (e) { fail(`Not deleted: ${errText(e)}`); return false }
      ctx.refresh()
      return true
    }

    async function followUp(t: Thread, at: string | null, why: string): Promise<boolean> {
      const when = at ?? await askDate(t.prospect_name, 'followup')
      if (!when) return false
      try { await setFollowUp(t.prospect_id, when, why) } catch (e) { fail(errText(e)); return false }
      toast.show({ message: `A follow-up to ${first(t)} drafts ${formatReturn(when)}.`, sub: `If ${first(t)} writes first, the date is dropped.` })
      return true
    }

    async function followUpClear(t: Thread): Promise<boolean> {
      try { await clearFollowUp(t.prospect_id); return true } catch (e) { fail(errText(e)); return false }
    }

    async function holdDiscard(t: Thread) {
      const hold = t.ownerConfirmation
      if (!hold) return
      const ok = await confirm({ title: 'Discard this internal question?', message: 'No reply will be drafted for it. The thread stays reachable, and a new message from them starts a fresh draft.', confirmText: 'Discard', verb: 'confirm-hold-discard', danger: true })
      if (!ok) return
      try { if (!(await dismissConfirmation(hold.id))) fail('This question was already retired or answered. Nothing was changed.') } catch (e) { fail(errText(e)) }
      ctx.refresh()
    }

    async function askOwner(t: Thread): Promise<string> {
      if (!t.draft) return ''
      try { return await escalateDraftToClient(t.draft.id) } catch (e) { const m = errText(e) || 'Could not queue that.'; fail(m); return m }
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

    return { rowDiscard, discardStale, send, discard, solved, later, bringBackNow, saveEdit, compose, bringBack, cameBackDismiss, spam, notSpam, deleteSeat, followUp, followUpClear, holdDiscard, askOwner, bulkDiscard, isFollowUp }
  }, [ctx, confirm, toast, askDiscard, askDate])
}

export type DmVerbs = ReturnType<typeof useDmVerbs>
