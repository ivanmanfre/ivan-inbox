import { useRef } from 'react'
import { OpsGroups, PendingCard } from '../../screens/OpsScreen'
import { OpsSkeleton } from '../../components/Skeleton'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { blockedOps, claimingOps, outboundFeedId, pendingOps, sentOps, type OpsDraft } from '../../lib/ops'
import { useCommentQueue } from '../../hooks/useCommentQueue'
import { useAgentDigest, usePipelineHealth } from '../../hooks/useContent'
import { pipelineHealthTotal, STUCK_GENERATING_MINUTES, type PipelineHealth } from '../../lib/content'
import { SummariesSection } from './ContentSections'
import { ReactionDesk } from './ReactionDesk'
import { CalmEmpty, Failed } from './Surface'
import { relTime } from './fmt'
import type { AutomationAlert, GlanceCounts } from './useGlanceCounts'

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

// THE PIPELINE NOTES, rehomed (2026-08-07).
//
// Ivan retired the Content strip's alarm band. Four facts it carried had no
// other surface, and 🔴 the assumption that Ops already counted them is FALSE —
// verified, not assumed: the rail's Ops badge is `pendingOps(ops_drafts)`, a
// table that has never held a carousel_drafts row, and the Content badge is a
// head count of `status='review'`. Neither has ever counted an errored draft.
//
// So the count lands here, quietly, and the button goes back to the rows: Ops
// is where "something needs a person" already lives, and this is that, one tier
// below an approval. It renders NOTHING when the pipeline is clean.
function PipelineNotes({ health, olderUnsent, onOpenErrors }: {
  health: PipelineHealth
  olderUnsent: number
  onOpenErrors?: () => void
}) {
  const total = pipelineHealthTotal(health)
  if (total === 0 && olderUnsent === 0) return null
  const lines = [
    health.errored > 0
      && `${health.errored} draft${health.errored === 1 ? '' : 's'} errored in the content pipeline.`,
    health.pastDue > 0
      && `${health.pastDue} scheduled post${health.pastDue === 1 ? '' : 's'} went past ${health.pastDue === 1 ? 'its' : 'their'} time with nothing published back.`,
    health.stalledGenerating > 0
      && `${health.stalledGenerating} draft${health.stalledGenerating === 1 ? '' : 's'} generating for over ${STUCK_GENERATING_MINUTES} minutes — the run that started ${health.stalledGenerating === 1 ? 'it' : 'them'} is probably dead.`,
    health.failedPublish > 0
      && `${health.failedPublish} publish ${health.failedPublish === 1 ? 'failure' : 'failures'} in the queue — the only place a failed publish is written down.`,
    // History, not a defect — it keeps the wording it had inside the band.
    olderUnsent > 0
      && `${olderUnsent} pipeline ${olderUnsent === 1 ? 'alert predates' : 'alerts predate'} the 14-day window (ClickUp-era ids, no live draft behind them) — historical, not actionable here.`,
  ].filter((l): l is string => typeof l === 'string')
  return (
    <div className="ops-pipe">
      <div className="ops-pipe-h">
        <span className="ops-pipe-t">Content pipeline</span>
        {total > 0 && <span className="ops-pipe-n">{total}</span>}
      </div>
      {lines.map(l => <div className="ops-pipe-l" key={l}>{l}</div>)}
      {onOpenErrors && (health.errored > 0 || health.pastDue > 0) && (
        <button type="button" className="btn s ops-pipe-b" onClick={onOpenErrors}>
          Open them in Content
        </button>
      )}
    </div>
  )
}

// AUTOMATION HEALTH, and the ruling it had to be built around.
//
// The inbox reads `dashboard_workflow_stats` NOWHERE, so a broken pipeline is
// invisible here until content stops arriving. On the day this was written that
// was not hypothetical: "Carousel Generation" last errored 2 days ago, "Post
// Generation" 8 days ago, and "Outreach - DM Sequence" is a 30-minute job that
// last ran 10 days ago.
//
// 🔴 BUT TodayScreen.tsx:16 records that Ivan CUT an n8n / workflow-error zone,
// and SystemAlertStrip.tsx:8 states what the ruling was aimed at: "a permanent
// shelf of n8n workflow errors nobody acts on". So this obeys the same three
// conditions that strip obeys and states them here so the next reader can check
// they still hold:
//   1. it renders NOTHING when there is nothing;
//   2. every row names a dated consequence, which is what stopped and when;
//   3. it is windowed, so the number can reach zero. Unwindowed it would read
//      17 forever, seven of those last having run 72 to 167 days ago and three
//      of them called "TEMP" or "delete me".
//
// READ ONLY. The old dashboard pairs this data with Pause/Resume controls that
// call a live n8n toggle edge function. None of that is ported. A count, a
// list, and the route back to Ops is the whole surface.
function AutomationHealth({ alerts, olderErrored, olderStalled }: {
  alerts: AutomationAlert[]
  olderErrored: number
  olderStalled: number
}) {
  if (alerts.length === 0) return null
  const older = olderErrored + olderStalled
  return (
    <div className="ops-pipe">
      <div className="ops-pipe-h">
        <span className="ops-pipe-t">Automations</span>
        <span className="ops-pipe-n">{alerts.length}</span>
      </div>
      {alerts.map(a => {
        // A row with no timestamp says so. It cannot reach this list without
        // one (the window filter drops a null), but the type allows it and a
        // silent "" would read as a sentence that lost its end.
        const when = a.lastAt ? relTime(a.lastAt) : 'at an unrecorded time'
        return (
          <div className="ops-pipe-l wb-auto-l" key={a.key}>
            <span className="wb-auto-n">{a.name}</span>
            <span className="wb-auto-w">
              {a.kind === 'stalled'
                ? `past its schedule, last ran ${when}`
                : a.kind === 'both'
                  ? `errored and past its schedule, last ran ${when}`
                  : `last run errored ${when}`}
              {a.acknowledged ? ' · marked read on the old dashboard' : ''}
            </span>
          </div>
        )
      })}
      {older > 0 && (
        // Stated rather than hidden. These are outside the 14-day window on
        // purpose; leaving them out of the count without saying so would be the
        // same silence this block exists to remove.
        <div className="ops-pipe-l">
          {older} more last ran over two weeks ago and are not counted above.
        </div>
      )}
    </div>
  )
}

export function OpsBoard({ drafts, loading, error, loadedAt, refresh, onOpenErrors, glance }: {
  drafts: OpsDraft[]
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
  // Ops does not own the Content job, so the jump is handed in by the Shell.
  onOpenErrors?: () => void
  // The shell's cross-job read. Handed in rather than mounted here so the rail
  // row and this list are the SAME numbers from the same fetch. Two mounts of
  // the same query would eventually disagree by one poll interval and there
  // would be no way to tell which was right.
  glance?: Pick<GlanceCounts, 'alerts' | 'olderErrored' | 'olderStalled'>
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, refresh)
  const pending = pendingOps(drafts)
  // The comment lane's queue lives here, not on the card: one line, one retry
  // timer, one read of comment_feed for every outbound card on screen.
  const queue = useCommentQueue(pending, refresh)
  const history = claimingOps(drafts).length + sentOps(drafts).length + blockedOps(drafts).length
  // Daily summaries live HERE now, not at the bottom of the Content scroll
  // (Ivan, 2026-08-04: "DAILY SUMMARIES INSIDE OPS AS A SUB TAB MAYBE").
  const digest = useAgentDigest(true)
  // Four head counts, no rows — the rehomed alarm band (PipelineNotes above).
  const health = usePipelineHealth(true)

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
        {/* The reaction desk sits ABOVE the pipeline notes and below the queue:
            it is a decision like the cards above it, not a status line like the
            notes below. It renders nothing at all when no reaction is waiting
            (Ivan, 2026-08-19 — reactions live in ops, not the content pipeline). */}
        <ReactionDesk />
        <PipelineNotes
          health={health.rows} olderUnsent={digest.olderUnsent} onOpenErrors={onOpenErrors}
        />
        {glance && (
          <AutomationHealth
            alerts={glance.alerts}
            olderErrored={glance.olderErrored}
            olderStalled={glance.olderStalled}
          />
        )}
        <SummariesSection rows={digest.rows} defaultOpen />
      </div>
    </>
  )
}
