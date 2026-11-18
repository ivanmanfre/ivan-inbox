// The desk's flags (db desk_config): one small store the whole app reads, seeded from
// this device's last read and replaced by the authenticated read (src/d/desk/flags.ts).
// No imports on purpose: places.ts reads it for the Claude place's nav slot, and
// places.ts is imported by every test of the shell.

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
  try { localStorage.setItem(DESK_FLAGS_KEY, JSON.stringify(f)) } catch { /* private mode: the store still holds it */ }
  setDeskFlags(f, true)
}

// ---- the store ---------------------------------------------------------------
export type DeskFlagState = DeskFlags & { /** The authenticated read has answered in this session. */ read: boolean }
let state: DeskFlagState | null = null
const listeners = new Set<() => void>()

export function deskFlagState(): DeskFlagState {
  if (!state) state = { ...(cachedDeskFlags() ?? FLAGS_OFF), read: false }
  return state
}

export function setDeskFlags(f: DeskFlags, read: boolean): void {
  const cur = deskFlagState()
  const next = { ...f, read: read || cur.read }
  if (cur.desk_enabled === next.desk_enabled && cur.nav_visible === next.nav_visible && cur.t3_enabled === next.t3_enabled
    && cur.triggers_enabled === next.triggers_enabled && cur.read === next.read) return
  state = next
  listeners.forEach(l => l())
}

export function subscribeDeskFlags(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** Tests: forget the in-memory state so the next read starts from localStorage again. */
export function resetDeskFlagStore(): void { state = null; listeners.clear() }

/** The Claude place's nav slot: in the main nav only while nav_visible is on (read live, never captured). */
export function claudeNav(): 'main' | 'hidden' {
  return deskFlagState().nav_visible ? 'main' : 'hidden'
}
