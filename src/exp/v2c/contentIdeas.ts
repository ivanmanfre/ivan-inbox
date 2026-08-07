import type { FilterState } from '../../lib/contentFilters'

// The two rules the IDEAS band obeys inside the post lane, as pure functions —
// the same split this directory already uses for `layout.ts` / `route.ts` /
// `freshness.ts`: the decision is unit-testable, the render is not.

// The ideas band's open flag rides in the SAME persisted array the stage
// sections use (`sect.open`, sectionState.ts) so it survives a reload — it used
// to be a component-local `useState(true)`, which is why collapsing 74 rows
// lasted exactly until the next load. Default OPEN, unchanged: Ivan,
// 2026-08-04, "LOOK HOW ANNOYING IS NOW TO OPEN EVERYTHING".
//
// 🔴 It CANNOT ride the stage sections' TOUCHED sentinel. A browser that had
// already decided about stages before this shipped carries TOUCHED without
// `ideas`, which under the stages' rule reads as "closed" — that would reverse
// the 08-04 default on every existing install. Two decisions, two sentinels,
// one entry, and no storage-key bump (which would have cost the stored
// filters). `ideas` cannot collide with a stage key: neither lane ever renders
// a StageSection for the ideas stage (both filter it out of PIPELINE_STAGES).
export const IDEAS_OPEN = 'ideas'
export const IDEAS_TOUCHED = 'ideas_touched'

export function ideasIsOpen(persisted: string[]): boolean {
  return persisted.includes(IDEAS_TOUCHED) ? persisted.includes(IDEAS_OPEN) : true
}

export function toggleIdeasOpen(persisted: string[]): string[] {
  const rest = persisted.filter(x => x !== IDEAS_OPEN && x !== IDEAS_TOUCHED)
  return ideasIsOpen(persisted)
    ? [...rest, IDEAS_TOUCHED]
    : [...rest, IDEAS_OPEN, IDEAS_TOUCHED]
}

// 🔴 ONE ARRAY, TWO WRITERS — so the OTHER writer's rebuild lives here too.
//
// The stage sections carry their own sentinel in this same array and rebuild
// the array from their DEFAULT_OPEN the first time the operator touches a
// section (until then their sentinel is absent, and an empty answer has to stay
// distinguishable from an undecided one). That rebuild used to be written
// against `initial` alone, which was harmless while the stage sections were the
// array's only writer — and silently wrong the moment the ideas band started
// writing into it: collapse the band FIRST, toggle any stage section LATER, and
// the rebuild dropped `ideas_touched`, reopening a band the operator had
// explicitly closed, with no error and nothing to notice.
//
// Both decisions now survive in EITHER order: `toggleIdeasOpen` keeps every key
// it does not own (including the stages' sentinel), and `stagesWriteBase` keeps
// the ideas keys across the stage rebuild. The two sentinels stay separate on
// purpose — see the note above on why the ideas band cannot ride TOUCHED.
export const STAGES_TOUCHED = 'touched'

export function isIdeasKey(k: string): boolean {
  return k === IDEAS_OPEN || k === IDEAS_TOUCHED
}

export function stagesWriteBase(persisted: string[], initial: string[]): string[] {
  if (persisted.includes(STAGES_TOUCHED)) return persisted.filter(x => x !== STAGES_TOUCHED)
  return [...initial, ...persisted.filter(isIdeasKey)]
}

/**
 * Is a DRAFT facet or the draft search box set?
 *
 * The ideas band reads `lm_idea_candidates`; the facets and the search box run
 * over `carousel_drafts`. No draft facet can narrow an idea row, so while one is
 * set the band answers a question nobody asked — and it answered it with 74 rows
 * at the top of the list, above the 9 the filter had actually found.
 *
 * The FilteredEmpty escape sits behind the SAME predicate, so "the band is down
 * to its header" and "the filter found nothing" can never disagree.
 */
export function draftFacetsActive(filters: FilterState, q: string): boolean {
  return Object.values(filters).some(v => !!v) || q.trim() !== ''
}

/**
 * Rows minus the ones already decided in this session.
 *
 * The optimistic half of approve/reject. `decideIdea` promotes or archives the
 * candidate, so the row genuinely leaves `reviewing` — but the refetch behind it
 * takes a round trip (approve waits on the n8n promote run before the status is
 * even stamped), and a decided row that sits there for two seconds invites a
 * second click on an act that fires a pipeline.
 *
 * 🔴 Keying on the id is safe HERE and nowhere near a cache. content.ts:329 bans
 * keying UI state on an idea id ACROSS refreshes because a re-worded re-ingest
 * is a different row — a decided id points at a row that has left the band for
 * good, and the re-ingest arrives under a NEW id, so it can never be hidden by
 * an older decision. The set is session-local and dies with the mount.
 */
export function withoutDecided<T extends { id: string }>(
  rows: T[], decided: ReadonlySet<string>,
): T[] {
  return decided.size === 0 ? rows : rows.filter(r => !decided.has(r.id))
}
