import { lazy } from 'react'
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
const SKINS: Record<Exclude<Skin, 'plain'>, () => Promise<SkinModule>> = {
  a: () => import('./skins/a'),
  b: () => import('./skins/b'),
}

const loadSkin = SKIN === 'plain' ? null : SKINS[SKIN]
const Mobile = loadSkin
  ? lazy(() => loadSkin().then(m => ({ default: m.skin.Mobile ?? PlainMobile })))
  : PlainMobile
const AskPane = loadSkin
  ? lazy(() => loadSkin().then(m => ({ default: m.skin.AskPane ?? PlainAskPane })))
  : PlainAskPane

export const candidate: BrainCandidate = {
  id: 'b',
  Mobile,
  AskPane,
}
