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
import { useRef, useState, type ReactNode } from 'react'
import { doneTodayTasks, isTaskKind, outboundFeedId, pendingOps, pendingTasks, splitCommentIdeas, COMMENT_IDEAS_PER_DAY, type OpsDraft } from '../../lib/ops'
import { useCommentQueue } from '../../hooks/useCommentQueue'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useReactions } from '../../hooks/useReactions'
import { relAge } from '../kit'
import { checkedPhrase, clockTime } from '../../lib/today'
import { Banner, Button, EmptyState, Icon } from '../../ds'
import { OpsSkeleton } from '../chrome/Skeleton'
import { Body, Group, Head, Screen } from '../kit'
import { PendingCard } from './PendingCard'
import { QuickBatch } from './QuickBatch'
import { ReactionDesk } from './ReactionDesk'
import { TaskList } from './TaskList'
import { answerLine, groupOpsByLane, kindsLine } from './lanes'
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

/**
 * One collapsible section: a lane, the task list or the reaction desk. Closed
 * on mount, every time (never persisted); open state lives only while the
 * board stays mounted. The closed header is one 44px row that says the lane,
 * the count and the kinds, so the board reads without opening anything.
 */
function Fold({ id, title, count, sub, quiet, children }: {
  id: string
  /** A row that is not a lane (comment ideas for later): drawn a step down. */
  quiet?: boolean
  title: string
  count: number
  sub?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const bodyId = `a-ops-fold-${id}`
  return (
    <section className="a-ops-fold" data-open={open ? '' : undefined} data-quiet={quiet ? '' : undefined}>
      <button
        type="button" className="a-ops-fold-head wb-ops-fold"
        aria-expanded={open} aria-controls={bodyId}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={open ? 'disclose' : 'forward'} size={16} />
        <span className="a-ops-fold-t">{title} · <span className="a-mono">{count}</span></span>
        {sub ? <span className="a-ops-fold-k">{sub}</span> : null}
      </button>
      {open && <div className="a-ops-fold-body a-stack" id={bodyId}>{children}</div>}
    </section>
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
  // The comment lane's queue lives here, not on the card: one line, one retry
  // timer, one read of comment_feed for every outbound card on screen.
  const queue = useCommentQueue(pending, refresh)
  // Tasks are a LIST, not cards (2026-08-30, Ivan: "make it a more crm thing
  // with thick"). They come out of the card column and render above it through
  // the one component that owns what a task is.
  const pendingCards = pending.filter(d => !isTaskKind(d.kind))
  // A comment the gate accepted but HELD (volume lane switched off) is stamped
  // and so leaves `pending`; it stays on the board, in place, saying so.
  const pendingIds = new Set(pendingCards.map(d => d.id))
  const cards = queue.held.size === 0
    ? pendingCards
    : drafts.filter(d => pendingIds.has(d.id) || queue.held.has(d.id))
  // Comment ideas past the 3 the poster can still post today wait in their
  // own closed row (blueprint v3 decision 11): the lane rows and the first
  // line count only today's, the same reading as the Ops icon (opsBadge).
  const later = splitCommentIdeas(drafts).later
  const laterIds = new Set(later.map(d => d.id))
  const todayCards = cards.filter(d => !laterIds.has(d.id))
  const answer = answerLine(pending.filter(d => !laterIds.has(d.id)))
  const taskCount = pendingTasks(drafts).length
  const doneCount = doneTodayTasks(drafts).length
  const hasTasks = pending.length !== pendingCards.length || doneCount > 0
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
      // N2b-1: one head on the phone. The decorative `IM` avatar goes with the
      // merge on every width here: the Settings tile it sat beside is the real
      // route into the account, and this head never had another control.
      chrome
    />
  )

  // A failed read with nothing ever loaded is the one state that has no cards to
  // keep: say it is unread, not empty.
  if (error && drafts.length === 0) {
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
                Nothing has loaded yet, so this is not an empty queue, it is an unread one.
              </span>
            </>
          </Banner>
        </Body>
      </Screen>
    )
  }

  // A failed REFRESH keeps the last good cards on screen and says so. It used
  // to draw only the banner while its text claimed the cards were showing.
  const staleBanner = error ? (
    <Banner
      tone="attention"
      icon="error"
      title={loadedAt ? `Couldn’t refresh, showing the copy from ${clockTime(loadedAt)}` : 'Couldn’t refresh, showing the last copy'}
      action={<Button variant="quiet" onClick={refresh}>Retry</Button>}
    >
      The cards below may be out of date.
    </Banner>
  ) : null

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

  const empty = pending.length === 0 && cards.length === 0 && !hasTasks

  return (
    <Screen>
      {head}
      <Body innerRef={rowsRef}>
        <PullLine pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {staleBanner}
        <div className="a-ops-canvas" data-wide={sideLive ? '' : undefined}>
          {answer && <p className="a-ops-answer">{answer}</p>}
          <QuickBatch cards={todayCards} refresh={refresh} />
          <div className="a-cols" data-cols={sideLive ? 'side' : undefined}>
            <div className="a-stack a-ops-main">
              {empty ? (
                <EmptyState
                  icon="ops"
                  ghosts
                  // The panel's best line, and it earns its place here more than
                  // anywhere: this is the surface where "empty" and "broken" looked
                  // identical before.
                  title={error
                    ? 'Nothing was waiting on you at the last good read.'
                    : 'Nothing waiting on you, and this is a live read, not a stall.'}
                  sub={
                    <>
                      Comment replies, newsjacks, weekly reports and escalations all clear.
                      <span className="a-ops-fresh a-mono">Checked {relAge(loadedAt)}</span>
                    </>
                  }
                />
              ) : (
                // By client lane, every lane closed on open (Ivan, 2026-09-26:
                // "make sure ops are separated by client lane and start
                // collapsed"). The comment-queue line rides inside the lane its
                // comments belong to, and a held card counts in its lane.
                <>{groupOpsByLane(todayCards).map(lane => {
                  const ids = new Set(lane.cards.map(d => d.id))
                  const waiting = queue.waiting.filter(e => ids.has(e.id)).length
                  return (
                    <Fold
                      key={lane.key} id={`lane-${lane.key}`}
                      title={lane.label} count={lane.cards.length} sub={kindsLine(lane.cards)}
                    >
                      {/* The line, stated once. Ivan can approve several and leave; this
                          says what is actually happening, because the poster takes one
                          at a time and refuses the rest. */}
                      {waiting > 0 && (
                        <Banner tone={queue.cappedToday ? 'attention' : 'neutral'} icon={queue.cappedToday ? 'blocked' : 'time'}>
                          {queue.cappedToday
                            ? `${waiting} comment${waiting === 1 ? '' : 's'} held, the poster hit its 3-a-day cap. They stay here for tomorrow.`
                            : `${waiting} comment${waiting === 1 ? '' : 's'} queued here, the poster takes one at a time, so this retries the next as its window opens. Leave the tab open.`}
                        </Banner>
                      )}
                      {lane.cards.map(d => (
                        <PendingCard
                          key={d.id} draft={d} refresh={refresh}
                          feed={queue.feed.get(outboundFeedId(d) ?? '')}
                          held={queue.held.get(d.id)}
                          onGateResult={queue.record}
                        />
                      ))}
                    </Fold>
                  )
                })}
                {later.length > 0 && (
                  <Fold
                    id="later" quiet title="Comment ideas for later" count={later.length}
                    sub={`the poster posts ${COMMENT_IDEAS_PER_DAY} a day`}
                  >
                    {later.map(d => (
                      <PendingCard
                        key={d.id} draft={d} refresh={refresh}
                        feed={queue.feed.get(outboundFeedId(d) ?? '')}
                        held={queue.held.get(d.id)}
                        onGateResult={queue.record}
                      />
                    ))}
                  </Fold>
                )}</>
              )}
            </div>
            {/* The side column: the task list first (it is the thing he ticks
                through), then the reaction desk last on the surface. Both fold
                closed like the lanes (2026-09-26). The desk renders nothing at
                all when no reaction is waiting (Ivan, 2026-08-19, reactions live
                in ops, not the content pipeline); a desk that failed to load
                stays unfolded, so the failure is never hidden behind a tap. On a
                phone the grid puts this column first, which is the order Ops
                has always read in. */}
            {sideLive && (
              <div className="a-stack a-ops-side">
                {hasTasks && (
                  <Fold
                    id="tasks" title="Tasks" count={taskCount}
                    sub={doneCount > 0 ? `${doneCount} done today` : undefined}
                  >
                    <TaskList drafts={drafts} refresh={refresh} />
                  </Fold>
                )}
                {rx.rows.length > 0 ? (
                  <Fold id="reactions" title="Reactions" count={rx.rows.length}>
                    <ReactionDesk rx={rx} />
                  </Fold>
                ) : <ReactionDesk rx={rx} />}
              </div>
            )}
          </div>
        </div>
      </Body>
    </Screen>
  )
}
