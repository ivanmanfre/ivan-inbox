/* ==========================================================================
   src/wb/ask/index.tsx: the seam.

   Two exports, the same two contracts the skin already had: `Mobile` owns the
   whole 390 screen except the takeover windows, and `AskPane` is the docked
   desktop pane. Nothing about the props changed.
   ========================================================================== */
import { Mobile } from './Mobile'
import { AskPane } from './AskPane'
export { Mobile, AskPane }

// The brain-b skin contract (`src/exp/brain/b/skin.ts`): skin `b`, the default,
// resolves to this module, so the phone chrome and the docked Ask pane are these
// two components on every default load.
export const skin = { Mobile, AskPane }
