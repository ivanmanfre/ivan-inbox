import type { BrainCandidate } from '../types'
import { skin } from '../../../wb/ask'

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
export const candidate: BrainCandidate = {
  id: 'b',
  Mobile: skin.Mobile,
  AskPane: skin.AskPane,
}
