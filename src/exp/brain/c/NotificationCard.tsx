import type { NotificationGroup } from '../../../lib/turns'
import { familyLabel } from './families'

// One system card in the stream: family label, title, one body line, a tap
// target that opens the lane, a swipe (or the ✕) to dismiss, repeats folded
// into this one card with a count. Severity is shape first, a left bar whose
// width and the row's own font-weight carry it, colour only reinforces what
// the shape already said, so the card still reads correctly with colour off.
export function NotificationCard({ group, onOpen, onDismiss }: {
  group: NotificationGroup
  onOpen: () => void
  onDismiss: () => void
}) {
  const n = group.latest
  const unread = group.unread > 0
  const bodyLine = (n.body ?? '').split('\n').find(l => l.trim().length > 0) ?? ''

  return (
    <div
      className={`brc-entry brc-card sev-${n.severity}${unread ? ' unread' : ''}`}
      data-card data-family={n.family} data-stream-key={`n:${group.key}`}
    >
      <div className="brc-card-bar" aria-hidden="true" />
      <button type="button" className="brc-card-tap" onClick={onOpen} aria-label={`Open: ${n.title}`}>
        <div className="brc-card-top">
          {/* Unread is a filled vs hollow mark, never colour alone. */}
          <span className={`brc-unread-mark${unread ? ' on' : ''}`} aria-hidden="true" />
          <span className="brc-card-fam">{familyLabel(n.family)}</span>
          {group.count > 1 && <span className="brc-card-count">×{group.count}</span>}
        </div>
        <div className="brc-card-title">{n.title}</div>
        {bodyLine && <div className="brc-card-body">{bodyLine}</div>}
      </button>
      <button
        type="button" className="brc-card-x" data-dismiss
        onClick={e => { e.stopPropagation(); onDismiss() }}
        aria-label="Dismiss"
      >✕</button>
    </div>
  )
}

/** The quiet toggle's fold: every routine info-severity card, one line. */
export function QuietRow({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <div className="brc-entry brc-quiet" data-quiet-row data-stream-key="quiet-fold">
      <button type="button" className="brc-quiet-tap" onClick={onExpand}>
        {count} quiet update{count === 1 ? '' : 's'}
      </button>
    </div>
  )
}
