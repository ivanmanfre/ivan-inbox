/* =========================================================================
   Ops (Direction B) — THE BOARD.

   Copied from src/exp/v2c/OpsBoard.tsx: same props, same hooks in the same
   order, same early returns, same strings. This file owns the FRAME and
   delegates the approve/discard card to ./PendingCard, which stays its only
   owner. No second approve path exists.

   WHAT OPS IS FOR, RULED 2026-08-31 (Ivan): "rn i mainly use it for
   notifications important, tasks, and approval pending items."

   Four blocks were cut the same day for failing that test and are named in
   the original file so nobody rebuilds them thinking they were an oversight:
   the content pipeline, automation health, the read-only Working/Done/Blocked
   history, and the daily summaries. They are not on Ops and they are not
   here either.

   Direction B: THE BOARD IS A DECK OF CARDS. Cards of the same kind that pile
   up render as one physical deck — peeked edges behind the front card make
   the count visible before it is opened, and a header names the count AND the
   kind (Sidebar News, dubinc · Stacked Activity Cards, spydiecy · Tool Group,
   serafimcloud). Tapping fans the deck out on the one spring; as the front
   card resolves and leaves, the next one advances into its place.
   ========================================================================= */
import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PullIndicator } from '../../../components/PullIndicator'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import { doneTodayTasks, isTaskKind, outboundFeedId, pendingOps, type OpsDraft, type OpsKind } from '../../../lib/ops'
import { useCommentQueue } from '../../../hooks/useCommentQueue'
import {
  Avatar, Banner, Button, EmptyState, Header, Icon, SkeletonRows, ToastStack,
  list, rise, spring, type ToastItem,
} from '../../../ds'
import { DirB, Surface } from '../shell'
import { PendingCard } from './PendingCard'
import { TaskList } from './TaskList'
import { ReactionDesk } from './ReactionDesk'
import { KIND_PLURAL, timeAgo, type OpsToast } from './util'
import './ops.css'

// The freshness stamp, byte for byte from src/exp/v2c/Surface.tsx: an empty
// list carrying "checked 4s ago" is confirmed empty; an empty list carrying
// nothing is unverified.
function relAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'never'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* --- the deck ------------------------------------------------------------
   Same-kind cards in a row are one pile. One card is just a card; two or more
   get the peeked edges, the count and the kind, and the fan. */

type Group = { kind: OpsKind; rows: OpsDraft[] }

function groupByKind(rows: OpsDraft[]): Group[] {
  const out: Group[] = []
  for (const d of rows) {
    const last = out[out.length - 1]
    if (last && last.kind === d.kind) last.rows.push(d)
    else out.push({ kind: d.kind, rows: [d] })
  }
  return out
}

function CardShell({ draft, children }: { draft: OpsDraft; children: React.ReactNode }) {
  return (
    <motion.div
      data-ops-id={draft.id}
      variants={rise}
      initial="hidden"
      animate="show"
      exit="exit"
      layout
      transition={spring}
    >
      {children}
    </motion.div>
  )
}

function Deck({ group, render }: {
  group: Group
  render: (d: OpsDraft) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const n = group.rows.length
  if (n === 1) {
    return (
      <AnimatePresence initial={false}>
        <CardShell key={group.rows[0].id} draft={group.rows[0]}>{render(group.rows[0])}</CardShell>
      </AnimatePresence>
    )
  }
  const shown = open ? group.rows : group.rows.slice(0, 1)
  return (
    <motion.div layout transition={spring} className="dirb-col">
      <button type="button" className="opsb-deckhead" onClick={() => setOpen(o => !o)}>
        <span className="opsb-deckhead-n">{n} {KIND_PLURAL[group.kind]}</span>
        <Icon name={open ? 'discloseUp' : 'disclose'} size={16} />
      </button>
      <motion.div
        layout
        transition={spring}
        className={open ? 'dirb-cards' : 'dirb-deck opsb-deckwrap'}
      >
        {/* The peeked edges. Inert, and only while the deck is closed: they
            ARE the count, drawn rather than described. */}
        {!open && (
          <>
            <span className="dirb-deck-peek" data-i="1" aria-hidden="true" />
            {n > 2 && <span className="dirb-deck-peek" data-i="2" aria-hidden="true" />}
          </>
        )}
        <AnimatePresence initial={false}>
          {shown.map(d => (
            <CardShell key={d.id} draft={d}>{render(d)}</CardShell>
          ))}
        </AnimatePresence>
      </motion.div>
    </motion.div>
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

  // The toast stack. VIEW ONLY: a card reports a write that already returned,
  // and the one follow-up action a success toast carries is a link the card
  // itself already had. Nothing here writes anything.
  const [toasts, setToasts] = useState<Array<ToastItem & { at: string }>>([])
  const dismiss = useCallback((id: string) => {
    setToasts(cur => cur.filter(t => t.id !== id))
  }, [])
  const pushToast = useCallback((t: OpsToast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const at = new Date().toISOString()
    setToasts(cur => [...cur, {
      id,
      at,
      tone: 'clear',
      icon: 'check',
      message: (
        <span className="opsb-toast">
          <span className="opsb-toast-src">{t.src}</span>
          <span className="opsb-toast-detail">{t.detail}</span>
          <span className="opsb-toast-age ds-t-meta">{timeAgo(at)}</span>
        </span>
      ),
      actionLabel: t.actionLabel,
      onAction: t.href ? () => window.open(t.href, '_blank', 'noreferrer') : undefined,
    }])
  }, [])

  // ONE header, owned here. The wrapped screen's own nav is gone because the
  // screen is no longer wrapped — the doubled render has no code path left.
  const head = <Header title="Ops" tail={<Avatar initials="IM" name="IM" />} />

  // SEAM REQUEST (see NOTES.md): `Surface` is typed
  // `{className, children} & HTMLAttributes<HTMLDivElement>`, which carries no
  // `ref`. It IS the scrolling element, and pull-to-refresh has to hold it, so
  // until the shared part forwards a ref the prop is handed through as one.
  // React 19 passes `ref` as an ordinary prop, so this is a types-only gap.
  const scrollRef = { ref: rowsRef } as unknown as React.HTMLAttributes<HTMLDivElement>

  if (error) {
    return (
      <DirB>
        {head}
        <Surface>
          {/* The error state is a real fork, not a dead end: retry, and the
              sentence that says what he is looking at instead. */}
          <Banner
            tone="urgent"
            icon="error"
            title="The ops queue didn’t load"
            action={<Button variant="outline" icon="retry" onClick={refresh}>Try again</Button>}
          >
            {error}
          </Banner>
          <span className="ds-t-meta dirb-dim">
            {drafts.length > 0 && loadedAt
              ? `Showing what loaded ${relAge(loadedAt)}. It may be out of date.`
              : 'Nothing has loaded yet, so this is not an empty queue — it is an unread one.'}
          </span>
        </Surface>
      </DirB>
    )
  }

  if (loading && drafts.length === 0) {
    return (
      <DirB>
        {head}
        <Surface><SkeletonRows rows={4} label="Loading the ops queue" /></Surface>
      </DirB>
    )
  }

  return (
    <DirB>
      {head}
      <Surface {...scrollRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {/* The state band (four count tiles + stacked bar + freshness line) was
            removed on 2026-08-04 at Ivan's word: on a queue he reads every day
            it was four numbers describing what the cards under it already show.
            The freshness claim survives where it is load-bearing — the empty
            state still says when it last checked, because an empty queue and a
            stalled feed are the one pair this screen cannot tell apart on its
            own (audit A5).
            One column, always: the read-only history column was cut 2026-08-31
            and there is no second thing to hold. */}
        <TaskList drafts={drafts} refresh={refresh} flush onToast={pushToast} />
        {pending.length === 0 && !hasTasks ? (
          <EmptyState
            ghosts
            icon="ops"
            // The panel's best line, and it earns its place here more than
            // anywhere: this is the surface where "empty" and "broken" looked
            // identical before.
            title="Nothing waiting on you — and this is a live read, not a stall."
            sub={<>Comment replies, newsjacks, weekly reports and escalations all clear.<br />Checked {relAge(loadedAt)}</>}
          />
        ) : (
          <>
            {/* The line, stated once. Ivan can approve several and leave; this
                says what is actually happening, because the poster takes one
                at a time and refuses the rest. A wait on the poster is a
                persistent status strip, never a spinner. */}
            {queue.waiting.length > 0 && (
              <Banner
                tone={queue.cappedToday ? 'attention' : 'neutral'}
                icon={queue.cappedToday ? 'timer' : 'scheduled'}
              >
                {queue.cappedToday
                  ? `${queue.waiting.length} comment${queue.waiting.length === 1 ? '' : 's'} held — the poster hit its 3-a-day cap. They stay here for tomorrow.`
                  : `${queue.waiting.length} comment${queue.waiting.length === 1 ? '' : 's'} queued here — the poster takes one at a time, so this retries the next as its window opens. Leave the tab open.`}
              </Banner>
            )}
            <motion.div className="dirb-cards" variants={list} initial="hidden" animate="show">
              {groupByKind(cards).map(g => (
                <Deck
                  key={`${g.kind}-${g.rows[0].id}`}
                  group={g}
                  render={d => (
                    <PendingCard
                      draft={d} refresh={refresh}
                      feed={queue.feed.get(outboundFeedId(d) ?? '')}
                      onGateResult={queue.record}
                      onToast={pushToast}
                    />
                  )}
                />
              ))}
            </motion.div>
          </>
        )}
        {/* Last thing on the surface, and the only status-shaped one left: it is
            a decision like the cards above it, and it renders nothing at all when
            no reaction is waiting (Ivan, 2026-08-19 — reactions live in ops, not
            the content pipeline). */}
        <ReactionDesk />
      </Surface>
      <ToastStack items={toasts} onDismiss={dismiss} />
    </DirB>
  )
}
