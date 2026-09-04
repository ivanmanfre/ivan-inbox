import { useEffect, useRef, useState } from 'react'
import { notificationDeepLink, type Notification, type NotificationGroup } from '../../../../../lib/turns'
import { parseWbHash } from '../../../../v2c/route'
import type { Job } from '../../../../v2c/layout'
import type { FeedData } from '../../useFeedData'
import { GroupCard, NotificationCard } from './NotificationCard'

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

export function Feed({ feed, goJob, openThread, onNavigated }: {
  feed: FeedData
  goJob: (j: Job) => void
  openThread: (id: string, turn?: string) => void
  onNavigated: () => void
}) {
  const fresh = useArrivals(feed.groups.map(g => g.key))
  const [leaving, leave] = useLeaving()
  const rows = withLeaving(feed.groups, leaving)

  const openOne = (n: Notification) => {
    feed.markRead(n)
    const route = parseWbHash(notificationDeepLink(n))
    if (route.thread) openThread(route.thread, route.turn)
    else goJob(route.job)
    onNavigated()
  }

  return (
    <div className="bb-feed-body bbf-feed" data-feed>
      {feed.loaded && feed.groups.length === 0 && (
        <div className="bb-feed-empty" data-feed-empty>
          {feed.error
            ? (
              <>
                Could not load the feed.{' '}
                <button type="button" className="bbf-retry-line" data-tap onClick={() => void feed.refresh()}>
                  Tap to try again
                </button>
              </>
            )
            : feed.lastEmptySince ? `Nothing new since ${clockTime(feed.lastEmptySince)}.` : 'Nothing here yet.'}
        </div>
      )}
      {rows.map(({ g, going }, at) => (
        <div
          className={`bbf-slot${fresh.has(g.key) && !going ? ' bbf-enter' : ''}${going ? ' bbf-out' : ''}`}
          key={g.key}
          aria-hidden={going || undefined}
        >
          {g.items.length > 1
            ? (
              <GroupCard
                g={g} open={feed.expanded.has(g.key)} onToggle={() => feed.toggle(g.key)}
                onOpen={openOne}
                onDismissAll={() => leave(g, at, () => feed.dismissGroupRows(g))}
                onDismissOne={feed.dismissOne}
              />
            )
            : (
              <NotificationCard
                n={g.latest} onOpen={openOne}
                onDismiss={id => leave(g, at, () => feed.dismissOne(id))}
              />
            )}
        </div>
      ))}
    </div>
  )
}
