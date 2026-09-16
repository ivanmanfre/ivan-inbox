import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { normalizeCountry, cityOf, driftSummary, type JoinedRow } from './drift'
import type { PostAudienceRow } from './reach'

const NOW = Date.parse('2026-09-16T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86400e3).toISOString()
const joined = (o: Partial<JoinedRow>): JoinedRow => ({
  connected_at: at(10), title: 'Founder', country: 'United States', location: null, company: null, ...o,
})
const many = (n: number, o: Partial<JoinedRow>): JoinedRow[] => Array.from({ length: n }, () => joined(o))
const post = (o: Partial<PostAudienceRow>): PostAudienceRow => ({
  activity_id: String(Math.random()), post_url: null, published_at: at(5), title: 'p',
  impressions: null, in_pct: 40, out_pct: 60, members_reached: 100, demographics: null,
  captured_at: at(1), source: 'tracker', ...o,
})

describe('normalizeCountry', () => {
  it('maps ISO-2 codes and known spellings to one label', () => {
    expect(normalizeCountry('US', null)).toBe('United States')
    expect(normalizeCountry('United States of America', null)).toBe('United States')
    expect(normalizeCountry('GB', null)).toBe('United Kingdom')
    expect(normalizeCountry('UK', null)).toBe('United Kingdom')
    expect(normalizeCountry('Turkey', null)).toBe('Türkiye')
    expect(normalizeCountry('Poland', null)).toBe('Poland')
  })
  it('reads the country off a comma location only when it is a known country', () => {
    expect(normalizeCountry(null, 'Zagreb, Croatia')).toBe('Croatia')
    expect(normalizeCountry(null, 'New York, New York, United States')).toBe('United States')
    expect(normalizeCountry(null, 'Austin, Texas')).toBeNull()
    expect(normalizeCountry(null, 'Los Angeles Metropolitan Area')).toBeNull()
  })
  it('treats a metro string in the country column as unplaced', () => {
    expect(normalizeCountry('Greater Stockholm Metropolitan Area', null)).toBeNull()
    expect(normalizeCountry(null, null)).toBeNull()
  })
})

describe('cityOf', () => {
  it('cuts LinkedIn metro labels down to the city', () => {
    expect(cityOf('Zagreb Metropolitan Area')).toBe('Zagreb')
    expect(cityOf('London Area, United Kingdom')).toBe('London')
    expect(cityOf('Greater Barcelona Metropolitan Area')).toBe('Barcelona')
    expect(cityOf('San Francisco Bay Area')).toBe('San Francisco')
    expect(cityOf('Dallas-Fort Worth Metroplex')).toBe('Dallas-Fort Worth')
    expect(cityOf('Tel Aviv-Yafo')).toBe('Tel Aviv-Yafo')
  })
})

describe('driftSummary', () => {
  it('splits accepts into the last 90 days and the 90 before, with shares of placed rows', () => {
    const rows = [
      ...many(12, { country: 'US' }),
      ...many(4, { country: 'Israel' }),
      ...many(4, { country: null, location: 'Greater Stockholm Metropolitan Area' }),
      ...many(10, { connected_at: at(120), country: 'Poland' }),
      ...many(2, { connected_at: at(200), country: 'Poland' }), // outside 180 d: ignored
    ]
    const s = driftSummary(rows, [], NOW)
    expect(s.recent.n).toBe(20)
    expect(s.recent.placed).toBe(16)
    expect(s.recent.countries[0]).toEqual({ label: 'United States', n: 12, pct: 75 })
    expect(s.recent.countries[1]).toEqual({ label: 'Israel', n: 4, pct: 25 })
    expect(s.prior.n).toBe(10)
    expect(s.prior.countries[0]).toEqual({ label: 'Poland', n: 10, pct: 100 })
  })
  it('groups titles case-insensitively and keeps the top five', () => {
    const rows = [
      ...many(6, { title: 'Founder' }), ...many(3, { title: 'founder' }), ...many(5, { title: 'Co-Founder' }),
      ...many(2, { title: 'CEO' }), ...many(2, { title: 'CMO' }), ...many(1, { title: 'Head of Growth' }), ...many(1, { title: 'Owner' }),
      joined({ title: null }),
    ]
    const s = driftSummary(rows, [], NOW)
    expect(s.recent.titles.map(t => t.label)).toEqual(['Founder', 'Co-Founder', 'CEO', 'CMO', 'Head of Growth'])
    expect(s.recent.titles[0]).toEqual({ label: 'Founder', n: 9, pct: 45 })
  })
  it('reports a shift only when both windows reach the floor and the move is five points or more', () => {
    const rows = [
      ...many(6, { country: 'US' }), ...many(4, { country: 'United Kingdom' }),
      ...many(2, { connected_at: at(120), country: 'US' }), ...many(8, { connected_at: at(120), country: 'United Kingdom' }),
    ]
    // Equal moves (40 points each) fall back to label order.
    expect(driftSummary(rows, [], NOW).shifts).toEqual([
      { label: 'United Kingdom', recentPct: 40, priorPct: 80 },
      { label: 'United States', recentPct: 60, priorPct: 20 },
    ])
    expect(driftSummary(rows.slice(0, 10).concat(rows.slice(10, 15)), [], NOW).shifts).toEqual([]) // prior window under the floor
  })
  it('names the top reached location and counts accepts in that city', () => {
    const own = [
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }, { label: 'London Area, United Kingdom', pct: 10 }] } }),
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 40 }] } }),
    ]
    const rows = [...many(10, { country: 'US' }), joined({ country: 'Croatia', location: 'Zagreb, Croatia' })]
    const s = driftSummary(rows, own, NOW)
    expect(s.reachTop).toEqual({ label: 'Zagreb Metropolitan Area', pct: 36, city: 'Zagreb', joinedInCity: 1 })
  })
  it('gives no reach line without a located post in the recent weeks', () => {
    expect(driftSummary(many(12, {}), [post({ demographics: null })], NOW).reachTop).toBeNull()
  })
})
