import { lazy } from 'react'
import type { BrainAskPaneProps, BrainCandidate, BrainMobileProps } from '../types'
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
const SKINS: Record<Exclude<Skin, 'plain'>, () => Promise<SkinModule>> = {
  a: () => import('./skins/a'),
  b: () => import('./skins/b'),
}

const loadSkin = SKIN === 'plain' ? null : SKINS[SKIN]

// A lazy component cannot be the RESOLVED VALUE of another lazy: `brain/index.ts`
// already wraps this candidate as `lazy(() => import('./b').then(m => ({default:
// m.candidate.Mobile})))`, so handing it a lazy here makes React throw "Lazy
// element type must resolve to a class or function" and the whole surface fails
// to mount. It hit `?skin=a` and `?skin=b` identically, the empty skin included,
// which is what proved it was the seam and not a skin. The lazy still exists and
// still code-splits; it is rendered INSIDE a plain component instead of being
// handed over as one. (brain-b-design-elevation-2026-09-04, builder a.)
const LazyMobile = loadSkin ? lazy(() => loadSkin().then(m => ({ default: m.skin.Mobile ?? PlainMobile }))) : null
const LazyAskPane = loadSkin ? lazy(() => loadSkin().then(m => ({ default: m.skin.AskPane ?? PlainAskPane }))) : null
const Mobile = LazyMobile ? (p: BrainMobileProps) => <LazyMobile {...p} /> : PlainMobile
const AskPane = LazyAskPane ? (p: BrainAskPaneProps) => <LazyAskPane {...p} /> : PlainAskPane

export const candidate: BrainCandidate = {
  id: 'b',
  Mobile,
  AskPane,
}
