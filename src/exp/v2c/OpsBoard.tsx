import { useRef } from 'react'
import { OpsGroups, PendingCard } from '../../screens/OpsScreen'
import { OpsSkeleton } from '../../components/Skeleton'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { blockedOps, claimingOps, outboundFeedId, pendingOps, sentOps, type OpsDraft } from '../../lib/ops'
import { useCommentQueue } from '../../hooks/useCommentQueue'
import { CalmEmpty, Failed } from './Surface'

// Ops, designed for the canvas it actually gets.
//
// The tournament shipped Ops as the production screen dropped inside a titled
// region. That produced the two defects the panel made a must-fix regardless of
// winner: the wrapped screen's own nav rendered a SECOND "Ops" title and a second
// bare "Nothing waiting on you.", and at 1440px roughly 600px below the fold was
// dead black. A wrapper tweak cannot fix the second one — an empty queue on a
// 1240px-wide region is empty in a much louder way than on a phone.
//
// So this file owns the frame and delegates the two things the production screen
// should stay the only owner of: the approve/discard card (PendingCard) and what
// "Working / Done / Blocked" mean (OpsGroups). No second approve path exists.
//
// The region is spent on:
//   1. A STATE BAND — four counts as real numbers with a stacked bar of the same
//      four, so the queue's shape is drawn rather than described.
//   2. A FRESHNESS SIGNAL — audit finding A5: Ops could not distinguish an empty
//      queue from a stalled feed. The band says when it last heard anything, in
//      the app's existing 3 tiers, and an aging read says so in words.
//   3. TWO COLUMNS above 1000px — the queue on the left at a readable measure,
//      the read-only history on the right, so neither has to stretch to 1240px
//      and neither leaves the other's half black.

export function OpsBoard({ drafts, loading, error, loadedAt, refresh }: {
  drafts: OpsDraft[]
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, refresh)
  const pending = pendingOps(drafts)
  // The comment lane's queue lives here, not on the card: one line, one retry
  // timer, one read of comment_feed for every outbound card on screen.
  const queue = useCommentQueue(pending, refresh)
  const history = claimingOps(drafts).length + sentOps(drafts).length + blockedOps(drafts).length

  // ONE header, owned here. The wrapped screen's own nav is gone because the
  // screen is no longer wrapped — the doubled render has no code path left.
  const head = (
    <div className="nav">
      <div className="row-top">
        <h2>Ops</h2>
        <div className="avatar-me">IM</div>
      </div>
    </div>
  )

  if (error) {
    return (
      <>
        {head}
        <div className="rows ops-rows">
          <Failed
            what="The ops queue"
            message={error}
            onRetry={refresh}
            loadedAt={drafts.length > 0 ? loadedAt : null}
          />
          {/* Stale rows beat a void, but only the read-only half of them: an
              approve button over a queue we know is out of date is the U1 replay
              hazard with a nicer banner on top. */}
          {drafts.length > 0 && (
            <div className="wb-ocols one">
              <div className="wb-ocol">
                <OpsGroups drafts={drafts} pad={false} />
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  if (loading && drafts.length === 0) {
    return <>{head}<OpsSkeleton /></>
  }

  return (
    <>
      {head}
      <div className="rows ops-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {/* The state band (four count tiles + stacked bar + freshness line) was
            removed on 2026-08-04 at Ivan's word: on a queue he reads every day
            it was four numbers describing what the cards under it already show.
            The freshness claim survives where it is load-bearing — CalmEmpty
            still says when it last checked, because an empty queue and a
            stalled feed are the one pair this screen cannot tell apart on its
            own (audit A5). StateBand stays exported and unmounted. */}
        {/* Two columns only when BOTH have something to hold. A queue of zero
            beside five history rows is the column-stranding the panel marked as
            v2b's weakness (300px of black under the short column); one centered
            measure with a full-width band above it is the app's own desktop
            convention and has no hole in it. */}
        <div className={`wb-ocols${history === 0 || pending.length === 0 ? ' one' : ''}`}>
          <div className="wb-ocol wb-ocol-q">
            {pending.length === 0 ? (
              <CalmEmpty
                // The panel's best line, and it earns its place here more than
                // anywhere: this is the surface where "empty" and "broken" looked
                // identical before.
                line="Nothing waiting on you — and this is a live read, not a stall."
                loadedAt={loadedAt}
                sub="Comment replies, newsjacks, weekly reports and escalations all clear."
              />
            ) : (
              <>
              {/* The line, stated once. Ivan can approve several and leave; this
                  says what is actually happening, because the poster takes one
                  at a time and refuses the rest. */}
              {queue.waiting.length > 0 && (
                <div className={`ops-queue${queue.cappedToday ? ' capped' : ''}`}>
                  {queue.cappedToday
                    ? `${queue.waiting.length} comment${queue.waiting.length === 1 ? '' : 's'} held — the poster hit its 3-a-day cap. They stay here for tomorrow.`
                    : `${queue.waiting.length} comment${queue.waiting.length === 1 ? '' : 's'} queued here — the poster takes one at a time, so this retries the next as its window opens. Leave the tab open.`}
                </div>
              )}
              {pending.map(d => (
                <PendingCard
                  key={d.id} draft={d} refresh={refresh}
                  feed={queue.feed.get(outboundFeedId(d) ?? '')}
                  onGateResult={queue.record}
                />
              ))}
              </>
            )}
          </div>
          {history > 0 && (
            <div className="wb-ocol wb-ocol-h">
              <div className="wb-ocol-h-ttl">Already handled</div>
              <OpsGroups drafts={drafts} pad={false} expanded={pending.length === 0} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
