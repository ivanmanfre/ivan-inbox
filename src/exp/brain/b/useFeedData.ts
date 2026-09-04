import { useCallback, useEffect, useState } from 'react'
import {
  dismissGroup, dismissNotification, groupNotifications, listNotifications,
  markNotificationsRead, type Notification, type NotificationGroup,
} from '../../../lib/turns'
import { mockFlag } from '../../v2c/mock'
import { mockNotificationRows } from './mockNotifications'

// `?wbmock=feed:demo` — evidence-only, same idiom as the shared `chat:...`
// flags. See mockNotifications.ts for why a fixture stands in here: creating
// live rows to pose for a screenshot is not one of the two writes this run
// is permitted to make against real data.
const FEED_MOCK = mockFlag('feed') === 'demo'

// One fetch, shared by the header's unread badge and the feed sheet's body —
// two renderings of the same data rather than two independent polls that
// could disagree with each other about the count.
export function useFeedData() {
  const [rows, setRows] = useState<Notification[]>([])
  const [lastEmptySince, setLastEmptySince] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (FEED_MOCK) { setRows(mockNotificationRows()); setLoaded(true); return }
    try {
      const live = await listNotifications()
      setRows(live)
      setLoaded(true)
      if (live.length === 0) {
        try {
          const last = await listNotifications({ includeDismissed: true, limit: 1 })
          setLastEmptySince(last[0]?.last_seen_at ?? last[0]?.created_at ?? null)
        } catch { /* the empty state still renders without a time */ }
      }
    } catch {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Poll on mount (above), on visibilitychange, and when the service worker
  // posts {type:'push'} — the three named triggers (D4: polling stands in for
  // a realtime publication edit this run deliberately left out of scope).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const onSwMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | undefined)?.type === 'push') void refresh()
    }
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      navigator.serviceWorker?.removeEventListener?.('message', onSwMessage)
    }
  }, [refresh])

  const groups = groupNotifications(rows)
  const unreadTotal = rows.filter(r => !r.read_at).length

  // MARK-READ ON OPEN, not on scroll-into-view: a fast scroll through a feed
  // with a hundred rows would stamp every one of them read before Ivan had
  // looked at any single one, which is a false "seen" signal worse than no
  // signal. Opening a card (the deep link) or dismissing it are both
  // unambiguous acts of attention; scrolling past is not.
  const markRead = useCallback((n: Notification) => {
    if (!FEED_MOCK) void markNotificationsRead([n.id])
    setRows(prev => prev.map(r => r.id === n.id ? { ...r, read_at: r.read_at ?? new Date().toISOString() } : r))
  }, [])

  const dismissOne = useCallback((id: string) => {
    setRows(prev => prev.filter(r => r.id !== id))
    if (!FEED_MOCK) void dismissNotification(id)
  }, [])

  const dismissGroupRows = useCallback((g: NotificationGroup) => {
    const ids = new Set(g.items.map(i => i.id))
    setRows(prev => prev.filter(r => !ids.has(r.id)))
    if (FEED_MOCK) return
    if (g.groupKey) void dismissGroup(g.groupKey)
    else for (const id of ids) void dismissNotification(id)
  }, [])

  const toggle = useCallback((key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  }), [])

  return {
    rows, groups, unreadTotal, loaded, lastEmptySince, expanded,
    refresh, markRead, dismissOne, dismissGroupRows, toggle,
  }
}

export type FeedData = ReturnType<typeof useFeedData>
