// ============================================================================
// Direction A — "THE INSTRUMENT".
//
// Eight key screens of the app rebuilt on `src/ds` (the Phase 1 design system)
// as one dense, ruled surface: grouped containers of hairline rows, mono meta
// and tabular figures, sticky compact heads, actions that live inside the row
// and appear on hover or focus, KPI as a ledger rather than a deck of cards,
// the calendar as a real month lattice on desktop and a dense agenda on the
// phone, and the feed as a two-density ledger.
//
// Every screen below is a COPY of the component the app ships, with every hook,
// data call, write, keyboard path, effect and string kept and only the view
// rebuilt. The data layer is untouched: these files import the same
// `src/lib` and `src/hooks` modules the originals do.
//
// Notes, the motion table and the ledger deviations:
// goal-runs/inbox-app-revamp-2026-09-05-out/02-directions/a/NOTES.md
// ============================================================================
import type { Overrides } from '..'

import { Today } from './today'
import { Dms } from './dms'
import { ThreadPeer } from './thread'
import { ContentList } from './content'
import { SendsScreen } from './sends'
import { OpsBoard } from './ops'
import { Settings } from './settings'
import { Mobile, AskPane } from './brain'

export const overrides: Overrides = {
  Today,
  Dms,
  ThreadPeer,
  ContentList,
  SendsScreen,
  OpsBoard,
  Settings,
  Mobile,
  AskPane,
}
