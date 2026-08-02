// Per-section UI state, persisted — generalized from the Today tab's cache.
//
// today.ts:335 already established the only pattern this app is allowed to use
// for localStorage: "WHITELIST PROJECTION, NOT A COPY". Everything written is
// enumerated field by field, capability links (…?k=…) are dropped at the
// projection and never re-added, and a spread is never permitted to stand in
// for the field list. That rule was written for a cached payload of real rows;
// this file applies the same discipline to something much smaller and much less
// dangerous — which facet a human picked and what they typed into a search box.
//
// TWO LOCKS, both here, both tested:
//
//   1. FIELD ALLOWLIST. `project()` reconstructs the object from two named
//      fields (`filters`, `q`) and nothing else survives the trip in EITHER
//      direction. A stored blob that has grown a third key is not merged, not
//      trusted, not passed through — the extra key is dropped on read as well
//      as on write, because the thing on disk is attacker-writable in exactly
//      the way the in-memory object is not.
//   2. VERSION KEY. `v` must equal SECTION_STATE_VERSION. A miss returns the
//      empty state rather than a half-understood one. Facet KEYS are a data
//      contract (`qa_verdict`, `image_style`, the family-keyed `structure`), so
//      when that contract changes the honest move is to forget, not to restore
//      a filter whose meaning moved under it.
//
// WHAT IS NEVER PERSISTED: row data of any kind. No titles, no bodies, no ids,
// no urls, no counts. A facet key, a facet value and a search string are the
// complete surface. `filters` values ARE user-adjacent (they are database
// values like `story_opener`), so they are length-capped and count-capped, but
// they are never row content.

export const SECTION_STATE_VERSION = 1

export type SectionState = {
  // One value per facet key — the same shape as contentFilters' FilterState.
  filters: Record<string, string>
  // Free-text search over the loaded rows. Client-side, never a query param.
  q: string
}

// The allowlist, as data rather than as prose. Exported so the test can assert
// that a field nobody named cannot reach storage.
export const SECTION_FIELDS = ['filters', 'q'] as const

export const EMPTY_SECTION_STATE: SectionState = { filters: {}, q: '' }

// Caps. A facet key is a code-side identifier, a facet value is a database
// value, and neither has any business being long. The caps exist so a corrupted
// or hand-edited entry cannot become a storage-quota or a render problem.
const MAX_FACETS = 24
const MAX_KEY_LEN = 40
const MAX_VALUE_LEN = 160
const MAX_Q_LEN = 120

// Facet keys are written by this codebase, never by a database row, so they are
// held to an identifier shape. Anything else is not a key we emitted.
const KEY_RE = /^[a-z][a-z0-9_]*$/

function projectFilters(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_FACETS) break
    if (typeof k !== 'string' || k.length > MAX_KEY_LEN || !KEY_RE.test(k)) continue
    // A non-string value is not a facet value. FilterState is
    // Record<string,string> by construction (contentFilters.ts:37) and an
    // object here would be a shape this surface never wrote.
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (!s) continue // an empty value is "no filter", stored as absence
    out[k] = s.slice(0, MAX_VALUE_LEN)
    n += 1
  }
  return out
}

/**
 * The projection. Both the write path and the read path go through it, so the
 * allowlist is enforced twice and can never be enforced in only one direction.
 */
export function projectSectionState(input: unknown): SectionState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...EMPTY_SECTION_STATE }
  const o = input as Record<string, unknown>
  return {
    filters: projectFilters(o.filters),
    q: typeof o.q === 'string' ? o.q.slice(0, MAX_Q_LEN) : '',
  }
}

export function isEmptySectionState(s: SectionState): boolean {
  return !s.q && Object.keys(s.filters).length === 0
}

// One namespace, so every adopting surface (Sends, Drafts, Ops) is one string
// away and nothing else on this origin can collide with it.
export function sectionStorageKey(section: string): string {
  return `wb-section:${section}`
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Safari private mode throws on the property access itself.
    return null
  }
}

/**
 * Read a section's state. Any failure — absent, unparseable, wrong version,
 * wrong shape — returns the empty state. A filter you cannot explain is worse
 * than no filter: it is rows silently missing (AFFORDANCES §3, "no filter is a
 * default — a default filter is a hidden row").
 */
export function readSectionState(section: string, store: Storage | null = defaultStorage()): SectionState {
  if (!store) return { ...EMPTY_SECTION_STATE }
  let raw: string | null = null
  try {
    raw = store.getItem(sectionStorageKey(section))
  } catch {
    return { ...EMPTY_SECTION_STATE }
  }
  if (!raw) return { ...EMPTY_SECTION_STATE }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...EMPTY_SECTION_STATE }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_SECTION_STATE }
  if ((parsed as { v?: unknown }).v !== SECTION_STATE_VERSION) return { ...EMPTY_SECTION_STATE }
  return projectSectionState(parsed)
}

/**
 * Write a section's state, or delete the entry entirely when the state is
 * empty. Deleting matters: a surface with no filter should leave no trace, so
 * "did I leave a filter on?" is answerable by the absence of the key.
 */
export function writeSectionState(
  section: string, state: SectionState, store: Storage | null = defaultStorage(),
): void {
  if (!store) return
  const safe = projectSectionState(state)
  try {
    if (isEmptySectionState(safe)) {
      store.removeItem(sectionStorageKey(section))
      return
    }
    store.setItem(sectionStorageKey(section), JSON.stringify({
      v: SECTION_STATE_VERSION,
      filters: safe.filters,
      q: safe.q,
    }))
  } catch {
    // Quota or a disabled store. A filter that cannot be remembered is not an
    // error the operator needs to see.
  }
}
