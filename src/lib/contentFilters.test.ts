import { describe, it, expect } from 'vitest'
import {
  applyFilters, buildFacets, draftSpecs, scoreBand, QUEUE_SPECS, RESOURCE_SPECS,
  styleSpecs, type FacetSpec,
} from './contentFilters'
import type { ContentDraft } from './content'
import { previewKeyFor, type Resource, type StylePrompt } from './styles'

const base: ContentDraft = {
  id: '1', client_id: null, status: 'review', type: 'single_image',
  title: 'A post', topic: null, post_body: 'body', scheduled_at: null,
  source_post_id: null, image_urls: [], taxonomy: null,
  updated_at: '2026-07-30T10:00:00Z', created_at: '2026-07-28T10:00:00Z',
}
const row = (o: Partial<ContentDraft>): ContentDraft => ({ ...base, ...o })

describe('buildFacets', () => {
  const specs: FacetSpec<{ k: string }>[] = [{ key: 'k', label: 'K', of: r => ({ value: r.k, label: r.k }) }]

  it('counts values and orders by frequency', () => {
    const f = buildFacets([{ k: 'a' }, { k: 'b' }, { k: 'b' }], specs)[0]
    expect(f.options).toEqual([{ value: 'b', label: 'b', n: 2 }, { value: 'a', label: 'a', n: 1 }])
  })
  it('drops a facet that cannot change the result', () => {
    // Rule: a control with one side is decoration. This is how the
    // experiment-arm chip disappears on Mattan's lane — from data, not a rule.
    expect(buildFacets([{ k: 'a' }, { k: 'a' }], specs)).toEqual([])
    expect(buildFacets([], specs)).toEqual([])
  })
  it('keeps a single option that not every row carries', () => {
    const sparse: FacetSpec<{ k?: string }>[] = [
      { key: 'k', label: 'K', of: r => (r.k ? { value: r.k, label: r.k } : null) },
    ]
    expect(buildFacets([{ k: 'a' }, {}], sparse)[0].options).toHaveLength(1)
  })
})

describe('applyFilters', () => {
  const specs: FacetSpec<{ a: string; b: string }>[] = [
    { key: 'a', label: 'A', of: r => ({ value: r.a, label: r.a }) },
    { key: 'b', label: 'B', of: r => ({ value: r.b, label: r.b }) },
  ]
  const rows = [{ a: '1', b: 'x' }, { a: '1', b: 'y' }, { a: '2', b: 'x' }]

  it('ANDs across facets and returns everything when nothing is selected', () => {
    expect(applyFilters(rows, specs, {})).toHaveLength(3)
    expect(applyFilters(rows, specs, { a: '1' })).toHaveLength(2)
    expect(applyFilters(rows, specs, { a: '1', b: 'x' })).toHaveLength(1)
  })
  it('ignores a filter key no spec knows, rather than emptying the list', () => {
    expect(applyFilters(rows, specs, { ghost: 'z' })).toHaveLength(3)
  })
})

describe('draft facets', () => {
  it('never offers a board facet on the Ivan lane', () => {
    // 4 Ivan rows carry board_visible=true and it means nothing — Ivan has no
    // client board. The facet is absent from the lane, not merely empty.
    expect(draftSpecs('ivan').some(s => s.key === 'board')).toBe(false)
    expect(draftSpecs('risedtc').some(s => s.key === 'board')).toBe(true)
  })
  it('treats a NULL board flag as internal, strictly', () => {
    const spec = draftSpecs('risedtc').find(s => s.key === 'board')!
    expect(spec.of(row({ board_visible: true }))!.value).toBe('yes')
    expect(spec.of(row({ board_visible: null }))!.value).toBe('no')
    expect(spec.of(row({}))!.value).toBe('no')
  })

  it('keys structure and image style by FAMILY, so before-after cannot collide', () => {
    // 🔴 style-before-after and image-style-before-after both normalise to
    // 'before-after'. A family-blind facet value would let a structure filter
    // select image rows and vice versa.
    const st = draftSpecs('ivan').find(s => s.key === 'structure')!
    const im = draftSpecs('ivan').find(s => s.key === 'image_style')!
    const a = st.of(row({ taxonomy: { structure_used: 'Before/After' } }))!
    const b = im.of(row({ taxonomy: { image_style: 'Before/After' } }))!
    expect(a.value).toBe('structure:before-after')
    expect(b.value).toBe('image:before-after')
    expect(a.value).not.toBe(b.value)
    // The label stays the value the generator actually wrote.
    expect(a.label).toBe('Before/After')
  })

  it('reads the taxonomy vocabulary as stored, never Title-Cased', () => {
    const pillar = draftSpecs('ivan').find(s => s.key === 'pillar')!
    // 🔴 Stored lowercase-snake; the dashboard's target constant is Title Case,
    // and comparing to it scores every pillar at 0%.
    expect(pillar.of(row({ taxonomy: { pillar: 'case_study' } }))!.value).toBe('case_study')
    expect(pillar.of(row({ taxonomy: null }))).toBeNull()
  })

  it('bands a QA score instead of ranging it', () => {
    // Live rows carry both `82` and `74/90` forms, so a hardcoded 0-100 range
    // is a scale claim the data does not support.
    expect(scoreBand(82).value).toBe('high')
    expect(scoreBand(74).value).toBe('mid')
    expect(scoreBand(12).value).toBe('low')
    expect(scoreBand(null).value).toBe('unscored')
    const band = draftSpecs('ivan').find(s => s.key === 'qa_band')!
    expect(band.of(row({ qa_score: '104' }))!.value).toBe('high')
  })

  it('only claims a regeneration or a backfill when the row says so', () => {
    const regen = draftSpecs('ivan').find(s => s.key === 'regen')!
    const back = draftSpecs('ivan').find(s => s.key === 'backfilled')!
    expect(regen.of(row({ qa_regen: '3' }))!.value).toBe('yes')
    expect(regen.of(row({ qa_regen: null }))).toBeNull()
    expect(back.of(row({ qa_backfilled: 'true' }))!.value).toBe('yes')
    expect(back.of(row({ qa_backfilled: null }))).toBeNull()
  })

  it('filters a known row down to itself across three facets', () => {
    const rows = [
      row({ id: 'a', type: 'carousel', funnel_stage: 'buyers', taxonomy: { pillar: 'teardown' } }),
      row({ id: 'b', type: 'carousel', funnel_stage: 'reach', taxonomy: { pillar: 'teardown' } }),
      row({ id: 'c', type: 'text', funnel_stage: 'buyers', taxonomy: { pillar: 'personal' } }),
    ]
    const specs = draftSpecs('ivan')
    const hit = applyFilters(rows, specs, { kind: 'carousel', funnel: 'buyers', pillar: 'teardown' })
    expect(hit.map(r => r.id)).toEqual(['a'])
  })
})

describe('queue, resource and style facets', () => {
  it('keeps the queue vocabulary separate from the draft one', () => {
    const status = QUEUE_SPECS.find(s => s.key === 'status')!
    // 'posted' is a scheduled_posts word. 'published' is a carousel_drafts word.
    // They are never merged.
    expect(status.of({
      id: '1', clickup_task_id: null, post_text: null, scheduled_at: null,
      posted_at: null, status: 'posted', platform: 'linkedin', is_repost: null,
      error_message: null, created_at: '', post_kind: 'reach', unipile_share_url: null,
    })!.value).toBe('posted')
  })

  it('makes the stuck-resource predicate filterable from both sides', () => {
    const landing = RESOURCE_SPECS.find(s => s.key === 'landing')!
    const stuck: Resource = {
      id: 'bb07706c', topic: 'Report Card', format: 'AI Kit', status: 'approved',
      resource_url: 'https://x', landing_url: null, cover_url: null,
      landing_slug: null, updated_at: '2026-07-23T00:00:00Z',
    }
    expect(landing.of(stuck)!.value).toBe('no')
    expect(landing.of({ ...stuck, landing_url: 'https://y' })!.value).toBe('yes')
  })

  it('makes the style family mandatory and the preview lookup family-keyed', () => {
    const roster: StylePrompt[] = [
      { slug: 'style-before-after', title: 'Style: Before/After', family: 'structure', body: null, updated_at: '2026-07-01T00:00:00Z' },
      { slug: 'image-style-before-after', title: 'Post Image — Before/After', family: 'image', body: null, updated_at: '2026-07-01T00:00:00Z' },
    ]
    const previews = new Map<string, unknown>([['image:before-after', {}]])
    const specs = styleSpecs(previews, previewKeyFor, Date.parse('2026-08-01T00:00:00Z'))
    const examples = specs.find(s => s.key === 'examples')!
    // The image family has published examples; the structure card with the same
    // normalised key must not inherit them.
    expect(examples.of(roster[1])!.value).toBe('yes')
    expect(examples.of(roster[0])!.value).toBe('no')
    expect(buildFacets(roster, specs).some(f => f.key === 'family')).toBe(true)
  })
})
