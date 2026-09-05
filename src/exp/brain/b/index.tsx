import { lazy, Suspense } from 'react'
import type { BrainAskPaneProps, BrainMobileProps } from '../types'
import type { BrainCandidate } from '../types'
import { Mobile as PlainMobile } from './Mobile'
import { AskPane as PlainAskPane } from './AskPane'
import { SKIN, type Skin, type SkinModule } from './skin'
import './brain-b.css'

// Candidate B — "The state word is the hero." Every feed card and every
// answer's own status line leads with the short bold word for what changed
// (HALTED, replied, booked, failed, running again), a drawn mark whose SHAPE
// carries severity, then who/what, then one line of body. See NOTES.md in
// goal-runs/inbox-brain-app-2026-09-04-out/03-build/b/ for the thesis.
//
// Skins (goal run brain-b-design-elevation-2026-09-04): a skin folder under
// ./skins/<x>/ owns a CSS layer and any component it chooses to replace. The
// shared components carry `skin-<x>` on their root so the layer can scope.
// Phase 3 W1 (inbox-app-revamp-2026-09-05): skin `b`, the default, is now the
// design-system rebuild under `src/wb/ask`. `?skin=plain` still reaches the B
// that shipped on 09-04 and `?skin=a` its first elevation; both are swept in W6.
const SKINS: Record<Exclude<Skin, 'plain'>, () => Promise<SkinModule>> = {
  a: () => import('./skins/a'),
  b: () => import('../../../wb/ask'),
}

// The registry in ../index.ts already wraps `candidate.Mobile` in React.lazy,
// and React refuses a lazy that resolves to another lazy (#306). So the skinned
// surface is a plain function component owning its own Suspense boundary.
const loadSkin = SKIN === 'plain' ? null : SKINS[SKIN]
const LazyMobile = loadSkin ? lazy(() => loadSkin().then(m => ({ default: m.skin.Mobile ?? PlainMobile }))) : null
const LazyAskPane = loadSkin ? lazy(() => loadSkin().then(m => ({ default: m.skin.AskPane ?? PlainAskPane }))) : null
const Mobile = LazyMobile
  ? (p: BrainMobileProps) => <Suspense fallback={null}><LazyMobile {...p} /></Suspense>
  : PlainMobile
const AskPane = LazyAskPane
  ? (p: BrainAskPaneProps) => <Suspense fallback={null}><LazyAskPane {...p} /></Suspense>
  : PlainAskPane

// Phase 3 W1 (inbox-app-revamp-2026-09-05): the phone chrome and the docked Ask
// pane are the design-system rebuilds under `src/wb/ask`. The plain and skinned
// components above stay reachable through `?skin=plain` and `?skin=a` until W6
// sweeps them.
export const candidate: BrainCandidate = {
  id: 'b',
  Mobile,
  AskPane,
}
