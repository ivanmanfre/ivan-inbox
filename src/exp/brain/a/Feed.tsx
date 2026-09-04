// Feed.tsx - the thesis's other half: a DENSE ledger, not a second inbox.
// One row per folded notification, grouped by family under collapsible
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
import { familyEyebrow, familyLabel, familyLaneLabel, groupChange, plainHeadline } from './families'
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
  const laneLabel = familyLaneLabel(familyKey)
  // claude_turn's own `title` column carries the prompt he sent (inbox-turn-run
  // fills it that way for its dedupe key), not what he came back to read. The
  // answer he actually wants is `body` - so this one family swaps which field
  // is the headline and which is the small line underneath.
  const isTurn = familyKey === 'claude_turn'
  const label = familyLabel(familyKey)
  return (
    <div className="ba-fsec">
      <button type="button" className="ba-fsec-h" onClick={onToggle} aria-expanded={open}>
        <span className="ba-fsec-l">{label}</span>
        <span className="ba-fsec-n">{groups.length}</span>
        {unread > 0 && <span className="ba-fsec-u" aria-label={`${unread} unread`} />}
        <span className={`ba-fsec-car${open ? ' open' : ''}`} aria-hidden="true">›</span>
      </button>
      {open && groups.map(g => {
        // Every line that reaches the screen is stripped of the producer's
        // markdown and status emoji first: these bodies were written for a
        // chat app, and `**File:**` as a headline reads as source code.
        const answerLine = plainHeadline(g.latest.body)
        const promptLine = plainHeadline(g.latest.title)
        const headline = isTurn && answerLine ? answerLine : promptLine
        const eyebrow = familyEyebrow(familyKey, g.latest.severity)
        const change = groupChange(g.latest.title, g.items[1]?.title, g.count, g.items.length)
        const meta = [
          eyebrow,
          isTurn ? (answerLine ? promptLine : null) : laneLabel,
          g.count > 1 ? `×${g.count}` : null,
          change === 'changed' ? 'changed' : null,
        ].filter(Boolean) as string[]
        return (
          <div
            key={g.key} className="ba-card" data-card data-family={familyKey}
            data-change={change}
            onClick={() => onOpenItem(g.latest)}
          >
            <Mark sev={markFor(g.latest.severity)} unread={g.unread > 0} />
            <div className="ba-card-body">
              <div className={`ba-card-title${g.unread > 0 ? ' unread' : ''}`}>{headline}</div>
              {meta.length > 0 && <div className="ba-card-meta">{meta.join(' · ')}</div>}
            </div>
            <span className="ba-card-time">{relAge(g.lastSeenAt)}</span>
            <button
              type="button" className="ba-card-x"
              aria-label={g.items.length > 1 ? `Dismiss all ${g.items.length}` : 'Dismiss'}
              onClick={e => {
                e.stopPropagation()
                if (g.items.length > 1) onDismissGroup(g); else onDismiss(g.latest.id)
              }}
            >✕</button>
          </div>
        )
      })}
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

  // Before the first read lands there is nothing TRUE to say about what is or
  // is not new, so the surface says it is still looking rather than printing
  // an empty state it has not earned.
  const loading = loadedAt === null && !error

  return (
    <div className="ba-feed" data-feed aria-hidden={!active}>
      <div className="ba-feed-h">
        <span className="ba-feed-t">Feed</span>
        {unreadTotal > 0 && (
          <span className="ba-feed-unread"><span className="ba-feed-dot" aria-hidden="true" />{unreadTotal} unread</span>
        )}
      </div>
      {error && <div className="ba-feed-err">{error}</div>}
      {loading && (
        <div className="ba-feed-load" data-loading>
          <div className="ba-feed-load-t">Reading what came in.</div>
          <div className="ba-skel-list">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="ba-skel-row">
                <span className="ba-skel-mark" />
                <span className="ba-skel-line" />
                <span className="ba-skel-line short" />
              </div>
            ))}
          </div>
        </div>
      )}
      {!error && !loading && loadedAt && rows.length === 0 && (
        <div className="ba-feed-empty">
          Nothing new since {clockTime(loadedAt)}.
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
