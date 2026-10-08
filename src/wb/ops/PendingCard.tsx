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
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  archOutcomeLabel, GATE_HELD_LABEL, personHeadline, type OpsDraft, type OpsKind, type GateVerdict, type FeedState,
} from '../../lib/ops'
import { usePendingCard } from './usePendingCard'
import { Banner, Button, Chip, Textarea } from '../../ds'
import { Group, KV, Sep } from '../kit'
import './ops.css'
import { ConversationTakeoverCard } from './ConversationTakeoverCard'
import { formatBookingForSlack } from './slackFormat.js'
import { renderMrkdwn } from './slackPreview'

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
    // Who, when and the brief are in the Slack preview under this block
    // (2026-09-27), so only the rows that never reach Slack stay here.
    const rows: Array<[React.ReactNode, React.ReactNode]> = []
    if (ctx.booked_note) rows.push(['Note', ctx.booked_note])
    if (ctx.hubspot_url) rows.push(['Record', <Link href={ctx.hubspot_url}>HubSpot</Link>])
    return (
      <>
        {rows.length > 0 && <KV rows={rows} />}
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
      ['Who', [ctx.target_name, personHeadline(ctx.target_headline)].filter(Boolean).join(' · ')],
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
  // Every state, confirm sentence and write lives in usePendingCard, shared
  // with the D Ops card so there is one approve path for both frames.
  const confirm = useConfirm()
  const {
    body, setBody, busy, drafting, tag, setTag, liking, liked, needsDavor, busyNote, refusal, error, gate,
    postState, heldVerdict, isCloseOnly, isComment, isArchComment, canDraft, canTag, commenterName, tagMayFail,
    archOut, archReason, archBasis, archSrc, where, left,
    approveConfirm, discardConfirm, handledConfirm, editorNote, approveLabel,
    onApprove, onLike, onGenerate, onNeedsDavor, onMarkHandled, onDiscard,
  } = usePendingCard({ draft, refresh, feed, held, onGateResult, confirm })

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
        {draft.kind === 'booking' ? (
          <>
            {/* Ivan 2026-09-27: "I want to see it formatted". The card reads the
                way the channel will, through the same formatter the Slack
                sender runs; the raw text stays one tap away. */}
            <div className="a-slack-preview">{renderMrkdwn(formatBookingForSlack(body, draft.context))}</div>
            <details className="a-ops-edit">
              <summary className="a-meta">Edit the text</summary>
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
            </details>
          </>
        ) : (
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
        )}
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
