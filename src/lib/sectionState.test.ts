import { describe, it, expect } from 'vitest'
import {
  EMPTY_SECTION_STATE, SECTION_FIELDS, SECTION_STATE_VERSION,
  isEmptySectionState, projectSectionState, readSectionState, sectionStorageKey,
  writeSectionState,
} from './sectionState'

// A storage double, so the allowlist is asserted against the BYTES that reach
// disk rather than against the object we happened to hand in.
function mem() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

describe('projectSectionState — the field allowlist', () => {
  it('keeps only the two named fields', () => {
    const out = projectSectionState({
      filters: { stage: 'review' }, q: 'hook',
      // Everything below is what an allowlist exists to stop: row data, a
      // capability link, and a field nobody declared.
      rows: [{ id: 'abc', body: 'the whole post' }],
      approve_url: 'https://x/approve?k=SECRET',
      client_id: 'risedtc',
    } as unknown)
    expect(Object.keys(out).sort()).toEqual([...SECTION_FIELDS].sort())
    expect(JSON.stringify(out)).not.toContain('SECRET')
    expect(JSON.stringify(out)).not.toContain('risedtc')
  })

  it('rejects non-string filter values and non-identifier keys', () => {
    const out = projectSectionState({
      filters: {
        stage: 'review',
        // a nested object is a shape this surface never wrote
        qa: { verdict: 'PASS' },
        // not an identifier we emit
        'Stage ': 'x',
        '__proto__': 'y',
        'a-b': 'z',
        // empty means "no filter", which is stored as absence
        pillar: '   ',
      },
      q: 5,
    } as unknown)
    expect(out.filters).toEqual({ stage: 'review' })
    expect(out.q).toBe('')
  })

  it('caps count and length so a hand-edited entry stays bounded', () => {
    const filters: Record<string, string> = {}
    for (let i = 0; i < 40; i += 1) filters[`k${i}`] = 'v'
    const out = projectSectionState({ filters, q: 'x'.repeat(500) })
    expect(Object.keys(out.filters)).toHaveLength(24)
    expect(out.q).toHaveLength(120)
    expect(projectSectionState({ filters: { k: 'v'.repeat(500) } }).filters.k).toHaveLength(160)
  })

  it('survives every wrong shape', () => {
    for (const bad of [null, undefined, 'str', 7, [], { filters: 'nope' }]) {
      expect(projectSectionState(bad)).toEqual(EMPTY_SECTION_STATE)
    }
  })
})

describe('read/write — versioning', () => {
  it('round-trips through storage', () => {
    const s = mem()
    writeSectionState('content.posts.ivan', { filters: { stage: 'review' }, q: 'kyle', open: [] }, s)
    expect(readSectionState('content.posts.ivan', s)).toEqual({ filters: { stage: 'review' }, q: 'kyle', open: [] })
  })

  it('stamps the version and forgets a stored state that carries another one', () => {
    const s = mem()
    writeSectionState('sec', { filters: { stage: 'review' }, q: '', open: [] }, s)
    const raw = JSON.parse(s.getItem(sectionStorageKey('sec'))!)
    expect(raw.v).toBe(SECTION_STATE_VERSION)
    // A facet KEY is a data contract. When it changes, the honest move is to
    // forget — a restored filter whose meaning moved is rows silently missing.
    s.setItem(sectionStorageKey('sec'), JSON.stringify({ ...raw, v: SECTION_STATE_VERSION + 1 }))
    expect(readSectionState('sec', s)).toEqual(EMPTY_SECTION_STATE)
    // and a version-less blob is not trusted either
    s.setItem(sectionStorageKey('sec'), JSON.stringify({ filters: { stage: 'review' } }))
    expect(readSectionState('sec', s)).toEqual(EMPTY_SECTION_STATE)
  })

  it('enforces the allowlist on READ as well as on write', () => {
    const s = mem()
    s.setItem(sectionStorageKey('sec'), JSON.stringify({
      v: SECTION_STATE_VERSION, filters: { stage: 'review' }, q: 'hi',
      rows: [{ id: 'leaked' }], token: 'SECRET',
    }))
    const out = readSectionState('sec', s)
    expect(Object.keys(out).sort()).toEqual([...SECTION_FIELDS].sort())
  })

  it('returns the empty state for absent, unparseable and unavailable storage', () => {
    const s = mem()
    expect(readSectionState('nothing', s)).toEqual(EMPTY_SECTION_STATE)
    s.setItem(sectionStorageKey('sec'), '{not json')
    expect(readSectionState('sec', s)).toEqual(EMPTY_SECTION_STATE)
    expect(readSectionState('sec', null)).toEqual(EMPTY_SECTION_STATE)
  })

  it('deletes the entry when the state goes empty, so no filter leaves no trace', () => {
    const s = mem()
    writeSectionState('sec', { filters: { stage: 'review' }, q: '', open: [] }, s)
    expect(s.getItem(sectionStorageKey('sec'))).not.toBeNull()
    writeSectionState('sec', { filters: {}, q: '', open: [] }, s)
    expect(s.getItem(sectionStorageKey('sec'))).toBeNull()
    expect(isEmptySectionState({ filters: {}, q: '', open: [] })).toBe(true)
  })

  it('keys each section separately, which is what makes a lane switch safe', () => {
    const s = mem()
    writeSectionState('content.posts.ivan', { filters: { hook: 'story_opener' }, q: '', open: [] }, s)
    // 'story' vs 'story_opener': the vocabularies differ per lane, so the other
    // lane must never see this value.
    expect(readSectionState('content.posts.risedtc', s)).toEqual(EMPTY_SECTION_STATE)
    expect(readSectionState('content.lm.ivan', s)).toEqual(EMPTY_SECTION_STATE)
    expect(readSectionState('content.posts.ivan', s).filters.hook).toBe('story_opener')
  })
})
