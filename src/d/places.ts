import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { DRoute } from './route'
import type { DIconName } from './ui/icons'

// ---------------------------------------------------------------------------
// THE PLACE REGISTRY. One entry per place in the left panel / dock.
//
// A page agent builds `src/d/<place>/index.tsx` (default export, PlaceProps)
// and nothing else in the frame: the lazy import below already points at the
// folder, and until the folder holds a real page its index renders the honest
// "Not built yet" state with a link to today's page (`today`).
//
// Change a line here only to rename a place, move it between the main and the
// low nav, or change which brain-b page the placeholder links to. One line per
// place, blank line between, so two agents never touch the same hunk.
// ---------------------------------------------------------------------------

export type PlaceId = 'lanes' | 'dms' | 'content' | 'ops' | 'sales' | 'claude' | 'settings'

export type Layout = 'desktop' | 'phone'

/** What every page receives from the frame. */
export type PlaceProps = {
  /** Which canvas the frame is drawing. Every page renders both. */
  layout: Layout
  /** The parsed address: place, sub segment, raw query. */
  route: DRoute
  /** Go somewhere inside D. Takes a D hash (use `dHash`) or any old app hash. */
  navigate: (hash: string) => void
}

export type PlaceDef = {
  id: PlaceId
  label: string
  icon: DIconName
  /** Main nav (with the per-seat line) or the low nav above the footer. */
  nav: 'main' | 'low'
  /** On the phone dock (the lime Claude key is the dock's own, not a place key). */
  dock: boolean
  /** Today's equivalent page in the old app, for the "Not built yet" link. */
  today: string
  Page: LazyExoticComponent<ComponentType<PlaceProps>>
}

export const PLACES: Record<PlaceId, PlaceDef> = {
  lanes: { id: 'lanes', label: 'Lanes', icon: 'lanes', nav: 'main', dock: true, today: '#exp/brain-b/sends', Page: lazy(() => import('./lanes')) },

  dms: { id: 'dms', label: 'DMs', icon: 'dms', nav: 'main', dock: true, today: '#exp/brain-b/dms', Page: lazy(() => import('./dms')) },

  content: { id: 'content', label: 'Content', icon: 'content', nav: 'main', dock: true, today: '#exp/brain-b/content', Page: lazy(() => import('./content')) },

  ops: { id: 'ops', label: 'Ops', icon: 'ops', nav: 'main', dock: true, today: '#exp/brain-b/ops', Page: lazy(() => import('./ops')) },

  sales: { id: 'sales', label: 'Sales', icon: 'sales', nav: 'main', dock: true, today: '#exp/brain-b/sales', Page: lazy(() => import('./sales')) },

  claude: { id: 'claude', label: 'Claude', icon: 'claude', nav: 'main', dock: false, today: '#exp/brain-b/ask', Page: lazy(() => import('./claude')) },

  settings: { id: 'settings', label: 'Settings', icon: 'settings', nav: 'low', dock: false, today: '#exp/brain-b/settings', Page: lazy(() => import('./settings')) },
}

/** Draw order: main nav, then low nav. */
export const PLACE_ORDER: readonly PlaceId[] = ['lanes', 'dms', 'content', 'ops', 'sales', 'claude', 'settings']
