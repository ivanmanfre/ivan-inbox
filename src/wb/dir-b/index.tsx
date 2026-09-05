/* =========================================================================
   Direction B ("surface"), Phase 2 of inbox-app-revamp-2026-09-05.

   Nine screens, each a component with the SAME props as the one it replaces.
   The seam (`src/wb/index.tsx`) hands a mount point one of these when the app
   was booted with `?ds=b`, and the shipped component otherwise, so with no
   flag nothing here loads at all.

   The direction, in one line: a row is a card that lifts into its detail, a
   board is a deck, a calendar is a stack of day cards on the phone and a grid
   of the same cards on the desktop, a figure counts itself up on mount, and a
   sheet tracks the finger to a snap point. More air and larger type than the
   app carries today, still on the eight step ladder.
   ========================================================================= */
import type { Overrides } from '../index'
import { Today } from './today'
import { Dms, ThreadPeer } from './dms'
import { ContentList } from './content'
import { SendsScreen } from './sends'
import { OpsBoard } from './ops'
import { Settings } from './settings'
import { Mobile } from './mobile'
import { AskPane } from './ask'

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
