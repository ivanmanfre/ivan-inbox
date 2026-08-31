import { useRef } from 'react'
import { PendingCard, TaskList } from '../../screens/OpsScreen'
import { OpsSkeleton } from '../../components/Skeleton'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { doneTodayTasks, isTaskKind, outboundFeedId, pendingOps, type OpsDraft } from '../../lib/ops'
import { useCommentQueue } from '../../hooks/useCommentQueue'
import { ReactionDesk } from './ReactionDesk'
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
// So this file owns the frame and delegates the approve/discard card to the
// production screen (PendingCard), which stays its only owner. No second approve
// path exists.
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

// WHAT OPS IS FOR, RULED 2026-08-31 (Ivan): "rn i mainly use it for
// notifications important, tasks, and approval pending items."
//
// Four blocks were cut the same day for failing that test, named here so nobody
// rebuilds them thinking they were an oversight:
//   * Content pipeline (PipelineNotes)  - a status count, not a decision. Its
//     rows live on Content, which is where the jump used to send him anyway.
//   * Automations (AutomationHealth)    - "like automations i dont care to see
//     them here". This is the third time a shelf of workflow errors has been
//     removed from a surface Ivan reads (see TodayScreen.tsx:16 and
//     SystemAlertStrip.tsx:8). It renders nowhere now; the alerting path that
//     actually reaches him is WhatsApp.
//   * Already handled (OpsGroups)       - Working / Done / Blocked, read-only
//     history under a queue he reads daily.
//   * Daily summaries (SummariesSection) - a reading surface, not an action one.
// Every one of them still exists as a component with its data hook intact, so
// re-mounting any of them is one line. They are simply not on Ops.

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
  // Tasks are a LIST, not cards (2026-08-30, Ivan: "make it a more crm thing
  // with thick"). They come out of the card column and render above it through
  // the one component that owns what a task is.
  const cards = pending.filter(d => !isTaskKind(d.kind))
  const hasTasks = pending.length !== cards.length || doneTodayTasks(drafts).length > 0
  // The comment lane's queue lives here, not on the card: one line, one retry
  // timer, one read of comment_feed for every outbound card on screen.
  const queue = useCommentQueue(pending, refresh)

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
        {/* One column, always: the read-only history column was cut 2026-08-31
            and there is no second thing to hold. */}
        <div className="wb-ocols one">
          <div className="wb-ocol wb-ocol-q">
            <TaskList drafts={drafts} refresh={refresh} flush />
            {pending.length === 0 && !hasTasks ? (
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
              {cards.map(d => (
                <PendingCard
                  key={d.id} draft={d} refresh={refresh}
                  feed={queue.feed.get(outboundFeedId(d) ?? '')}
                  onGateResult={queue.record}
                />
              ))}
              </>
            )}
          </div>
        </div>
        {/* Last thing on the surface, and the only status-shaped one left: it is
            a decision like the cards above it, and it renders nothing at all when
            no reaction is waiting (Ivan, 2026-08-19 — reactions live in ops, not
            the content pipeline). */}
        <ReactionDesk />
      </div>
    </>
  )
}
