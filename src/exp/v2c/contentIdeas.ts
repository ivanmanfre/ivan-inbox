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
