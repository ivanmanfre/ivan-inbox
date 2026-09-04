import type { BrainCandidate } from '../types'
import { BrainMobile } from './Mobile'
import { BrainAskPane } from './AskPane'
import './brain-a.css'

// Candidate a - "Thread first, feed as a dense ledger." Ask is the calm home;
// the feed is a scannable ledger one tap or one swipe away. See NOTES.md in
// goal-runs/inbox-brain-app-2026-09-04-out/02-candidates/a/ for the design
// thesis, the family->card map and the motion list.
export const candidate: BrainCandidate = {
  id: 'a',
  Mobile: BrainMobile,
  AskPane: BrainAskPane,
}
