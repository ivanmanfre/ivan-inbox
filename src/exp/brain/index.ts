import { lazy, type ComponentType } from 'react'
import type { BrainAskPaneProps, BrainCandidate, BrainId, BrainMobileProps } from './types'

// Registry. Each candidate folder exports `candidate: BrainCandidate` from its
// index and imports its own CSS layer there (`./brain-<id>.css`), so the
// stylesheet only loads when that candidate is on. Nothing here is reachable
// without `#exp/brain-<id>` in the URL at load (see ../index.tsx).
const LOADERS: Record<BrainId, () => Promise<{ candidate: BrainCandidate }>> = {
  a: () => import('./a'),
  b: () => import('./b'),
  c: () => import('./c'),
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
