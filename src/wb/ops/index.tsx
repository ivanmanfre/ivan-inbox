/* ==========================================================================
   Direction A · the Ops board (S12 / S36).

   Ops is the surface Ivan opens to answer things. Ruled 2026-08-31 (Ivan):
   "rn i mainly use it for notifications important, tasks, and approval pending
   items." Four blocks were cut the same day for failing that test (the content
   pipeline notes, the automation health shelf, the read-only Working/Done/
   Blocked history and the daily summaries), and the state band was cut on
   2026-08-04. None of them come back here.

   What the direction changes is the frame:
     · a sticky compact head that carries the freshness read at all times, so an
       empty queue and a stalled feed can never look alike (audit A5);
     · tasks as dense hairline rows in one group, with the done-today run under
       its own eyebrow;
     · a pending card as a grouped decision block whose eyebrow NAMES the kind;
     · at 1000px and up the queue keeps a readable measure on the left and the
       list work (tasks, then the reaction desk) takes the right column, so the
       wide canvas carries two live columns instead of one pinned card stack and
       600px of dead ground. With neither a task nor a reaction waiting there is
       no second column to draw, and the single one keeps its measure and centres.
   ========================================================================== */
import { useRef } from 'react'
import { doneTodayTasks, isTaskKind, outboundFeedId, pendingOps, type OpsDraft } from '../../lib/ops'
import { useCommentQueue } from '../../hooks/useCommentQueue'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useReactions } from '../../hooks/useReactions'
import { relAge } from '../../exp/v2c/Surface'
import { checkedPhrase } from '../../lib/today'
import { Avatar, Banner, Button, EmptyState, Icon } from '../../ds'
import { OpsSkeleton } from '../chrome/Skeleton'
import { Body, Group, Head, Screen } from '../kit'
import { PendingCard } from './PendingCard'
import { ReactionDesk } from './ReactionDesk'
import { TaskList } from './TaskList'
import './ops.css'

/** The pull-to-refresh mark, drawn with the icon set instead of arrow glyphs. */
function PullLine({ pull, refreshing, trigger }: { pull: number; refreshing: boolean; trigger: number }) {
  if (pull <= 0 && !refreshing) return null
  const ready = pull >= trigger
  return (
    <div className="a-ops-ptr" style={{ height: pull }}>
      <span
        className="a-ops-ptr-m"
        data-spin={refreshing ? '' : undefined}
        style={{
          opacity: refreshing ? 1 : Math.min(1, pull / trigger),
          transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
        }}
      >
        <Icon name={refreshing ? 'refresh' : ready ? 'up' : 'down'} size={20} />
      </span>
    </div>
  )
}

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
  // The desk's state is held here so the frame can ask whether the desk has
  // anything in it before it decides how many columns to draw. The desk itself
  // still renders nothing when nothing is waiting.
  const rx = useReactions(true)
  const deskLive = Boolean(rx.error) || rx.rows.length > 0
  // A column is drawn only when something lives in it. Two live columns beat one
  // column and a dead half; one centred column beats a half-empty grid.
  const sideLive = deskLive || hasTasks

  // ONE header, owned here, and it carries the freshness read on every state:
  // an empty queue and a stalled feed are the one pair this screen cannot tell
  // apart on its own.
  const head = (
    <Head
      title="Ops"
      sub={checkedPhrase(loadedAt)}
      tail={<Avatar name="IM" initials="IM" size="sm" />}
    />
  )

  if (error) {
    return (
      <Screen>
        {head}
        <Body>
          <Banner
            tone="urgent"
            icon="error"
            title="The ops queue didn’t load"
            action={<Button variant="quiet" onClick={refresh}>Try again</Button>}
          >
            <>
              {error}
              <span className="a-ops-failf">
                {drafts.length > 0 && loadedAt
                  ? `Showing what loaded ${relAge(loadedAt)}. It may be out of date.`
                  : 'Nothing has loaded yet, so this is not an empty queue — it is an unread one.'}
              </span>
            </>
          </Banner>
        </Body>
      </Screen>
    )
  }

  if (loading && drafts.length === 0) {
    return (
      <Screen>
        {head}
        <Body>
          <Group label="Ops">
            <OpsSkeleton />
          </Group>
        </Body>
      </Screen>
    )
  }

  const empty = pending.length === 0 && !hasTasks

  return (
    <Screen>
      {head}
      <Body innerRef={rowsRef}>
        <PullLine pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        <div className="a-ops-canvas" data-wide={sideLive ? '' : undefined}>
          <div className="a-cols" data-cols={sideLive ? 'side' : undefined}>
            <div className="a-stack">
              {empty ? (
                <EmptyState
                  icon="ops"
                  ghosts
                  // The panel's best line, and it earns its place here more than
                  // anywhere: this is the surface where "empty" and "broken" looked
                  // identical before.
                  title="Nothing waiting on you — and this is a live read, not a stall."
                  sub={
                    <>
                      Comment replies, newsjacks, weekly reports and escalations all clear.
                      <span className="a-ops-fresh a-mono">Checked {relAge(loadedAt)}</span>
                    </>
                  }
                />
              ) : (
                <>
                  {/* The line, stated once. Ivan can approve several and leave; this
                      says what is actually happening, because the poster takes one
                      at a time and refuses the rest. */}
                  {queue.waiting.length > 0 && (
                    <Banner tone={queue.cappedToday ? 'attention' : 'neutral'} icon={queue.cappedToday ? 'blocked' : 'time'}>
                      {queue.cappedToday
                        ? `${queue.waiting.length} comment${queue.waiting.length === 1 ? '' : 's'} held — the poster hit its 3-a-day cap. They stay here for tomorrow.`
                        : `${queue.waiting.length} comment${queue.waiting.length === 1 ? '' : 's'} queued here — the poster takes one at a time, so this retries the next as its window opens. Leave the tab open.`}
                    </Banner>
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
            {/* The side column: the task list first (it is the thing he ticks
                through), then the reaction desk last on the surface. The desk is
                the only status-shaped block left and it renders nothing at all
                when no reaction is waiting (Ivan, 2026-08-19 — reactions live in
                ops, not the content pipeline). On a phone the grid puts this
                column first, which is the order Ops has always read in. */}
            {sideLive && (
              <div className="a-stack a-ops-side">
                <TaskList drafts={drafts} refresh={refresh} />
                <ReactionDesk rx={rx} />
              </div>
            )}
          </div>
        </div>
      </Body>
    </Screen>
  )
}
