/* ==========================================================================
   Direction A · the pending decision card (S12-18 to S12-35, S36).

   The view only. Every hook, every write, every confirm string and every
   user-visible sentence is the production card's (src/screens/OpsScreen.tsx);
   what changed is the frame: the card is a `Group` whose eyebrow NAMES the kind
   as a neutral label, the context is a key/value block, the editor is the ds
   `Textarea`, and the foot is one decision bar with ONE primary action and
   quiet siblings, each carrying the consequence it will confirm.

   The nine per-kind hexes are gone on purpose (SYSTEM.md §10): a kind is not a
   severity. Amber and red are spent only on the two things that are live and
   stopped — a post the poster refused, and a card waiting on its send window.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  approveOpsDraft, approveWeeklyReport, canGenerateDraft, canTagCommenter, isCloseOnlyComment,
  discardOpsDraft, DRAFT_CONTINUE_MAX, engineLabel, expiresIn, generateCommentDraft, likeComment,
  markCommentHandled, outboundApproveUrl, outboundSkipUrl, postCommentReply, seatLabel,
  dispatchCommentGate, cardStateOf,
  type OpsDraft, type OpsKind, type GateVerdict, type FeedState,
} from '../../lib/ops'
import { Banner, Button, Chip, Textarea } from '../../ds'
import { Group, KV, Sep } from '../kit'
import './ops.css'

// 'OUTBOUND' said what the ENGINE calls the lane, not what the card is. Ivan
// reads these as comments, so they say Comments; `comment_reply` becomes REPLY
// in the same pass so the two comment kinds cannot be told apart by an S.
export const KIND_LABEL: Record<OpsKind, string> = { escalation: 'ESC', update: 'UPDATE', newsjack: 'NEWSJACK', weekly_report: 'WEEKLY', comment_reply: 'REPLY', comment_outbound: 'COMMENTS', booking: 'BOOKED', precall_email: 'PRE-CALL', manual_invite: 'INVITE', task: 'TASK' }

// Slack channel ids are unreadable on a card. escalation/update/booking all print a
// destination, so name the ones we own and fall back to the raw id for anything else.
const CHANNEL_NAME: Record<string, string> = { C0BJ72F58BY: 'the Rise DTC channel' }
function channelLabel(id: string): string {
  return CHANNEL_NAME[id] ?? `#${id}`
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="a-link" href={href} target="_blank" rel="noreferrer">{children}</a>
}

// Whatever the context jsonb carries worth surfacing inline: who this is about
// (escalations) or what already happened (update receipts), plus a replay tag.
//
// The rows are a key/value grid now (project-detail-view): the same values, in
// the same order, with the column of keys that lets a card be read down its
// left edge instead of decoded from a run of bare spans.
function ContextBlock({ draft }: { draft: OpsDraft }) {
  const ctx = draft.context
  if (!ctx) return null

  if (draft.kind === 'newsjack') {
    if (!ctx.headline) return null
    return (
      <KV rows={[['Headline', ctx.source_url
        ? <Link href={ctx.source_url}>{ctx.headline}</Link>
        : <span>{ctx.headline}</span>]]} />
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
    const rows: Array<[React.ReactNode, React.ReactNode]> = []
    if (ctx.week) rows.push(['week of', ctx.week])
    if (parts.length > 0) rows.push(['Week', parts.join(' · ')])
    if (ctx.report_url) rows.push(['Page', <Link href={ctx.report_url}>read the page</Link>])
    return rows.length > 0 ? <KV rows={rows} /> : null
  }
  // A pre-call reminder is read the same way: who it emails and when the call is.
  if (draft.kind === 'precall_email') {
    const when = ctx.call_time ? new Date(ctx.call_time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
    const rows: Array<[React.ReactNode, React.ReactNode]> = [
      ['Who', [ctx.invitee_name, ctx.invitee_email].filter(Boolean).join(' · ')],
    ]
    if (when) rows.push(['call', when])
    return <KV rows={rows} />
  }
  // A booking card is read in about three seconds: who, when, and the brief. The
  // unmatched warning is load-bearing - without a prospect row we cannot claim the
  // lead came from outbound, and the body says "from outbound" by default.
  if (draft.kind === 'booking') {
    const rows: Array<[React.ReactNode, React.ReactNode]> = [
      ['Who', [ctx.prospect_name, ctx.company || ctx.domain].filter(Boolean).join(' · ')],
    ]
    if (ctx.when_str) rows.push(['When', ctx.when_str])
    if (ctx.booked_note) rows.push(['Note', ctx.booked_note])
    if (ctx.brief_url) rows.push(['Brief', <Link href={ctx.brief_url}>read the brief</Link>])
    if (ctx.hubspot_url) rows.push(['Record', <Link href={ctx.hubspot_url}>HubSpot</Link>])
    return (
      <>
        <KV rows={rows} />
        {ctx.matched_prospect === false && (
          <div className="a-ops-warn a-meta">no lane history, check before claiming outbound</div>
        )}
      </>
    )
  }
  // A manual-invite card is a to-do, not a draft: Mattan hand-sent a calendar
  // invite to a matched prospect, which can never auto-attribute (calendar invites
  // bypass the booking page). The evidence line is what goes into the verdict row.
  if (draft.kind === 'manual_invite') {
    const rows: Array<[React.ReactNode, React.ReactNode]> = [
      ['Who', [ctx.prospect_name, ctx.company].filter(Boolean).join(' · ')],
    ]
    if (ctx.when_str) rows.push(['call', ctx.when_str])
    if (ctx.matched_via) rows.push([ctx.matched_via, ctx.matched_value])
    if (ctx.meeting_title) rows.push(['Meeting', <>&ldquo;{ctx.meeting_title}&rdquo;</>])
    return <KV rows={rows} />
  }
  // The comment itself is the card's whole context: who said it, on which post,
  // and what they actually wrote. Without the quote the reply below is unjudgeable.
  if (draft.kind === 'comment_reply') {
    const rows: Array<[React.ReactNode, React.ReactNode]> = [
      ['Who', [ctx.author_name, ctx.author_headline].filter(Boolean).join(' · ')],
    ]
    if (ctx.post_url) rows.push(['Post', <Link href={ctx.post_url}>open the post</Link>])
    return (
      <>
        <KV rows={rows} />
        {ctx.comment_text && <blockquote className="a-quote">&ldquo;{ctx.comment_text}&rdquo;</blockquote>}
        {ctx.category && <div className="a-ops-tags"><Chip tone="quiet">{ctx.category}</Chip></div>}
      </>
    )
  }
  // Outbound: whose post we are commenting on, the line the draft reacts to, and
  // the post itself. The draft below is unjudgeable without the excerpt.
  if (draft.kind === 'comment_outbound') {
    const rows: Array<[React.ReactNode, React.ReactNode]> = [
      ['Who', [ctx.target_name, ctx.target_headline].filter(Boolean).join(' · ')],
    ]
    if (ctx.post_url) rows.push(['Post', <Link href={ctx.post_url}>open the post</Link>])
    return (
      <>
        <KV rows={rows} />
        {ctx.post_excerpt && <blockquote className="a-quote">&ldquo;{ctx.post_excerpt}&rdquo;</blockquote>}
        {ctx.hook && <div className="a-ops-tags"><Chip tone="quiet">{ctx.hook}</Chip></div>}
      </>
    )
  }
  const who = draft.kind === 'escalation'
    ? [ctx.prospect_name, ctx.company].filter(Boolean).join(' · ')
    : ''
  const receipts = draft.kind === 'update' && Array.isArray(ctx.receipts) ? ctx.receipts : []
  if (!who && receipts.length === 0 && ctx.replay !== true) return null
  const rows: Array<[React.ReactNode, React.ReactNode]> = []
  if (who) rows.push(['Who', who])
  if (receipts.length > 0) rows.push(['Receipts', receipts.join(', ')])
  return (
    <>
      {rows.length > 0 && <KV rows={rows} />}
      {ctx.replay === true && <div className="a-ops-tags"><Chip tone="quiet">replay</Chip></div>}
    </>
  )
}

// Exported so a host surface can own the FRAME (header, freshness, columns) and
// still act on the queue through this one card. Duplicating it would mean two
// approve paths with two sets of confirm copy for the same publish.
export function PendingCard({ draft, refresh, feed, onGateResult }: {
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
  // NOTE: `kind='task'` never reaches this card. Tasks are rows in TaskList —
  // they have no body to edit and nothing to send, and wearing a draft card is
  // exactly what Ivan rejected on 2026-08-29.
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

  // The two confirms, built ONCE and read twice: the sheet fires them on the
  // click, and the foot prints the same sentence as the action's consequence
  // BEFORE the click (ai-approval). One expression, so the caption can never
  // drift from what the sheet will actually say.
  const approveConfirm = isOutbound
    ? {
      title: approveUrl ? `Send this to the ${where} comment gate?` : `Copy this to post as ${where}?`,
      message: approveUrl
        ? 'The poster’s rate caps, cooldown and jitter still decide. You get their answer on the card — no new tab.'
        : 'Nothing is posted by the system. The comment goes to your clipboard - paste it under the post from Mattan’s seat.',
      confirmText: approveUrl ? 'Approve & queue' : 'Approve & copy',
    }
    : isComment
      ? {
        title: isCloseOnly ? 'Mark this handled?' : `Post this reply as ${where}?`,
        message: isCloseOnly
          ? 'Nothing is posted. The card clears and you stop being reminded about this comment.'
          : `Goes live on LinkedIn under their comment, from the client seat.${tag && canTag && commenterName ? ` Tags ${commenterName} so they get the notification, like a native reply.` : ''}${liked ? '' : ' Their comment gets a like too.'} Checks first that they have not already been answered.`,
        confirmText: isCloseOnly ? 'Mark handled' : 'Approve & post',
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
            ? {
              title: 'Copy the message and close this?',
              message: 'Nothing is sent to the client. The message goes to your clipboard and the card clears.',
              confirmText: 'Approve & copy',
            }
            : {
              // 2026-08-06, Ivan: "make newsjack not autojump at first, just add to buffer
              // in mattan panel bc i wanna see and approve first". Approving writes the post
              // and stops: it lands in review on the board with every other draft and takes
              // a slot only when Ivan gives it one.
              title: isNewsjack ? `Write this one for ${where}?` : `Post to ${where}?`,
              message: isNewsjack
                ? 'Writes the post now and drops it in the buffer for review. Nothing is scheduled and nothing already in the queue moves.'
                : 'The dispatcher posts this to Slack within about 2 minutes.',
              confirmText: isNewsjack ? 'Approve & draft' : 'Approve & send',
            }

  const discardConfirm = {
    title: 'Discard this one?',
    message: isNewsjack
      ? "It won't be written or scheduled."
      : isWeekly
        ? "The page stays live at its link. You just won't be reminded about this week again."
        : isComment
          ? "The comment stays on the post. You just won't be reminded about it again."
          : isOutbound
            ? 'Nothing gets posted. The draft is dropped for good.'
            : `It won't be posted to ${draft.slack_channel}.`,
    confirmText: 'Discard',
    danger: true,
  }

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
      const ok = await confirm(approveConfirm)
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
      const ok = await confirm(approveConfirm)
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
      const ok = await confirm(approveConfirm)
      if (!ok) return
      setBusy(true); setError('')
      try { await approveOpsDraft(draft.id, body); refresh() }
      catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // A manual-invite card dispatches nothing: the work (stamping the attribution
    // row + call_booked_at) happens outside this app, so approve is the "I did it"
    // acknowledgement and double-stamps like weekly_report.
    if (draft.kind === 'manual_invite') {
      const ok = await confirm(approveConfirm)
      if (!ok) return
      setBusy(true); setError('')
      try { await approveWeeklyReport(draft.id, body); refresh() }
      catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // Nothing dispatches a weekly report: approving copies the message and closes
    // the card; Ivan pastes it to the client himself.
    if (isWeekly) {
      const ok = await confirm(approveConfirm)
      if (!ok) return
      setBusy(true); setError('')
      try {
        // Copy first: if the clipboard is blocked, the card stays put and the
        // message is still recoverable from the textarea.
        await navigator.clipboard.writeText(body)
        await approveWeeklyReport(draft.id, body)
        refresh()
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    const ok = await confirm(approveConfirm)
    if (!ok) return
    setBusy(true); setError('')
    try { await approveOpsDraft(draft.id, body); refresh() }
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
    const ok = await confirm(discardConfirm)
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

  // The one note that rides under the editor, exactly as the card said it.
  const editorNote = isNewsjack
    ? 'Angle the post gets written from, edit before approving.'
    : isWeekly
      ? 'Read the page first. Edit this message, then copy it and send it yourself.'
      : isComment
        ? (isCloseOnly
          ? (draft.client_id === 'arch'
            ? 'No draft on purpose: this one wants Davorin in his own words. No ARCH drafter exists yet, so write it by hand in his register. Type above and the button posts it.'
            : 'No draft on purpose: this one wants Mattan in his own words. Type above and the button posts it, or press Draft it for a starting point.')
          : isEscalatedComment
            ? 'Your own words. Approve posts this live under their comment.'
            : onDemand
              ? 'Drafted on request, so this category never passed the auto gate. Read every word before you post it.'
              : 'Edit it first. Approve posts it live under their comment.')
        : isOutbound
          ? (approveUrl
            ? 'A comment on their post, from your seat. Approve queues it here — caps, cooldown and jitter still decide.'
            : 'A comment on their post, from Mattan’s seat. Approve copies it - you paste it on LinkedIn yourself.')
          : undefined

  const approveLabel = busy
    ? (isNewsjack ? 'Writing…' : isCloseOnly ? 'Closing…' : isComment ? 'Posting…' : isOutbound ? (approveUrl ? 'Opening…' : 'Copying…') : isWeekly ? 'Copying…' : 'Sending…')
    : (isNewsjack ? 'Approve & draft' : isCloseOnly ? 'Mark handled' : isComment ? 'Approve & post' : isOutbound ? (approveUrl ? 'Approve & queue' : 'Approve & copy') : isWeekly ? 'Approve & copy' : 'Approve & send')

  const foot = (
    <div className="a-ops-decide">
      {error && <div className="a-ops-err a-meta">{error}</div>}
      {/* If the Draft it button is gone, its refusal still belongs on the card. */}
      {!canDraft && refusal.length > 0 && (
        <div className="a-ops-refused a-meta">Refused: {refusal.join(' · ')}</div>
      )}
      <div className="a-ops-acts">
        <div className="a-ops-act">
          <Button variant="quiet" disabled={busy || drafting} onClick={onDiscard}>Discard</Button>
          <span className="a-ops-cons a-meta">{discardConfirm.message}</span>
        </div>
        {canDraft && (
          <div className="a-ops-act">
            <Button variant="quiet" busy={drafting} disabled={busy} onClick={onGenerate}>
              {drafting ? 'Writing…' : 'Draft it'}
            </Button>
            {/* A refusal renders on the row it belongs to: the engine refused to
                write THIS draft, so it says so under the button that asked. */}
            {refusal.length > 0 && (
              <span className="a-ops-refused a-meta">Refused: {refusal.join(' · ')}</span>
            )}
          </div>
        )}
        <div className="a-ops-act a-ops-act-p">
          <Button variant="primary" busy={busy} disabled={drafting} onClick={onApprove}>{approveLabel}</Button>
          <span className="a-ops-cons a-meta">{approveConfirm.message}</span>
        </div>
      </div>
    </div>
  )

  return (
    <Group
      className="a-ops-card"
      label={KIND_LABEL[draft.kind]}
      tail={<>{where}{left && <><Sep />{left}</>}<Sep />{timeAgo(draft.created_at)}</>}
      foot={foot}
      pad
    >
      <div className="a-stack" data-tight>
        <ContextBlock draft={draft} />
        <Textarea
          label="Draft"
          labelHidden
          className="a-ops-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          disabled={busy || drafting}
          placeholder={canDraft ? 'Write his reply, or press Draft it.' : undefined}
          hint={editorNote}
        />
        {/* Comment tools (Ivan, 08-27): emoji into the draft, like their comment,
            and the tag chip. The mention itself is added server-side so the draft
            stays clean text here. The picker is user-selected CONTENT, which is
            why it is the one place in this direction that keeps its glyphs
            (SYSTEM.md §6). */}
        {isComment && draft.context?.comment_id && (
          <div className="a-ops-tools">
            <div className="a-ops-emoji" data-off={busy || drafting ? '' : undefined}>
              {['🙂', '😄', '😂', '😅', '😉', '😎', '🙌', '👏', '🤝', '🙏', '🔥', '💪', '🚀', '🎯', '💯', '✅', '⚡', '👍', '❤️', '🥂'].map(e => (
                <button
                  key={e}
                  type="button"
                  className="a-ops-emo"
                  aria-label={e}
                  disabled={busy || drafting}
                  onClick={() => setBody(b => b && !b.endsWith(' ') ? `${b} ${e}` : `${b}${e}`)}
                >{e}</button>
              ))}
            </div>
            <div className="a-ops-toolchips">
              <Chip tone="neutral" selected={liked} onClick={liking || liked ? undefined : onLike}>
                {liked ? '👍 Liked' : liking ? 'Liking…' : '👍 Like their comment'}
              </Chip>
              {canTag && !isCloseOnly && (
                <Chip tone="neutral" selected={tag} onClick={busy ? undefined : () => setTag(t => !t)}>
                  {tag ? (tagMayFail ? `@ tags ${commenterName} (may not stick - hidden surname)` : `@ tags ${commenterName}`) : 'no tag'}
                </Chip>
              )}
            </div>
          </div>
        )}
        {/* Read from comment_feed, the table the poster actually writes. A card
            that painted "Queued" out of React state would keep saying it after a
            refresh even though nothing was scheduled. */}
        {postState === 'queued' && (
          <Banner tone="neutral" icon="time">
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
            sent. (The retry line lives on the host; see the board.) */}
        {gate && gate.outcome === 'timing' && (
          <Banner tone="attention" icon="timer">
            Waiting for the send window — {gate.message}
          </Banner>
        )}
      </div>
    </Group>
  )
}
