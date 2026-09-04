import type { BrainCandidate } from '../types'
import { Placeholder } from '../placeholder'

// Candidate c. Replaced wholesale by the Phase 2 builder that OWNS this folder.
export const candidate: BrainCandidate = {
  id: 'c',
  Mobile: (p) => <Placeholder id="c" part="Mobile" workSurface={p.workSurface} windows={p.windows} />,
  AskPane: () => <Placeholder id="c" part="AskPane" />,
}
