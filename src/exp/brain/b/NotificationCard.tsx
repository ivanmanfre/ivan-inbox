import type { Notification, NotificationGroup } from '../../../lib/turns'
import { FAMILY_LANE, familyLabel, groupStateWord, sanitizeBody, severityShape, stateWord } from './families'
import { JOB_LABEL } from '../../v2c/layout'

// A tenant chip, drawn ONLY off the row's own `tenant` column — never a guess
// off body text (00-notification-families.md flags that a tenant tag is
// almost never structural in the source corpus; where the pipeline has not
// resolved one, the chip is simply absent rather than invented).
function TenantChip({ tenant }: { tenant: string | null }) {
  if (!tenant) return null
  const label = /rise/i.test(tenant) ? 'RISE' : /arch/i.test(tenant) ? 'ARCH' : /ivan/i.test(tenant) ? 'Mine' : tenant
  return <span className="bb-tenant">{label}</span>
}

function openLabel(family: string): string | null {
  const lane = FAMILY_LANE[family as keyof typeof FAMILY_LANE]
  return lane ? `Open in ${JOB_LABEL[lane]}` : null
}

export function NotificationCard({ n, onOpen, onDismiss }: {
  n: Notification
  onOpen: (n: Notification) => void
  onDismiss: (id: string) => void
}) {
  const shape = severityShape(n.severity)
  const word = stateWord(n)
  const unread = !n.read_at
  const open = openLabel(n.family)
  return (
    <div className={`bb-card${unread ? ' unread' : ''}`} data-card data-family={n.family} data-shape={shape}>
      <div className="bb-mark" data-shape={shape}><i /></div>
      <div className="bb-card-body" onClick={() => onOpen(n)}>
        <span className={`bb-card-word${unread ? ' unread' : ''}`}>{word}</span>
        <span className="bb-card-who">{familyLabel(n.family)}</span>
        {n.body && <span className="bb-card-body-l">{sanitizeBody(n.body).slice(0, 140)}</span>}
        <div className="bb-card-meta">
          <TenantChip tenant={n.tenant} />
          <span>{new Date(n.last_seen_at || n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        </div>
        {open && (
          <div className="bb-card-actions">
            <button type="button" className="bb-card-open" onClick={e => { e.stopPropagation(); onOpen(n) }}>{open}</button>
          </div>
        )}
      </div>
      <button type="button" className="bb-card-dismiss" aria-label="Dismiss" onClick={() => onDismiss(n.id)}>✕</button>
    </div>
  )
}

export function GroupCard({ g, open, onToggle, onOpen, onDismissAll, onDismissOne }: {
  g: NotificationGroup
  open: boolean
  onToggle: () => void
  onOpen: (n: Notification) => void
  onDismissAll: () => void
  onDismissOne: (id: string) => void
}) {
  const shape = severityShape(g.latest.severity)
  const unread = g.unread > 0
  return (
    <div className={`bb-card${unread ? ' unread' : ''}`} data-card data-family={g.family} data-shape={shape}>
      <div className="bb-mark" data-shape={shape}><i /></div>
      <div className="bb-card-body" onClick={onToggle}>
        <span className="bb-card-hero">{g.count}</span>
        <span className="bb-card-who">{familyLabel(g.family)}</span>
        <span className="bb-card-body-l">{groupStateWord(g.count, g.family)} · latest {new Date(g.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        <div className="bb-card-meta">
          <TenantChip tenant={g.latest.tenant} />
          <span>{open ? 'hide' : 'show'} {g.items.length}</span>
        </div>
      </div>
      <button type="button" className="bb-card-dismiss" aria-label="Dismiss all" onClick={onDismissAll}>✕</button>
      <div className={`bb-group-items${open ? ' open' : ''}`}>
        {open && g.items.map(item => (
          <NotificationCard key={item.id} n={item} onOpen={onOpen} onDismiss={onDismissOne} />
        ))}
      </div>
    </div>
  )
}
