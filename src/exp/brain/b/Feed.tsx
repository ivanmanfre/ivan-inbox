import { notificationDeepLink, type Notification } from '../../../lib/turns'
import { parseWbHash } from '../../v2c/route'
import type { Job } from '../../v2c/layout'
import type { FeedData } from './useFeedData'
import { GroupCard, NotificationCard } from './NotificationCard'

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function Feed({ feed, goJob, openThread, onNavigated }: {
  feed: FeedData
  goJob: (j: Job) => void
  /** The thread to open, and the turn inside it the row names. `claude_turn`
   * rows carry both (`./#exp/v2/ask?thread=…&turn=…`), so a tap lands on the
   * ANSWER the notification was about rather than at the bottom of a thread
   * that may have moved on since. */
  openThread: (id: string, turn?: string) => void
  onNavigated: () => void
}) {
  const openOne = (n: Notification) => {
    feed.markRead(n)
    const route = parseWbHash(notificationDeepLink(n))
    if (route.thread) openThread(route.thread, route.turn)
    else goJob(route.job)
    onNavigated()
  }

  return (
    <div className="bb-feed-body" data-feed>
      {feed.loaded && feed.groups.length === 0 && (
        <div className="bb-feed-empty" data-feed-empty>
          {feed.error
            ? 'Could not load the feed. Pull to try again.'
            : feed.lastEmptySince ? `Nothing new since ${clockTime(feed.lastEmptySince)}.` : 'Nothing here yet.'}
        </div>
      )}
      {feed.groups.map(g => (
        g.items.length > 1
          ? (
            <GroupCard
              key={g.key} g={g} open={feed.expanded.has(g.key)} onToggle={() => feed.toggle(g.key)}
              onOpen={openOne} onDismissAll={() => feed.dismissGroupRows(g)} onDismissOne={feed.dismissOne}
            />
          )
          : <NotificationCard key={g.key} n={g.latest} onOpen={openOne} onDismiss={feed.dismissOne} />
      ))}
    </div>
  )
}
