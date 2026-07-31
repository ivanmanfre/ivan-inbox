import { supabase } from './supabase'
import type { ContentDraft } from './content'

// Styles + resources domain.
//
// The style roster is enumerated LIVE from content_prompts every time. There
// were three overlapping hardcoded catalogues in the dashboard's history (9+6,
// 11+6, 15) and all three were wrong the day after they were written; the live
// surface (StylesLive.tsx:9-19) dropped its catalogue for exactly that reason.
// 11 rows are active as of 2026-07-31 — that number is not written down here.

export type StylePrompt = {
  slug: string
  title: string
  // The prompt body itself. Same column StylesLive.tsx:89 renders a blurb from.
  body: string | null
  updated_at: string
}

export async function fetchStyleRoster(): Promise<StylePrompt[]> {
  const { data, error } = await supabase.from('content_prompts')
    .select('slug, title, body, updated_at')
    .like('slug', 'style-%')
    .eq('is_active', true)
    .order('slug', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => ({
    slug: r.slug as string,
    title: (r.title as string) || (r.slug as string),
    body: (r.body as string) ?? null,
    updated_at: r.updated_at as string,
  }))
}

// ---------- key normalisation ----------

// The same style is spelled three different ways across the data: a
// content_prompts slug ('style-teardown'), a taxonomy value written by the
// generator ("TEARDOWN"), and a human-facing label ("Teardown", sometimes
// prefixed "Style: " or "Carousel Style — "). Joining the roster to real posts
// on the raw slug returns nothing (skeptic finding, 2026-07-31: the naive slug
// join produced empty previews for every style).
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
    .replace(/^carousel\s+style\s*[:—–-]\s*/, '')
    .replace(/^style\s*[:—–-]\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Every style key a single draft claims. taxonomy is a jsonb object on most
// rows, a BARE STRING on some (ACCESS-MATRIX check 3), {} or absent on others —
// all four shapes are live, so all four are handled here rather than at each
// call site.
export function styleKeysOf(draft: Pick<ContentDraft, 'taxonomy'>): string[] {
  const t = draft.taxonomy
  const raw: unknown[] = []
  if (typeof t === 'string') raw.push(t)
  else if (t && typeof t === 'object') {
    raw.push((t as Record<string, unknown>).structure_used)
    raw.push((t as Record<string, unknown>).image_style)
  }
  const keys: string[] = []
  for (const v of raw) {
    const k = normalizeStyleKey(v)
    if (k && !keys.includes(k)) keys.push(k)
  }
  return keys
}

export type StylePreview = {
  imageUrls: string[]
  lastUsedAt: string
  count: number
}

// How many real examples a style card carries. Six fills the row twice over on
// the widest layout; past that it is just payload.
export const MAX_PREVIEW_IMAGES = 6

// Published drafts → per-style previews, newest first. A style with no
// published example simply gets no entry: the UI is expected to render a
// designed "no recent example" state for it (verified-empty ≠ broken — Ivan's
// carousels only had 1 of 7 recent published rows carrying image_urls on
// 2026-07-31, so the empty case is the common one, not the edge case).
export function previewsByStyle(drafts: ContentDraft[]): Map<string, StylePreview> {
  const published = drafts
    .filter(d => d.status === 'published')
    .slice()
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  const out = new Map<string, StylePreview>()
  for (const d of published) {
    for (const key of styleKeysOf(d)) {
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
  resource_url: string
  cover_url: string | null
  landing_slug: string | null
  updated_at: string
}

// READ ONLY. LM rows are never written from this app: whether an n8n watcher
// treats lm_drafts_v2.status='approved' as a publish trigger is unverifiable
// from either repo (skeptic verdict 2026-07-31), so the inbox does not offer
// an approve/edit affordance that might turn out to publish a page.
export async function fetchResources(): Promise<Resource[]> {
  const { data, error } = await supabase.from('lm_drafts_v2')
    .select('id, topic, format, status, resource_url, cover_url, landing_slug, updated_at')
    // Same tenancy split as carousel_drafts: NULL = Ivan's own, non-null = a
    // client board's LM, which belongs on that board and not here.
    .is('client_id', null)
    .not('resource_url', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as unknown as Resource[]
}
