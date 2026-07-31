import type { ReactNode } from 'react'

// The three states, as three components, so no surface can accidentally render
// two of them the same way.
//
// The audit's P1 U2/U3: Inbox, Drafts and Ops have no error state at all — a
// failed fetch renders the identical "No threads yet." / "Nothing waiting on
// you." copy as a genuinely empty queue, on the screens Ivan opens first every
// day. Meanwhile Sends and Today, the "just checking" surfaces, have the most
// thorough three-way handling in the app. This inverts that: every data surface
// in the workbench routes through here.
//
// The distinguishing signal is not just copy — it is the FRESHNESS STAMP. Today
// already has one (.td-sync "Synced 00:30 · now"); nothing else does. An empty
// list carrying "checked 4s ago" is confirmed empty. An empty list carrying
// nothing is unverified.

export function relAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'never'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// State 3 — FETCH FAILED. Red tier, names what broke, offers the retry, and says
// what the operator is looking at instead (stale rows or nothing).
export function Failed({ what, message, onRetry, loadedAt, children }: {
  what: string
  message: string
  onRetry?: () => void
  loadedAt?: string | null
  children?: ReactNode
}) {
  return (
    <div className="wb-failed">
      <div className="wb-failed-h">
        <span className="wb-failed-dot" />
        <span className="wb-failed-t">{what} didn’t load</span>
        {onRetry && <button className="wb-retry" onClick={onRetry}>Try again</button>}
      </div>
      <div className="wb-failed-m">{message}</div>
      <div className="wb-failed-f">
        {loadedAt
          ? `Showing what loaded ${relAge(loadedAt)}. It may be out of date.`
          : 'Nothing has loaded yet, so this is not an empty queue — it is an unread one.'}
      </div>
      {children}
    </div>
  )
}

// State 2 — GENUINELY EMPTY. Calm, terse, un-corporate (the zero-state voice the
// aesthetics audit named as worth protecting), plus the stamp that makes it a
// fact rather than a hope.
export function CalmEmpty({ line, loadedAt, sub }: {
  line: string; loadedAt?: string | null; sub?: string
}) {
  return (
    <div className="wb-empty">
      <div className="wb-empty-l">{line}</div>
      {sub && <div className="wb-empty-s">{sub}</div>}
      {loadedAt !== undefined && (
        <div className="wb-empty-f">
          <span className="wb-ok-dot" />
          Checked {relAge(loadedAt)}
        </div>
      )}
    </div>
  )
}

// One section-header primitive with optional slots, modelled on Today's .td-zh
// (the strongest of the four unrelated patterns the audit counted). Count, dot
// and chevron are slots; the rule and the letter-spaced label are the constant.
export function SectionHead({ n, title, count, sev, open, onToggle, tail }: {
  n?: string
  title: string
  count?: ReactNode
  sev?: 'clear' | 'attention' | 'urgent' | null
  open?: boolean
  onToggle?: () => void
  tail?: ReactNode
}) {
  return (
    <div className={`wb-sech${onToggle ? ' tap' : ''}`} onClick={onToggle}>
      {n && <span className="wb-sech-n">{n}</span>}
      <span className="wb-sech-t">{title}</span>
      <span className="wb-sech-rule" />
      {tail}
      {count !== undefined && <span className="wb-sech-c">{count}</span>}
      {sev !== undefined && sev !== null && <span className={`wb-sech-dot ${sev}`} />}
      {onToggle && <span className="wb-sech-chev">{open ? '⌄' : '›'}</span>}
    </div>
  )
}

// A proportion bar built from parts. This is the workbench's answer to "every
// section encodes something visually": a stage/lane breakdown is drawn once at
// the top of a list instead of being a column of numbers.
export function StackBar({ parts }: { parts: { key: string; n: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0)
  if (total === 0) return <div className="wb-stack wb-stack-zero" />
  return (
    <div className="wb-stack">
      {parts.filter(p => p.n > 0).map(p => (
        <span
          key={p.key}
          className="wb-stack-seg"
          style={{ width: `${(p.n / total) * 100}%`, background: p.color }}
          title={`${p.key}: ${p.n}`}
        />
      ))}
    </div>
  )
}
