import { lazy, type ComponentType } from 'react'
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
export function lazyBrainAsk(id: BrainId): ComponentType<BrainAskPaneProps> {
  return lazy(() => LOADERS[id]().then(m => ({ default: m.candidate.AskPane })))
}

export type { BrainCandidate, BrainId, BrainMobileProps, BrainAskPaneProps } from './types'
