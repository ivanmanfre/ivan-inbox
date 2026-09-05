import type { ReactNode } from 'react'
import { Banner, Button, EmptyState, type IconName } from '../../../ds'
import { relAge } from '../../../exp/v2c/Surface'

// Direction B — the filtered-empty state and the denominator figure, rebuilt on
// `EmptyState` with ghosts. Copied out of `src/exp/v2c/ContentBits.tsx` because
// the LOOK of an empty stage is the look of this screen; every string is the
// one that was there.
//
// An empty result caused by a filter and an empty lane must never look the same
// — the same distinction fetchLaneProbe draws at lane level, applied one level
// down.
export function FilteredEmpty({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <EmptyState
      icon="filter"
      ghosts
      title={`No ${noun} match this filter.`}
      sub="The lane is not empty — the filter is."
      action={<Button variant="quiet" onClick={onClear}>Clear the filter</Button>}
    />
  )
}

// A number with the denominator it was computed over. 28% of Ivan's rows and 36%
// of Mattan's carry no pillar at all, so any figure that hides its own
// denominator here is fabricated (IA §4.2).
export function Figure({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <span className="dirb-dim">
      <b>{n}</b> of {of} {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// The three data states, rebuilt. `relAge` is imported rather than copied: it is
// arithmetic, not a look.
// ---------------------------------------------------------------------------

// State 3 — FETCH FAILED. Names what broke, offers the retry, and says what the
// operator is looking at instead (stale rows or nothing).
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
      icon="alert"
      title={`${what} didn’t load`}
      action={onRetry ? <Button variant="quiet" icon="retry" onClick={onRetry}>Try again</Button> : undefined}
    >
      <div>{message}</div>
      <div className="dirb-dim">
        {loadedAt
          ? `Showing what loaded ${relAge(loadedAt)}. It may be out of date.`
          : 'Nothing has loaded yet, so this is not an empty queue — it is an unread one.'}
      </div>
      {children}
    </Banner>
  )
}

// State 2 — GENUINELY EMPTY. Calm, terse, plus the stamp that makes it a fact
// rather than a hope.
export function CalmEmpty({ line, loadedAt, sub, icon }: {
  line: string; loadedAt?: string | null; sub?: string; icon?: IconName
}) {
  return (
    <EmptyState
      icon={icon ?? 'content'}
      ghosts
      title={line}
      sub={
        <>
          {sub ? <span>{sub}</span> : null}
          {loadedAt !== undefined ? <span>{`Checked ${relAge(loadedAt)}`}</span> : null}
        </>
      }
    />
  )
}
