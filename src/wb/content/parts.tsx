/* ==========================================================================
   The three data states, the filtered-empty escape, and the pull indicator.

   Copied from `src/exp/v2c/Surface.tsx` (Failed / CalmEmpty / relAge),
   `src/exp/v2c/ContentBits.tsx` (FilteredEmpty / Figure) and
   `src/components/PullIndicator.tsx`. Every string is moved verbatim; only the
   markup is rebuilt on `src/ds` + the kit.
   ========================================================================== */
import type { ReactNode } from 'react'
import { Banner, Button, EmptyState, Icon } from '../../ds'
import './content.css'

/* `relAge` moved to the shared kit in Phase 3 W6 (the rail, Money and Ops read
   it too). Re-exported here so every call site that named this module keeps
   working. */
import { relAge } from '../kit'
export { relAge }

// W3-10: pure so the boundary is unit-testable without a fetch. `count` is the
// cached row set the caller currently holds for the open lane; an empty cache
// must not claim rows survived, and a non-empty one must not lose the claim.
export function cacheLoadedAt(count: number, loadedAt: string | null): string | null {
  return count > 0 ? loadedAt : null
}

/** State 3 — FETCH FAILED. Names what broke, offers the retry, and says what
    the operator is looking at instead (stale rows or nothing). */
export function Failed({ what, message, onRetry, loadedAt, children }: {
  what: string
  message: string
  onRetry?: () => void
  loadedAt?: string | null
  children?: ReactNode
}) {
  return (
    <Banner
      tone="urgent"
      icon="error"
      title={`${what} didn’t load`}
      action={onRetry ? <Button variant="quiet" size="sm" icon="retry" onClick={onRetry}>Try again</Button> : undefined}
    >
      <span className="a-stack" data-tight>
        <span>{message}</span>
        <span className="a-dim">
          {loadedAt
            ? `Showing what loaded ${relAge(loadedAt)}. It may be out of date.`
            : 'Nothing has loaded yet, so this is not an empty queue, it is an unread one.'}
        </span>
        {children}
      </span>
    </Banner>
  )
}

/** State 2 — GENUINELY EMPTY. Calm, terse, with the stamp that makes it a fact
    rather than a hope. */
export function CalmEmpty({ line, loadedAt, sub }: {
  line: string; loadedAt?: string | null; sub?: string
}) {
  return (
    <EmptyState
      icon="check"
      title={line}
      sub={
        <span className="a-stack" data-tight>
          {sub && <span>{sub}</span>}
          {loadedAt !== undefined && <span className="a-mono a-dim">Checked {relAge(loadedAt)}</span>}
        </span>
      }
    />
  )
}

/** An empty result caused by a FILTER, which must never look like an empty
    lane. */
export function FilteredEmpty({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <EmptyState
      icon="filter"
      title={`No ${noun} match this filter.`}
      sub="The lane is not empty, the filter is."
      action={<Button variant="quiet" size="sm" icon="clear" onClick={onClear}>Clear the filter</Button>}
    />
  )
}

/** A number with the denominator it was computed over: any figure that hides
    its own denominator here is fabricated. */
export function Figure({ n, of, label }: { n: number; of: number; label: string }) {
  return <span className="a-mono a-dim"><b className="a-ink">{n}</b> of {of} {label}</span>
}

/** The quiet one-line note a band uses to say what it is reading. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="a-ct-sub">{children}</div>
}

/** The arrow that rides down as you pull to refresh. */
export function PullIndicator({ pull, refreshing, trigger }: {
  pull: number; refreshing: boolean; trigger: number
}) {
  if (pull <= 0 && !refreshing) return null
  const ready = pull >= trigger
  return (
    <div className="a-ct-ptr" style={{ height: pull }} aria-hidden>
      <div
        className="a-ct-ptr-i"
        data-spin={refreshing ? '' : undefined}
        style={{
          opacity: refreshing ? 1 : Math.min(1, pull / trigger),
          transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
        }}
      >
        <Icon name={refreshing ? 'refresh' : ready ? 'up' : 'down'} size={16} />
      </div>
    </div>
  )
}
