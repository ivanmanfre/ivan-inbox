/* ==========================================================================
   src/wb/ask/Feed.tsx: S27, the feed as a ledger.

   03-DIRECTION move 3: a sticky day header per day carrying its live count in
   a mono tail. Move 5: new rows land at the top on the list stagger, and a
   floating pill appears only when something arrives while he is scrolled down.
   Move 8: a dismissed row resolves in place, leaves under `AnimatePresence`,
   and puts one toast on the stack. Move 20: empty is ghost rows with the
   promise on top, never a void.

   The data half is unchanged: `useArrivals`, `useLeaving` and `withLeaving`
   are the old file's, byte for byte, and the write still fires the instant he
   presses.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, DayHeader, EmptyState, ToastStack, fadeT, rise, spring, type ToastItem } from '../../ds'
import { Body, Rows } from '../kit'
import { notificationDeepLink, type Notification, type NotificationGroup } from '../../lib/turns'
import { parseWbHash } from '../../exp/v2c/route'
import type { Job } from '../../exp/v2c/layout'
import type { FeedData } from '../../exp/brain/b/useFeedData'
import { dayWord } from '../../exp/brain/b/skins/b/forms'
import { GroupRow, NotificationRow } from './NotificationRow'
import './ask.css'

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Which rows are NEW since the last render, so a row that arrived while he was
 * looking can land on its own and the rest stay still. The first render is not
 * an arrival: everything is new then, and a whole feed animating on open is a
 * splash screen, not an explanation.
 */
function useArrivals(keys: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (seen.current === null) { seen.current = new Set(keys); return }
    const added = keys.filter(k => !seen.current!.has(k))
    seen.current = new Set(keys)
    if (!added.length) return
    setFresh(new Set(added))
    const t = window.setTimeout(() => setFresh(new Set()), 400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join('|')])
  return fresh
}

/**
 * A dismissed row leaves before its slot does, and THE WRITE FIRES FIRST.
 *
 * Two things were wrong and they pulled against each other. Holding
 * `feed.dismissOne` behind the animation meant closing the feed inside that
 * window dropped the write on the floor. Firing it immediately meant the row
 * left React state in the same commit, so the slot unmounted and the leave
 * animation never ran at all.
 *
 * So the dismiss happens the instant he presses it, and the row is kept on
 * screen from a SNAPSHOT for 220ms afterwards, spliced back at the index it
 * left from. The snapshot is inert, so a second press cannot queue a second
 * write for the same id.
 */
type Leaving = { g: NotificationGroup; at: number }

function useLeaving(): [Map<string, Leaving>, (g: NotificationGroup, at: number, drop: () => void) => void] {
  const [leaving, setLeaving] = useState<Map<string, Leaving>>(new Map())
  const timers = useRef<number[]>([])
  useEffect(() => () => { for (const t of timers.current) window.clearTimeout(t) }, [])
  const leave = (g: NotificationGroup, at: number, drop: () => void) => {
    let already = false
    setLeaving(prev => {
      if (prev.has(g.key)) { already = true; return prev }
      const next = new Map(prev)
      next.set(g.key, { g, at })
      return next
    })
    if (already) return
    drop()
    timers.current.push(window.setTimeout(() => {
      setLeaving(prev => { const next = new Map(prev); next.delete(g.key); return next })
    }, 220))
  }
  return [leaving, leave]
}

/** The live groups with the leaving snapshots spliced back where they were. */
function withLeaving(groups: NotificationGroup[], leaving: Map<string, Leaving>): { g: NotificationGroup; going: boolean }[] {
  const out = groups.map(g => ({ g, going: false }))
  const gone = [...leaving.values()].filter(l => !groups.some(g => g.key === l.g.key))
  for (const l of gone.sort((a, b) => a.at - b.at)) {
    out.splice(Math.min(l.at, out.length), 0, { g: l.g, going: true })
  }
  return out
}

type Slot = { g: NotificationGroup; going: boolean; at: number }

/** One band per day, in the order the rows already arrived in. */
function byDay(rows: Slot[]): { label: string; slots: Slot[]; unread: number }[] {
  const out: { label: string; slots: Slot[]; unread: number }[] = []
  for (const s of rows) {
    const label = dayWord(s.g.lastSeenAt)
    const band = out[out.length - 1]
    if (band && band.label === label) { band.slots.push(s); band.unread += s.g.unread }
    else out.push({ label, slots: [s], unread: s.g.unread })
  }
  return out
}

export function Feed({ feed, goJob, openThread, onNavigated, onScrolled }: {
  feed: FeedData
  goJob: (j: Job) => void
  openThread: (id: string, turn?: string) => void
  onNavigated: () => void
  /** The head condenses once the ledger has moved (move 3). */
  onScrolled?: (scrolled: boolean) => void
}) {
  const fresh = useArrivals(feed.groups.map(g => g.key))
  const [leaving, leave] = useLeaving()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [scrolled, setScrolled] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const rows: Slot[] = withLeaving(feed.groups, leaving).map((r, at) => ({ ...r, at }))
  const days = byDay(rows)

  // Move 5. The pill is only ever earned: something landed while he was
  // scrolled away from the top, and tapping it takes him to it.
  const arrivedWhileAway = fresh.size > 0 && scrolled

  const onScroll = () => {
    const el = scroller.current
    const next = (el?.scrollTop ?? 0) > 8
    if (next !== scrolled) { setScrolled(next); onScrolled?.(next) }
  }

  const toTop = () => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })

  const openOne = (n: Notification) => {
    feed.markRead(n)
    const route = parseWbHash(notificationDeepLink(n))
    if (route.thread) openThread(route.thread, route.turn)
    else goJob(route.job)
    onNavigated()
  }

  // Move 8. The write has already fired by the time this runs; the toast is a
  // receipt, not an offer to take it back. nothing in the feed's data layer
  // can un-dismiss a row, and an Undo that cannot undo is a lie.
  const receipt = (id: string) => {
    setToasts(prev => [...prev, { id, message: 'Dismissed', icon: 'discard' }])
    window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  const dismissOne = (id: string) => { feed.dismissOne(id); receipt(id) }

  return (
    <>
      <Body flush className="a-brain-feed" innerRef={scroller} onScroll={onScroll}>
        {feed.loaded && feed.groups.length === 0 && (
          <div data-feed-empty>
            {feed.error
              ? (
                <EmptyState
                  icon="alert" ghosts
                  title="Could not load the feed."
                  action={<Button variant="quiet" icon="retry" onClick={() => void feed.refresh()}>Tap to try again</Button>}
                />
              )
              : (
                <EmptyState
                  icon="inbox" ghosts
                  title={feed.lastEmptySince ? `Nothing new since ${clockTime(feed.lastEmptySince)}.` : 'Nothing here yet.'}
                />
              )}
          </div>
        )}

        {days.map(day => (
          <div className="a-brain-day" key={day.label}>
            <DayHeader label={day.label} tail={day.unread > 0 ? `${day.unread} unread` : undefined} sticky />
            <Rows>
              <AnimatePresence initial={false}>
                {day.slots.map(({ g, going, at }) => (
                  <motion.div
                    key={g.key}
                    aria-hidden={going || undefined}
                    variants={rise}
                    initial={fresh.has(g.key) && !going ? 'hidden' : false}
                    animate="show"
                    exit="exit"
                    transition={spring}
                  >
                    {g.items.length > 1
                      ? (
                        <GroupRow
                          g={g} open={feed.expanded.has(g.key)} onToggle={() => feed.toggle(g.key)}
                          onOpen={openOne}
                          onDismissAll={() => leave(g, at, () => { feed.dismissGroupRows(g); receipt(g.key) })}
                          onDismissOne={dismissOne}
                        />
                      )
                      : (
                        <NotificationRow
                          n={g.latest} onOpen={openOne} going={going}
                          onDismiss={id => leave(g, at, () => dismissOne(id))}
                        />
                      )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </Rows>
          </div>
        ))}
      </Body>

      <AnimatePresence>
        {arrivedWhileAway && (
          <motion.div
            className="a-brain-newpill"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, transition: fadeT }}
          >
            <Button variant="primary" size="sm" icon="up" onClick={toTop}>{fresh.size} new</Button>
          </motion.div>
        )}
      </AnimatePresence>

      <ToastStack items={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  )
}
