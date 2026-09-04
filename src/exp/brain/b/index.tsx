import type { BrainCandidate } from '../types'
import { Mobile } from './Mobile'
import { AskPane } from './AskPane'
import './brain-b.css'

// Candidate B — "The state word is the hero." Every feed card and every
// answer's own status line leads with the short bold word for what changed
// (HALTED, replied, booked, failed, running again), a drawn mark whose SHAPE
// carries severity, then who/what, then one line of body. See NOTES.md in
// goal-runs/inbox-brain-app-2026-09-04-out/02-candidates/b/ for the full
// thesis, the family -> card map, the tab grouping decision and the motion
// list.
export const candidate: BrainCandidate = {
  id: 'b',
  Mobile,
  AskPane,
}
