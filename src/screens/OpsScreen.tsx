import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../components/ConfirmSheet'
import { OpsSkeleton } from '../components/Skeleton'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useOps } from '../hooks/useOps'
import {
  approveOpsDraft, approveWeeklyReport, blockedOps, canGenerateDraft, canTagCommenter, isCloseOnlyComment, claimingOps, discardOpsDraft, engineLabel, expiresIn, generateCommentDraft, likeComment, markCommentHandled, outboundApproveUrl, outboundSkipUrl, pendingOps, postCommentReply, seatLabel, sentOps,
  dispatchCommentGate, cardStateOf,
  completeTask, doneTodayTasks, dueLabel, isTaskKind, pendingTasks, taskDetails, taskDue, taskSource, taskTitle,
  type OpsDraft, type OpsKind, type GateVerdict, type FeedState,
} from '../lib/ops'
import { checkedPhrase } from '../lib/today'
import { label } from '../lib/labels'

function slotText(iso?: string): string {
  if (!iso) return ''
  return iso.replace('T', ' ').slice(0, 16) + ' UTC'
}

function timeAgo(iso: string): string {
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

// 'OUTBOUND' said what the ENGINE calls the lane, not what the card is. Ivan
// reads these as comments, so they say Comments; `comment_reply` becomes REPLY
// in the same pass so the two comment kinds cannot be told apart by an S.
const KIND_LABEL: Record<OpsKind, string> = { escalation: 'ESC', update: 'UPDATE', newsjack: 'NEWSJACK', weekly_report: 'WEEKLY', comment_reply: 'REPLY', comment_outbound: 'COMMENTS', booking: 'BOOKED', precall_email: 'PRE-CALL', manual_invite: 'INVITE', task: 'TASK' }
// Escalations run warm/red (something needs attention); updates stay neutral/blue (fyi);
// newsjack runs amber because it is the only kind with a clock on it. Booking takes the
// Rise accent gold: it is the only card that reports money arriving rather than work owed.
// A task runs neutral grey: it is the only card that asks for nothing to be sent,
// so it should not compete for attention with the kinds that publish.
const KIND_COLOR: Record<OpsKind, string> = { escalation: '#FF453A', update: '#0A84FF', newsjack: '#FF9F0A', weekly_report: '#30D158', comment_reply: '#BF5AF2', comment_outbound: '#64D2FF', booking: '#FFD60A', precall_email: '#5E5CE6', manual_invite: '#66D4CF', task: '#8E8E93' }

// Slack channel ids are unreadable on a card. escalation/update/booking all print a
// destination, so name the ones we own and fall back to the raw id for anything else.
const CHANNEL_NAME: Record<string, string> = { C0BJ72F58BY: 'the Rise DTC channel' }
function channelLabel(id: string): string {
  return CHANNEL_NAME[id] ?? `#${id}`
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Whatever the context jsonb carries worth surfacing inline: who this is about
// (escalations) or what already happened (update receipts), plus a replay tag.
function ContextLine({ draft }: { draft: OpsDraft }) {
  const ctx = draft.context
  if (!ctx) return null
  if (draft.kind === 'newsjack') {
    if (!ctx.headline) return null
    return (
      <div className="ops-ctx">
        {ctx.source_url
          ? <a className="ops-link" href={ctx.source_url} target="_blank" rel="noreferrer">{ctx.headline}</a>
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
      <div className="ops-ctx">
        {ctx.week && <span>week of {ctx.week}</span>}
        {parts.length > 0 && <span>{parts.join(' · ')}</span>}
        {ctx.report_url && (
          <a className="ops-link" href={ctx.report_url} target="_blank" rel="noreferrer">read the page</a>
        )}
      </div>
    )
  }
  // A pre-call reminder is read the same way: who it emails and when the call is.
  if (draft.kind === 'precall_email') {
    const when = ctx.call_time ? new Date(ctx.call_time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
    return (
      <div className="ops-ctx">
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
      <div className="ops-ctx">
        <span>{[ctx.prospect_name, ctx.company || ctx.domain].filter(Boolean).join(' · ')}</span>
        {ctx.when_str && <span>{ctx.when_str}</span>}
        {ctx.booked_note && <span>{ctx.booked_note}</span>}
        {ctx.matched_prospect === false && (
          <span className="ops-replay">no lane history, check before claiming outbound</span>
        )}
        {ctx.brief_url && (
          <a className="ops-link" href={ctx.brief_url} target="_blank" rel="noreferrer">read the brief</a>
        )}
        {ctx.hubspot_url && (
          <a className="ops-link" href={ctx.hubspot_url} target="_blank" rel="noreferrer">HubSpot</a>
        )}
      </div>
    )
  }
  // A manual-invite card is a to-do, not a draft: Mattan hand-sent a calendar
  // invite to a matched prospect, which can never auto-attribute (calendar invites
  // bypass the booking page). The evidence line is what goes into the verdict row.
  if (draft.kind === 'manual_invite') {
    return (
      <div className="ops-ctx">
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
      <div className="ops-ctx">
        <span>{[ctx.author_name, ctx.author_headline].filter(Boolean).join(' · ')}</span>
        {ctx.comment_text && <span>&ldquo;{ctx.comment_text}&rdquo;</span>}
        {ctx.category && <span className="ops-replay">{ctx.category}</span>}
        {ctx.post_url && (
          <a className="ops-link" href={ctx.post_url} target="_blank" rel="noreferrer">open the post</a>
        )}
      </div>
    )
  }
  // Outbound: whose post we are commenting on, the line the draft reacts to, and
  // the post itself. The draft below is unjudgeable without the excerpt.
  if (draft.kind === 'comment_outbound') {
    return (
      <div className="ops-ctx">
        <span>{[ctx.target_name, ctx.target_headline].filter(Boolean).join(' · ')}</span>
        {ctx.post_excerpt && <span>&ldquo;{ctx.post_excerpt}&rdquo;</span>}
        {ctx.hook && <span className="ops-replay">{ctx.hook}</span>}
        {ctx.post_url && (
          <a className="ops-link" href={ctx.post_url} target="_blank" rel="noreferrer">open the post</a>
        )}
      </div>
    )
  }
  const who = draft.kind === 'escalation'
    ? [ctx.prospect_name, ctx.company].filter(Boolean).join(' · ')
    : ''
  const receipts = draft.kind === 'update' && Array.isArray(ctx.receipts) ? ctx.receipts : []
  if (!who && receipts.length === 0 && ctx.replay !== true) return null
  return (
    <div className="ops-ctx">
      {who && <span>{who}</span>}
      {receipts.length > 0 && <span>{receipts.join(', ')}</span>}
      {ctx.replay === true && <span className="ops-replay">replay</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// THE TASK LIST (UX v2, 2026-08-30)
// ---------------------------------------------------------------------------
//
// 2026-08-29, Ivan, on the task card shipped the day before: "u made it a shitty
// text dude make it a more crm thing with thick or something... better
// functioning". "thick" is tick. He is right about the diagnosis: a task was
// riding PendingCard, which is a DRAFT card — a 137px-tall textarea, a hint
// line, and two full-width buttons, all of which exist because a draft is
// something you read and edit before it is SENT. A task is never sent. Wearing
// that card, one line of to-do rendered as a wall of chrome.
//
// So tasks leave the card and become a LIST: one row each, a circle on the
// left, the title in one line, the rest quiet underneath.
//
// The two interactions are deliberately asymmetric, which is the app's existing
// rule and not a new one (see onLike: "a like is the smallest public act this
// app performs" — no sheet; see onDiscard — sheet, danger):
//   TICK is SAFE and INSTANT. Nothing is sent, nothing is public, and the row
//   is still readable in "Done today" underneath. A confirm sheet on it would
//   cost two taps to do the one thing this list exists for.
//   REMOVE is DESTRUCTIVE and keeps its sheet. A removed task is invisible on
//   every group of the board, so the sheet is the only thing between a
//   mis-tap and a task he never sees again.

const TICK_LEAVE_MS = 420

function Tick({ on, onClick, label }: { on: boolean; onClick?: () => void; label?: string }) {
  return (
    <div
      className={`task-tick${on ? ' on' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 12.5 10 17l8.5-9.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function TaskRow({ draft, refresh, onLeaving }: {
  draft: OpsDraft
  refresh: () => void
  onLeaving: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Painted the moment he taps, before the write returns. It is reverted if the
  // write fails, so an optimistic tick can never leave a task looking handled
  // when the row was not stamped.
  const [ticked, setTicked] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  const title = taskTitle(draft.body)
  const details = taskDetails(draft.body)
  const due = taskDue(draft)
  const dl = due ? dueLabel(due) : null
  const src = taskSource(draft)

  async function onTick() {
    if (busy || ticked) return
    setBusy(true); setError(''); setTicked(true)
    try {
      await completeTask(draft)
      // The row plays its strike-through and fade where it stands, THEN the
      // queue is re-read. Refreshing immediately would yank it mid-animation
      // and the tick would read as the row simply vanishing.
      onLeaving()
    } catch (e) {
      setTicked(false)
      setError(errText(e))
    } finally { setBusy(false) }
  }

  async function onRemove() {
    const ok = await confirm({
      title: 'Remove this task?',
      message: 'It comes off the board for good. Nothing else happens.',
      confirmText: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await discardOpsDraft(draft.id); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className={`task-r${ticked ? ' done' : ''}`} data-ops-id={draft.id}>
      <Tick on={ticked} onClick={onTick} label={`Mark done: ${title}`} />
      <div className="task-mid">
        <div
          className="task-t"
          onClick={details ? () => setOpen(o => !o) : undefined}
        >
          {title}
        </div>
        {details && (
          <div
            className={`task-d${open ? ' open' : ''}`}
            onClick={() => setOpen(o => !o)}
          >
            {details}
          </div>
        )}
        <div className="task-meta">
          {dl && <span className={`task-chip due ${dl.tone}`}>due {dl.text}</span>}
          {src && <span className="task-chip">{src}</span>}
          <span className="task-chip q">{timeAgo(draft.created_at)}</span>
        </div>
        {error && <div className="ops-err">{error}</div>}
      </div>
      <div
        className="task-x"
        onClick={busy ? undefined : onRemove}
        role="button"
        aria-label={`Remove: ${title}`}
      >
        ✕
      </div>
    </div>
  )
}

// Exported for the same reason PendingCard is: the workbench owns the FRAME,
// this owns what a task IS. `flush` turns off the inline gutters for a host
// that already has its own.
export function TaskList({ drafts, refresh, flush = false }: {
  drafts: OpsDraft[]
  refresh: () => void
  flush?: boolean
}) {
  // Ids that have been ticked and are playing out. They are held here rather
  // than in the row so the delayed refresh survives the row unmounting.
  const [doneOpen, setDoneOpen] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const tasks = pendingTasks(drafts)
  const doneToday = doneTodayTasks(drafts)
  if (tasks.length === 0 && doneToday.length === 0) return null

  const leaveThen = () => {
    timers.current.push(setTimeout(refresh, TICK_LEAVE_MS))
  }

  return (
    <div className={`task-sec${flush ? ' flush' : ''}`}>
      {tasks.length > 0 && (
        <div className="task-hdr">Your list · {tasks.length}</div>
      )}
      {tasks.map(d => (
        <TaskRow key={d.id} draft={d} refresh={refresh} onLeaving={leaveThen} />
      ))}
      {doneToday.length > 0 && (
        <>
          <div className="task-donehdr" onClick={() => setDoneOpen(o => !o)}>
            <span>Done today · {doneToday.length}</span>
            <span className="chev">{doneOpen ? '⌄' : '›'}</span>
          </div>
          {doneOpen && doneToday.map(d => (
            <div className="task-r done static" key={d.id} data-ops-id={d.id}>
              <Tick on />
              <div className="task-mid">
                <div className="task-t">{taskTitle(d.body)}</div>
              </div>
              <span className="task-tm">{timeAgo(d.sent_at!)}</span>
            </div>
          ))}
        </>
      )}
    </div>
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
        message: approveUrl
          ? 'The poster’s rate caps, cooldown and jitter still decide. You get their answer on the card — no new tab.'
          : 'Nothing is posted by the system. The comment goes to your clipboard - paste it under the post from Mattan’s seat.',
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
      const ok = await confirm({
        title: isCloseOnly ? 'Mark this handled?' : `Post this reply as ${where}?`,
        message: isCloseOnly
          ? 'Nothing is posted. The card clears and you stop being reminded about this comment.'
          : `Goes live on LinkedIn under their comment, from the client seat.${tag && canTag && commenterName ? ` Tags ${commenterName} so they get the notification, like a native reply.` : ''}${liked ? '' : ' Their comment gets a like too.'} Checks first that they have not already been answered.`,
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
        message: 'Sends by email from im@ivanmanfredi.com within about 5 minutes. Edits you made above go out as written.',
        confirmText: 'Approve & send',
      })
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
      const ok = await confirm({
        title: 'Mark this attribution handled?',
        message: 'Nothing is sent. Close this once the booking is stamped in booking_attributions + call_booked_at.',
        confirmText: 'Mark handled',
      })
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
      const ok = await confirm({
        title: 'Copy the message and close this?',
        message: 'Nothing is sent to the client. The message goes to your clipboard and the card clears.',
        confirmText: 'Approve & copy',
      })
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
    const ok = await confirm({
      // 2026-08-06, Ivan: "make newsjack not autojump at first, just add to buffer
      // in mattan panel bc i wanna see and approve first". Approving writes the post
      // and stops: it lands in review on the board with every other draft and takes
      // a slot only when Ivan gives it one.
      title: isNewsjack ? `Write this one for ${where}?` : `Post to ${where}?`,
      message: isNewsjack
        ? 'Writes the post now and drops it in the buffer for review. Nothing is scheduled and nothing already in the queue moves.'
        : 'The dispatcher posts this to Slack within about 2 minutes.',
      confirmText: isNewsjack ? 'Approve & draft' : 'Approve & send',
    })
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
  // Takes ~10s (three candidates, every gate on all of them), so the button
  // carries the wait instead of a toast.
  async function onGenerate() {
    setDrafting(true); setError(''); setRefusal([])
    try {
      const out = await generateCommentDraft(draft.id)
      if (out.drafted && out.draft) {
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

  return (
    <div className="ops-card" data-ops-id={draft.id}>
      <div className="ops-h">
        <span
          className="ops-kind"
          style={{ background: `${KIND_COLOR[draft.kind]}22`, color: KIND_COLOR[draft.kind] }}
        >
          {KIND_LABEL[draft.kind]}
        </span>
        <span className="ops-chan">{where}</span>
        {left && <span className="ops-replay">{left}</span>}
        <span className="ops-tm">{timeAgo(draft.created_at)}</span>
      </div>
      <ContextLine draft={draft} />
      <textarea
        className="ops-body"
        value={body}
        onChange={e => setBody(e.target.value)}
        disabled={busy || drafting}
        placeholder={canDraft ? 'Write his reply, or press Draft it.' : undefined}
      />
      {isNewsjack && <div className="ops-ctx">Angle the post gets written from, edit before approving.</div>}
      {isWeekly && <div className="ops-ctx">Read the page first. Edit this message, then copy it and send it yourself.</div>}
      {isComment && (
        <div className="ops-ctx">
          {isCloseOnly
            ? (draft.client_id === 'arch'
              ? 'No draft on purpose: this one wants Davorin in his own words. No ARCH drafter exists yet, so write it by hand in his register. Type above and the button posts it.'
              : 'No draft on purpose: this one wants Mattan in his own words. Type above and the button posts it, or press Draft it for a starting point.')
            : isEscalatedComment
              ? 'Your own words. Approve posts this live under their comment.'
              : onDemand
              ? 'Drafted on request, so this category never passed the auto gate. Read every word before you post it.'
              : 'Edit it first. Approve posts it live under their comment.'}
        </div>
      )}
      {/* Comment tools (Ivan, 08-27): emoji into the draft, like their comment,
          and the tag chip. The mention itself is added server-side so the draft
          stays clean text here. */}
      {isComment && draft.context?.comment_id && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '2px 0 4px' }}>
          {['🙂', '😄', '😂', '😅', '😉', '😎', '🙌', '👏', '🤝', '🙏', '🔥', '💪', '🚀', '🎯', '💯', '✅', '⚡', '👍', '❤️', '🥂'].map(e => (
            <span
              key={e}
              style={{ cursor: 'pointer', fontSize: 17, lineHeight: '24px', opacity: busy || drafting ? 0.4 : 1 }}
              onClick={busy || drafting ? undefined : () => setBody(b => b && !b.endsWith(' ') ? `${b} ${e}` : `${b}${e}`)}
            >{e}</span>
          ))}
          <span
            onClick={liking || liked ? undefined : onLike}
            style={{
              cursor: liked ? 'default' : 'pointer', fontSize: 12, padding: '3px 9px',
              borderRadius: 20, border: '1px solid #0A84FF55',
              color: liked ? '#30D158' : '#0A84FF', marginLeft: 'auto', whiteSpace: 'nowrap',
            }}
          >
            {liked ? '👍 Liked' : liking ? 'Liking…' : '👍 Like their comment'}
          </span>
          {canTag && !isCloseOnly && (
            <span
              onClick={busy ? undefined : () => setTag(t => !t)}
              style={{
                cursor: 'pointer', fontSize: 12, padding: '3px 9px',
                borderRadius: 20, whiteSpace: 'nowrap',
                border: `1px solid ${tag ? '#BF5AF255' : '#8E8E9355'}`,
                color: tag ? '#BF5AF2' : '#8E8E93',
              }}
            >
              {tag ? (tagMayFail ? `@ tags ${commenterName} (may not stick - hidden surname)` : `@ tags ${commenterName}`) : 'no tag'}
            </span>
          )}
        </div>
      )}
      {isOutbound && (
        <div className="ops-ctx">
          {approveUrl
            ? 'A comment on their post, from your seat. Approve queues it here — caps, cooldown and jitter still decide.'
            : 'A comment on their post, from Mattan’s seat. Approve copies it - you paste it on LinkedIn yourself.'}
        </div>
      )}
      {/* Read from comment_feed, the table the poster actually writes. A card
          that painted "Queued" out of React state would keep saying it after a
          refresh even though nothing was scheduled. */}
      {postState === 'queued' && (
        <div className="ops-state ops-state-q">
          Queued — the poster has it. It posts after its jitter window unless you discard.
        </div>
      )}
      {postState === 'posted' && (
        <div className="ops-state ops-state-ok">Posted to LinkedIn.</div>
      )}
      {postState === 'failed' && (
        <div className="ops-state ops-state-bad">
          The poster could not post it{feed?.post_error ? `: ${feed.post_error}` : ''}. Still yours to act on.
        </div>
      )}
      {refusal.length > 0 && (
        <div className="ops-reason">Refused: {refusal.join(' · ')}</div>
      )}
      {/* A CLOCK refusal is not a failure — it is a queue position. The card
          says what it is waiting on and stays actionable; nothing claims it was
          sent. (The retry line lives on the host; see OpsBoard.) */}
      {gate && gate.outcome === 'timing' && (
        <div className="ops-state ops-state-wait">
          Waiting for the send window — {gate.message}
        </div>
      )}
      {error && <div className="ops-err">{error}</div>}
      <div className={canDraft ? 'ops-ac three' : 'ops-ac'}>
        <div className="btn s" onClick={busy || drafting ? undefined : onDiscard}>Discard</div>
        {canDraft && (
          <div className="btn s" onClick={busy || drafting ? undefined : onGenerate}>
            {drafting ? 'Writing…' : 'Draft it'}
          </div>
        )}
        <div className="btn p" onClick={busy || drafting ? undefined : onApprove}>
          {busy
            ? (isNewsjack ? 'Writing…' : isCloseOnly ? 'Closing…' : isComment ? 'Posting…' : isOutbound ? (approveUrl ? 'Opening…' : 'Copying…') : isWeekly ? 'Copying…' : 'Sending…')
            : (isNewsjack ? 'Approve & draft' : isCloseOnly ? 'Mark handled' : isComment ? 'Approve & post' : isOutbound ? (approveUrl ? 'Approve & queue' : 'Approve & copy') : isWeekly ? 'Approve & copy' : 'Approve & send')}
        </div>
      </div>
    </div>
  )
}

// Read-only row for the Sent/Blocked groups — same shape as the Sends log feed.
function ReadOnlyRow({ draft, reason, working }: { draft: OpsDraft; reason?: string; working?: boolean }) {
  return (
    <div className="log-r">
      <span
        className="log-chip"
        style={{ background: `${KIND_COLOR[draft.kind]}22`, color: KIND_COLOR[draft.kind] }}
      >
        {KIND_LABEL[draft.kind]}
      </span>
      <div className="log-mid">
        <div className="log-top">
          <span className="log-nm">
            {draft.slack_channel ? `#${draft.slack_channel}` : engineLabel(draft.client_id)}
          </span>
          {draft.kind === 'newsjack' && draft.context?.slot && (
            <span className="ops-chan">publishes {slotText(draft.context.slot)}</span>
          )}
          {/* The default path schedules nothing, so the row says where the post
              actually went instead of leaving a done card with no destination. */}
          {draft.kind === 'newsjack' && !draft.context?.slot && draft.context?.buffered === true && (
            <span className="ops-chan">in the buffer, waiting on you</span>
          )}
        </div>
        <div className="log-snip">{draft.body}</div>
        {working && <div className="ops-ctx">{draft.kind === 'newsjack' ? 'Writing the post…' : 'Posting…'}</div>}
        {reason && <div className="ops-reason">Blocked: {label(reason)}</div>}
      </div>
      <span className="log-tm">{timeAgo(draft.sent_at ?? draft.created_at)}</span>
    </div>
  )
}

function Section({ title, count, open, onToggle, children }: {
  title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <>
      <div className="ops-sechdr" onClick={onToggle}>
        <span>{title} · {count}</span>
        <span className="chev">{open ? '⌄' : '›'}</span>
      </div>
      {open && children}
    </>
  )
}

// The three read-only groups — what the queue already dealt with. Exported for
// the same reason PendingCard is: a host that redesigns the frame must not
// re-implement what "Working" means. `pad` lets a host that owns its own gutters
// turn off the inline 16px this screen needs.
export function OpsGroups({ drafts, pad = true, expanded = false }: {
  drafts: OpsDraft[]
  pad?: boolean
  // A host whose queue is empty has a whole region to spend and nothing waiting
  // to put in it: opening the history there is real content, not filler, and it
  // is the difference between "clear" and "dead".
  expanded?: boolean
}) {
  const [claimingOpen, setClaimingOpen] = useState(true)
  const [sentOpen, setSentOpen] = useState(expanded)
  const [blockedOpen, setBlockedOpen] = useState(expanded)
  // Tasks are excluded from all three groups: TaskList owns every state a task
  // can reach. A task cannot be `claiming` (Done double-stamps) and cannot be
  // `blocked` (no dispatcher refuses it, and an operator Remove is hidden
  // everywhere by DISCARDED_REASON), so this only affects Done — where a ticked
  // task would otherwise render twice, once here and once in "Done today", and
  // push a real send out of a group capped at ten rows.
  const rows = drafts.filter(d => !isTaskKind(d.kind))
  const claiming = claimingOps(rows)
  const sent = sentOps(rows)
  const blocked = blockedOps(rows)
  const style = pad ? { padding: '0 16px' } : undefined
  return (
    <>
      <Section title="Working" count={claiming.length} open={claimingOpen} onToggle={() => setClaimingOpen(o => !o)}>
        <div style={style}>
          {claiming.map(d => <ReadOnlyRow key={d.id} draft={d} working />)}
        </div>
      </Section>
      <Section title="Done" count={sent.length} open={sentOpen} onToggle={() => setSentOpen(o => !o)}>
        <div style={style}>
          {sent.map(d => <ReadOnlyRow key={d.id} draft={d} />)}
        </div>
      </Section>
      <Section title="Blocked" count={blocked.length} open={blockedOpen} onToggle={() => setBlockedOpen(o => !o)}>
        <div style={style}>
          {blocked.map(d => <ReadOnlyRow key={d.id} draft={d} reason={d.send_blocked_reason ?? undefined} />)}
        </div>
      </Section>
    </>
  )
}

export function OpsScreen() {
  // `error` used to be dropped on the floor here, so a failed fetch rendered the
  // identical "Nothing waiting on you." as a genuinely clear queue (U2/U3). The
  // three states are distinct now, which is also what earns the empty state the
  // right to say it is a live read.
  const { drafts, loading, error, loadedAt, refresh } = useOps()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())

  const pending = pendingOps(drafts)
  // Tasks come out of the card queue and into the list above it (TaskList reads
  // the full `drafts` itself — it also owns the "Done today" strip).
  const cards = pending.filter(d => !isTaskKind(d.kind))

  if (loading && drafts.length === 0) {
    return (
      <>
        <div className="nav">
          <div className="row-top"><h2>Ops</h2><div className="avatar-me">IM</div></div>
        </div>
        <OpsSkeleton />
      </>
    )
  }

  return (
    <>
      <div className="nav">
        <div className="row-top"><h2>Ops</h2><div className="avatar-me">IM</div></div>
      </div>
      <div className="rows ops-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {error && (
          <div className="ops-fail">
            <span className="ops-fail-d" />
            <span className="ops-fail-t">The ops queue didn’t load — {error}</span>
            <button className="stalebtn" onClick={refresh}>Try again</button>
          </div>
        )}
        <TaskList drafts={drafts} refresh={refresh} />
        {pending.length === 0 && !error ? (
          <div className="empty">
            Nothing waiting on you
            <div className="empty-f">
              <span className="empty-dot" />
              {checkedPhrase(loadedAt)}. This is a live read, not a stall.
            </div>
          </div>
        ) : cards.length === 0 ? null : (
          cards.map(d => <PendingCard key={d.id} draft={d} refresh={refresh} />)
        )}
        <OpsGroups drafts={drafts} />
      </div>
    </>
  )
}
