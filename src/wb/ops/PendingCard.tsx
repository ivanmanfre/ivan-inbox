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
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  approveOpsDraft, approveWeeklyReport, canGenerateDraft, canTagCommenter, isCloseOnlyComment,
  discardOpsDraft, DRAFT_CONTINUE_MAX, engineLabel, expiresIn, generateCommentDraft, likeComment,
  markCommentHandled, outboundApproveUrl, outboundSkipUrl, postCommentReply, isHandWritten, seatLabel, seatPerson,
  dispatchCommentGate, cardStateOf, weeklyReportDispatches, weeklySendAfter, GATE_HELD_LABEL,
  archOutcome, archOutcomeLabel, archSources, markNeedsDavor, DRAFTER_BUSY,
  type OpsDraft, type OpsKind, type GateVerdict, type FeedState,
} from '../../lib/ops'
import { Banner, Button, Chip, Textarea } from '../../ds'
import { Group, KV, Sep } from '../kit'
import './ops.css'
import { ConversationTakeoverCard } from './ConversationTakeoverCard'

// 'OUTBOUND' said what the ENGINE calls the lane, not what the card is. Ivan
// reads these as comments, so they say Comments; `comment_reply` becomes REPLY
// in the same pass so the two comment kinds cannot be told apart by an S.
// ELEVATION (2026-09-20): the same thirteen words, in the app's sentence case.
export const KIND_LABEL: Record<OpsKind, string> = { escalation: 'Esc', update: 'Update', newsjack: 'Newsjack', weekly_report: 'Weekly', comment_reply: 'Reply', comment_outbound: 'Comments', booking: 'Booked', precall_email: 'Pre-call', manual_invite: 'Invite', task: 'Task', leads_ballot: 'Leads', audn_recommendation: 'Audience', conversation_takeover: 'Takeover' }

// Slack channel ids are unreadable on a card. escalation/update/booking all print a
// destination, so name the ones we own. An id we cannot name returns null and the
// caller says something true without it: a raw `C0…` id is a code, not a place.
const CHANNEL_NAME: Record<string, string> = { C0BJ72F58BY: 'the Rise DTC channel', C0BPJ0KHXV1: 'the ARCH channel' }
export function channelLabel(id: string | null | undefined): string | null {
  return id ? CHANNEL_NAME[id] ?? null : null
}

// The discard caption for the Slack-bound kinds. Named channel when we know it,
// plain "Slack" when we do not, never the id.
export function slackDiscardLine(id: string | null | undefined): string {
  return `It won't be posted to ${channelLabel(id) ?? 'Slack'}.`
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
  // A leads ballot is read as a supply decision: how thin the sendable queue got, how
  // much is stacked on his review page, and the page itself.
  if (draft.kind === 'leads_ballot') {
    const n = (v: unknown) => (typeof v === 'number' ? v : null)
    const rows: Array<[React.ReactNode, React.ReactNode]> = []
    const parts = [
      n(ctx.company_count) !== null ? `${ctx.company_count} companies` : null,
      n(ctx.people) !== null ? `${ctx.people} people` : null,
      n(ctx.sendable) !== null ? `${ctx.sendable} left to send` : null,
    ].filter(Boolean)
    if (parts.length > 0) rows.push(['Batch', parts.join(' · ')])
    if (ctx.page_url) rows.push(['Page', <Link href={ctx.page_url}>open his page</Link>])
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
export function PendingCard({ draft, refresh, feed, held, onGateResult }: {
  draft: OpsDraft
  refresh: () => void
  // The comment_feed row behind an outbound card, if the host loaded it. The
  // poster writes NOTHING to ops_drafts, so this is the only durable answer to
  // "did it actually go out" — and because it comes from the database, it
  // survives a refresh and a second device instead of living in React memory.
  feed?: FeedState
  // The gate's accept when it PARKED the comment (lane switched off). The host
  // holds it because the stamped card has already left `pending`.
  held?: GateVerdict
  // Lets the host (which owns the retry line) learn what the gate said without
  // this card having to know a queue exists.
  onGateResult?: (id: string, v: GateVerdict) => void
}) {
  if (draft.kind === 'conversation_takeover') return <ConversationTakeoverCard draft={draft} refresh={refresh} />
  return <StandardPendingCard draft={draft} refresh={refresh} feed={feed} held={held} onGateResult={onGateResult} />
}

function StandardPendingCard({ draft, refresh, feed, held, onGateResult }: {
  draft: OpsDraft
  refresh: () => void
  feed?: FeedState
  held?: GateVerdict
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
  // Same pattern for the ARCH "Needs Davor" stamp: context.needs_davor is the
  // durable answer, this paints the chip between the write and the refresh.
  const [davorNow, setDavorNow] = useState(false)
  // The drafter never ran. Not a refusal (it judged nothing) and not an error
  // (nothing broke), so it gets its own quiet line.
  const [busyNote, setBusyNote] = useState('')
  // Why the engine refused to write one. Named gate violations, not a spinner
  // that stops: a refusal Ivan cannot see reads as a broken button.
  const [refusal, setRefusal] = useState<string[]>([])
  const [error, setError] = useState('')
  // The gate's last answer for THIS card, so a clock refusal can render as a
  // queue position rather than as a red error.
  const [gate, setGate] = useState<GateVerdict | null>(null)
  const postState = cardStateOf(feed)
  // Approved, but nothing posts until the lane is switched on. Not a success.
  const heldVerdict = held ?? (gate?.held ? gate : null)
  const confirm = useConfirm()

  // Re-seed the editor if the row itself changes (e.g. realtime update lands
  // while the operator hasn't touched it yet).
  useEffect(() => { setBody(draft.body) }, [draft.id, draft.body])

  const isNewsjack = draft.kind === 'newsjack'
  const isWeekly = draft.kind === 'weekly_report'
  // A weekly report with a send gate on it has a sender behind it; one without
  // is still hand-pasted. The card decides, not the client id. See ops.ts.
  const weeklyDispatches = weeklyReportDispatches(draft)
  const weeklyGateMs = weeklySendAfter(draft)
  const weeklyHeld = weeklyGateMs !== null && Date.now() < weeklyGateMs
  const weeklyGateLabel = weeklyGateMs === null ? '' : new Date(weeklyGateMs)
    .toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })
  const isBallot = draft.kind === 'leads_ballot'
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
  // The ARCH lane (Davorin's own posts) reads its comments through a drafter that
  // answers with a VERDICT, so the card carries the verdict: the chip, the reason
  // it gave, what a draft rests on, and what it read. It also splits the two acts
  // the RISE card folds into one primary — posting and closing are separate
  // buttons here, because "Needs Davor" sits between them and a card that silently
  // turned its post button into a close button while he waited would post nothing.
  const isArchComment = isComment && draft.client_id === 'arch'
  const archOut = archOutcome(draft)
  const archReason = typeof draft.context?.arch_reason === 'string' ? draft.context.arch_reason : ''
  const archBasis = typeof draft.context?.arch_basis === 'string' ? draft.context.arch_basis : ''
  const archSrc = isArchComment ? archSources(draft) : []
  const needsDavor = davorNow || draft.context?.needs_davor === true
  // RISE keeps the one-primary flip it has always had; ARCH never closes a card
  // from the button that says "post".
  const commentCloseOnly = isCloseOnly && !isArchComment
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
  // A comment card names the SEAT it posts from (Ivan / Rise / Arch); every
  // other kind keeps the engine register ("your feed" / "Rise").
  const where = isComment || isOutbound
    ? seatLabel(draft.client_id)
    : isNewsjack || isWeekly || !draft.slack_channel
      ? engineLabel(draft.client_id)
      : channelLabel(draft.slack_channel) ?? engineLabel(draft.client_id)
  const left = isNewsjack ? expiresIn(draft.context?.expires_at) : null

  // The two confirms, built ONCE and read twice: the sheet fires them on the
  // click, and the foot prints the same sentence as the action's consequence
  // BEFORE the click (ai-approval). One expression, so the caption can never
  // drift from what the sheet will actually say.
  const approveConfirm = isOutbound
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
              // 2026-08-06, Ivan: "make newsjack not autojump at first, just add to buffer
              // in mattan panel bc i wanna see and approve first". Approving writes the post
              // and stops: it lands in review on the board with every other draft and takes
              // a slot only when Ivan gives it one.
              title: isNewsjack ? `Write this one for ${where}?` : `Post to ${where}?`,
              message: isNewsjack
                ? 'Writes the post now and drops it in the buffer for review. Nothing is scheduled and nothing already in the queue moves.'
                : isBallot
                  ? 'Goes out under your own name in about 5 minutes. Davorin sees it from you, not from the app.'
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
            : slackDiscardLine(draft.slack_channel),
    confirmText: 'Discard',
    danger: true,
  }

  // The same sentence the RISE card's close-only primary confirms with, read
  // twice here too: the sheet fires it and the foot prints it as the button's
  // consequence before the click.
  const handledConfirm = {
    title: 'Mark this handled?',
    message: 'Nothing is posted. The card clears and you stop being reminded about this comment.',
    confirmText: 'Mark handled',
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
      try { await approveOpsDraft(draft.id, body, draft.kind); refresh() }
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
    if (isWeekly) {
      const ok = await confirm(approveConfirm)
      if (!ok) return
      setBusy(true); setError('')
      try {
        if (weeklyDispatches) {
          // A sender is watching for approved_at with sent_at still null, so
          // stamp approved_at ALONE and let it post. Stamping both is what
          // silently swallowed the 0830 ARCH report (2026-09-07).
          await approveOpsDraft(draft.id, body, draft.kind)
        } else {
          // No sender for this shape: approving IS the send. Copy first, so a
          // blocked clipboard leaves the card put and the message recoverable
          // from the textarea.
          await navigator.clipboard.writeText(body)
          await approveWeeklyReport(draft.id, body)
        }
        refresh()
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    const ok = await confirm(approveConfirm)
    if (!ok) return
    setBusy(true); setError('')
    try { await approveOpsDraft(draft.id, body, draft.kind); refresh() }
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
    setDrafting(true); setError(''); setRefusal([]); setBusyNote('')
    try {
      let out = await generateCommentDraft(draft.id, draft.client_id)
      for (let n = 0; !out.drafted && !out.transient && out.can_continue && n < DRAFT_CONTINUE_MAX; n++) {
        setRefusal([out.why?.[0] ?? 'Still working…'])
        out = await generateCommentDraft(draft.id, draft.client_id)
      }
      if (out.transient) {
        // Nothing was written and nothing was judged, so the card says exactly
        // that and keeps every action it had.
        setRefusal([])
        setBusyNote(DRAFTER_BUSY)
      } else if (out.drafted && out.draft) {
        setRefusal([])
        setBody(out.draft)
        refresh()
      } else if (isArchComment) {
        // The ARCH drafter's "no draft" is a VERDICT, not a gate failure: it wrote
        // its outcome, reason and sources to the row, so the card re-reads the row
        // and renders them instead of printing a refusal it did not make.
        setRefusal([])
        refresh()
      } else {
        setRefusal(out.why?.length ? out.why : ['No draft survived the voice gates. Write this one yourself.'])
        if (out.reason === 'already_answered') refresh()
      }
    } catch (e) { setError(errText(e)) }
    finally { setDrafting(false) }
  }

  // "This one wants Davorin." Nothing is sent and nothing is closed — the row is
  // stamped, the card keeps its place in the queue, and the chip says why it is
  // still sitting there. The write's own error is read and shown: a chip painted
  // over a refused update would be the card lying about a database row.
  async function onNeedsDavor() {
    if (busy || needsDavor) return
    setBusy(true); setError('')
    try {
      await markNeedsDavor(draft)
      setDavorNow(true)
      refresh()
    } catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  // The close-only path the RISE card reaches through its primary. On an ARCH
  // card it is its own quiet button, because the primary stays "Approve & post".
  async function onMarkHandled() {
    const ok = await confirm(handledConfirm)
    if (!ok) return
    setBusy(true); setError('')
    try { await markCommentHandled(draft.id); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
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
      await discardOpsDraft(draft.id, draft.kind); refresh()
    }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  // The one note that rides under the editor, exactly as the card said it.
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
            // Before the drafter has answered, the note is an instruction AND a
            // boundary: it drafts from Davorin's public record only, and when the
            // record does not cover the question it says so instead of inventing
            // him an opinion. Once it HAS answered, the verdict block above the
            // editor carries the reason and this stops repeating the invitation.
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

  const foot = (
    <div className="a-ops-decide">
      {error && <div className="a-ops-err a-meta">{error}</div>}
      {/* The drafter never ran. It reads as neither red nor refused, because it
          was neither: pressing again is the whole fix. */}
      {busyNote && <div className="a-ops-note a-meta">{busyNote}</div>}
      {/* If the Draft it button is gone, its refusal still belongs on the card. */}
      {!canDraft && refusal.length > 0 && (
        <div className="a-ops-refused a-meta">Refused: {refusal.join(' · ')}</div>
      )}
      <div className="a-ops-acts">
        <div className="a-ops-act">
          {/* ai-approval: the decline is OUTLINED danger, not a quiet
              sibling. It is the one action on the card that cannot be undone
              from here, and its consequence caption sits under it. */}
          <Button variant="danger" disabled={busy || drafting} onClick={onDiscard}>Discard</Button>
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
        {/* ARCH only. Two quiet siblings for the two exits that post nothing, so
            the primary can stay the one act that publishes. */}
        {isArchComment && (
          <div className="a-ops-act">
            <Button variant="quiet" disabled={busy || drafting || needsDavor} onClick={onNeedsDavor}>
              {needsDavor ? 'Waiting on Davorin' : 'Needs Davor'}
            </Button>
            <span className="a-ops-cons a-meta">
              Nothing is posted and nothing closes. The card stays here, marked as waiting on Davorin.
            </span>
          </div>
        )}
        {isArchComment && (
          <div className="a-ops-act">
            <Button variant="quiet" disabled={busy || drafting} onClick={onMarkHandled}>Mark handled</Button>
            <span className="a-ops-cons a-meta">{handledConfirm.message}</span>
          </div>
        )}
        <div className="a-ops-act a-ops-act-p">
          {/* On an ARCH card the primary publishes or it does nothing: with an
              empty editor there is no reply to post, so it is disabled rather
              than quietly becoming a close button. */}
          <Button
            variant="primary"
            busy={busy}
            disabled={drafting || (isArchComment && !body.trim())}
            onClick={onApprove}
          >{approveLabel}</Button>
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
      foot={heldVerdict ? undefined : foot}
      pad
    >
      <div className="a-stack" data-tight>
        <ContextBlock draft={draft} />
        {/* The ARCH verdict, read in the order the operator decides in: what the
            drafter did, why, what a draft rests on, and what it read. The three
            outcomes that leave the editor empty are ANSWERS — printing them is
            what stops an empty box reading as a drafter that failed. */}
        {isArchComment && (archOut || needsDavor) && (
          <div className="a-ops-arch">
            <div className="a-ops-tags">
              {archOut && (
                <Chip tone={archOut === 'DRAFT' ? 'clear' : archOut === 'ESCALATE' ? 'attention' : 'neutral'}>
                  {archOutcomeLabel(archOut)}
                </Chip>
              )}
              {needsDavor && <Chip tone="attention">waiting on Davorin</Chip>}
            </div>
            {/* Ivan 2026-09-17: the reasoning crowded out the comment and the reply box.
                The chip says the verdict; the why, the check-first note and the sources
                open on a tap. */}
            {(archReason || archSrc.length > 0) && (
              <details className="a-ops-arch-more">
                <summary className="a-meta">Why, and what it read</summary>
              {archReason && <div className="a-ops-arch-why a-meta">{archReason}</div>}
              {/* Only a DRAFT rests on something: the published line it answers
                  from. The other three outcomes exist because nothing does. */}
              {archOut === 'DRAFT' && archBasis && (
                <div className="a-ops-arch-why a-meta">Rests on: {archBasis}</div>
              )}
              {typeof draft.context?.arch_caution === 'string' && draft.context.arch_caution && (
                <div className="a-ops-arch-why a-meta">Starting draft, check first: {draft.context.arch_caution}</div>
              )}
              {archSrc.length > 0 && (
                <div className="a-ops-arch-src">
                  <div className="a-meta">Sources</div>
                  <ul className="a-ops-srcs">
                    {archSrc.map(s => (
                      <li key={s.id}>
                        <span>{s.title}</span>
                        <Sep />
                        <span className="a-meta">{s.source_type}</span>
                        <Sep />
                        {/* A private source informed the read and may never be
                            quoted back at the commenter. The card says which. */}
                        <span className="a-meta">{s.public ? 'public' : 'private, context only'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              </details>
            )}
          </div>
        )}
        <Textarea
          label="Draft"
          labelHidden
          className="a-ops-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          disabled={busy || drafting}
          // An ARCH card whose verdict is "he answers this one" is not waiting on
          // a draft, so nothing in the box invites one.
          placeholder={canDraft && !(isArchComment && archOut && archOut !== 'DRAFT') ? 'Write his reply, or press Draft it.' : undefined}
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
        {/* An accept the gate parked: approved, but the lane is switched off,
            so nothing posts. Amber, never the green of a send, and the gate's
            own sentence stays readable under it. */}
        {heldVerdict && (
          <Banner tone="attention" icon="pause" title={GATE_HELD_LABEL}>
            <span title={heldVerdict.message}>{heldVerdict.message}</span>
          </Banner>
        )}
        {postState === 'queued' && !heldVerdict && (
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
