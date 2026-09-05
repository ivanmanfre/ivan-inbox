/* =========================================================================
   Ops (Direction B) — THE PENDING CARD, all nine kinds.

   Copied from src/screens/OpsScreen.tsx. Every hook, every piece of state,
   every guard, every write and every user-visible string is the original's;
   the JSX is rebuilt on src/ds. Three things changed on purpose:

   1. The nine per-kind HEXES ARE GONE. A kind is a LABEL, never a severity,
      so every kind wears the same neutral `Chip` and only the word differs.
      Severity tone is kept for the two things that really are live signals:
      a post that failed, and a refusal.
   2. EVERY ACTION CARRIES ITS CONSEQUENCE under its own label. The sentence
      is the one the confirm sheet already says, moved up so the sheet is a
      confirmation rather than the first reading of it (AI Approval,
      educalvolpz — consequence-captions-per-option).
   3. A REFUSAL READS INLINE NEXT TO THE ROW it refused, not as a paragraph
      under the card (AI Task List, educalvolpz).

   The comment tools keep their emoji picker exactly as it is: the emoji
   there is user-selected CONTENT and is deliberately not an icon set.
   ========================================================================= */
import { useEffect, useState } from 'react'
import { useConfirm } from '../../../components/ConfirmSheet'
import {
  approveOpsDraft, approveWeeklyReport, canGenerateDraft, canTagCommenter, isCloseOnlyComment,
  discardOpsDraft, DRAFT_CONTINUE_MAX, engineLabel, expiresIn, generateCommentDraft, likeComment,
  markCommentHandled, outboundApproveUrl, outboundSkipUrl, postCommentReply, seatLabel,
  dispatchCommentGate, cardStateOf,
  type OpsDraft, type GateVerdict, type FeedState,
} from '../../../lib/ops'
import { Banner, Button, Card, Chip, Icon, Textarea } from '../../../ds'
import { channelLabel, errText, KIND_LABEL, timeAgo, type PushToast } from './util'
import './ops.css'

// Whatever the context jsonb carries worth surfacing inline: who this is about
// (escalations) or what already happened (update receipts), plus a replay tag.
//
// Direction B: the same branches, the same strings, drawn as a context BLOCK —
// quiet meta lines, a `Chip` where the original used a tag, and the links as
// links. Nothing was added and nothing was merged.
function ContextLine({ draft }: { draft: OpsDraft }) {
  const ctx = draft.context
  if (!ctx) return null
  if (draft.kind === 'newsjack') {
    if (!ctx.headline) return null
    return (
      <div className="dirb-col ds-t-meta">
        {ctx.source_url
          ? <a className="opsb-link" href={ctx.source_url} target="_blank" rel="noreferrer">{ctx.headline}</a>
          : <span>{ctx.headline}</span>}
      </div>
    )
  }
  // The weekly report card is read before it is sent, so the context line is the
  // week's actual numbers plus the link to the page. Zeros are printed, never
  // dropped: a week with 0 calls booked has to look like one at a glance.
  if (draft.kind === 'weekly_report') {
    const n = (v: unknown) => (typeof v === 'number' ? v : null)
    const parts = [
      n(ctx.replied) !== null ? `${ctx.replied} replied` : null,
      n(ctx.calls_booked) !== null ? `${ctx.calls_booked} calls booked` : null,
      n(ctx.engagers) !== null ? `${ctx.engagers} commented` : null,
      n(ctx.impressions) !== null ? `${ctx.impressions} impressions` : null,
    ].filter(Boolean)
    return (
      <div className="dirb-col ds-t-meta">
        {ctx.week && <span>week of {ctx.week}</span>}
        {parts.length > 0 && <span>{parts.join(' · ')}</span>}
        {ctx.report_url && (
          <a className="opsb-link" href={ctx.report_url} target="_blank" rel="noreferrer">read the page</a>
        )}
      </div>
    )
  }
  // A pre-call reminder is read the same way: who it emails and when the call is.
  if (draft.kind === 'precall_email') {
    const when = ctx.call_time ? new Date(ctx.call_time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
    return (
      <div className="dirb-col ds-t-meta">
        <span>{[ctx.invitee_name, ctx.invitee_email].filter(Boolean).join(' · ')}</span>
        {when && <span>call {when}</span>}
      </div>
    )
  }
  // A booking card is read in about three seconds: who, when, and the brief. The
  // unmatched warning is load-bearing - without a prospect row we cannot claim the
  // lead came from outbound, and the body says "from outbound" by default.
  if (draft.kind === 'booking') {
    return (
      <div className="dirb-col ds-t-meta">
        <span>{[ctx.prospect_name, ctx.company || ctx.domain].filter(Boolean).join(' · ')}</span>
        {ctx.when_str && <span>{ctx.when_str}</span>}
        {ctx.booked_note && <span>{ctx.booked_note}</span>}
        {ctx.matched_prospect === false && (
          <span className="dirb-row-wrap">
            <Chip tone="attention" icon="alert">no lane history, check before claiming outbound</Chip>
          </span>
        )}
        <span className="dirb-row-wrap">
          {ctx.brief_url && (
            <a className="opsb-link" href={ctx.brief_url} target="_blank" rel="noreferrer">read the brief</a>
          )}
          {ctx.hubspot_url && (
            <a className="opsb-link" href={ctx.hubspot_url} target="_blank" rel="noreferrer">HubSpot</a>
          )}
        </span>
      </div>
    )
  }
  // A manual-invite card is a to-do, not a draft: Mattan hand-sent a calendar
  // invite to a matched prospect, which can never auto-attribute (calendar invites
  // bypass the booking page). The evidence line is what goes into the verdict row.
  if (draft.kind === 'manual_invite') {
    return (
      <div className="dirb-col ds-t-meta">
        <span>{[ctx.prospect_name, ctx.company].filter(Boolean).join(' · ')}</span>
        {ctx.when_str && <span>call {ctx.when_str}</span>}
        {ctx.matched_via && <span>{ctx.matched_via}: {ctx.matched_value}</span>}
        {ctx.meeting_title && <span>&ldquo;{ctx.meeting_title}&rdquo;</span>}
      </div>
    )
  }
  // The comment itself is the card's whole context: who said it, on which post,
  // and what they actually wrote. Without the quote the reply below is unjudgeable.
  if (draft.kind === 'comment_reply') {
    return (
      <div className="dirb-col ds-t-meta">
        <span>{[ctx.author_name, ctx.author_headline].filter(Boolean).join(' · ')}</span>
        {ctx.comment_text && <span className="dirb-quote ds-t-body">&ldquo;{ctx.comment_text}&rdquo;</span>}
        <span className="dirb-row-wrap">
          {ctx.category && <Chip tone="quiet">{ctx.category}</Chip>}
          {ctx.post_url && (
            <a className="opsb-link" href={ctx.post_url} target="_blank" rel="noreferrer">open the post</a>
          )}
        </span>
      </div>
    )
  }
  // Outbound: whose post we are commenting on, the line the draft reacts to, and
  // the post itself. The draft below is unjudgeable without the excerpt.
  if (draft.kind === 'comment_outbound') {
    return (
      <div className="dirb-col ds-t-meta">
        <span>{[ctx.target_name, ctx.target_headline].filter(Boolean).join(' · ')}</span>
        {ctx.post_excerpt && <span className="dirb-quote ds-t-body">&ldquo;{ctx.post_excerpt}&rdquo;</span>}
        <span className="dirb-row-wrap">
          {ctx.hook && <Chip tone="quiet">{ctx.hook}</Chip>}
          {ctx.post_url && (
            <a className="opsb-link" href={ctx.post_url} target="_blank" rel="noreferrer">open the post</a>
          )}
        </span>
      </div>
    )
  }
  const who = draft.kind === 'escalation'
    ? [ctx.prospect_name, ctx.company].filter(Boolean).join(' · ')
    : ''
  const receipts = draft.kind === 'update' && Array.isArray(ctx.receipts) ? ctx.receipts : []
  if (!who && receipts.length === 0 && ctx.replay !== true) return null
  return (
    <div className="dirb-col ds-t-meta">
      {who && <span>{who}</span>}
      {receipts.length > 0 && <span>{receipts.join(', ')}</span>}
      {ctx.replay === true && <span className="dirb-row-wrap"><Chip tone="quiet">replay</Chip></span>}
    </div>
  )
}

/** One action: the button, then the one line that says what pressing it does. */
function Action({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="opsb-action">
      {children}
      <span className="opsb-caption ds-t-meta">{caption}</span>
    </div>
  )
}

// Exported so a host surface can own the FRAME (header, freshness, columns) and
// still act on the queue through this one card. Duplicating it would mean two
// approve paths with two sets of confirm copy for the same publish.
export function PendingCard({ draft, refresh, feed, onGateResult, onToast }: {
  draft: OpsDraft
  refresh: () => void
  // The comment_feed row behind an outbound card, if the host loaded it. The
  // poster writes NOTHING to ops_drafts, so this is the only durable answer to
  // "did it actually go out" — and because it comes from the database, it
  // survives a refresh and a second device instead of living in React memory.
  feed?: FeedState
  // Lets the host (which owns the retry line) learn what the gate said without
  // this card having to know a queue exists.
  onGateResult?: (id: string, v: GateVerdict) => void
  // Direction B only, and view-only: the host owns the toast stack. A card
  // reports a write that ALREADY succeeded; nothing here is a second write.
  onToast?: PushToast
}) {
  const [body, setBody] = useState(draft.body)
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  // Tagging is the native-LinkedIn default (Ivan, 08-27): a reply @-mentions the
  // commenter so they get the notification. The chip below the editor turns it
  // off for one reply; the mention itself is welded on server-side.
  const [tag, setTag] = useState(true)
  const [liking, setLiking] = useState(false)
  // context.liked is the durable answer (stamped by the edge fn); likedNow just
  // paints the button before the next refresh lands.
  const [likedNow, setLikedNow] = useState(false)
  // Why the engine refused to write one. Named gate violations, not a spinner
  // that stops: a refusal Ivan cannot see reads as a broken button.
  const [refusal, setRefusal] = useState<string[]>([])
  const [error, setError] = useState('')
  // The gate's last answer for THIS card, so a clock refusal can render as a
  // queue position rather than as a red error.
  const [gate, setGate] = useState<GateVerdict | null>(null)
  const postState = cardStateOf(feed)
  const confirm = useConfirm()

  // Re-seed the editor if the row itself changes (e.g. realtime update lands
  // while the operator hasn't touched it yet).
  useEffect(() => { setBody(draft.body) }, [draft.id, draft.body])

  const isNewsjack = draft.kind === 'newsjack'
  const isWeekly = draft.kind === 'weekly_report'
  // NOTE: `kind='task'` never reaches this card. Tasks are rows in TaskList
  // above — they have no body to edit and nothing to send, and wearing a draft
  // card is exactly what Ivan rejected on 2026-08-29. Both Ops surfaces route
  // them, so this card has no task branch left to go stale.
  const isComment = draft.kind === 'comment_reply'
  // An escalate card carries no draft on purpose: the point is that Mattan
  // answers it himself, so there is nothing to copy.
  const isEscalatedComment = isComment && !draft.body.trim()
  // ...but the editor above is live, and the placeholder invites him to write one.
  // So what decides "post it" vs "just close it" is whether there is text in the
  // box RIGHT NOW. See isCloseOnlyComment for what keying it on the stored row cost.
  const isCloseOnly = isCloseOnlyComment(draft, body)
  // ...but "on purpose" is not the same as "never". The button writes one
  // through the same gates the pipeline uses, and the card keeps saying whose
  // idea it was.
  const canDraft = canGenerateDraft(draft)
  const onDemand = isComment && draft.context?.drafted_on_demand === true
  const canTag = canTagCommenter(draft)
  const commenterName = isComment ? String(draft.context?.author_name ?? '') : ''
  // "Marian A." pattern: a privacy-abbreviated surname means the profile is
  // out-of-network for the seat, and LinkedIn refuses to resolve those into a
  // mention - the tag posts as plain text (proven 08-28). Warn before, verify after.
  const tagMayFail = /\s[A-Za-z]\.$/.test(commenterName.trim())
  const liked = likedNow || draft.context?.liked === true
  const isOutbound = draft.kind === 'comment_outbound'
  // ivan lane cards carry the n8n gate link; risedtc cards are copy-and-hand-post.
  const approveUrl = outboundApproveUrl(draft)
  // A NULL slack_channel used to render the literal "#null" on the card
  // (phase0-readability #5 / phase0-mobile #8). No channel = say whose engine
  // it is instead of printing a database absence.
  // A comment card names the SEAT it posts from (Ivan / Mattan Danino); every
  // other kind keeps the engine register ("your feed" / "Rise").
  const where = isComment || isOutbound
    ? seatLabel(draft.client_id)
    : isNewsjack || isWeekly || !draft.slack_channel
      ? engineLabel(draft.client_id)
      : channelLabel(draft.slack_channel)
  const left = isNewsjack ? expiresIn(draft.context?.expires_at) : null
  const postUrl = typeof draft.context?.post_url === 'string' ? draft.context.post_url : undefined
  const reportUrl = typeof draft.context?.report_url === 'string' ? draft.context.report_url : undefined

  // The consequence of the primary action, in the sheet's own words. Same
  // expression as the confirm below, read once and used twice, so the caption
  // and the sheet can never drift apart.
  const approveMessage = isOutbound
    ? (approveUrl
      ? 'The poster’s rate caps, cooldown and jitter still decide. You get their answer on the card — no new tab.'
      : 'Nothing is posted by the system. The comment goes to your clipboard - paste it under the post from Mattan’s seat.')
    : isComment
      ? (isCloseOnly
        ? 'Nothing is posted. The card clears and you stop being reminded about this comment.'
        : `Goes live on LinkedIn under their comment, from the client seat.${tag && canTag && commenterName ? ` Tags ${commenterName} so they get the notification, like a native reply.` : ''}${liked ? '' : ' Their comment gets a like too.'} Checks first that they have not already been answered.`)
      : draft.kind === 'precall_email'
        ? 'Sends by email from im@ivanmanfredi.com within about 5 minutes. Edits you made above go out as written.'
        : draft.kind === 'manual_invite'
          ? 'Nothing is sent. Close this once the booking is stamped in booking_attributions + call_booked_at.'
          : isWeekly
            ? 'Nothing is sent to the client. The message goes to your clipboard and the card clears.'
            : isNewsjack
              ? 'Writes the post now and drops it in the buffer for review. Nothing is scheduled and nothing already in the queue moves.'
              : 'The dispatcher posts this to Slack within about 2 minutes.'

  // The consequence of the decline, in the sheet's own words, same as above.
  const discardMessage = isNewsjack
    ? "It won't be written or scheduled."
    : isWeekly
      ? "The page stays live at its link. You just won't be reminded about this week again."
      : isComment
        ? "The comment stays on the post. You just won't be reminded about it again."
        : isOutbound
          ? 'Nothing gets posted. The draft is dropped for good.'
          : `It won't be posted to ${draft.slack_channel}.`

  async function onApprove() {
    // Outbound comments: two lanes, one kind.
    //
    // ivan lane (approve_url present) — 2026-08-03, Ivan: "why u opening a new
    // tab on n8n just send that shit lol... make it be 'Queued'". The gate is
    // fired HERE and its verdict is read. That is a correctness fix as much as a
    // convenience one: the five poster gates genuinely refuse (disarmed, stale
    // post, 3/day cap, 10-minute spacing, one-in-flight, per-target cooldown),
    // and this card used to stamp approved+sent regardless — a refused comment
    // rendered as handled and never posted. Only an ACCEPT stamps now; a
    // refusal shows the gate's own sentence and leaves the card actionable.
    //
    // risedtc lane (no approve_url): copy + close; Ivan posts it from Mattan's
    // seat by hand. There is no poster for that lane by design, so it keeps the
    // double-stamp.
    if (isOutbound) {
      const ok = await confirm({
        title: approveUrl ? `Send this to the ${where} comment gate?` : `Copy this to post as ${where}?`,
        message: approveMessage,
        confirmText: approveUrl ? 'Approve & queue' : 'Approve & copy',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        if (approveUrl) {
          const v = await dispatchCommentGate(approveUrl)
          // `already` counts as an accept for stamping: the row has left
          // `pending`, so a replay is the idempotent case, not a new send.
          if (v.outcome === 'accepted' || v.outcome === 'already') {
            await approveWeeklyReport(draft.id, body)
            setGate(v)
            onGateResult?.(draft.id, v)
            onToast?.({
              src: where,
              detail: 'Queued — the poster has it. It posts after its jitter window unless you discard.',
              actionLabel: postUrl ? 'open the post' : undefined,
              href: postUrl,
            })
            refresh()
          } else {
            // NOT stamped. The card stays in the queue, says what the poster
            // said, and (for a clock refusal) joins the retry line.
            setGate(v)
            onGateResult?.(draft.id, v)
            // A clock refusal renders as a queue position, not as an error.
            if (v.outcome !== 'timing') setError(v.message)
          }
        } else {
          // Copy first: a blocked clipboard leaves the card recoverable.
          await navigator.clipboard.writeText(body)
          await approveWeeklyReport(draft.id, body)
          onToast?.({
            src: where,
            detail: 'Nothing is posted by the system. The comment goes to your clipboard - paste it under the post from Mattan’s seat.',
            actionLabel: postUrl ? 'open the post' : undefined,
            href: postUrl,
          })
          refresh()
        }
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // A comment reply is the one thing in this app that publishes publicly.
    // The edge function re-reads the thread before it writes, so an approve on a
    // comment Mattan already answered clears the card instead of doubling up.
    if (isComment) {
      const ok = await confirm({
        title: isCloseOnly ? 'Mark this handled?' : `Post this reply as ${where}?`,
        message: approveMessage,
        confirmText: isCloseOnly ? 'Mark handled' : 'Approve & post',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        if (isCloseOnly) {
          await markCommentHandled(draft.id)
        } else {
          const out = await postCommentReply(draft.id, body, tag)
          if (!out.posted) setError('Mattan already replied to this one, so nothing was posted. Card cleared.')
          else if (out.tagged && out.tagVerified === false) {
            setError('Posted fine — but the tag rendered as plain text: LinkedIn would not resolve this profile for a mention (usually an out-of-network commenter with a hidden surname).')
          } else {
            onToast?.({
              src: where,
              detail: 'Posted to LinkedIn.',
              actionLabel: postUrl ? 'open the post' : undefined,
              href: postUrl,
            })
          }
        }
        refresh()
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // Pre-call reminder: approve stamps approved_at and the Precall Reminder
    // workflow's sender lane emails it from im@ivanmanfredi.com within ~5 minutes,
    // stamping sent_at (which moves the card Working → Sent).
    if (draft.kind === 'precall_email') {
      const ok = await confirm({
        title: `Email this reminder to ${draft.context?.invitee_email ?? 'the invitee'}?`,
        message: approveMessage,
        confirmText: 'Approve & send',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        await approveOpsDraft(draft.id, body)
        onToast?.({ src: where, detail: approveMessage })
        refresh()
      }
      catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // A manual-invite card dispatches nothing: the work (stamping the attribution
    // row + call_booked_at) happens outside this app, so approve is the "I did it"
    // acknowledgement and double-stamps like weekly_report.
    if (draft.kind === 'manual_invite') {
      const ok = await confirm({
        title: 'Mark this attribution handled?',
        message: approveMessage,
        confirmText: 'Mark handled',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        await approveWeeklyReport(draft.id, body)
        onToast?.({ src: where, detail: approveMessage })
        refresh()
      }
      catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // Nothing dispatches a weekly report: approving copies the message and closes
    // the card; Ivan pastes it to the client himself.
    if (isWeekly) {
      const ok = await confirm({
        title: 'Copy the message and close this?',
        message: approveMessage,
        confirmText: 'Approve & copy',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        // Copy first: if the clipboard is blocked, the card stays put and the
        // message is still recoverable from the textarea.
        await navigator.clipboard.writeText(body)
        await approveWeeklyReport(draft.id, body)
        onToast?.({
          src: where,
          detail: approveMessage,
          actionLabel: reportUrl ? 'read the page' : undefined,
          href: reportUrl,
        })
        refresh()
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    const ok = await confirm({
      // 2026-08-06, Ivan: "make newsjack not autojump at first, just add to buffer
      // in mattan panel bc i wanna see and approve first". Approving writes the post
      // and stops: it lands in review on the board with every other draft and takes
      // a slot only when Ivan gives it one.
      title: isNewsjack ? `Write this one for ${where}?` : `Post to ${where}?`,
      message: approveMessage,
      confirmText: isNewsjack ? 'Approve & draft' : 'Approve & send',
    })
    if (!ok) return
    setBusy(true); setError('')
    try {
      await approveOpsDraft(draft.id, body)
      onToast?.({ src: where, detail: approveMessage })
      refresh()
    }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  // One tap, one like, from the client seat. No confirm sheet: a like is the
  // smallest public act this app performs, it cannot double (LinkedIn treats a
  // repeat as a no-op), and the edge fn stamps context.liked so the state holds.
  async function onLike() {
    if (liking || liked) return
    setLiking(true); setError('')
    try { await likeComment(draft.id); setLikedNow(true); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setLiking(false) }
  }

  // No confirm sheet: nothing leaves the building, it fills the textarea above.
  // Slow (three candidates, every gate on all of them, up to a minute or two per
  // round), so the button carries the wait instead of a toast. When every candidate
  // is refused the engine stamps its attempts on the card and answers
  // `can_continue`; this presses again for Ivan, so one tap runs the whole
  // reasoning loop and a refusal only reaches him once the rounds are spent.
  async function onGenerate() {
    setDrafting(true); setError(''); setRefusal([])
    try {
      let out = await generateCommentDraft(draft.id)
      for (let n = 0; !out.drafted && out.can_continue && n < DRAFT_CONTINUE_MAX; n++) {
        setRefusal([out.why?.[0] ?? 'Still working…'])
        out = await generateCommentDraft(draft.id)
      }
      if (out.drafted && out.draft) {
        setRefusal([])
        setBody(out.draft)
        refresh()
      } else {
        setRefusal(out.why?.length ? out.why : ['No draft survived the voice gates. Write this one yourself.'])
        if (out.reason === 'already_answered') refresh()
      }
    } catch (e) { setError(errText(e)) }
    finally { setDrafting(false) }
  }

  async function onDiscard() {
    const ok = await confirm({
      title: 'Discard this one?',
      message: discardMessage,
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try {
      // Best-effort cancel of the underlying feed row (ivan lane); a failure is
      // fine - the row expires on its own 5-day gate.
      const skip = outboundSkipUrl(draft)
      if (skip) { try { void fetch(skip, { mode: 'no-cors' }) } catch { /* fire and forget */ } }
      await discardOpsDraft(draft.id); refresh()
    }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  const approveLabel = busy
    ? (isNewsjack ? 'Writing…' : isCloseOnly ? 'Closing…' : isComment ? 'Posting…' : isOutbound ? (approveUrl ? 'Opening…' : 'Copying…') : isWeekly ? 'Copying…' : 'Sending…')
    : (isNewsjack ? 'Approve & draft' : isCloseOnly ? 'Mark handled' : isComment ? 'Approve & post' : isOutbound ? (approveUrl ? 'Approve & queue' : 'Approve & copy') : isWeekly ? 'Approve & copy' : 'Approve & send')

  return (
    <Card
      className="dirb-lift"
      lead={<Chip>{KIND_LABEL[draft.kind]}</Chip>}
      title={where}
      sub={left ? `${left} · ${timeAgo(draft.created_at)}` : timeAgo(draft.created_at)}
      foot={
        <div className="opsb-actions">
          <Action caption={discardMessage}>
            <Button variant="danger" onClick={busy || drafting ? undefined : onDiscard}>Discard</Button>
          </Action>
          {canDraft && (
            <Action caption="Nothing leaves the building. It fills the box above.">
              <Button
                variant="outline"
                busy={drafting}
                onClick={busy || drafting ? undefined : onGenerate}
              >
                {drafting ? 'Writing…' : 'Draft it'}
              </Button>
            </Action>
          )}
          <Action caption={approveMessage}>
            <Button
              variant="primary"
              busy={busy}
              onClick={busy || drafting ? undefined : onApprove}
            >
              {approveLabel}
            </Button>
          </Action>
          {/* A refusal is READ NEXT TO THE ROW IT REFUSED, so the reason and
              the button that earned it are never a scroll apart. */}
          {refusal.length > 0 && (
            <span className="opsb-inline ds-t-meta">
              <Icon name="blocked" size={16} />
              Refused: {refusal.join(' · ')}
            </span>
          )}
          {error && (
            <span className="opsb-inline ds-t-meta">
              <Icon name="error" size={16} />
              {error}
            </span>
          )}
        </div>
      }
    >
      <ContextLine draft={draft} />
      <Textarea
        label="Draft"
        labelHidden
        value={body}
        onChange={e => setBody(e.target.value)}
        disabled={busy || drafting}
        placeholder={canDraft ? 'Write his reply, or press Draft it.' : undefined}
      />
      {isNewsjack && <span className="ds-t-meta dirb-dim">Angle the post gets written from, edit before approving.</span>}
      {isWeekly && <span className="ds-t-meta dirb-dim">Read the page first. Edit this message, then copy it and send it yourself.</span>}
      {isComment && (
        <span className="ds-t-meta dirb-dim">
          {isCloseOnly
            ? (draft.client_id === 'arch'
              ? 'No draft on purpose: this one wants Davorin in his own words. No ARCH drafter exists yet, so write it by hand in his register. Type above and the button posts it.'
              : 'No draft on purpose: this one wants Mattan in his own words. Type above and the button posts it, or press Draft it for a starting point.')
            : isEscalatedComment
              ? 'Your own words. Approve posts this live under their comment.'
              : onDemand
              ? 'Drafted on request, so this category never passed the auto gate. Read every word before you post it.'
              : 'Edit it first. Approve posts it live under their comment.'}
        </span>
      )}
      {/* Comment tools (Ivan, 08-27): emoji into the draft, like their comment,
          and the tag chip. The mention itself is added server-side so the draft
          stays clean text here.

          S12-23: the emoji picker is UNCHANGED. It is user-selected content,
          not chrome, so it is deliberately not converted to lucide; only the
          two controls beside it moved onto Chip. */}
      {isComment && draft.context?.comment_id && (
        <div className="opsb-emoji-row">
          {['🙂', '😄', '😂', '😅', '😉', '😎', '🙌', '👏', '🤝', '🙏', '🔥', '💪', '🚀', '🎯', '💯', '✅', '⚡', '👍', '❤️', '🥂'].map(e => (
            <span
              key={e}
              className="opsb-emoji"
              data-off={busy || drafting}
              onClick={busy || drafting ? undefined : () => setBody(b => b && !b.endsWith(' ') ? `${b} ${e}` : `${b}${e}`)}
            >{e}</span>
          ))}
          <span className="opsb-emoji-tail">
            <Chip
              tone={liked ? 'clear' : 'quiet'}
              onClick={liking || liked ? undefined : onLike}
            >
              {liked ? '👍 Liked' : liking ? 'Liking…' : '👍 Like their comment'}
            </Chip>
            {canTag && !isCloseOnly && (
              <Chip
                tone={tag ? 'accent' : 'quiet'}
                selected={tag}
                onClick={busy ? undefined : () => setTag(t => !t)}
              >
                {tag ? (tagMayFail ? `@ tags ${commenterName} (may not stick - hidden surname)` : `@ tags ${commenterName}`) : 'no tag'}
              </Chip>
            )}
          </span>
        </div>
      )}
      {isOutbound && (
        <span className="ds-t-meta dirb-dim">
          {approveUrl
            ? 'A comment on their post, from your seat. Approve queues it here — caps, cooldown and jitter still decide.'
            : 'A comment on their post, from Mattan’s seat. Approve copies it - you paste it on LinkedIn yourself.'}
        </span>
      )}
      {/* Read from comment_feed, the table the poster actually writes. A card
          that painted "Queued" out of React state would keep saying it after a
          refresh even though nothing was scheduled.

          A card waiting on the poster wears a PERSISTENT status banner, never a
          spinner glued to the card: the wait is on someone else and it survives
          a reload (Push Approval Card, felipemenezes098). */}
      {postState === 'queued' && (
        <Banner tone="neutral" icon="scheduled">
          Queued — the poster has it. It posts after its jitter window unless you discard.
        </Banner>
      )}
      {postState === 'posted' && (
        <Banner tone="clear" icon="check">Posted to LinkedIn.</Banner>
      )}
      {postState === 'failed' && (
        <Banner tone="urgent" icon="error">
          The poster could not post it{feed?.post_error ? `: ${feed.post_error}` : ''}. Still yours to act on.
        </Banner>
      )}
      {/* A CLOCK refusal is not a failure — it is a queue position. The card
          says what it is waiting on and stays actionable; nothing claims it was
          sent. (The retry line lives on the host; see OpsBoard.) */}
      {gate && gate.outcome === 'timing' && (
        <Banner tone="attention" icon="timer">
          Waiting for the send window — {gate.message}
        </Banner>
      )}
    </Card>
  )
}
