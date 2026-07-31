import { describe, it, expect } from 'vitest'
import { normalizeStyleKey, styleKeysOf, previewsByStyle, MAX_PREVIEW_IMAGES } from './styles'
import type { ContentDraft } from './content'

const base: ContentDraft = {
  id: '1', client_id: null, status: 'published', type: 'single_image',
  title: 'p', topic: null, post_body: null, scheduled_at: null,
  source_post_id: 'urn:li:activity:1', image_urls: [], taxonomy: null,
  updated_at: '2026-07-30T10:00:00Z', created_at: '2026-07-28T10:00:00Z',
}
const row = (o: Partial<ContentDraft>): ContentDraft => ({ ...base, ...o })

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
})

describe('styleKeysOf', () => {
  // All four taxonomy shapes below are live in carousel_drafts today
  // (ACCESS-MATRIX check 3: jsonb on most rows, a BARE STRING on some).
  // Reading .structure_used off a bare string throws nothing and returns
  // undefined, which is exactly how the whole style panel came back empty.
  it('reads a jsonb taxonomy', () => {
    expect(styleKeysOf({ taxonomy: { structure_used: 'TEARDOWN', pillar: 'systems' } }))
      .toEqual(['teardown'])
  })
  it('reads a bare-string taxonomy', () => {
    expect(styleKeysOf({ taxonomy: 'Teardown' })).toEqual(['teardown'])
  })
  it('reads both structure_used and image_style off one row', () => {
    expect(styleKeysOf({ taxonomy: { structure_used: 'CASE STUDY', image_style: 'Concept Visual' } }))
      .toEqual(['case-study', 'concept-visual'])
  })
  it('yields nothing for an empty or missing taxonomy', () => {
    expect(styleKeysOf({ taxonomy: {} })).toEqual([])
    expect(styleKeysOf({ taxonomy: null })).toEqual([])
  })
  it('never repeats a key when both fields say the same thing', () => {
    expect(styleKeysOf({ taxonomy: { structure_used: 'TEARDOWN', image_style: 'Teardown' } }))
      .toEqual(['teardown'])
  })
})

describe('previewsByStyle', () => {
  it('collects newest-first images per style and counts uses', () => {
    const m = previewsByStyle([
      row({ id: 'old', taxonomy: { structure_used: 'TEARDOWN' }, image_urls: ['old-1.png'], updated_at: '2026-07-10T10:00:00Z' }),
      row({ id: 'new', taxonomy: 'Teardown', image_urls: ['new-1.png', 'new-2.png'], updated_at: '2026-07-29T10:00:00Z' }),
    ])
    const t = m.get('teardown')!
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

  it('gives an unmatched style no entry rather than a wrong one', () => {
    // "DATA-LED" is a real taxonomy value with no matching roster slug. The
    // card for style-data-driven must render its empty state, NOT borrow these
    // images.
    const m = previewsByStyle([
      row({ taxonomy: { structure_used: 'DATA-LED' }, image_urls: ['d.png'] }),
    ])
    expect(m.get('data-driven')).toBeUndefined()
    expect(m.get('data-led')?.imageUrls).toEqual(['d.png'])
  })

  it('counts a published row with no images and still leaves the card empty-safe', () => {
    // Ivan's carousels: only 1 of 7 recent published rows carried image_urls
    // (2026-07-31). A style whose only examples have no assets must count as
    // used but render the no-example state, not a broken <img>.
    const m = previewsByStyle([
      row({ taxonomy: { structure_used: 'CASE STUDY' }, image_urls: null }),
    ])
    expect(m.get('case-study')).toEqual({
      imageUrls: [], lastUsedAt: '2026-07-30T10:00:00Z', count: 1,
    })
  })

  it('caps images per style and never repeats one', () => {
    const many = Array.from({ length: 10 }, (_, i) => `img-${i}.png`)
    const m = previewsByStyle([
      row({ id: 'a', taxonomy: 'Teardown', image_urls: many, updated_at: '2026-07-29T10:00:00Z' }),
      row({ id: 'b', taxonomy: 'Teardown', image_urls: many, updated_at: '2026-07-28T10:00:00Z' }),
    ])
    expect(m.get('teardown')!.imageUrls).toHaveLength(MAX_PREVIEW_IMAGES)
    expect(new Set(m.get('teardown')!.imageUrls).size).toBe(MAX_PREVIEW_IMAGES)
  })

  it('drops rows whose taxonomy is empty instead of bucketing them under a blank key', () => {
    const m = previewsByStyle([
      row({ taxonomy: {} }), row({ taxonomy: null }), row({ taxonomy: '   ' }),
    ])
    expect(m.size).toBe(0)
    expect(m.get('')).toBeUndefined()
  })
})
