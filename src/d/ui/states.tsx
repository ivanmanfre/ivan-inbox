import type { ReactNode } from 'react'
import { DIcon } from './icons'
import { Btn } from './Key'

// Honest states. Every page draws all four; none of them is a blank.

/** Loading: grey bars in the page's own shape. `lines` bars, optional `title` bar. */
export function Skeleton({ lines = 4, title = true, label = 'Loading' }: { lines?: number; title?: boolean; label?: string }) {
  return (
    <div className="d-skel" role="status" aria-live="polite" aria-label={label}>
      {title && <i className="d-skel-t" />}
      {Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${88 - ((i * 17) % 40)}%` }} />)}
    </div>
  )
}

/** Nothing here, with the real reason ("Nothing waiting: the last draft went out at 10:45"). */
export function Empty({ title, reason, action }: { title: ReactNode; reason?: ReactNode; action?: ReactNode }) {
  return (
    <div className="d-empty">
      <p>{title}</p>
      {reason != null && <small>{reason}</small>}
      {action}
    </div>
  )
}

/** A read that failed. Never rendered as "empty". */
export function Failed({ what, onRetry, detail }: { what: string; onRetry?: () => void; detail?: ReactNode }) {
  return (
    <div className="d-failed" role="alert">
      <DIcon name="alert" />
      <div>
        <p>Could not read {what}.</p>
        {detail != null && <small>{detail}</small>}
      </div>
      {onRetry && <Btn onClick={onRetry} verb="retry">Retry</Btn>}
    </div>
  )
}

/** Offline: what is on screen was read at `since` and will not move until the connection is back. */
export function Offline({ since }: { since?: string | null }) {
  return (
    <div className="d-offline" role="status">
      <DIcon name="offline" />
      <span>Offline. {since ? `What you see was read at ${since}.` : 'What you see may be out of date.'} Nothing new loads and nothing sends until you are back.</span>
    </div>
  )
}
