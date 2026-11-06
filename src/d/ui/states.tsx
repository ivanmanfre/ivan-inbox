import type { ReactNode } from 'react'
import { DIcon } from './icons'
import { Btn } from './Key'
import { warsawHm } from './time'
import '../home/phone-ox-offline.css'

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

/** A read that failed. Never rendered as "empty". `compact`: one line inside a list section (warn colour,
 *  icon, Retry), with "last read HH:MM" when an earlier read worked (`at`, ms or ISO). */
export function Failed({ what, onRetry, detail, compact = false, at }: { what: string; onRetry?: () => void; detail?: ReactNode; compact?: boolean; at?: number | string | null }) {
  const last = at != null && at !== '' ? `last read ${warsawHm(at)}` : null
  if (compact) return (
    <div className="d-failed d-failed-c" role="alert">
      <DIcon name="alert" />
      <p>Could not read {what}.{detail != null && <> {detail}</>}{last && <small> · {last}</small>}</p>
      {onRetry && <Btn onClick={onRetry} verb="retry">Retry</Btn>}
    </div>
  )
  return (
    <div className="d-failed" role="alert">
      <DIcon name="alert" />
      <div>
        <p>Could not read {what}.</p>
        {(detail != null || last) && <small>{detail}{detail != null && last ? ' · ' : ''}{last}</small>}
      </div>
      {onRetry && <Btn onClick={onRetry} verb="retry">Retry</Btn>}
    </div>
  )
}

/** A figure whose read failed (#39): one visible line, "Lanes read failed · Retry". The reason stays in
 *  the title for a mouse; the line itself is what the phone shows. */
export function FailLine({ what, why, onRetry }: { what: string; why?: string | null; onRetry?: () => void }) {
  return (
    <p className="d-failline" role="alert" title={why ?? undefined}>
      <span>{what} read failed</span>
      {onRetry && <> · <button type="button" className="d-failline-k" data-verb="retry" onClick={onRetry}>Retry</button></>}
    </p>
  )
}

/** Offline: what is on screen was read at `since` and will not move until the connection is back. */
export function Offline({ since }: { since?: string | null }) {
  return (
    <div className="d-offline" role="status">
      <DIcon name="offline" />
      <span><span className="d-off-a">Offline. {since ? `What you see was read at ${since}.` : 'What you see may be out of date.'}</span> <span className="d-off-b">Nothing new loads and nothing sends until you are back.</span></span>
    </div>
  )
}
