import type { SkinModule } from '../../skin'
import { Mobile } from './Mobile'
import { AskPane } from './AskPane'
import './skin.css'

// Skin b for finalist B — "Cards with a form".
//
// Every notification family gets a card whose SHAPE says what it is before a
// word is read: a reply is a quote, a booking is a time block, an error is a
// bar-edged strip, a Claude answer is a page snippet, a seat or lane health
// change is a status tile, and a repeat is a stacked deck. Severity is carried
// by FORM and POSITION (a needs-you card sits raised at full plate width, an
// informational card lies flat and inset), with colour only reinforcing.
//
// Plan: goal-runs/brain-b-design-elevation-2026-09-04-out/00-plan-b.md
// Notes and the motion table: .../01-build/b/NOTES.md
export const skin: SkinModule['skin'] = { Mobile, AskPane }
