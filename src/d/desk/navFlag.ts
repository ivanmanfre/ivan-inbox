// The desk's flags (db desk_config) as last read on this device. No imports on
// purpose: places.ts reads this at module load to decide whether the Claude place
// is back in the nav, and places.ts is imported by every test of the shell.

export const DESK_FLAGS_KEY = 'desk-flags-v1'

export type DeskFlags = { desk_enabled: boolean; nav_visible: boolean; t3_enabled: boolean; triggers_enabled: boolean }

export const FLAGS_OFF: DeskFlags = { desk_enabled: false, nav_visible: false, t3_enabled: false, triggers_enabled: false }

export function cachedDeskFlags(): DeskFlags | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(DESK_FLAGS_KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as Partial<DeskFlags>
    return { ...FLAGS_OFF, ...Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'boolean')) }
  } catch { return null }
}

export function saveDeskFlags(f: DeskFlags): void {
  try { localStorage.setItem(DESK_FLAGS_KEY, JSON.stringify(f)) } catch { /* private mode: the nav stays as it was */ }
}

/** The Claude place's nav slot: back in the main nav only once desk_config.nav_visible was read true. */
export function claudeNav(): 'main' | 'hidden' {
  return cachedDeskFlags()?.nav_visible === true ? 'main' : 'hidden'
}
