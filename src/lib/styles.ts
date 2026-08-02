import { supabase } from './supabase'
import {
  elapsedMinutes, laneFilter, STUCK_GENERATING_MINUTES,
  type ContentDraft, type ContentLane,
} from './content'

// Styles + resources domain.
//
// The style roster is enumerated LIVE from content_prompts every time. There
// were three overlapping hardcoded catalogues in the dashboard's history (9+6,
// 11+6, 15) and all three were wrong the day after they were written; the live
// surface (StylesLive.tsx:9-19) dropped its catalogue for exactly that reason.
// 11 + 6 rows are active as of 2026-07-31 — neither number is written down here.
//
// content_prompts holds TWO style families under two disjoint slug prefixes,
// and they are NOT interchangeable (verified live 2026-07-31):
//   'style-%'       → post/carousel STRUCTURE  (titles "Style: X" / "Carousel Style — X")
//   'image-style-%' → post IMAGE treatment     (titles "Post Image — X")
// 'before-after' exists in BOTH. A family-blind key would hand the four
// published "Before/After" IMAGE examples to the STRUCTURE card as well, which
// is the wrong-preview failure D8 exists to prevent — so family travels with
// the key everywhere below.
export type StyleFamily = 'structure' | 'image'

export type StylePrompt = {
  slug: string
  title: string
  family: StyleFamily
  // The prompt body itself. Same column StylesLive.tsx:89 renders a blurb from.
  body: string | null
  updated_at: string
}

// Prefix test, not a guess: SQL `LIKE 'style-%'` has no leading wildcard, so it
// never matches 'image-style-...'. The two prefixes partition the roster, and
// the image test runs first because 'image-style-x' contains 'style-' as a
// substring (it just isn't a prefix).
export function styleFamilyOf(slug: string): StyleFamily {
  return slug.startsWith('image-style-') ? 'image' : 'structure'
}

export async function fetchStyleRoster(): Promise<StylePrompt[]> {
  const { data, error } = await supabase.from('content_prompts')
    .select('slug, title, body, updated_at')
    // PostgREST `or` with two anchored LIKEs. `*` is PostgREST's wildcard alias
    // for `%` (it avoids the percent-encoding round trip inside an or= group).
    // Both patterns are anchored at the head, so they select disjoint sets —
    // fetching only 'style-*' is what left the image styles off the roster.
    .or('slug.like.style-*,slug.like.image-style-*')
    .eq('is_active', true)
    .order('slug', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => ({
    slug: r.slug as string,
    title: (r.title as string) || (r.slug as string),
    family: styleFamilyOf(r.slug as string),
    body: (r.body as string) ?? null,
    updated_at: r.updated_at as string,
  }))
}

// ---------- key normalisation ----------

// The same style is spelled three different ways across the data: a
// content_prompts slug ('style-teardown', 'image-style-concept-visual'), a
// taxonomy value written by the generator ("TEARDOWN", "Concept Visual"), and a
// human-facing label ("Teardown", sometimes prefixed "Style: ",
// "Carousel Style — " or "Post Image — "). Joining the roster to real posts on
// the raw slug returns nothing (skeptic finding, 2026-07-31: the naive slug
// join produced empty previews for every style).
//
// This drops the family prefix, so 'image-style-before-after' and
// 'style-before-after' BOTH normalise to 'before-after'. That collision is
// deliberate and handled one level up, by tagging each key with its family —
// see previewKeyFor. Do not try to fix it here by keeping the prefix: the
// taxonomy values ("Before/After") carry no prefix to keep.
//
// This deliberately does NOT fuzzy-match. "DATA-LED" is a live taxonomy value
// and 'style-data-driven' is a live slug; they normalise to 'data-led' and
// 'data-driven' and stay UNMATCHED. They may well be the same idea, but only
// the roster can decide that — a stemmer that collapsed them would silently
// attach one style's published examples to a different style's card, and
// nothing downstream would ever flag it. An empty preview is a designed state;
// a wrong preview is a lie.
export function normalizeStyleKey(x: unknown): string {
  if (typeof x !== 'string') return ''
  return x
    .trim()
    .toLowerCase()
    // Order matters: every image form has to lose its prefix BEFORE the bare
    // 'style' rule runs, or 'image-style-quote-card' would survive as
    // 'image-style-quote-card' and match no taxonomy value at all.
    .replace(/^post\s+image\s*[:—–-]\s*/, '')
    .replace(/^image[\s-]*style\s*[:—–-]\s*/, '')
    .replace(/^carousel\s+style\s*[:—–-]\s*/, '')
    .replace(/^style\s*[:—–-]\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Display label. The roster's own title column is what the UI shows, but it
// carries the family as a prose prefix ("Style: Teardown", "Carousel Style —
// Myth-Busting", "Post Image — Concept Visual"); the section header already
// says which family the card is in, so repeating it on every tile is noise.
// Slug-shaped input is titled too, because fetchStyleRoster falls back to the
// slug when a row has a blank title.
export function cleanStyleTitle(title: string): string {
  const stripped = title
    .trim()
    .replace(/^post\s+image\s*[:—–-]\s*/i, '')
    .replace(/^image[\s-]*style\s*[:—–-]\s*/i, '')
    .replace(/^carousel\s+style\s*[:—–-]\s*/i, '')
    .replace(/^style\s*[:—–-]\s*/i, '')
  if (!stripped) return title.trim()
  // A human label keeps its own casing and punctuation ("Myth-Busting" stays
  // hyphenated); only an all-lowercase unspaced remainder is treated as a slug.
  if (/\s/.test(stripped) || stripped !== stripped.toLowerCase()) return stripped
  return stripped.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export type StyleKeys = { structure: string[]; image: string[] }

// Every style key a single draft claims, split by family. taxonomy is a jsonb
// object on most rows, a BARE STRING on some (ACCESS-MATRIX check 3), {} or
// absent on others — all four shapes are live, so all four are handled here
// rather than at each call site.
//
// The split is the whole point: taxonomy.image_style="Before/After" and
// taxonomy.structure_used="TEARDOWN" both normalise to plain keys, and
// 'before-after' is a live slug in BOTH families. Returning one flat list is
// what would let 50 "Concept Visual" image examples land on a structure card.
// A bare-string taxonomy is a structure value (that column predates image_style
// — every observed bare string is a structure name like "Teardown").
export function styleKeysOf(draft: Pick<ContentDraft, 'taxonomy'>): StyleKeys {
  const t = draft.taxonomy
  const structureRaw: unknown[] = []
  const imageRaw: unknown[] = []
  if (typeof t === 'string') structureRaw.push(t)
  else if (t && typeof t === 'object') {
    structureRaw.push((t as Record<string, unknown>).structure_used)
    imageRaw.push((t as Record<string, unknown>).image_style)
  }
  const dedupe = (raw: unknown[]): string[] => {
    const keys: string[] = []
    for (const v of raw) {
      const k = normalizeStyleKey(v)
      if (k && !keys.includes(k)) keys.push(k)
    }
    return keys
  }
  return { structure: dedupe(structureRaw), image: dedupe(imageRaw) }
}

export type StylePreview = {
  imageUrls: string[]
  lastUsedAt: string
  count: number
}

// How many real examples a style card carries. Six fills the row twice over on
// the widest layout; past that it is just payload.
export const MAX_PREVIEW_IMAGES = 6

// The map key. Family-qualified because the two families collide on real
// values: 'image:before-after' (4 published examples) and
// 'structure:before-after' (0) are different cards, and only the prefix keeps
// them apart. Exported so a UI never hand-rolls the join string.
export function previewKey(family: StyleFamily, key: string): string {
  return `${family}:${key}`
}

// What a roster row looks itself up by. UIs call this, not normalizeStyleKey.
export function previewKeyFor(p: StylePrompt): string {
  return previewKey(p.family, normalizeStyleKey(p.slug))
}

// Published drafts → per-style previews, newest first, keyed
// `${family}:${key}`. A style with no published example simply gets no entry:
// the UI is expected to render a designed "no recent example" state for it
// (verified-empty ≠ broken — Ivan's carousels only had 1 of 7 recent published
// rows carrying image_urls on 2026-07-31, so the empty case is the common one,
// not the edge case).
export function previewsByStyle(drafts: ContentDraft[]): Map<string, StylePreview> {
  const published = drafts
    .filter(d => d.status === 'published')
    .slice()
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  const out = new Map<string, StylePreview>()
  for (const d of published) {
    const keys = styleKeysOf(d)
    const tagged = [
      ...keys.structure.map(k => previewKey('structure', k)),
      ...keys.image.map(k => previewKey('image', k)),
    ]
    for (const key of tagged) {
      const entry = out.get(key) ?? { imageUrls: [], lastUsedAt: d.updated_at, count: 0 }
      entry.count += 1
      for (const url of d.image_urls ?? []) {
        if (entry.imageUrls.length >= MAX_PREVIEW_IMAGES) break
        if (typeof url === 'string' && url && !entry.imageUrls.includes(url)) entry.imageUrls.push(url)
      }
      out.set(key, entry)
    }
  }
  return out
}

// ---------- resources (published Ivan lead magnets) ----------

export type Resource = {
  id: string
  topic: string | null
  format: string | null
  status: string
  resource_url: string | null
  // The live page. Its ABSENCE at a terminal-looking status is the stuck signal
  // (isStuckResource below) — it is a different column from resource_url, which
  // is the asset.
  landing_url: string | null
  cover_url: string | null
  landing_slug: string | null
  updated_at: string
}

// READ ONLY. LM rows are never written from this app: whether an n8n watcher
// treats lm_drafts_v2.status='approved' as a publish trigger is unverifiable
// from either repo (skeptic verdict 2026-07-31), so the inbox does not offer
// an approve/edit affordance that might turn out to publish a page.
//
// R6, the one read change this spec makes to this file (IA §7): the lane was
// hardcoded `.is('client_id', null)`, so Mattan's 5 rows — including the only
// real approved-but-undated failure in the database, bb07706c… (`approved`
// since 07-23, landing_url still NULL) — could appear on no inbox surface at
// all. laneFilter() is the only correct way to scope, so it scopes here too.
//
// The `_r1atest` row (client_id='_r1atest', disqualified) belongs to no lane and
// is excluded by construction: an unrecognised tenant is never coalesced into
// Ivan's, the same fail-closed posture as the cross-tenant rule (IA §4.4).
export async function fetchResources(lane: ContentLane = 'ivan'): Promise<Resource[]> {
  const f = laneFilter(lane)
  let q = supabase.from('lm_drafts_v2')
    .select('id, topic, format, status, resource_url, landing_url, cover_url, landing_slug, updated_at')
  q = f.op === 'is' ? q.is(f.column, null) : q.eq(f.column, f.value)
  // The resource_url filter this fetch used to carry is gone: "has a resource
  // URL" is a FACET (AFFORDANCES §2.4), and a facet whose rows were already
  // filtered out at the query is a control with one side. Dropping it is also
  // what lets Mattan's lane render all 5 of its rows rather than 3.
  const { data, error } = await q
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as unknown as Resource[]
}

// The approved-with-no-date detector, carried onto the resource row set
// (IA §2.4 extension). The only real instance of that failure in the whole
// database is here rather than in carousel_drafts: a resource at a
// terminal-looking status with no live URL is stuck, evaluated per lane. This
// is a read and a boolean; it adds no write.
export const RESOURCE_TERMINAL_STATUSES = ['approved', 'published', 'live'] as const

export function isStuckResource(r: Resource): boolean {
  return (RESOURCE_TERMINAL_STATUSES as readonly string[]).includes(r.status)
    && !(r.landing_url && r.landing_url.trim())
}

// ---------- the LM pipeline (phase 6 ask 2) ----------
//
// Ivan: "lead magnets/resources and posts need to be separated", and before
// that, "[the new surface] doesn't show… lead magnet stages". Both are the same
// hole: `lm_drafts_v2` was rendered as one flat, status-filterable list, while
// carousel_drafts got a nine-section lifecycle. The old dashboard has treated
// LMs as a full pipeline for a long time; nothing of that model survived the
// rebuild.
//
// The MODEL is ported from personal-site — `lib/statusLabels.ts:21-31`
// (LM_STATUSES) and `hooks/useLeadMagnets.ts:44-62` (LM_STATUS_ALIASES /
// normalizeLmStatus) — reimplemented in this app's conventions (a `stageOfLm`
// beside `stageOf`, a `groupByLmStage` beside `groupByStage`) rather than
// copied, because the two repos disagree about almost everything else: this one
// derives a STAGE from a status instead of rendering the status, and it never
// drops a row it cannot classify.
//
// 🔴 The alias fold is the load-bearing half, and this is not theoretical. A
// count=exact probe per status against live `lm_drafts_v2` on 2026-08-02:
//
//     pending 37 · published 40 · disqualified 34 · review 10 · complete 2
//     lm_review 1 · approved 1 · error 1 · live 1        (127 rows total)
//
// 37 rows — the single largest group in the table, 29% of it — sit at the LEGACY
// value `pending`, which the old dashboard folds to `idea`. Unfolded they render
// as a phantom "Pending" status that exists in no pipeline. Same for `complete`
// (→published) and `lm_review` (→review). Fold them, and the table is a
// lifecycle; don't, and it is a bag of vocabularies.
const LM_STATUS_ALIASES: Record<string, string> = {
  draft: 'idea',
  ready: 'published',
  complete: 'published',
  pending: 'idea',
  lm_review: 'review',
  generating_content: 'generating',
}

export function normalizeLmStatus(raw?: string | null): string {
  const s = (raw ?? '').trim() || 'idea'
  return LM_STATUS_ALIASES[s] ?? s
}

// The canonical nine, in lifecycle order. This is the LM_STATUSES array from
// statusLabels.ts:21-31 minus the two off-pipeline states, which this app lifts
// into the alert strip exactly as it does for posts — an error is not a step on
// the way to publishing.
export const LM_PIPELINE_STAGES = [
  'idea', 'generating', 'generating_assets', 'review', 'approved', 'scheduled', 'published',
] as const

export type LmStage = (typeof LM_PIPELINE_STAGES)[number] | 'error' | 'archived' | 'other'

export const LM_STAGE_LABEL: Record<LmStage, string> = {
  idea: 'Idea',
  generating: 'Generating',
  // The one in-flight stage posts do not have: body-gen and asset/page/cover
  // build are separate runs with separate failure modes, and the old board keeps
  // them apart (LeadMagnetStudioPanel.tsx:463-478).
  generating_assets: 'Generating resources',
  review: 'Needs review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  error: 'Errors',
  archived: 'Archived',
  other: 'Other',
}

// 🔴 `live` is NOT folded, deliberately. It is a real live value (1 row) and it
// is NOT in the old dashboard's alias table, so folding it to `published` would
// be a semantic claim this build invented rather than ported. It lands in
// `other`, which is rendered and never dropped — the same posture stageOf()
// takes for a vocabulary that grows after the file was written. If Ivan wants
// `live` to mean published, that is a one-line addition to LM_STATUS_ALIASES
// and a decision he makes, not one a builder makes quietly.
export function stageOfLm(r: Resource): LmStage {
  const s = normalizeLmStatus(r.status)
  switch (s) {
    case 'idea': return 'idea'
    case 'generating': return 'generating'
    case 'generating_assets': return 'generating_assets'
    case 'review': return 'review'
    case 'approved': return 'approved'
    case 'scheduled': return 'scheduled'
    case 'published': return 'published'
    case 'error': return 'error'
    case 'disqualified':
    case 'skipped': return 'archived'
    // Anything the n8n vocabulary grows after this file was written, plus
    // `live`. Rendered at the bottom, never dropped.
    default: return 'other'
  }
}

export type LmStages = Record<LmStage, Resource[]>

function emptyLmStages(): LmStages {
  return {
    idea: [], generating: [], generating_assets: [], review: [], approved: [],
    scheduled: [], published: [], error: [], archived: [], other: [],
  }
}

// No `now` parameter, unlike groupByStage: no LM stage is time-dependent today
// (there is no LM equivalent of isStuckScheduled), and a parameter that is
// threaded through but never read is a promise the function does not keep.
export function groupByLmStage(rows: Resource[]): LmStages {
  const out = emptyLmStages()
  for (const r of rows) out[stageOfLm(r)].push(r)
  return out
}

// The generating-class stages on this lane. TWO of them, which is the whole
// reason the LM pipeline is nine stages and the post pipeline is eight: a body
// generation and an asset/page/cover build are separate runs, so either can
// stall on its own.
export const LM_GENERATING_STAGES: readonly LmStage[] = ['generating', 'generating_assets']

// Same threshold, same source (genAge.ts:11 — that file is shared by BOTH old
// boards, so one number covers both lanes here too). LM rows carry no dedicated
// start timestamp, so updated_at is the only clock there is; genAge.ts's own
// comment says exactly that.
export function isStuckGeneratingLm(r: Resource, now: number = Date.now()): boolean {
  if (!LM_GENERATING_STAGES.includes(stageOfLm(r))) return false
  const m = elapsedMinutes(r.updated_at, now)
  return m !== null && m >= STUCK_GENERATING_MINUTES
}
