import { useCallback, useState } from 'react'
import type { ConfirmOpts as OldConfirmOpts } from '../../lib/confirm'
import { GATE_HELD_LABEL, type FeedState, type GateVerdict, type OpsDraft } from '../../lib/ops'
import { channelName, usePendingCard, type PendingCardState } from '../../wb/ops/usePendingCard'
import { seatOf, SEAT_NAME } from '../seats'
import { useDConfirm } from '../ui/confirm'
import { Key } from '../ui/Key'
import { warsawDayTime } from '../ui/time'
import { CardContext, tapeLabel } from './CardContext'
import { ArchWhy } from './ArchWhy'
import { More } from './More'
import { kindTitle, SEAT_PERSON } from './model'
import { formatBookingForSlack } from '../../wb/ops/slackFormat.js'
import { renderMrkdwn } from '../../wb/ops/slackPreview'

// THE OPEN CARD. One design for every kind: a mono head line, the context
// (left on desktop), the draft box, the note, and at most four hardware keys
// right under the content (never pinned to the viewport), each with its
// consequence under it. Comment replies put their secondary verbs behind More.
// All state and writes: usePendingCard (shared with today's card).

/** The D confirm sheet, spoken to in today's confirm shape. */
export function useCardConfirm() {
  const confirm = useDConfirm()
  return useCallback((o: OldConfirmOpts) => confirm({
    title: o.title, message: o.message, confirmText: o.confirmText ?? 'OK', cancelText: o.cancelText, danger: o.danger,
  }), [confirm])
}

function captions(d: OpsDraft, st: PendingCardState) {
  const seat = seatOf(d.client_id) ?? 'ivan'
  const slack = channelName(d.slack_channel) ?? 'Slack'
  switch (d.kind) {
    case 'comment_outbound': return { discard: 'The poster skips it.', approve: st.approveUrl ? 'The poster takes 3 a day, one at a time.' : 'Copied, then closed.' }
    case 'comment_reply': return {
      discard: 'It won’t be posted.',
      approve: st.commentCloseOnly ? 'Closes it, nothing is posted.' : `Posts under their comment, from ${seat === 'ivan' ? 'your' : `${SEAT_PERSON[seat]}’s`} seat.`,
    }
    case 'newsjack': return { discard: 'The story moves on without a post.', approve: 'Writes a draft into review. Nothing is scheduled.' }
    case 'weekly_report': return { discard: 'The page stays live.', approve: st.weeklyDispatches ? 'App message, then yours.' : 'Copied. Approving is the send.' }
    case 'precall_email': return { discard: 'No reminder goes out.', approve: 'Emails them from im@ within 5 minutes.' }
    case 'manual_invite': return { discard: 'Dropped. Nothing is stamped.', approve: 'You stamped the attribution by hand.' }
    case 'leads_ballot': return { discard: `Not posted to ${slack}.`, approve: 'One message, from your account.' }
    default: return { discard: `Not posted to ${slack}.`, approve: `Posts to ${slack} about 2 minutes later.` }
  }
}

export function OpsCard({ d, refresh, feed, held, onGateResult, layout, pos, waitingLine }: {
  d: OpsDraft
  refresh: () => void
  feed?: FeedState
  held?: GateVerdict
  onGateResult?: (id: string, v: GateVerdict) => void
  layout: 'desktop' | 'phone'
  /** "card 1 of 3" */
  pos: string
  /** The comment queue's line, when this card waits in it. */
  waitingLine?: string | null
}) {
  const confirm = useCardConfirm()
  const st = usePendingCard({ draft: d, refresh, feed, held, onGateResult, confirm })
  const [more, setMore] = useState(false)
  // Booking cards read as the Slack message they become (Ivan 2026-09-27: "I want
  // to see it formatted"). Tap the message to edit the text; leave the box and
  // it reads formatted again. Same formatter the Slack sender runs.
  const [editing, setEditing] = useState(false)
  const formatted = d.kind === 'booking' && !editing
  const seat = seatOf(d.client_id)
  const laneName = seat ? SEAT_NAME[seat] : d.client_id
  const left = st.left
  const cap = captions(d, st)
  const name = String(d.context?.author_name ?? '')
  const hasComment = Boolean(d.context?.comment_id)
  // Arch comments always get More: Needs Davor and Mark handled need no comment_id (today's card).
  const withMore = st.isComment && (hasComment || st.isArchComment)
  const off = st.busy || st.drafting
  const primaryOff = st.drafting || (st.isArchComment && !st.body.trim())
  return (
    <section className={`op-card op-card-${layout}`} data-card={d.id} data-kind={d.kind}>
      <header className="op-ch">
        <span className="op-eb">{kindTitle(d)}</span>
        <span className="op-ew">
          {laneName} lane{st.where && !st.isComment && !st.isOutbound && st.where !== laneName ? ` · to ${st.where}` : ''} · {warsawDayTime(d.created_at).replace(',', '')} · {pos}
          {left && <> · <b className={left === 'expired' ? '' : 'op-hot'}>{left}</b></>}
        </span>
      </header>
      <div className="op-cb">
        <div className="op-ctx"><CardContext d={d} liked={st.liked} needsDavor={st.needsDavor} /><ArchWhy st={st} /></div>
        <div className="op-rep">
          <label className="op-tape">
            <span className="op-tm"><span>{tapeLabel(d)}</span></span>
            {formatted ? (
              <div
                className="op-slack" role="button" tabIndex={0} title="Tap to edit the text"
                onClick={e => { if (!(e.target as HTMLElement).closest('a') && !off) setEditing(true) }}
                onKeyDown={e => { if (e.key === 'Enter' && !off) setEditing(true) }}
              >{renderMrkdwn(formatBookingForSlack(st.body, d.context))}</div>
            ) : (
            <textarea
              value={st.body} rows={3} disabled={off} title={st.editorNote || undefined}
              autoFocus={d.kind === 'booking'}
              onBlur={d.kind === 'booking' ? () => setEditing(false) : undefined}
              onChange={e => st.setBody(e.target.value)}
              placeholder={st.canDraft && !(st.isArchComment && st.archOut && st.archOut !== 'DRAFT') ? 'Write his reply, or press Draft it.' : 'Empty.'}
            />
            )}
          </label>
          {st.canTag && !st.isCloseOnly && st.tag && st.tagMayFail && <div className="op-note op-warn" data-tag-warn>@ tags {st.commenterName}: may not stick, hidden surname.</div>}
          {st.heldVerdict && <div className="op-ban op-ban-warn"><b>{GATE_HELD_LABEL}</b> {st.heldVerdict.message}</div>}
          {st.postState === 'queued' && !st.heldVerdict && <div className="op-ban">Queued: the poster has it. It posts after its jitter window unless you discard.</div>}
          {st.postState === 'posted' && <div className="op-ban">Posted to LinkedIn.</div>}
          {st.postState === 'failed' && <div className="op-ban op-ban-warn">The poster could not post it{feed?.post_error ? `: ${feed.post_error}` : ''}. Still yours to act on.</div>}
          {st.gate?.outcome === 'timing' && <div className="op-ban op-ban-warn">Waiting for the send window: {st.gate.message}</div>}
          {waitingLine && <div className="op-ban">{waitingLine}</div>}
          {st.error && <div className="op-err" role="alert">{st.error}</div>}
          {st.busyNote && <div className="op-note">{st.busyNote}</div>}
          {st.refusal.length > 0 && <div className="op-err">Refused: {st.refusal.join(' · ')}</div>}
          {!st.heldVerdict && (
            <div className="op-keys">
              <div className="op-k">
                <Key verb="discard" disabled={off} onClick={() => void st.onDiscard()} title={st.discardConfirm.message}>Discard</Key>
              </div>
              {st.canDraft && (
                <div className="op-k">
                  <Key verb="draft" disabled={st.busy || st.drafting} onClick={() => void st.onGenerate()} title="Fills the box.">{st.drafting ? 'Writing…' : 'Draft it'}</Key>
                </div>
              )}
              {withMore && (
                <div className="op-k">
                  <Key verb="more" aria-expanded={more} onClick={() => setMore(m => !m)} title={st.isArchComment ? (hasComment ? 'Like, tag, Davor, handled' : 'Davor, handled') : 'Like, tag, emoji'}>More</Key>
                </div>
              )}
              <div className="op-k op-kp">
                <Key primary verb={st.commentCloseOnly ? 'mark-handled' : 'approve'} disabled={primaryOff || st.busy} onClick={() => void st.onApprove()} title={cap.approve}>{st.approveLabel}</Key>
              </div>
            </div>
          )}
        </div>
      </div>
      {withMore && <More st={st} name={name} layout={layout} open={more} onClose={() => setMore(false)} hasComment={hasComment} />}
    </section>
  )
}
