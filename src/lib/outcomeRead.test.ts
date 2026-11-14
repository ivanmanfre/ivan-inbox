import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { coverageLine, outcomeGroups, outcomeLine, previousLine, tooFew, type OutcomeRow } from './outcomeRead'

const row = (o: Partial<OutcomeRow>): OutcomeRow => ({
  dimension: 'source_kind', grp: 'brain', label: 'Content Brain', posts: 4, imp_posts: 4, imp_median: 115, buyer_posts: 4,
  buyer_sum: 6, buyer_per_post: 1.5, buyer_lo: 0.65, buyer_hi: 2.95, wrote_sum: 1, wrote_per_post: 0.25, bookings_linked: 0,
  fit_versions: ['audn-icp-engager-scoring@v18'], coverage: {}, ...o,
})

describe('outcome read', () => {
  it('writes one plain line with the range', () => {
    expect(outcomeLine(row({ wrote_posts: 4 }))).toBe('1.5 buyers a post (0.7 to 3) · 1 wrote to you · 115 views')
    expect(outcomeLine(row({ posts: 20, buyer_posts: 1, wrote_posts: 0 }))).toBe('1.5 buyers a post (0.7 to 3) · buyers counted on 1 of 20 · 115 views')
  })
  it('says 1 buyer, and never calls an unmeasured group too few', () => {
    expect(outcomeLine(row({ buyer_per_post: 1, buyer_lo: null, buyer_hi: null, wrote_posts: 0, imp_median: null }))).toBe('1 buyer a post')
    expect(tooFew(row({ buyer_posts: 0 }))).toBe(false)
    expect(tooFew(row({ buyer_posts: 2 }))).toBe(true)
  })
  it('says buyers were not counted when no post had engagers collected', () => {
    expect(outcomeLine(row({ buyer_posts: 0, buyer_per_post: null, imp_median: null }))).toBe('buyers not counted')
  })
  it('puts the account total first and groups by post count', () => {
    const g = outcomeGroups([row({ grp: 'a', label: 'A', posts: 1 }), row({ dimension: 'lane', grp: 'all', label: 'All posts', posts: 9 }), row({ grp: 'b', label: 'B', posts: 5 }), row({ dimension: 'ivan_topic', grp: 'poland', label: 'Poland' })])
    expect(g.total?.grp).toBe('all')
    expect(g.bySource.map(r => r.grp)).toEqual(['b', 'a'])
    expect(g.byTopic.map(r => r.grp)).toEqual(['poland'])
  })
  it('compares with the read before only on the same buyer score', () => {
    expect(previousLine(row({}), row({ posts: 7, buyer_per_post: 0.9 }), '11 Sep to 8 Oct')).toBe('The read before (11 Sep to 8 Oct): 7 posts, 0.9 buyers a post.')
    expect(previousLine(row({}), row({ fit_versions: ['17'] }), '11 Sep to 8 Oct')).toContain('different or mixed')
    expect(previousLine(row({ fit_versions: ['a', 'b'] }), row({ fit_versions: ['a', 'b'] }), '11 Sep to 8 Oct')).toContain('different or mixed')
  })
  it('names the gaps', () => {
    expect(coverageLine(row({ coverage: { engagers_not_collected: 1, engagers_not_shown_by_day7: 1, no_day7_impressions: 3 } }))).toBe('Gaps: engagers missing on 2 posts, no day-7 views on 3.')
    expect(coverageLine(row({ coverage: {} }))).toBeNull()
    expect(coverageLine(row({ coverage: { comments_only: 3, deleted_left_out: 1 } }))).toBe('Gaps: only commenters are collected on 3 posts, likes are not, 1 deleted post left out.')
  })
})
