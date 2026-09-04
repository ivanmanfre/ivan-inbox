import { useRef, useState } from 'react'
import { notificationDeepLink, type Notification } from '../../../../../lib/turns'
import { parseWbHash } from '../../../../v2c/route'
import type { Job } from '../../../../v2c/layout'
import type { FeedData } from '../../useFeedData'
import { LedgerGroup, LedgerRow } from './LedgerRow'

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * The ledger. One scroller, hairline-separated rows, nothing boxed.
 *
 * The one piece of state this file owns beyond the shared `useFeedData` is the
 * SETTLE: when a row leaves, the rows under it were already drawn at the old
 * offset, so they are handed the height of the gap that just opened and close
 * it over one beat. Without it the list teleports and the eye loses its place.
 */
export function Feed({ feed, goJob, openThread, onNavigated }: {
  feed: FeedData
  goJob: (j: Job) => void
  openThread: (id: string, turn?: string) => void
  onNavigated: () => void
}) {
  const [settle, setSettle] = useState<{ after: number; h: number; token: number } | null>(null)
  const token = useRef(0)

  const openOne = (n: Notification) => {
    feed.markRead(n)
    const route = parseWbHash(notificationDeepLink(n))
    if (route.thread) openThread(route.thread, route.turn)
    else goJob(route.job)
    onNavigated()
  }

  const leave = (after: number, h: number, run: () => void) => {
    token.current += 1
    const t = token.current
    setSettle({ after, h, token: t })
    run()
    window.setTimeout(() => setSettle(s => (s && s.token === t ? null : s)), 260)
  }

  return (
    <div className="bb-feed-body bb-a-led" data-feed>
      {feed.loaded && feed.groups.length === 0 && (
        <div className="bb-feed-empty bb-a-empty" data-feed-empty>
          {feed.error
            ? 'Could not load the feed. Pull to try again.'
            : feed.lastEmptySince ? `Nothing new since ${clockTime(feed.lastEmptySince)}.` : 'Nothing here yet.'}
        </div>
      )}
      {feed.groups.map((g, i) => {
        const settling = settle && i > settle.after
        const style = settling ? ({ ['--bb-a-h' as string]: `${settle.h}px` } as React.CSSProperties) : undefined
        const cls = settling ? 'bb-a-settling' : undefined
        return (
          <div className={cls} style={style} key={g.key}>
            {g.items.length > 1
              ? (
                <LedgerGroup
                  g={g} open={feed.expanded.has(g.key)} onToggle={() => feed.toggle(g.key)}
                  onOpen={openOne}
                  onDismissAll={() => leave(i, 0, () => feed.dismissGroupRows(g))}
                  onDismissOne={(id, h) => leave(i, h, () => feed.dismissOne(id))}
                />
              )
              : (
                <LedgerRow
                  n={g.latest} onOpen={openOne}
                  onDismiss={(id, h) => leave(i, h, () => feed.dismissOne(id))}
                />
              )}
          </div>
        )
      })}
    </div>
  )
}
