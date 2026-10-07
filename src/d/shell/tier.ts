// SPEC-shell-spacing §2.2-2.3: main-column tiers and the Claude drawer mode.
// Pure functions, so the boundaries are unit-tested (tier.test.ts).

export type Tier = 't1' | 't2' | 't3' | 't4'
export type DrawerMode = 'dock' | 'over'

/** Tier floors on the main column's inline size: t3 ≥ 680, t2 ≥ 840, t1 ≥ 1000. */
export const TIER_FLOORS = { t3: 680, t2: 840, t1: 1000 } as const
/** Going UP a tier needs this much past the floor, so a window resized near a line does not flicker. */
export const TIER_HYST = 16
/** Dock the drawer at a canvas of 1080; leave dock only below 1064. */
export const DOCK_AT = 1080
export const UNDOCK_BELOW = 1064
/** The drawer pane (390) plus its 8px right gutter. */
export const DRAWER_W = 390
export const DRAWER_COL = 398

const RANK: Record<Tier, number> = { t4: 0, t3: 1, t2: 2, t1: 3 }
export const tierRank = (t: Tier): number => RANK[t]

function rawTier(w: number): Tier {
  return w >= TIER_FLOORS.t1 ? 't1' : w >= TIER_FLOORS.t2 ? 't2' : w >= TIER_FLOORS.t3 ? 't3' : 't4'
}

/** The tier for a main-column width. With `prev`, a rise needs the floor + 16; a drop is immediate. */
export function tierOf(w: number, prev?: Tier | null): Tier {
  const t = rawTier(w)
  if (!prev || RANK[t] <= RANK[prev]) return t
  // Rising: take the highest tier whose floor + hysteresis is met, but never fall below prev.
  const up = rawTier(w - TIER_HYST)
  return RANK[up] > RANK[prev] ? up : prev
}

/** Dock or overlay for a canvas width C (the space for main + drawer). */
export function drawerMode(c: number, prev?: DrawerMode | null): DrawerMode {
  if (c >= DOCK_AT) return 'dock'
  if (prev === 'dock' && c >= UNDOCK_BELOW) return 'dock'
  return 'over'
}

export type Geometry = { mode: DrawerMode; main: number; tier: Tier }

/**
 * The geometry a canvas width will produce. `shell` off keeps today's frame:
 * the drawer always docks, at `drawerWidth`.
 */
export function targetFor(c: number, o: { drawerOpen: boolean; shell: boolean; prevMode?: DrawerMode | null; prevTier?: Tier | null; drawerWidth?: number }): Geometry {
  const mode: DrawerMode = o.shell && o.drawerOpen ? drawerMode(c, o.prevMode) : 'dock'
  const col = o.drawerOpen && mode === 'dock' ? (o.shell ? DRAWER_COL : o.drawerWidth ?? DRAWER_W) : 0
  const main = Math.max(0, c - col)
  return { mode, main, tier: tierOf(main, o.prevTier) }
}

/** SPEC §4.2: a smaller tier, or dock → over (the canvas shrank), applies at the START of a frame change. */
export function isNarrowing(a: Geometry, b: Geometry): boolean {
  return RANK[b.tier] < RANK[a.tier] || (a.mode === 'dock' && b.mode === 'over')
}
