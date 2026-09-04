// Feed.tsx - the thesis's other half: a DENSE ledger, not a second inbox.
// One ~56px row per folded notification, grouped by family under collapsible
// headers, severity drawn as a shape (never colour alone), built to scan 30
// items in five seconds.
//
// Polls on mount, on visibilitychange, and when the service worker posts a
// push message - never on an interval while the tab is hidden.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  dismissGroup, dismissNotification, groupNotifications, listNotifications,
  markNotificationsRead, type Notification, type NotificationGroup, type NotificationSeverity,
} from '../../../lib/turns'
import { familyLabel, familyLaneLabel } from './families'
import { relAge } from '../../v2c/Surface'

type Severity = 'urgent' | 'attention' | 'info'

function markFor(sev: NotificationSeverity): Severity {
  if (sev === 'error') return 'urgent'
  if (sev === 'attention') return 'attention'
  return 'info'
}

/** "14:20" - a real clock reading, per the mission's empty-state example. */
function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function stateWord(sev: NotificationSeverity): string {
  if (sev === 'error') return 'Needs you'
  if (sev === 'attention') return 'For info'
  return 'For info'
}

// The mark: filled square (urgent) / half-filled square (attention) / hollow
// ring (info). Unread carries full opacity + weight; read dims both - fill
// and weight, never a colour swap, per the mission's severity-is-form rule.
function Mark({ sev, unread }: { sev: Severity; unread: boolean }) {
  return <span className={`ba-mark ${sev}${unread ? ' unread' : ' read'}`} aria-hidden="true" />
}

function FamilySection({ familyKey, groups, open, onToggle, onOpenItem, onDismiss, onDismissGroup }: {
  familyKey: string
  groups: NotificationGroup[]
  open: boolean
  onToggle: () => void
  onOpenItem: (n: Notification) => void
  onDismiss: (id: string) => void
  onDismissGroup: (g: NotificationGroup) => void
}) {
  const unread = groups.reduce((s, g) => s + g.unread, 0)
  const lane = familyLaneLabel(familyKey)
  return (
    <div className="ba-fsec">
      <button type="button" className="ba-fsec-h" onClick={onToggle} aria-expanded={open}>
        <span className="ba-fsec-l">{familyLabel(familyKey)}</span>
        <span className="ba-fsec-n">{groups.length}</span>
        {unread > 0 && <span className="ba-fsec-u" />}
        <span className={`ba-fsec-car${open ? ' open' : ''}`}>›</span>
      </button>
      {open && groups.map(g => (
        <div
          key={g.key} className="ba-card" data-card data-family={familyKey}
          onClick={() => onOpenItem(g.latest)}
        >
          <Mark sev={markFor(g.latest.severity)} unread={g.unread > 0} />
          <div className="ba-card-body">
            <div className="ba-card-top">
              <span className="ba-card-fam">{familyLabel(familyKey)}</span>
              <span className="ba-card-sev">{stateWord(g.latest.severity)}</span>
            </div>
            <div className={`ba-card-title${g.unread > 0 ? ' unread' : ''}`}>{g.latest.title}</div>
            {lane && <div className="ba-card-lane">{lane}</div>}
          </div>
          <div className="ba-card-tail">
            <span className="ba-card-time">{relAge(g.lastSeenAt)}</span>
            {g.count > 1 && <span className="ba-card-pill">{g.count}</span>}
          </div>
          <button
            type="button" className="ba-card-x" aria-label="Dismiss"
            onClick={e => { e.stopPropagation(); onDismiss(g.latest.id) }}
          >✕</button>
          {g.items.length > 1 && (
            <button
              type="button" className="ba-card-clear"
              onClick={e => { e.stopPropagation(); onDismissGroup(g) }}
            >Clear all {g.items.length}</button>
          )}
        </div>
      ))}
    </div>
  )
}

export function Feed({ active, onNavigate, onUnreadChange }: {
  active: boolean
  onNavigate: (n: Notification) => void
  onUnreadChange?: (n: number) => void
}) {
  const [rows, setRows] = useState<Notification[]>([])
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openFamilies, setOpenFamilies] = useState<Set<string>>(new Set())
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const data = await listNotifications({ limit: 200 })
      if (!alive.current) return
      setRows(data)
      setError(null)
      setLoadedAt(new Date().toISOString())
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not load the feed')
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    let swSub: ((e: MessageEvent) => void) | null = null
    if ('serviceWorker' in navigator) {
      swSub = (e: MessageEvent) => { if ((e.data as { type?: string } | undefined)?.type === 'push') void refresh() }
      navigator.serviceWorker.addEventListener('message', swSub)
    }
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onVisible)
      if (swSub && 'serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', swSub)
    }
  }, [refresh])

  const groups = useMemo(() => groupNotifications(rows), [rows])
  const byFamily = useMemo(() => {
    const m = new Map<string, NotificationGroup[]>()
    for (const g of groups) {
      const arr = m.get(g.family)
      if (arr) arr.push(g); else m.set(g.family, [g])
    }
    // Sections ordered by whichever family has the freshest activity.
    return [...m.entries()].sort((a, b) => b[1][0].lastSeenAt.localeCompare(a[1][0].lastSeenAt))
  }, [groups])

  const unreadTotal = useMemo(() => rows.filter(r => !r.read_at).length, [rows])
  useEffect(() => { onUnreadChange?.(unreadTotal) }, [unreadTotal, onUnreadChange])

  // Every family starts open; a section is only in this set once collapsed
  // (D-M7's "scan everything" bet - nothing starts hidden).
  const isOpen = (fam: string) => !openFamilies.has(`closed:${fam}`)
  const onToggle = (fam: string) => setOpenFamilies(s => {
    const key = `closed:${fam}`
    const next = new Set(s)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const openItem = (n: Notification) => {
    void markNotificationsRead([n.id])
    onNavigate(n)
  }

  const doDismiss = (id: string) => {
    setRows(r => r.filter(x => x.id !== id))
    void dismissNotification(id)
  }
  const doDismissGroup = (g: NotificationGroup) => {
    const ids = new Set(g.items.map(i => i.id))
    setRows(r => r.filter(x => !ids.has(x.id)))
    if (g.groupKey) void dismissGroup(g.groupKey)
    else void Promise.all(g.items.map(i => dismissNotification(i.id)))
  }

  return (
    <div className="ba-feed" data-feed aria-hidden={!active}>
      <div className="ba-feed-h">
        <span className="ba-feed-t">Feed</span>
        {unreadTotal > 0 && <span className="ba-feed-unread">{unreadTotal} unread</span>}
      </div>
      {error && <div className="ba-feed-err">{error}</div>}
      {!error && rows.length === 0 && (
        <div className="ba-feed-empty">
          Nothing new{loadedAt ? ` since ${clockTime(loadedAt)}` : ''}.
        </div>
      )}
      <div className="ba-feed-list">
        {byFamily.map(([fam, gs]) => (
          <FamilySection
            key={fam} familyKey={fam} groups={gs} open={isOpen(fam)}
            onToggle={() => onToggle(fam)}
            onOpenItem={openItem} onDismiss={doDismiss} onDismissGroup={doDismissGroup}
          />
        ))}
      </div>
    </div>
  )
}
