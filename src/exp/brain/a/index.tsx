import type { BrainCandidate } from '../types'
import { Placeholder } from '../placeholder'

// Candidate a. Replaced wholesale by the Phase 2 builder that OWNS this folder.
export const candidate: BrainCandidate = {
  id: 'a',
  Mobile: (p) => <Placeholder id="a" part="Mobile" workSurface={p.workSurface} windows={p.windows} />,
  AskPane: () => <Placeholder id="a" part="AskPane" />,
}
