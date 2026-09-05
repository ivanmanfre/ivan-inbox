import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { notificationDeepLink, type Notification, type NotificationGroup } from '../../../lib/turns'
import { parseWbHash } from '../../../exp/v2c/route'
import type { Job } from '../../../exp/v2c/layout'
import type { FeedData } from '../../../exp/brain/b/useFeedData'
import { dayWord } from '../../../exp/brain/b/skins/b/forms'
import { Button, DayHeader, EmptyState, fadeT, spring } from '../../../ds'
import { GroupCard, NotificationCard, isRunning } from './NotificationCard'
import './mobile.css'

/* =========================================================================
   S27. The feed sheet's body, rebuilt on src/ds.

   The state hook, the deep-link resolution, the arrival window and the
   dismiss snapshot are the shipped ones, unchanged. What direction B adds is
   the reading order: sticky day headers with their own live count (move 3),
   a floating pill for anything that lands while he is scrolled down (move 5),
   and ghost rows instead of a void when there is nothing (move 20).
   ========================================================================= */

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Which rows are NEW since the last render, so a row that arrived while he was
 * looking can fade up and the rest stay still. The first render is not an
 * arrival: everything is new then, and a whole feed animating on open is a
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
 * A dismissed card leaves before its row does, and THE WRITE FIRES FIRST.
 *
 * Two things were wrong and they pulled against each other. Holding
 * `feed.dismissOne` behind the 200ms animation meant closing the feed inside
 * that window dropped the write on the floor. Firing it immediately meant the
 * row left React state in the same commit, so the slot unmounted and the leave
 * animation never ran at all (burst capture: zero frames).
 *
 * So the dismiss happens the instant he presses it, exactly as plain B does it,
 * and the row is kept on screen from a SNAPSHOT for 220ms afterwards, spliced
 * back at the index it left from. The snapshot is inert, so a second press
 * cannot queue a second write for the same id.
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

/** How far down the list counts as "scrolled away from the newest thing". */
const PILL_AT = 120

export function Feed({ feed, goJob, openThread, onNavigated }: {
  feed: FeedData
  goJob: (j: Job) => void
  openThread: (id: string, turn?: string) => void
  onNavigated: () => void
}) {
  const fresh = useArrivals(feed.groups.map(g => g.key))
  const [leaving, leave] = useLeaving()
  const rows = withLeaving(feed.groups, leaving)

  const body = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState(false)
  const [pending, setPending] = useState(0)

  // Move 5. The pill is only ever earned: something has to arrive WHILE he is
  // scrolled down. An arrival at the top needs no pill, it is already on screen.
  useEffect(() => {
    if (!fresh.size) return
    if ((body.current?.scrollTop ?? 0) <= PILL_AT) return
    setPending(fresh.size)
  }, [fresh])

  const onScroll = () => {
    const top = body.current?.scrollTop ?? 0
    setAway(top > PILL_AT)
    if (top <= PILL_AT) setPending(0)
  }

  const toTop = () => {
    body.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setPending(0)
  }

  const openOne = (n: Notification) => {
    feed.markRead(n)
    const route = parseWbHash(notificationDeepLink(n))
    if (route.thread) openThread(route.thread, route.turn)
    else goJob(route.job)
    onNavigated()
  }

  // Move 3. The day a row belongs to, and how many rows that day holds, so the
  // sticky header can carry its own live count as it passes under the chrome.
  const dayOf = (g: NotificationGroup) => dayWord(g.lastSeenAt)
  const perDay = new Map<string, number>()
  for (const { g } of rows) perDay.set(dayOf(g), (perDay.get(dayOf(g)) ?? 0) + 1)
  let lastDay: string | null = null

  // Move 4 under the motion contract: at most ONE continuous loop per surface,
  // so the sweep is granted to the first row whose state word says it is
  // running and to no other.
  const liveKey = rows.find(({ g, going }) => !going && g.items.length === 1 && isRunning(g.latest))?.g.key ?? null

  return (
    <div className="dirb-mob-feedwrap">
      <div className="dirb-mob-feed" data-feed ref={body} onScroll={onScroll}>
        {feed.loaded && feed.groups.length === 0 && (
          <div data-feed-empty>
            {feed.error
              ? (
                <EmptyState
                  ghosts icon="alert"
                  title="Could not load the feed."
                  action={
                    <Button variant="quiet" data-tap onClick={() => void feed.refresh()}>
                      Tap to try again
                    </Button>
                  }
                />
              )
              : (
                <EmptyState
                  ghosts icon="inbox"
                  title={feed.lastEmptySince ? `Nothing new since ${clockTime(feed.lastEmptySince)}.` : 'Nothing here yet.'}
                />
              )}
          </div>
        )}
        <AnimatePresence initial={false}>
          {rows.map(({ g, going }, at) => {
            const day = dayOf(g)
            const head = day === lastDay ? null : day
            lastDay = day
            const isFresh = fresh.has(g.key) && !going
            return (
              <div key={g.key} className="dirb-col">
                {head && (
                  <DayHeader
                    className="dirb-mob-day" label={head} sticky
                    tail={String(perDay.get(head) ?? 0)}
                  />
                )}
                {g.items.length > 1
                  ? (
                    <GroupCard
                      g={g} open={feed.expanded.has(g.key)} onToggle={() => feed.toggle(g.key)}
                      onOpen={openOne}
                      onDismissAll={() => leave(g, at, () => feed.dismissGroupRows(g))}
                      onDismissOne={feed.dismissOne}
                      going={going} fresh={isFresh} index={at}
                    />
                  )
                  : (
                    <NotificationCard
                      n={g.latest} onOpen={openOne}
                      onDismiss={id => leave(g, at, () => feed.dismissOne(id))}
                      going={going} fresh={isFresh} index={at}
                      live={g.key === liveKey}
                    />
                  )}
              </div>
            )
          })}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {pending > 0 && away && (
          <motion.div
            className="dirb-mob-pill"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: fadeT }}
            transition={spring}
          >
            <Button variant="primary" size="sm" icon="up" data-tap onClick={toTop}>
              {pending} new
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
