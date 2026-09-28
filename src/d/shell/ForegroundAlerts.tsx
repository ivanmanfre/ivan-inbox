import { useCallback, useEffect, useRef, useState } from 'react'
import { isImportantWorkflowFamily } from '../../../supabase/functions/_shared/notification-lifecycle'
import {
  dismissNotification, getActiveNotification, isActiveNotification, listNotifications,
  markNotificationsRead, routableHash, type Notification,
} from '../../lib/turns'
import { pushClientEvent } from '../../lib/pushEvent'
import { dHash, toDHash } from '../route'
import './ForegroundAlerts.css'

type Popup = { row: Notification; count: number; shownAt: number } | null
export type ForegroundHost = {
  bellOpen: boolean
  openBell: () => void
  navigate: (hash: string) => void
  refreshBell: () => void
}

/** Only fresh canonical workflow rows can enter this eight-second surface. */
export function ForegroundAlerts({ host }: { host: ForegroundHost }) {
  const [popup, setPopup] = useState<Popup>(null)
  const [error, setError] = useState(false)
  const seen = useRef(new Set<string>())
  const bellOpen = useRef(host.bellOpen)
  bellOpen.current = host.bellOpen

  const arrive = useCallback(async (id: string) => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || seen.current.has(id)) return
    seen.current.add(id)
    try {
      const row = await getActiveNotification(id)
      if (!row || document.visibilityState !== 'visible' || !navigator.onLine
        || !isImportantWorkflowFamily(row.family) || !isActiveNotification(row)) return
      const destination = routableHash(row.url)
      if (bellOpen.current || (destination && toDHash(destination) === location.hash)) return
      setError(false)
      setPopup(prev => prev ? { ...prev, count: prev.count + 1 } : { row, count: 1, shownAt: Date.now() })
    } catch {
      seen.current.delete(id) // a temporary read failure can recover on the next poll
    }
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: unknown; family?: unknown; notificationId?: unknown } | null
      if (data?.type !== 'push') return
      const event = pushClientEvent(data)
      if (event.notificationId && event.family && isImportantWorkflowFamily(event.family)) void arrive(event.notificationId)
    }
    navigator.serviceWorker?.addEventListener?.('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener?.('message', onMessage)
  }, [arrive])

  // Seed the known IDs on launch and on every resume/reconnect. Only a later
  // visible poll may discover a new row; old inbox history never becomes a popup.
  useEffect(() => {
    let alive = true
    let baseline = true
    const poll = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      try {
        const rows = (await listNotifications()).filter(row => isImportantWorkflowFamily(row.family))
        if (!alive) return
        const fresh = baseline ? [] : rows.filter(row => !seen.current.has(row.id))
        if (baseline) for (const row of rows) seen.current.add(row.id)
        baseline = false
        for (const row of fresh) void arrive(row.id)
      } catch { /* a failed poll cannot establish a baseline */ }
    }
    const reset = () => { baseline = true; void poll() }
    const onVisible = () => {
      setPopup(null)
      if (document.visibilityState === 'visible') reset()
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 20_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', reset)
    window.addEventListener('offline', onVisible)
    return () => {
      alive = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', reset)
      window.removeEventListener('offline', onVisible)
    }
  }, [arrive])

  useEffect(() => {
    if (!popup) return
    const deadline = Math.min(popup.shownAt + 8_000, popup.row.expires_at ? Date.parse(popup.row.expires_at) : Infinity)
    const timer = window.setTimeout(() => { setPopup(null); setError(false) }, Math.max(1, deadline - Date.now()))
    return () => window.clearTimeout(timer)
  }, [popup])

  useEffect(() => { if (host.bellOpen) setPopup(null) }, [host.bellOpen])

  if (!popup || !isActiveNotification(popup.row)) return null

  const open = () => {
    const { row, count } = popup
    setPopup(null)
    if (!isActiveNotification(row)) return
    if (count > 1) { host.openBell(); return }
    void markNotificationsRead([row.id]).then(host.refreshBell).catch(host.refreshBell)
    const url = (row.url ?? '').trim()
    if (/^https?:\/\//i.test(url)) { window.open(url, '_blank', 'noopener,noreferrer'); return }
    host.navigate(toDHash(routableHash(url) ?? '') ?? dHash('lanes'))
  }
  const dismiss = async () => {
    const row = popup.row
    setPopup(null)
    try {
      await dismissNotification(row.id)
      host.refreshBell()
    } catch {
      if (document.visibilityState === 'visible' && isActiveNotification(row)) { setPopup({ row, count: 1, shownAt: Date.now() }); setError(true) }
      host.refreshBell()
    }
  }

  return (
    <aside className="d-foreground" role="status" aria-label="Important alert" data-foreground-alert>
      <div className="d-foreground-copy">
        <b>{popup.count > 1 ? `${popup.count} important alerts` : popup.row.title}</b>
        <small>{popup.count > 1 ? 'Open Alerts to see each one.' : popup.row.body}</small>
        {error && <small className="d-foreground-error">Could not dismiss. Alert restored.</small>}
      </div>
      <div className="d-foreground-actions">
        <button type="button" className="d-foreground-open" data-verb="foreground-open" onClick={open}>Open</button>
        <button type="button" data-verb="foreground-dismiss" onClick={() => void dismiss()}>Dismiss</button>
      </div>
    </aside>
  )
}
