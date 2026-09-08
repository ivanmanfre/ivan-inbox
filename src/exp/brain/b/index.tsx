import { lazy } from 'react'
import type { BrainCandidate } from '../types'
import { Mobile } from '../../../wb/ask/Mobile'

// Candidate B -- "The state word is the hero." Every feed card and every
// answer's own status line leads with the short bold word for what changed
// (HALTED, replied, booked, failed, running again), a drawn mark whose SHAPE
// carries severity, then who/what, then one line of body. See NOTES.md in
// goal-runs/inbox-brain-app-2026-09-04-out/03-build/b/ for the thesis.
//
// Ivan picked it on 2026-09-04 and it is what the default app mounts.
//
// Phase 3 W6 (inbox-app-revamp-2026-09-05): the skin registry is gone. Skin `b`
// -- the design-system rebuild under `src/wb/ask` -- had been the default since
// W1, and the two surfaces it did not replace never existed, so `?skin=plain`
// and `?skin=a` pointed at two dead trees kept alive only by the loader. Both
// trees, `skin.ts` and `brain-b.css` are deleted; the surfaces below ARE the
// candidate now, imported directly rather than through a lazy indirection that
// had one entry left.
//
// W6-1: `Mobile` comes straight from its own file, never through the
// `wb/ask` barrel. The barrel's `index.tsx` statically imports `AskPane`
// alongside `Mobile`, so importing the barrel here (as `skin.Mobile` used to)
// dragged AskPane's 46.8KB into every mobile route's cold load the moment
// `Mobile` was needed, which is every route (Mobile is always mounted on
// phone). `AskPane` is a desktop-only surface most opens never touch, so it
// is its own `React.lazy` boundary, loaded only when the Ask pane actually
// renders.
export const candidate: BrainCandidate = {
  id: 'b',
  Mobile,
  AskPane: lazy(() => import('../../../wb/ask/AskPane').then(m => ({ default: m.AskPane }))),
}
