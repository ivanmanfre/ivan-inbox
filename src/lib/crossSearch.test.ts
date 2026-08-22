import { describe, expect, it } from 'vitest'
import { laneFilter, type ContentLane } from './content'
import {
  CROSS_MIN, SURFACE_LABEL, dedupeByProspect, dmLaneValue, laneName, orIlike, safeTerm, snippet,
  type CrossHit,
} from './crossSearch'

const LANES: ContentLane[] = ['ivan', 'risedtc', 'arch']

describe('tenancy — the whole point of this feature', () => {
  it('content scopes Ivan by NULL and DMs scope him by the literal, because the tables disagree', () => {
    // Live counts, GET only, 2026-08-22: inbox_messages_v?client_id=eq.ivan is
    // 2,863 rows; carousel_drafts?client_id=eq.ivan is 0 and ?client_id=is.null
    // is 190. Using one shape for both returns a calm, empty, wrong screen.
    expect(laneFilter('ivan')).toEqual({ column: 'client_id', op: 'is', value: null })
    expect(dmLaneValue('ivan')).toBe('ivan')
  })

  it('every client lane is an equality on its own value, on both sides', () => {
    for (const lane of LANES.filter(l => l !== 'ivan')) {
      expect(laneFilter(lane)).toEqual({ column: 'client_id', op: 'eq', value: lane })
      expect(dmLaneValue(lane)).toBe(lane)
    }
  })

  it('there is no lane whose filter is absent, so no query can run unscoped', () => {
    for (const lane of LANES) {
      const f = laneFilter(lane)
      expect(f.column).toBe('client_id')
      expect(f.op === 'is' || f.op === 'eq').toBe(true)
    }
  })

  it('names a lane, never prints its database value', () => {
    expect(laneName('risedtc')).toBe('Mattan Danino')
    expect(laneName('arch')).toBe('Davorin Smit')
    expect(laneName('ivan')).toBe('Ivan')
  })
})

describe('the term cannot rewrite the filter', () => {
  it('drops the characters that would break out of or(...)', () => {
    expect(safeTerm('a,b')).toBe('a b')
    expect(safeTerm('x)or=(y')).toBe('x or= y')
    expect(safeTerm("o'brien")).toBe('o brien')
  })

  it('strips the wildcards so a search for a literal stays a literal', () => {
    expect(safeTerm('50%')).toBe('50')
    expect(safeTerm('a_b')).toBe('a b')
    expect(safeTerm('*')).toBe('')
  })

  it('a term stripped to nothing falls under the floor and never reaches a query', () => {
    expect(safeTerm('%%%').length).toBeLessThan(CROSS_MIN)
  })
})

describe('the filter it builds', () => {
  it('is the bare comma list supabase-js .or() takes, with no brackets', () => {
    expect(orIlike(['title', 'topic'], 'margin'))
      .toBe('title.ilike.*margin*,topic.ilike.*margin*')
  })

  it('searches post_body, which is the field today search does not index', () => {
    expect(orIlike(['title', 'topic', 'post_body'], 'margin')).toContain('post_body.ilike.*margin*')
  })
})

describe('a hit says why it is a hit', () => {
  it('cuts around the match rather than from the top', () => {
    const body = `${'x'.repeat(200)} the margin question ${'y'.repeat(200)}`
    const out = snippet(body, 'margin', 60)
    expect(out).toContain('margin')
    expect(out.startsWith('…')).toBe(true)
  })

  it('returns short text whole, and an empty field as empty', () => {
    expect(snippet('short one', 'short')).toBe('short one')
    expect(snippet(null, 'x')).toBe('')
  })
})

describe('one row per person', () => {
  it('collapses four messages from one prospect into the newest', () => {
    const mk = (id: string, snip: string): CrossHit => ({
      surface: 'dm', id, title: 't', sub: '', snippet: snip, lane: 'ivan',
    })
    const out = dedupeByProspect([mk('p1', 'newest'), mk('p1', 'older'), mk('p2', 'other')])
    expect(out).toHaveLength(2)
    expect(out[0].snippet).toBe('newest')
  })
})

describe('what a badge prints', () => {
  it('is plain words, never a table name', () => {
    expect(Object.values(SURFACE_LABEL)).toEqual(['Conversation', 'Draft', 'Lead magnet'])
  })
})
