// place.ts — the localStorage projection for "which place he was in", in the
// today.ts idiom (src/lib/today.ts): a WHITELIST, never a copy, so a corrupted
// or foreign value can never resolve to something the tab bar cannot render.
// Paint the cached value immediately, on mount, before any network round trip.
import type { Job } from '../../v2c/layout'

// The five tab-bar destinations. 'today' | 'dms' | 'work' collapse onto
// whatever `workSurface` the Shell is already rendering for the matching Job;
// 'ask' and 'feed' are owned entirely by this candidate.
export type Place = 'ask' | 'today' | 'dms' | 'work' | 'feed'

const PLACE_KEY = 'brain-a-place'
const WORK_KEY = 'brain-a-worktab'

const VALID_PLACES: readonly Place[] = ['ask', 'today', 'dms', 'work', 'feed']
const VALID_WORK: readonly Job[] = ['content', 'sends', 'ops']

function isPlace(v: unknown): v is Place {
  return typeof v === 'string' && (VALID_PLACES as readonly string[]).includes(v)
}

function isWorkJob(v: unknown): v is Job {
  return typeof v === 'string' && (VALID_WORK as readonly string[]).includes(v)
}

/** null means "nothing cached, or it did not validate" — the caller's default wins. */
export function readPlace(): Place | null {
  try {
    const v = localStorage.getItem(PLACE_KEY)
    return isPlace(v) ? v : null
  } catch {
    return null
  }
}

export function writePlace(p: Place): void {
  try { localStorage.setItem(PLACE_KEY, p) } catch { /* quota / private mode */ }
}

/** Which of the three work jobs the segmented control was last on. Defaults to 'content'. */
export function readWorkTab(): Job {
  try {
    const v = localStorage.getItem(WORK_KEY)
    return isWorkJob(v) ? v : 'content'
  } catch {
    return 'content'
  }
}

export function writeWorkTab(j: Job): void {
  try { localStorage.setItem(WORK_KEY, j) } catch { /* quota / private mode */ }
}
