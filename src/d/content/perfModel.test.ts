import { describe, expect, it } from 'vitest'
import type { PostAudienceRow } from '../../lib/reach'
import { change, median, perfRead, sortPosts } from './perfModel'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const row = (id: string, at: string, impressions: number | null, extra: Partial<PostAudienceRow> = {}): PostAudienceRow => ({
  activity_id: id, post_url: null, published_at: at, title: `Post ${id}\nsecond line`, impressions, in_pct: null, out_pct: null,
  members_reached: null, demographics: null, captured_at: null, source: 'tracker', reactions: 10, comments: 2, shares: 0, ...extra,
})

describe('perfRead', () => {
  it('reads days and times in the seat clock and only calls a bucket with 3+ posts best', () => {
    // 07:30 UTC on a Tuesday = 09:30 Warsaw (CET from 26 Oct = UTC+1 → 08:30); use October CEST dates.
    const rows = [
      row('a', '2026-10-06T07:30:00Z', 300), row('b', '2026-10-13T07:30:00Z', 400), row('c', '2026-10-20T07:30:00Z', 500), // Tue 09:30 Warsaw
      row('d', '2026-10-08T12:00:00Z', 900), // Thu 14:00 Warsaw, alone
      row('e', '2026-10-30T07:30:00Z', 50), // Fri, under 3 days old
    ]
    const r = perfRead(rows, 'Europe/Warsaw', 30, NOW)
    expect(r.posts).toHaveLength(5)
    expect(r.fresh).toBe(1)
    expect(r.typical).toBe(450) // median of 300, 400, 500, 900; the fresh post left out
    const tue = r.days.find(d => d.key === 'Tue')!, thu = r.days.find(d => d.key === 'Thu')!
    expect([tue.n, tue.median, tue.best]).toEqual([3, 400, true])
    expect([thu.n, thu.best]).toEqual([1, false])
    expect(r.days.find(d => d.key === 'Fri')!.n).toBe(0)
    expect(r.times.map(t => [t.key, t.n])).toEqual([['08-11', 3], ['14-17', 1]])
    expect(r.posts.find(p => p.id === 'd')!.vsTypical).toBeCloseTo(2)
    expect(r.posts[0].title).toBe('Post a')
  })

  it('compares against the period before and leaves all time uncompared', () => {
    const rows = [row('now', '2026-10-20T09:00:00Z', 200), row('old', '2026-09-20T09:00:00Z', 100), row('older', '2026-06-01T09:00:00Z', 50)]
    const r30 = perfRead(rows, 'UTC', 30, NOW)
    expect(r30.now.posts).toBe(1)
    expect(r30.before?.posts).toBe(1)
    expect(change(r30.now.median, r30.before?.median)).toBe(100)
    expect(perfRead(rows, 'UTC', 0, NOW).before).toBeNull()
    expect(perfRead(rows, 'UTC', 0, NOW).now.posts).toBe(3)
  })

  it('engagement rate sums reactions, comments and reposts over impressions', () => {
    const r = perfRead([row('x', '2026-10-01T09:00:00Z', 1000, { reactions: 30, comments: 15, shares: 5 })], 'UTC', 90, NOW)
    expect(r.posts[0].rate).toBeCloseTo(0.05)
    expect(r.now.rate).toBeCloseTo(0.05)
  })

  it('night band wraps midnight', () => {
    const r = perfRead([row('n', '2026-10-01T23:30:00Z', 10), row('m', '2026-10-02T02:00:00Z', 20)], 'UTC', 90, NOW)
    expect(r.times).toEqual([expect.objectContaining({ key: '20-05', n: 2 })])
  })
})

describe('helpers', () => {
  it('median, change and sort', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([])).toBeNull()
    expect(change(50, 0)).toBeNull()
    const r = perfRead([row('lo', '2026-10-01T09:00:00Z', 10), row('hi', '2026-09-01T09:00:00Z', 99), row('na', '2026-10-02T09:00:00Z', null)], 'UTC', 0, NOW)
    expect(sortPosts(r.posts, 'impressions').map(p => p.id)).toEqual(['hi', 'lo', 'na'])
    expect(sortPosts(r.posts, 'newest').map(p => p.id)).toEqual(['na', 'lo', 'hi'])
  })
})
