import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dismissAllNotifications, dismissGroup, dismissNotification, groupNotifications, listNotifications,
  markNotificationsRead, mergeBackRows, restoreDismissedAt, restoreNotifications,
  type Notification, type NotificationGroup,
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
  // A read that FAILED is not an empty inbox. Without this flag the catch below
  // set `loaded` on an empty `rows` and the sheet said "Nothing here yet." — a
  // claim the data does not hold, and the one that makes him miss a lead.
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (FEED_MOCK) { setRows(mockNotificationRows()); setLoaded(true); return }
    try {
      const live = await listNotifications()
      setRows(live)
      setError(false)
      setLoaded(true)
      if (live.length === 0) {
        try {
          const last = await listNotifications({ includeDismissed: true, limit: 1 })
          setLastEmptySince(last[0]?.last_seen_at ?? last[0]?.created_at ?? null)
        } catch { /* the empty state still renders without a time */ }
      }
    } catch (e) {
      // The detail stays in the console, where it is useful; the surface says
      // one fixed sentence rather than a column name off a failed read.
      console.error('[brain-b] feed read failed', e)
      setError(true)
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

  // W2-4: a dismiss the server refused must not read as done. The row leaves
  // the list on the tap (so the gesture still feels instant) but the write is
  // AWAITED, not fired-and-forgotten, the caller learns whether it landed,
  // and on a throw (the audit's interceptor 403s every PATCH; a real network
  // drop looks the same to this catch) the row goes right back via the same
  // merge rule Undo uses, instead of staying gone under a claim nobody made
  // good on.
  const dismissOne = useCallback(async (id: string, row: Notification): Promise<boolean> => {
    setRows(prev => prev.filter(r => r.id !== id))
    if (FEED_MOCK) return true
    try {
      await dismissNotification(id)
      return true
    } catch (e) {
      console.error('[brain-b] dismiss failed', e)
      setRows(prev => mergeBackRows(prev, [row]))
      return false
    }
  }, [])

  const dismissGroupRows = useCallback(async (g: NotificationGroup): Promise<boolean> => {
    const ids = new Set(g.items.map(i => i.id))
    setRows(prev => prev.filter(r => !ids.has(r.id)))
    if (FEED_MOCK) return true
    try {
      if (g.groupKey) await dismissGroup(g.groupKey)
      else await Promise.all(g.items.map(i => dismissNotification(i.id)))
      return true
    } catch (e) {
      console.error('[brain-b] group dismiss failed', e)
      setRows(prev => mergeBackRows(prev, g.items))
      return false
    }
  }, [])

  /**
   * The inverse of the two dismisses, for the toast's Undo (move 8).
   *
   * The caller hands back the ROWS it removed, not their ids alone, because the
   * feed does not refetch to answer an undo: the rows go straight back into the
   * list in the same commit the press happens in, and the write follows. That
   * is the same order the dismiss uses, for the same reason — a screen that
   * closes inside the network window must not lose the act.
   *
   * `dismissed_at` is cleared for real, so the row is live again for every
   * other reader of the feed as well, not merely visible on this device.
   */
  const restore = useCallback((back: Notification[]) => {
    if (!back.length) return
    // Same merge rule the failed-dismiss rollback above uses (W2-4): one place
    // decides how a row that left comes back, whether the reason is Undo or a
    // refused write.
    setRows(prev => mergeBackRows(prev, back))
    if (!FEED_MOCK) void restoreNotifications(back.map(r => r.id))
  }, [])

  /**
   * Clear the whole feed. Optimistic like the single dismiss: the rows leave
   * this device in the same commit as the press, and the server statement
   * closes every open row, loaded or not. Returns the stamp the rows took, so
   * the receipt's Undo can hand it to undoClear; null when the write failed,
   * in which case the rows are already back on screen.
   */
  const rowsRef = useRef<Notification[]>(rows)
  rowsRef.current = rows
  const clearAll = useCallback(async (): Promise<string | null> => {
    const stamp = new Date().toISOString()
    const before = rowsRef.current
    setRows([])
    if (FEED_MOCK) return stamp
    try {
      await dismissAllNotifications(stamp)
      return stamp
    } catch (e) {
      console.error('[brain-b] clear all failed', e)
      setRows(prev => mergeBackRows(prev, before))
      return null
    }
  }, [])

  const undoClear = useCallback(async (stamp: string) => {
    if (!FEED_MOCK) {
      try { await restoreDismissedAt(stamp) } catch (e) { console.error('[brain-b] undo clear failed', e) }
    }
    await refresh()
  }, [refresh])

  const toggle = useCallback((key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  }), [])

  return {
    rows, groups, unreadTotal, loaded, error, lastEmptySince, expanded,
    refresh, markRead, dismissOne, dismissGroupRows, restore, toggle, clearAll, undoClear,
  }
}

export type FeedData = ReturnType<typeof useFeedData>
