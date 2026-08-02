import {
  STAGE_LABEL, stageOf, taxonomyFields,
  type ContentDraft, type ContentLane, type IdeaCandidate, type ScheduledQueueRow,
} from './content'
import { normalizeStyleKey, previewKey, type Resource, type StylePrompt } from './styles'

// Facets, derived from the rows in front of you.
//
// The whole mechanism is one rule (AFFORDANCES §3.1): **a facet is derived from
// the rows currently loaded in the current lane, never from a hardcoded list.**
// The grounds are in the data, not in taste — the two lanes spell the same hook
// types differently ('story' vs 'story_opener', 'data' vs 'data_led'), taxonomy
// carries ~25 keys beyond the six the code names, and image_style already holds
// free prose on two Mattan rows. A hardcoded enum would be wrong the next time
// an agent writes a new value, which is the same failure that killed three
// hardcoded style catalogues.
//
// Everything here is pure, so the rules that matter are unit-tested in node
// rather than only observable by clicking.

export type Tagged = { value: string; label: string }

export type FacetSpec<T> = {
  key: string
  label: string
  // null = this row carries nothing for this facet. A row that lacks a field
  // shows no tag for it and counts toward no option — never "unknown", because
  // a fabricated bucket is a claim about a row the machine never made.
  of: (row: T) => Tagged | null
}

export type FacetOption = { value: string; label: string; n: number }
export type Facet = { key: string; label: string; options: FacetOption[] }

// One value per facet at a time. A multi-select would need an AND/OR rule that
// this surface has no way to teach in a chip row.
export type FilterState = Record<string, string>

/**
 * Count every facet value across the loaded rows.
 *
 * A facet is DROPPED when it cannot change the result: no options at all (the
 * experiment-arm chip on Mattan's lane, from data rather than from a rule), or a
 * single option that every row already carries (the platform facet when every
 * queue row is LinkedIn). A control with one side is decoration.
 */
export function buildFacets<T>(rows: T[], specs: FacetSpec<T>[]): Facet[] {
  const out: Facet[] = []
  for (const spec of specs) {
    const counts = new Map<string, FacetOption>()
    for (const r of rows) {
      const t = spec.of(r)
      if (!t) continue
      const cur = counts.get(t.value)
      if (cur) cur.n += 1
      else counts.set(t.value, { value: t.value, label: t.label, n: 1 })
    }
    const options = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    if (options.length === 0) continue
    if (options.length === 1 && options[0].n >= rows.length) continue
    out.push({ key: spec.key, label: spec.label, options })
  }
  return out
}

// AND across facets: each active facet narrows. Client-side over the
// already-fetched page, so the caller must always show both numbers ("14 of 84
// shown") and say so when the server's exact count exceeds what it holds.
export function applyFilters<T>(rows: T[], specs: FacetSpec<T>[], state: FilterState): T[] {
  const active = Object.entries(state).filter(([, v]) => v)
  if (active.length === 0) return rows
  const byKey = new Map(specs.map(s => [s.key, s]))
  return rows.filter(r => active.every(([k, v]) => {
    const spec = byKey.get(k)
    if (!spec) return true
    return spec.of(r)?.value === v
  }))
}

export function activeFilters(state: FilterState): [string, string][] {
  return Object.entries(state).filter(([, v]) => !!v)
}

// ---------- prominence ----------
//
// The facets are all real and all counted honestly; what was wrong was that all
// eighteen of them were on screen at once (105 chips, 1,068px of chrome above
// the first draft row — phase0-facets.md §3). Splitting them is a PRESENTATION
// decision and nothing else: every facet survives, every count survives, and a
// demoted facet filters exactly as hard as a promoted one. Prominence is the
// order a human triages in, not a claim about which data matters.

export type FacetSplit = { prominent: Facet[]; demoted: Facet[] }

/**
 * Split derived facets into the ones that get their own pill and the ones that
 * live behind the "Filters" disclosure.
 *
 * Prominent facets come back in the ORDER OF `keys`, not in the order they were
 * derived — the pill row is a fixed vocabulary, so `Stage` is in the same place
 * on both lanes even when one of them has an extra facet. A key with no facet
 * (buildFacets dropped it because the loaded rows carry nothing for it) simply
 * has no pill; it is never rendered empty, because a control with one side is
 * decoration and a control with no sides is a lie.
 */
export function splitFacets(facets: Facet[], keys: string[]): FacetSplit {
  const byKey = new Map(facets.map(f => [f.key, f]))
  const prominent: Facet[] = []
  for (const k of keys) {
    const f = byKey.get(k)
    if (f) prominent.push(f)
  }
  const promoted = new Set(prominent.map(f => f.key))
  return { prominent, demoted: facets.filter(f => !promoted.has(f.key)) }
}

// The prominent set for the post lane. Chosen as the triage axes — where a row
// is in the pipeline, what it is, which pillar it serves, where it came from,
// and whether QA passed. Everything else (structure, image style, hook, funnel,
// experiment arm, QA band, image, regenerated, backfilled) is a lens, not a
// triage question, and rides behind the disclosure.
export const DRAFT_PROMINENT: string[] = ['stage', 'kind', 'pillar', 'source', 'qa_verdict']

// The lead-magnet lane's own four facets. Status and Format are the two that
// change what you are looking at; the two URL-presence facets are audit
// questions ("did the page ever ship") and are demoted.
export const RESOURCE_PROMINENT: string[] = ['status', 'format']

// ---------- search ----------

/**
 * Substring search over the fields the caller names, client-side over the rows
 * already fetched. Case-insensitive, no operators, no scoping syntax — the same
 * "Search by topic or body…" a human already knows from the old panel.
 *
 * It runs over the LOADED page, exactly like the facets do, which is why every
 * caller prints both numbers.
 */
export function applySearch<T>(rows: T[], q: string, textOf: (row: T) => (string | null | undefined)[]): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(r => textOf(r).some(s => (s ?? '').toLowerCase().includes(needle)))
}

// ---------- shared value helpers ----------

const tag = (v: string | null | undefined, label?: string): Tagged | null => {
  const s = (v ?? '').trim()
  return s ? { value: s, label: label ?? s } : null
}

const yesNo = (v: boolean, yes: string, no: string): Tagged =>
  v ? { value: 'yes', label: yes } : { value: 'no', label: no }

// Bands, never a free numeric range: live rows carry both `82` and `74/90`
// forms, so a hardcoded 0-100 assumption is a scale claim the data does not
// support. Bands survive a scale change (AFFORDANCES §2.1).
export function scoreBand(score: number | null): Tagged {
  if (score === null) return { value: 'unscored', label: 'Unscored' }
  if (score >= 80) return { value: 'high', label: '80+' }
  if (score >= 60) return { value: 'mid', label: '60–79' }
  return { value: 'low', label: 'Under 60' }
}

export function numOf(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.trim()) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// ---------- drafts ----------

export function draftScore(d: ContentDraft): number | null {
  return numOf(d.qa_score)
}

export function draftHasImage(d: ContentDraft): boolean {
  return Array.isArray(d.image_urls) ? d.image_urls.length > 0 : !!d.image_urls
}

export function draftSpecs(lane: ContentLane): FacetSpec<ContentDraft>[] {
  const specs: FacetSpec<ContentDraft>[] = [
    { key: 'stage', label: 'Stage', of: d => ({ value: stageOf(d), label: STAGE_LABEL[stageOf(d)] }) },
    { key: 'kind', label: 'Kind', of: d => tag(d.type ?? 'text') },
  ]
  if (lane !== 'ivan') {
    // Strict === true: NULL is not visible. Absence of the promotion flag is not
    // evidence of promotion (countBoardVisible), and this is the lane's primary
    // grouping as well as a facet.
    specs.push({
      key: 'board',
      label: 'Board',
      of: d => yesNo(d.board_visible === true, 'On Mattan’s board', 'Internal'),
    })
  }
  specs.push(
    { key: 'pillar', label: 'Pillar', of: d => tag(taxonomyFields(d.taxonomy).pillar) },
    {
      // 🔴 Family-keyed. 'before-after' exists in BOTH style families, so the
      // facet value carries the family exactly as previewKeyFor does — a
      // family-blind key would let one family's rows answer the other's filter.
      key: 'structure',
      label: 'Structure',
      of: d => {
        const raw = taxonomyFields(d.taxonomy).structure_used
        const k = normalizeStyleKey(raw)
        return k && raw ? { value: previewKey('structure', k), label: raw } : null
      },
    },
    {
      key: 'image_style',
      label: 'Image style',
      of: d => {
        const raw = taxonomyFields(d.taxonomy).image_style
        const k = normalizeStyleKey(raw)
        return k && raw ? { value: previewKey('image', k), label: raw } : null
      },
    },
    { key: 'hook', label: 'Hook', of: d => tag(taxonomyFields(d.taxonomy).hook_type) },
    { key: 'source', label: 'Source', of: d => tag(taxonomyFields(d.taxonomy).source) },
    { key: 'funnel', label: 'Funnel', of: d => tag(d.funnel_stage) },
    { key: 'arm', label: 'Experiment', of: d => tag(taxonomyFields(d.taxonomy).arm) },
    { key: 'qa_verdict', label: 'QA verdict', of: d => tag(d.qa_verdict) },
    { key: 'qa_band', label: 'QA score', of: d => scoreBand(draftScore(d)) },
    { key: 'image', label: 'Image', of: d => yesNo(draftHasImage(d), 'Has image', 'No image') },
    {
      key: 'regen',
      label: 'Regenerated',
      of: d => (numOf(d.qa_regen) ? { value: 'yes', label: 'Regenerated' } : null),
    },
    {
      // A backfilled QA verdict is a historical reconstruction, not a live
      // agent step, and must be filterable as such.
      key: 'backfilled',
      label: 'Evidence',
      of: d => (String(d.qa_backfilled) === 'true' ? { value: 'yes', label: 'Backfilled' } : null),
    },
  )
  return specs
}

// ---------- ideas ----------

export const IDEA_SPECS: FacetSpec<IdeaCandidate>[] = [
  { key: 'source', label: 'Source', of: i => tag(i.source) },
  { key: 'content_type', label: 'Type', of: i => tag(i.content_type) },
  { key: 'band', label: 'Composite', of: i => scoreBand(i.composite_score) },
  { key: 'format', label: 'Format', of: i => tag(i.format_recommendation) },
  {
    key: 'engaged',
    label: 'Engaged',
    of: i => (i.ivan_engaged === true ? { value: 'yes', label: 'Ivan engaged' } : null),
  },
]

// ---------- publish queue ----------

export const QUEUE_SPECS: FacetSpec<ScheduledQueueRow>[] = [
  // Labelled as a SEPARATE vocabulary from carousel_drafts.status wherever it
  // renders — the two are unrelated and merging them is how two buckets start
  // wearing the same word.
  { key: 'status', label: 'Queue status', of: r => tag(r.status) },
  { key: 'post_kind', label: 'Post kind', of: r => tag(r.post_kind) },
  { key: 'platform', label: 'Platform', of: r => tag(r.platform) },
  { key: 'repost', label: 'Repost', of: r => (r.is_repost === true ? { value: 'yes', label: 'Repost' } : null) },
  { key: 'failed', label: 'Failed', of: r => (r.error_message ? { value: 'yes', label: 'Has error' } : null) },
]

// ---------- resources ----------

export const RESOURCE_SPECS: FacetSpec<Resource>[] = [
  { key: 'status', label: 'Status', of: r => tag(r.status) },
  { key: 'format', label: 'Format', of: r => tag(r.format) },
  { key: 'landing', label: 'Landing URL', of: r => yesNo(!!r.landing_url, 'Has landing URL', 'No landing URL') },
  { key: 'asset', label: 'Resource URL', of: r => yesNo(!!r.resource_url, 'Has resource URL', 'No resource URL') },
]

// ---------- styles ----------

const DAY = 86400_000

export function styleSpecs(previews: Map<string, unknown>, keyFor: (p: StylePrompt) => string, now = Date.now()): FacetSpec<StylePrompt>[] {
  return [
    // Mandatory, and never inferred from anything but the slug prefix.
    { key: 'family', label: 'Family', of: p => ({ value: p.family, label: p.family === 'image' ? 'Image' : 'Structure' }) },
    {
      key: 'examples',
      label: 'Examples',
      of: p => yesNo(previews.has(keyFor(p)), 'Has examples', 'No example yet'),
    },
    {
      key: 'recent',
      label: 'Updated',
      of: p => (now - Date.parse(p.updated_at) <= 7 * DAY
        ? { value: 'yes', label: 'Updated ≤7d' }
        : null),
    },
  ]
}
