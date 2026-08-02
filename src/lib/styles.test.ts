import { describe, it, expect } from 'vitest'
import {
  cleanStyleTitle, normalizeStyleKey, previewKey, previewKeyFor, previewsByStyle,
  styleFamilyOf, styleKeysOf, MAX_PREVIEW_IMAGES, isStuckResource,
  RESOURCE_TERMINAL_STATUSES, type Resource, type StylePrompt,
} from './styles'
import type { ContentDraft } from './content'

const base: ContentDraft = {
  id: '1', client_id: null, status: 'published', type: 'single_image',
  title: 'p', topic: null, post_body: null, scheduled_at: null,
  source_post_id: 'urn:li:activity:1', image_urls: [], taxonomy: null,
  updated_at: '2026-07-30T10:00:00Z', created_at: '2026-07-28T10:00:00Z',
}
const row = (o: Partial<ContentDraft>): ContentDraft => ({ ...base, ...o })
const prompt = (slug: string, title?: string): StylePrompt => ({
  slug, title: title ?? slug, family: styleFamilyOf(slug), body: null,
  updated_at: '2026-07-30T10:00:00Z',
})

describe('normalizeStyleKey', () => {
  // The naive join — roster slug === taxonomy value — returned EMPTY previews
  // for every style (skeptic finding 2026-07-31). The same style is written
  // three ways in live data: a slug ('style-teardown'), a generator taxonomy
  // value ('TEARDOWN'), and a human label ('Teardown'). Each row below is a
  // form actually observed in the DB, not an invented variant.
  const cases: Array<[unknown, string]> = [
    ['style-teardown', 'teardown'],
    ['Teardown', 'teardown'],
    ['TEARDOWN', 'teardown'],
    ['style-case-study', 'case-study'],
    ['CASE STUDY', 'case-study'],
    ['style-data-driven', 'data-driven'],
    ['DATA-LED', 'data-led'],
    ['style-before-after', 'before-after'],
    ['Before/After', 'before-after'],
    ['Concept Visual', 'concept-visual'],
    ['style-myth-busting', 'myth-busting'],
    ['Style: Myth-Busting', 'myth-busting'],
    ['Carousel Style — Myth-Busting', 'myth-busting'],
    ['  Framework Walkthrough  ', 'framework-walkthrough'],
    // The image family: a slug, the taxonomy.image_style value, and the row's
    // own title all have to land on the same bare key. 'image-style-' must be
    // stripped BEFORE the bare 'style' rule runs, or the slug survives whole
    // and matches no published post at all.
    ['image-style-concept-visual', 'concept-visual'],
    ['Post Image — Concept Visual', 'concept-visual'],
    ['image-style-before-after', 'before-after'],
    ['Post Image — Before/After', 'before-after'],
    ['image-style-stat-card', 'stat-card'],
    ['Stat Card', 'stat-card'],
    ['image-style-lifestyle-photo', 'lifestyle-photo'],
    ['Post Image: Quote Card', 'quote-card'],
  ]
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} to ${expected}`, () => {
      expect(normalizeStyleKey(input)).toBe(expected)
    })
  }

  it('leaves DATA-LED and data-driven as different keys on purpose', () => {
    // Both are live values: 'style-data-driven' is a roster slug, "DATA-LED" is
    // a taxonomy.structure_used value. They might be the same idea, but only
    // the roster can say so. A stemmer that collapsed them would hang one
    // style's published examples under another style's card and nothing
    // downstream would ever catch it — an empty preview is a designed state, a
    // wrong preview is a lie. If they ARE meant to match, the fix is an alias
    // in the roster, never a fuzzier normalizer.
    expect(normalizeStyleKey('DATA-LED')).not.toBe(normalizeStyleKey('style-data-driven'))
  })

  it('returns an empty key for anything that is not a string', () => {
    expect(normalizeStyleKey(null)).toBe('')
    expect(normalizeStyleKey(undefined)).toBe('')
    expect(normalizeStyleKey(42)).toBe('')
    expect(normalizeStyleKey({})).toBe('')
    expect(normalizeStyleKey('   ')).toBe('')
  })

  it('collapses the two families onto one bare key on purpose', () => {
    // 'style-before-after' (a carousel STRUCTURE) and 'image-style-before-after'
    // (a post IMAGE treatment) are two different live prompts that share a name.
    // The normalizer cannot tell them apart — the taxonomy value they have to
    // match ("Before/After") carries no family prefix to keep. Disambiguation
    // therefore happens one level up, in previewKeyFor. If this ever stops
    // collapsing, the image cards go blank.
    expect(normalizeStyleKey('style-before-after')).toBe(normalizeStyleKey('image-style-before-after'))
  })
})

describe('styleFamilyOf', () => {
  // SQL `LIKE 'style-%'` is head-anchored, so it never matched the six
  // 'image-style-%' rows and the roster shipped without a single image style.
  // The JS test has to be head-anchored for the same reason: 'image-style-x'
  // CONTAINS 'style-' but is not prefixed by it.
  it('reads the family off the slug prefix, image first', () => {
    expect(styleFamilyOf('style-teardown')).toBe('structure')
    expect(styleFamilyOf('style-before-after')).toBe('structure')
    expect(styleFamilyOf('image-style-before-after')).toBe('image')
    expect(styleFamilyOf('image-style-concept-visual')).toBe('image')
  })
})

describe('cleanStyleTitle', () => {
  // The section header already says which family the card is in; repeating
  // "Post Image — " on all six tiles is noise.
  it('strips the family prefix from a display title', () => {
    expect(cleanStyleTitle('Style: Myth-Busting')).toBe('Myth-Busting')
    expect(cleanStyleTitle('Carousel Style — Teardown')).toBe('Teardown')
    expect(cleanStyleTitle('Post Image — Concept Visual')).toBe('Concept Visual')
    expect(cleanStyleTitle('Post Image — Before/After')).toBe('Before/After')
  })
  it('titles a slug, because a blank title falls back to one', () => {
    expect(cleanStyleTitle('style-case-study')).toBe('Case Study')
    expect(cleanStyleTitle('image-style-quote-card')).toBe('Quote Card')
  })
  it('leaves a plain human title alone', () => {
    expect(cleanStyleTitle('Teardown')).toBe('Teardown')
    expect(cleanStyleTitle('  Framework Walkthrough  ')).toBe('Framework Walkthrough')
  })
})

describe('styleKeysOf', () => {
  // All four taxonomy shapes below are live in carousel_drafts today
  // (ACCESS-MATRIX check 3: jsonb on most rows, a BARE STRING on some).
  // Reading .structure_used off a bare string throws nothing and returns
  // undefined, which is exactly how the whole style panel came back empty.
  it('reads a jsonb taxonomy', () => {
    expect(styleKeysOf({ taxonomy: { structure_used: 'TEARDOWN', pillar: 'systems' } }))
      .toEqual({ structure: ['teardown'], image: [] })
  })
  it('reads a bare-string taxonomy as a structure value', () => {
    // Every bare string observed live is a structure name ("Teardown"); that
    // column predates image_style entirely.
    expect(styleKeysOf({ taxonomy: 'Teardown' })).toEqual({ structure: ['teardown'], image: [] })
  })
  it('files structure_used and image_style under their own families', () => {
    expect(styleKeysOf({ taxonomy: { structure_used: 'CASE STUDY', image_style: 'Concept Visual' } }))
      .toEqual({ structure: ['case-study'], image: ['concept-visual'] })
  })
  it('yields nothing for an empty or missing taxonomy', () => {
    expect(styleKeysOf({ taxonomy: {} })).toEqual({ structure: [], image: [] })
    expect(styleKeysOf({ taxonomy: null })).toEqual({ structure: [], image: [] })
  })
  it('keeps the same word in both families rather than deduping across them', () => {
    // "Before/After" is a real value of BOTH fields. Collapsing them to one key
    // would count the row once and light up whichever card got there first.
    expect(styleKeysOf({ taxonomy: { structure_used: 'Before/After', image_style: 'Before/After' } }))
      .toEqual({ structure: ['before-after'], image: ['before-after'] })
  })
  it('still dedupes within a family', () => {
    expect(styleKeysOf({ taxonomy: { structure_used: 'TEARDOWN', image_style: 'Concept Visual' } }).structure)
      .toEqual(['teardown'])
  })
})

describe('previewKeyFor', () => {
  // The join the UI makes. A roster row looks up its examples by
  // `${family}:${normalized slug}` — never by the bare key, and never by the
  // raw slug (the raw-slug join is what returned empty previews for every
  // style, skeptic finding 2026-07-31).
  it('qualifies the key with the row family', () => {
    expect(previewKeyFor(prompt('style-teardown'))).toBe('structure:teardown')
    expect(previewKeyFor(prompt('image-style-concept-visual'))).toBe('image:concept-visual')
  })
  it('separates the two before-after prompts that share a name', () => {
    expect(previewKeyFor(prompt('style-before-after')))
      .not.toBe(previewKeyFor(prompt('image-style-before-after')))
  })
})

describe('previewsByStyle', () => {
  it('collects newest-first images per style and counts uses', () => {
    const m = previewsByStyle([
      row({ id: 'old', taxonomy: { structure_used: 'TEARDOWN' }, image_urls: ['old-1.png'], updated_at: '2026-07-10T10:00:00Z' }),
      row({ id: 'new', taxonomy: 'Teardown', image_urls: ['new-1.png', 'new-2.png'], updated_at: '2026-07-29T10:00:00Z' }),
    ])
    const t = m.get('structure:teardown')!
    expect(t.count).toBe(2)
    expect(t.imageUrls).toEqual(['new-1.png', 'new-2.png', 'old-1.png'])
    expect(t.lastUsedAt).toBe('2026-07-29T10:00:00Z')
  })

  it('ignores drafts that are not published', () => {
    const m = previewsByStyle([
      row({ id: 'r', status: 'review', taxonomy: { structure_used: 'TEARDOWN' }, image_urls: ['x.png'] }),
    ])
    expect(m.size).toBe(0)
  })

  it('attaches an image_style example to the IMAGE card only', () => {
    // The collision that makes family tagging load-bearing: 'before-after' is a
    // live slug in BOTH content_prompts families, and taxonomy.image_style
    // "Before/After" has 4 published rows while the carousel STRUCTURE of the
    // same name has none. A family-blind key would hand those four images to
    // the structure card too — a wrong preview, which is worse than the empty
    // state the structure card is supposed to render (D8).
    const m = previewsByStyle([
      row({ taxonomy: { structure_used: 'DATA-LED', image_style: 'Before/After' }, image_urls: ['ba.png'] }),
    ])
    expect(m.get(previewKeyFor(prompt('image-style-before-after')))?.imageUrls).toEqual(['ba.png'])
    expect(m.get(previewKeyFor(prompt('style-before-after')))).toBeUndefined()
  })

  it('counts one row under both families when it claims both', () => {
    const m = previewsByStyle([
      row({ taxonomy: { structure_used: 'TEARDOWN', image_style: 'Concept Visual' }, image_urls: ['t.png'] }),
    ])
    expect(m.get('structure:teardown')?.count).toBe(1)
    expect(m.get('image:concept-visual')?.count).toBe(1)
    expect(m.get('image:teardown')).toBeUndefined()
    expect(m.get('structure:concept-visual')).toBeUndefined()
  })

  it('gives an unmatched style no entry rather than a wrong one', () => {
    // "DATA-LED" is a real taxonomy value with no matching roster slug. The
    // card for style-data-driven must render its empty state, NOT borrow these
    // images.
    const m = previewsByStyle([
      row({ taxonomy: { structure_used: 'DATA-LED' }, image_urls: ['d.png'] }),
    ])
    expect(m.get(previewKeyFor(prompt('style-data-driven')))).toBeUndefined()
    expect(m.get('structure:data-led')?.imageUrls).toEqual(['d.png'])
  })

  it('counts a published row with no images and still leaves the card empty-safe', () => {
    // Ivan's carousels: only 1 of 7 recent published rows carried image_urls
    // (2026-07-31). A style whose only examples have no assets must count as
    // used but render the no-example state, not a broken <img>.
    const m = previewsByStyle([
      row({ taxonomy: { structure_used: 'CASE STUDY' }, image_urls: null }),
    ])
    expect(m.get(previewKey('structure', 'case-study'))).toEqual({
      imageUrls: [], lastUsedAt: '2026-07-30T10:00:00Z', count: 1,
    })
  })

  it('caps images per style and never repeats one', () => {
    const many = Array.from({ length: 10 }, (_, i) => `img-${i}.png`)
    const m = previewsByStyle([
      row({ id: 'a', taxonomy: 'Teardown', image_urls: many, updated_at: '2026-07-29T10:00:00Z' }),
      row({ id: 'b', taxonomy: 'Teardown', image_urls: many, updated_at: '2026-07-28T10:00:00Z' }),
    ])
    expect(m.get('structure:teardown')!.imageUrls).toHaveLength(MAX_PREVIEW_IMAGES)
    expect(new Set(m.get('structure:teardown')!.imageUrls).size).toBe(MAX_PREVIEW_IMAGES)
  })

  it('drops rows whose taxonomy is empty instead of bucketing them under a blank key', () => {
    const m = previewsByStyle([
      row({ taxonomy: {} }), row({ taxonomy: null }), row({ taxonomy: '   ' }),
    ])
    expect(m.size).toBe(0)
    expect(m.get('structure:')).toBeUndefined()
    expect(m.get('image:')).toBeUndefined()
  })
})

describe('isStuckResource', () => {
  // The only real approved-with-no-date failure in the whole database is here
  // rather than in carousel_drafts — and it is in MATTAN's lane, which the
  // hardcoded `.is('client_id', null)` fetch could never see (IA §2.4).
  const r = (o: Partial<Resource>): Resource => ({
    id: 'bb07706c-afdf-45ef-ac03-59b1cd8c512f',
    topic: 'The Shopify Report Card', format: 'AI Kit', status: 'approved',
    resource_url: 'https://resources.risedtc.com/rise-dtc-repeat-customer-report-card/',
    landing_url: null, cover_url: null, landing_slug: null,
    updated_at: '2026-07-23T00:00:00Z', ...o,
  })
  it('calls a terminal status with no live URL stuck', () => {
    expect(isStuckResource(r({}))).toBe(true)
    expect(isStuckResource(r({ status: 'live', landing_url: '   ' }))).toBe(true)
  })
  it('never calls an in-flight row stuck, and never a published one with a URL', () => {
    expect(isStuckResource(r({ status: 'review' }))).toBe(false)
    expect(isStuckResource(r({ status: 'pending' }))).toBe(false)
    expect(isStuckResource(r({ landing_url: 'https://x' }))).toBe(false)
  })
  it('keeps the terminal set explicit', () => {
    expect(RESOURCE_TERMINAL_STATUSES).toEqual(['approved', 'published', 'live'])
  })
})
