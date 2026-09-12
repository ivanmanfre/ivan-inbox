import { createElement, lazy, type ComponentType } from 'react'
import type { BrainAskPaneProps, BrainCandidate, BrainId, BrainMobileProps } from './types'

// Registry. The candidate folder exports `candidate: BrainCandidate` from its
// index. Phase 3 W6 (inbox-app-revamp-2026-09-05) swept the two losing
// candidates off the disk, so `b` -- the one Ivan picked on 09-04, and the one
// the default app mounts -- is the only row left.
const LOADERS: Record<BrainId, () => Promise<{ candidate: BrainCandidate }>> = {
  b: () => import('./b'),
}

export function loadBrain(id: BrainId): Promise<BrainCandidate> {
  return LOADERS[id]().then(m => m.candidate)
}

// Lazy wrappers so the Shell can render a candidate without owning the promise.
export function lazyBrainMobile(id: BrainId): ComponentType<BrainMobileProps> {
  return lazy(() => LOADERS[id]().then(m => ({ default: m.candidate.Mobile })))
}
// 2026-09-12 (goal run inbox-agent-drawer, Seat B — pre-existing bug found
// while wiring the desktop drawer to this exact function): `candidate.AskPane`
// (b/index.tsx) is ITSELF `React.lazy(...)`, on purpose (its own comment: kept
// out of Mobile's cold load). Wrapping that in a SECOND `lazy()` here made this
// function's resolved `.default` a lazy-element object instead of a class or
// function, which React refuses outright — "Element type is invalid... Lazy
// element type must resolve to a class or function" (error #306), thrown the
// instant the pane actually mounted. `AskPane` on desktop is opened by hand
// (never on boot — Shell's own comment), so nothing forced this path until the
// drawer's own probe (drawer-open.mjs) clicked it. Fixed by returning a plain
// function component as the outer lazy's default, which only re-renders the
// (still independently lazy, still Suspense-boundary-deferred) inner one.
export function lazyBrainAsk(id: BrainId): ComponentType<BrainAskPaneProps> {
  return lazy(() => LOADERS[id]().then(m => {
    const Inner = m.candidate.AskPane
    return { default: (props: BrainAskPaneProps) => createElement(Inner, props) }
  }))
}

export type { BrainCandidate, BrainId, BrainMobileProps, BrainAskPaneProps } from './types'
