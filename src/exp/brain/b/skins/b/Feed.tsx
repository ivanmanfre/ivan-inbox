import { useEffect, useRef, useState } from 'react'
import { notificationDeepLink, type Notification } from '../../../../../lib/turns'
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
 * A dismissed card leaves before its row does. `feed.dismissOne` drops the row
 * from state the instant it is called, so without this the card would vanish
 * between two frames and the list would jump under his hand; the slot is marked
 * leaving, the out animation runs, and the row is dropped when it ends.
 */
function useLeaving(): [Set<string>, (key: string, drop: () => void) => void] {
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const timers = useRef<number[]>([])
  useEffect(() => () => { for (const t of timers.current) window.clearTimeout(t) }, [])
  const leave = (key: string, drop: () => void) => {
    setLeaving(prev => new Set(prev).add(key))
    timers.current.push(window.setTimeout(() => {
      drop()
      setLeaving(prev => { const next = new Set(prev); next.delete(key); return next })
    }, 200))
  }
  return [leaving, leave]
}

export function Feed({ feed, goJob, openThread, onNavigated }: {
  feed: FeedData
  goJob: (j: Job) => void
  openThread: (id: string, turn?: string) => void
  onNavigated: () => void
}) {
  const fresh = useArrivals(feed.groups.map(g => g.key))
  const [leaving, leave] = useLeaving()

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
            ? 'Could not load the feed. Pull to try again.'
            : feed.lastEmptySince ? `Nothing new since ${clockTime(feed.lastEmptySince)}.` : 'Nothing here yet.'}
        </div>
      )}
      {feed.groups.map(g => (
        <div
          className={`bbf-slot${fresh.has(g.key) ? ' bbf-enter' : ''}${leaving.has(g.key) ? ' bbf-out' : ''}`}
          key={g.key}
        >
          {g.items.length > 1
            ? (
              <GroupCard
                g={g} open={feed.expanded.has(g.key)} onToggle={() => feed.toggle(g.key)}
                onOpen={openOne}
                onDismissAll={() => leave(g.key, () => feed.dismissGroupRows(g))}
                onDismissOne={feed.dismissOne}
              />
            )
            : (
              <NotificationCard
                n={g.latest} onOpen={openOne}
                onDismiss={id => leave(g.key, () => feed.dismissOne(id))}
              />
            )}
        </div>
      ))}
    </div>
  )
}
