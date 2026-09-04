import type { BrainCandidate } from '../types'
import { Mobile } from './Mobile'
import { AskPane } from './AskPane'
import './brain-c.css'

// Candidate C — "One stream". The phone opens on a single chronological
// timeline where his turns to Claude and the notifications that arrived are
// ONE feed, newest at the bottom like a chat, with the composer always docked.
// See NOTES.md in this candidate's evidence folder for the full thesis.
export const candidate: BrainCandidate = {
  id: 'c',
  Mobile,
  AskPane,
}
