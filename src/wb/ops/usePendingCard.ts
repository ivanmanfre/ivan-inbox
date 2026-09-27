/* ==========================================================================
   src/wb/ops/usePendingCard.ts - ONE pending card's state, confirms and writes.

   Extracted unchanged from PendingCard.tsx (2026-09-27) so the D Ops card and
   today's card share one approve path, one set of confirm sentences and one
   set of lib writes. The only new thing is that `confirm` is passed in: each
   frame brings its own sheet. Every comment below the fold is the card's own.
   ========================================================================== */
import { useEffect, useState } from 'react'
import type { ConfirmOpts } from '../../lib/confirm'
import {
  approveOpsDraft, approveWeeklyReport, canGenerateDraft, canTagCommenter, isCloseOnlyComment,
  discardOpsDraft, DRAFT_CONTINUE_MAX, engineLabel, expiresIn, generateCommentDraft, likeComment,
  markCommentHandled, outboundApproveUrl, outboundSkipUrl, postCommentReply, isHandWritten, seatLabel, seatPerson,
  dispatchCommentGate, cardStateOf, weeklyReportDispatches, weeklySendAfter,
  archOutcome, archSources, markNeedsDavor, DRAFTER_BUSY,
  type OpsDraft, type GateVerdict, type FeedState,
} from '../../lib/ops'

export type CardConfirm = { title: string; message: string; confirmText: string; danger?: boolean }

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Slack channel ids are unreadable on a card; name the ones we own.
const CHANNEL_NAME: Record<string, string> = { C0BJ72F58BY: 'the Rise DTC channel', C0BPJ0KHXV1: 'the ARCH channel' }
export function channelName(id: string | null | undefined): string | null {
  return id ? CHANNEL_NAME[id] ?? null : null
}

export function usePendingCard({ draft, refresh, feed, held, onGateResult, confirm }: {
  draft: OpsDraft
  refresh: () => void
  feed?: FeedState
  held?: GateVerdict
  onGateResult?: (id: string, v: GateVerdict) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
}) {
  const [body, setBody] = useState(draft.body)
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  // Tagging is the native-LinkedIn default (Ivan, 08-27).
  const [tag, setTag] = useState(true)
  const [liking, setLiking] = useState(false)
  const [likedNow, setLikedNow] = useState(false)
  const [davorNow, setDavorNow] = useState(false)
  const [busyNote, setBusyNote] = useState('')
  const [refusal, setRefusal] = useState<string[]>([])
  const [error, setError] = useState('')
  const [gate, setGate] = useState<GateVerdict | null>(null)
  const postState = cardStateOf(feed)
  const heldVerdict = held ?? (gate?.held ? gate : null)

  // Re-seed the editor if the row itself changes.
  useEffect(() => { setBody(draft.body) }, [draft.id, draft.body])

  const isNewsjack = draft.kind === 'newsjack'
  const isWeekly = draft.kind === 'weekly_report'
  const weeklyDispatches = weeklyReportDispatches(draft)
  const weeklyGateMs = weeklySendAfter(draft)
  const weeklyHeld = weeklyGateMs !== null && Date.now() < weeklyGateMs
  const weeklyGateLabel = weeklyGateMs === null ? '' : new Date(weeklyGateMs)
    .toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })
  const isBallot = draft.kind === 'leads_ballot'
  const isComment = draft.kind === 'comment_reply'
  const isEscalatedComment = isComment && !draft.body.trim()
  const isCloseOnly = isCloseOnlyComment(draft, body)
  const isArchComment = isComment && draft.client_id === 'arch'
  const archOut = archOutcome(draft)
  const archReason = typeof draft.context?.arch_reason === 'string' ? draft.context.arch_reason : ''
  const archBasis = typeof draft.context?.arch_basis === 'string' ? draft.context.arch_basis : ''
  const archCaution = typeof draft.context?.arch_caution === 'string' ? draft.context.arch_caution : ''
  const archSrc = isArchComment ? archSources(draft) : []
  const needsDavor = davorNow || draft.context?.needs_davor === true
  const commentCloseOnly = isCloseOnly && !isArchComment
  const canDraft = canGenerateDraft(draft)
  const onDemand = isComment && draft.context?.drafted_on_demand === true
  const canTag = canTagCommenter(draft)
  const commenterName = isComment ? String(draft.context?.author_name ?? '') : ''
  const tagMayFail = /\s[A-Za-z]\.$/.test(commenterName.trim())
  const liked = likedNow || draft.context?.liked === true
  const isOutbound = draft.kind === 'comment_outbound'
  const approveUrl = outboundApproveUrl(draft)
  const where = isComment || isOutbound
    ? seatLabel(draft.client_id)
    : isNewsjack || isWeekly || !draft.slack_channel
      ? engineLabel(draft.client_id)
      : channelName(draft.slack_channel) ?? engineLabel(draft.client_id)
  const left = isNewsjack ? expiresIn(draft.context?.expires_at) : null

  const approveConfirm: CardConfirm = isOutbound
    ? {
      title: approveUrl ? `Send this to the ${where} comment gate?` : `Copy this to post as ${seatPerson(draft.client_id)}?`,
      message: approveUrl
        ? 'The poster’s rate caps, cooldown and jitter still decide. You get their answer on the card, no new tab.'
        : 'Nothing is posted by the system. The comment goes to your clipboard - paste it under the post from Mattan’s seat.',
      confirmText: approveUrl ? 'Approve & queue' : 'Approve & copy',
    }
    : isComment
      ? {
        title: commentCloseOnly ? 'Mark this handled?' : `Post this reply as ${where}?`,
        message: commentCloseOnly
          ? 'Nothing is posted. The card clears and you stop being reminded about this comment.'
          : `Goes live on LinkedIn under their comment, from the client seat.${tag && canTag && commenterName ? ` Tags ${commenterName} so they get the notification, like a native reply.` : ''}${liked ? '' : ' Their comment gets a like too.'} Checks first that they have not already been answered.`,
        confirmText: commentCloseOnly ? 'Mark handled' : 'Approve & post',
      }
      : draft.kind === 'precall_email'
        ? {
          title: `Email this reminder to ${draft.context?.invitee_email ?? 'the invitee'}?`,
          message: 'Sends by email from im@ivanmanfredi.com within about 5 minutes. Edits you made above go out as written.',
          confirmText: 'Approve & send',
        }
        : draft.kind === 'manual_invite'
          ? {
            title: 'Mark this attribution handled?',
            message: 'Nothing is sent. Close this once the booking is stamped in booking_attributions + call_booked_at.',
            confirmText: 'Mark handled',
          }
          : isWeekly
            ? weeklyDispatches
              ? {
                title: `Send this report to ${where}?`,
                message: weeklyHeld
                  ? `Held until ${weeklyGateLabel}. It posts itself then — the report from the app, then your line from your own account ten seconds later.`
                  : 'Posts within about a minute: the report from the app, then your line from your own account ten seconds later. Edits you made above go out as written.',
                confirmText: 'Approve & send',
              }
              : {
                title: 'Copy the message and close this?',
                message: 'Nothing is sent to the client. The message goes to your clipboard and the card clears.',
                confirmText: 'Approve & copy',
              }
            : {
              title: isNewsjack ? `Write this one for ${where}?` : `Post to ${where}?`,
              message: isNewsjack
                ? 'Writes the post now and drops it in the buffer for review. Nothing is scheduled and nothing already in the queue moves.'
                : isBallot
                  ? 'Goes out under your own name in about 5 minutes. Davorin sees it from you, not from the app.'
                  : 'The dispatcher posts this to Slack within about 2 minutes.',
              confirmText: isNewsjack ? 'Approve & draft' : 'Approve & send',
            }

  const discardConfirm: CardConfirm = {
    title: 'Discard this one?',
    message: isNewsjack
      ? "It won't be written or scheduled."
      : isWeekly
        ? "The page stays live at its link. You just won't be reminded about this week again."
        : isComment
          ? "The comment stays on the post. You just won't be reminded about it again."
          : isOutbound
            ? 'Nothing gets posted. The draft is dropped for good.'
            : `It won't be posted to ${channelName(draft.slack_channel) ?? 'Slack'}.`,
    confirmText: 'Discard',
    danger: true,
  }

  const handledConfirm: CardConfirm = {
    title: 'Mark this handled?',
    message: 'Nothing is posted. The card clears and you stop being reminded about this comment.',
    confirmText: 'Mark handled',
  }

  // One write, one busy flag, one error line.
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }

  async function onApprove() {
    if (!(await confirm(approveConfirm))) return
    if (isOutbound) {
      await run(async () => {
        if (approveUrl) {
          const v = await dispatchCommentGate(approveUrl)
          if (v.outcome === 'accepted' || v.outcome === 'already') {
            await approveWeeklyReport(draft.id, body)
            setGate(v)
            onGateResult?.(draft.id, v)
            refresh()
          } else {
            setGate(v)
            onGateResult?.(draft.id, v)
            if (v.outcome !== 'timing') setError(v.message)
          }
        } else {
          await navigator.clipboard.writeText(body)
          await approveWeeklyReport(draft.id, body)
          refresh()
        }
      })
      return
    }
    if (isComment) {
      await run(async () => {
        if (commentCloseOnly) {
          await markCommentHandled(draft.id)
        } else {
          const out = await postCommentReply(draft.id, body, tag, isHandWritten(draft, body))
          if (!out.posted) setError(`${draft.client_id === 'arch' ? 'Davorin' : 'Mattan'} already replied to this one, so nothing was posted. Card cleared.`)
          else if (out.tagged && out.tagVerified === false) {
            setError('Posted fine, but the tag rendered as plain text: LinkedIn would not resolve this profile for a mention (usually an out-of-network commenter with a hidden surname).')
          }
        }
        refresh()
      })
      return
    }
    if (draft.kind === 'manual_invite') {
      await run(async () => { await approveWeeklyReport(draft.id, body); refresh() })
      return
    }
    if (isWeekly) {
      await run(async () => {
        if (weeklyDispatches) await approveOpsDraft(draft.id, body, draft.kind)
        else { await navigator.clipboard.writeText(body); await approveWeeklyReport(draft.id, body) }
        refresh()
      })
      return
    }
    // precall_email, escalation, update, booking, newsjack, leads_ballot
    await run(async () => { await approveOpsDraft(draft.id, body, draft.kind); refresh() })
  }

  // One tap, one like, no confirm (a repeat is a no-op on LinkedIn).
  async function onLike() {
    if (liking || liked) return
    setLiking(true); setError('')
    try { await likeComment(draft.id); setLikedNow(true); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setLiking(false) }
  }

  // Fills the editor; nothing leaves the building. Presses again while the
  // engine answers `can_continue`, so one tap runs the whole loop.
  async function onGenerate() {
    setDrafting(true); setError(''); setRefusal([]); setBusyNote('')
    try {
      let out = await generateCommentDraft(draft.id, draft.client_id)
      for (let n = 0; !out.drafted && !out.transient && out.can_continue && n < DRAFT_CONTINUE_MAX; n++) {
        setRefusal([out.why?.[0] ?? 'Still working…'])
        out = await generateCommentDraft(draft.id, draft.client_id)
      }
      if (out.transient) { setRefusal([]); setBusyNote(DRAFTER_BUSY) }
      else if (out.drafted && out.draft) { setRefusal([]); setBody(out.draft); refresh() }
      else if (isArchComment) { setRefusal([]); refresh() }
      else {
        setRefusal(out.why?.length ? out.why : ['No draft survived the voice gates. Write this one yourself.'])
        if (out.reason === 'already_answered') refresh()
      }
    } catch (e) { setError(errText(e)) }
    finally { setDrafting(false) }
  }

  async function onNeedsDavor() {
    if (busy || needsDavor) return
    await run(async () => { await markNeedsDavor(draft); setDavorNow(true); refresh() })
  }

  async function onMarkHandled() {
    if (!(await confirm(handledConfirm))) return
    await run(async () => { await markCommentHandled(draft.id); refresh() })
  }

  async function onDiscard() {
    if (!(await confirm(discardConfirm))) return
    await run(async () => {
      // Best-effort cancel of the feed row (ivan lane); the row expires anyway.
      const skip = outboundSkipUrl(draft)
      if (skip) { try { void fetch(skip, { mode: 'no-cors' }) } catch { /* fire and forget */ } }
      await discardOpsDraft(draft.id, draft.kind); refresh()
    })
  }

  const addEmoji = (e: string) => setBody(b => (b && !b.endsWith(' ') ? `${b} ${e}` : `${b}${e}`))

  const editorNote = isNewsjack
    ? 'Angle the post gets written from, edit before approving.'
    : isBallot
      ? 'Posts from your own Slack account, not the app. What you approve is exactly what Davorin reads.'
      : isWeekly
        ? weeklyDispatches
          ? 'Read the page first. Both messages below go out as written: the section markers and the reference footer are stripped before sending.'
          : 'Read the page first. Edit this message, then copy it and send it yourself.'
        : isComment
          ? (isCloseOnly
            ? (isArchComment
              ? (archOut
                ? 'Davorin answers this one in his own words. Type above and the button posts it.'
                : 'Press Draft it. The drafter answers only what Davorin has said in public, and says so when it cannot.')
              : 'No draft on purpose: this one wants Mattan in his own words. Type above and the button posts it, or press Draft it for a starting point.')
            : isEscalatedComment
              ? 'Your own words. Approve posts this live under their comment.'
              : onDemand
                ? 'Drafted on request, so this category never passed the auto gate. Read every word before you post it.'
                : 'Edit it first. Approve posts it live under their comment.')
          : isOutbound
            ? (approveUrl
              ? 'A comment on their post, from your seat. Approve queues it here, caps, cooldown and jitter still decide.'
              : 'A comment on their post, from Mattan’s seat. Approve copies it - you paste it on LinkedIn yourself.')
            : undefined

  const approveLabel = busy
    ? (isNewsjack ? 'Writing…' : commentCloseOnly ? 'Closing…' : isComment ? 'Posting…' : isOutbound ? (approveUrl ? 'Opening…' : 'Copying…') : isWeekly ? (weeklyDispatches ? 'Sending…' : 'Copying…') : 'Sending…')
    : (isNewsjack ? 'Approve & draft' : commentCloseOnly ? 'Mark handled' : isComment ? 'Approve & post' : isOutbound ? (approveUrl ? 'Approve & queue' : 'Approve & copy') : isWeekly ? (weeklyDispatches ? 'Approve & send' : 'Approve & copy') : 'Approve & send')

  return {
    body, setBody, busy, drafting, tag, setTag, liking, liked, needsDavor, busyNote, refusal, error, gate,
    postState, heldVerdict, isNewsjack, isWeekly, isComment, isOutbound, isArchComment, isCloseOnly,
    commentCloseOnly, canDraft, canTag, commenterName, tagMayFail, onDemand, archOut, archReason, archBasis,
    archCaution, archSrc, approveUrl, where, left, weeklyDispatches,
    approveConfirm, discardConfirm, handledConfirm, editorNote, approveLabel,
    onApprove, onLike, onGenerate, onNeedsDavor, onMarkHandled, onDiscard, addEmoji,
  }
}

export type PendingCardState = ReturnType<typeof usePendingCard>
