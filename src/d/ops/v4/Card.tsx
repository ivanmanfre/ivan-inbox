import { useCallback, useState, type ComponentProps } from 'react'
import { Avatar } from '../../../ds/Avatar'
import { Banner } from '../../../ds/Banner'
import { Chip } from '../../../ds/Chip'
import { Preview } from './Preview'
import { CardMore } from './More'
import { captions, OpsCard, useCardConfirm } from '../Card'
import type { ConfirmOpts as OldConfirmOpts } from '../../../lib/confirm'
import { GATE_HELD_LABEL } from '../../../lib/ops'
import { usePendingCard } from '../../../wb/ops/usePendingCard'
import { seatOf, SEAT_NAME } from '../../seats'
import { Key } from '../../ui/Key'
import { warsawDayTime } from '../../ui/time'
import { CardContext, tapeLabel } from '../CardContext'
import { ArchWhy } from '../ArchWhy'
import { kindTitle, rowLine } from '../model'
import { formatBookingForSlack } from '../../../wb/ops/slackFormat.js'
import { renderMrkdwn } from '../../../wb/ops/slackPreview'

// THE OPEN CARD. One design for every kind: a mono head line, the context
// (left on desktop), the draft box, the note, and at most four hardware keys
// right under the content (never pinned to the viewport), each with its
// consequence under it. Comment replies put their secondary verbs behind More.
// All state and writes: usePendingCard (shared with today's card).

export function CardV4({ d, refresh, feed, held, onGateResult, layout, pos, waitingLine, onActed, previous, next }: ComponentProps<typeof OpsCard> & {
  onActed?: (id: string, verb: string) => void; previous?: () => void; next?: () => void
}) {
  const ask = useCardConfirm()
  const confirm = useCallback(async (o: OldConfirmOpts) => {
    const ok = await ask(o)
    if (ok) onActed?.(d.id, o.danger ? 'Discarded' : o.confirmText === 'Mark handled' ? 'Marked handled' : 'Approved')
    return ok
  }, [ask, d.id, onActed])
  const st = usePendingCard({ draft: d, refresh, feed, held, onGateResult, confirm })
  const [more, setMore] = useState(false)
  // Booking cards read as the Slack message they become (Ivan 2026-09-27: "I want
  // to see it formatted"). Tap the message to edit the text; leave the box and
  // it reads formatted again. Same formatter the Slack sender runs.
  const [editing, setEditing] = useState(false)
  const [whole, setWhole] = useState(false)
  const formatted = d.kind === 'booking' && !editing
  const seat = seatOf(d.client_id)
  const laneName = seat ? SEAT_NAME[seat] : d.client_id
  const who = rowLine(d).who
  const initials = who.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()
  const excerptKey = st.isOutbound ? 'post_excerpt' : st.isComment ? 'comment_text' : null
  const excerpt = excerptKey ? String(d.context?.[excerptKey] ?? '') : ''
  const displayDraft = /(?:volume lane|\bmode\s*\d+|contentless)/i.test(String(d.context?.target_headline ?? '')) ? { ...d, context: { ...d.context, target_headline: '' } } : d
  const context = excerptKey && excerpt && !/[.!?…]$/.test(excerpt.trim()) ? { ...displayDraft, context: { ...displayDraft.context, [excerptKey]: excerpt.trimEnd() + '…' } } : displayDraft
  const contextLabel = st.isOutbound ? 'Their post' : st.isComment ? 'Their comment' : d.kind === 'newsjack' ? 'The story' : d.kind === 'weekly_report' ? 'The week' : d.kind === 'booking' || d.kind === 'precall_email' ? 'The call' : 'The person'
  const left = st.left
  const cap = captions(d, st)
  const name = String(d.context?.author_name ?? '')
  const hasComment = Boolean(d.context?.comment_id)
  // Arch comments always get More: Needs Davor and Mark handled need no comment_id (today's card).
  const withMore = st.isComment && (hasComment || st.isArchComment)
  const off = st.busy || st.drafting
  const primaryOff = st.drafting || (st.isArchComment && !st.body.trim())
  return (
    <section className={`op-card op-card-${layout}`} data-card={d.id} data-kind={d.kind} data-busy={st.busy || st.drafting || undefined}>
      <header className="op-ch op4-head" data-op-block>
        <Avatar name={who} initials={initials} tint={seat === 'ivan' ? 1 : seat === 'risedtc' ? 2 : seat === 'arch' ? 3 : 4} />
        <div className="op4-identity"><b>{who}</b><div><span className="op-eb">{kindTitle(d)}</span><span className="op4-lane"> · {laneName}</span></div></div>
        <div className="op4-headmeta" title={`Drafted ${warsawDayTime(d.created_at)}`}>
          {d.context?.posted_at && <time>posted {rowLine(d).time}</time>}
          <span>{laneName} · {pos.replace('card ', '')}{left && <> · <b className="op-hot">{left}</b></>}</span>
        </div>
        <div className="op4-nav">
          <button type="button" className="d-ib" aria-label="Previous card (k)" disabled={!previous} onClick={previous}>‹</button>
          <button type="button" className="d-ib" aria-label="Next card (j)" disabled={!next} onClick={next}>›</button>
        </div>
      </header>
      <div className="op-cb">
        <div className={`op-ctx op4-context${whole ? ' op4-whole' : ''}`} data-op-block>
          <div className="op4-label">{contextLabel}</div>
          <CardContext d={context} liked={st.liked} needsDavor={st.needsDavor} />
          {layout === 'phone' && excerpt && <button className="d-btn" type="button" aria-expanded={whole} onClick={() => setWhole(w => !w)}>{whole ? 'Show less' : 'Show the whole post'}</button>}
          <ArchWhy st={st} />
        </div>
        <div className="op-rep" data-op-block>
          <label className={`op-tape${st.drafting ? " op4-drafting" : ""}`}>
            <span className="op-tm"><span>{tapeLabel(d)}</span></span>
            {formatted ? (
              <div
                className="op-slack" role="button" tabIndex={0} title="Tap to edit the text"
                onClick={e => { if (!(e.target as HTMLElement).closest('a') && !off) setEditing(true) }}
                onKeyDown={e => { if (e.key === 'Enter' && !off) setEditing(true) }}
              >{renderMrkdwn(formatBookingForSlack(st.body, d.context))}</div>
            ) : (
            <textarea
              value={st.body} rows={Math.min(12, Math.max(3, st.body.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (layout === 'phone' ? 36 : 48))), 0)))} disabled={off} aria-label={tapeLabel(d)}
              autoFocus={d.kind === 'booking'}
              onBlur={d.kind === 'booking' ? () => setEditing(false) : undefined}
              onKeyDown={e => {
                if (document.querySelector('.d-confirm, .d-sheet, .d-palette')) return
                if (e.key === 'Escape') e.currentTarget.blur()
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !off && !primaryOff) { e.preventDefault(); void st.onApprove() }
              }}
              onChange={e => st.setBody(e.target.value)}
              placeholder={st.canDraft && !(st.isArchComment && st.archOut && st.archOut !== 'DRAFT') ? 'Write his reply, or press Draft it.' : 'Empty.'}
            />
            )}
          </label>
          {st.canTag && !st.isCloseOnly && st.tag && st.tagMayFail && <div className="op-note op-warn" data-tag-warn>@ tags {st.commenterName}: may not stick, hidden surname.</div>}
          <Preview d={d} st={st} />
          {st.canTagAuthor && <div data-verb="tag" className="op4-tag" aria-disabled={off} onClick={e => { if (e.target === e.currentTarget && !off) st.setTag(t => !t) }}>
            <Chip className="op-tagline" selected={st.tag} tone={st.tag ? 'accent' : 'neutral'} onClick={() => { if (!off) st.setTag(t => !t) }}>
              {st.tag ? `● Tag ${st.authorName}` : '○ No tag'}
            </Chip>
            {st.tag && st.authorTagMayFail && <small>may not stick, hidden surname</small>}
          </div>}
          {st.editorNote && <Banner className="op4-editornote" tone={st.onDemand || st.isCloseOnly ? 'attention' : 'neutral'}>{st.editorNote}</Banner>}
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
            <div className={`op-keys${off ? " op4-busy" : ""}`} data-op-block>
              <div className="op-k">
                <Key verb="discard" disabled={off} onClick={() => void st.onDiscard()} title={st.discardConfirm.message}>Discard</Key><small>{cap.discard}</small>
              </div>
              {st.canDraft && (
                <div className="op-k">
                  <Key verb="draft" disabled={st.busy || st.drafting} onClick={() => void st.onGenerate()} title="Fills the box.">{st.drafting ? 'Writing…' : 'Draft it'}</Key><small>Fills the box.</small>
                </div>
              )}
              {withMore && (
                <div className="op-k">
                  <Key verb="more" aria-expanded={more} onClick={() => setMore(m => !m)} title={st.isArchComment ? (hasComment ? 'Like, tag, Davor, handled' : 'Davor, handled') : 'Like, tag, emoji'}>More</Key><small>{st.isArchComment ? (hasComment ? 'Like, tag, Davor, handled' : 'Davor, handled') : 'Like, tag, emoji'}</small>
                  <CardMore st={st} name={name} layout={layout} open={more} onClose={() => setMore(false)} hasComment={hasComment} />
                </div>
              )}
              <div className="op-k op-kp">
                <Key primary verb={st.commentCloseOnly ? 'mark-handled' : 'approve'} disabled={primaryOff || st.busy} onClick={() => void st.onApprove()} title={cap.approve}>{st.approveLabel}</Key><small>{cap.approve}</small>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
