import type { SkinModule } from '../../skin'
import { Mobile } from './Mobile'
import { AskPane } from './AskPane'
import './skin.css'

// Skin a — "The ledger". The feed is a de-bordered ledger of hairline-separated
// rows with one column of severity marks; the state word is the only display
// element; the Ask thread reads like a document. Motion is a system of seven
// named rules and nothing else moves. Plan: 00-plan-a.md, notes: 01-build/a.
export const skin: SkinModule['skin'] = { Mobile, AskPane }
