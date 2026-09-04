import type { BrainCandidate } from '../types'
import { Placeholder } from '../placeholder'

// Candidate b. Replaced wholesale by the Phase 2 builder that OWNS this folder.
export const candidate: BrainCandidate = {
  id: 'b',
  Mobile: (p) => <Placeholder id="b" part="Mobile" workSurface={p.workSurface} windows={p.windows} />,
  AskPane: () => <Placeholder id="b" part="AskPane" />,
}
