import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { liftLine, rosterAngles, rosterCompare, rosterTop, type RosterPost } from './roster'
import type { PostAudienceRow } from './reach'

const NOW = Date.parse('2026-09-16T12:00:00Z') // Wed of ISO week 38; 12-week window starts Mon 29 Jun
const own = (o: Partial<PostAudienceRow>): PostAudienceRow => ({
  activity_id: o.activity_id ?? String(Math.random()), post_url: null, published_at: '2026-09-01T08:00:00Z', title: 'p',
  impressions: null, in_pct: null, out_pct: null, members_reached: null, demographics: null, captured_at: '2026-09-15T00:00:00Z', source: 'tracker', ...o,
})
const rp = (o: Partial<RosterPost>): RosterPost => ({
  who: 'Rival', role: 'direct_competitor', at: '2026-09-01T08:00:00Z', comments: 5, reposts: 0, url: 'https://x/1',
  text: null, angle: null, topic: null, actioned: null, ...o,
})
const many = (who: string, comments: number[], extra: Partial<RosterPost> = {}) => comments.map((c, i) => rp({ who, comments: c, reposts: i % 2, at: `2026-08-${String(10 + i).padStart(2, '0')}T08:00:00Z`, ...extra }))
const roster = [{ account: 'Rival', role: 'direct_competitor' }, { account: 'Quiet One (Co)', role: 'direct_competitor' }, { account: 'Buyer', role: 'buyer_voice' }]

describe('rosterCompare', () => {
  it('medians per account inside the window, floor 5, most commented first; you carry the same floor', () => {
    const mine = [1, 2, 3, 4, 9].map((c, i) => own({ activity_id: `m${i}`, comments: c, shares: i === 0 ? 3 : 0 }))
    const posts = [
      ...many('Rival', [1, 2, 30, 4, 5]),
      ...many('Big', [40, 50, 60, 70, 80, 90]),
      ...many('Thin', [100, 100]),
      ...many('Old', [9, 9, 9, 9, 9], { at: '2026-05-01T08:00:00Z' }),
      ...many('Buyer', [7, 7, 7, 7, 7], { role: 'buyer_voice' }),
    ]
    const c = rosterCompare(mine, posts, roster, 'Ivan', NOW)
    expect(c.from).toBe('2026-06-29')
    expect(c.you).toEqual({ who: 'Ivan', role: 'you', posts: 5, perWeek: 0.4, comments: 3, reposts: 0 })
    expect(c.competitors.map(a => `${a.who}:${a.comments}:${a.reposts}:${a.posts}`)).toEqual(['Big:65:0.5:6', 'Rival:4:0:5'])
    expect(c.underFloor).toEqual([{ who: 'Thin', posts: 2 }])
    expect(c.silent).toEqual(['Quiet One'])
    expect(c.otherRoles).toEqual({ buyer_voice: 5 })
  })
  it('you under the floor shows counts, not a median', () => {
    const c = rosterCompare([own({ comments: 9 })], [], roster, 'Ivan', NOW)
    expect(c.you.posts).toBe(1)
    expect(c.you.comments).toBeNull()
    expect(c.silent).toEqual(['Rival', 'Quiet One'])
  })
})

describe('rosterTop', () => {
  it('most commented competitor and buyer posts with the lift against the author median', () => {
    const posts = [...many('Rival', [1, 2, 30, 4, 5]), ...many('Buyer', [12], { role: 'buyer_voice' }), ...many('Ref', [99], { role: 'format_reference' })]
    const t = rosterTop(posts, NOW)
    expect(t.map(p => `${p.who}:${p.comments}`)).toEqual(['Rival:30', 'Buyer:12', 'Rival:5', 'Rival:4', 'Rival:2', 'Rival:1'])
    expect(t[0].lift).toBe(7.5)
    expect(liftLine(t[0])).toBe('7.5× their median of 4')
    expect(t[1].lift).toBeNull()
    expect(liftLine(t[1])).toBeNull()
    expect(liftLine({ lift: 1, authorMedian: 4 })).toBe('their normal post (median 4)')
  })
})

describe('rosterAngles', () => {
  it('keeps angles nobody marked as taken, inside the window, most commented first, cut on a word', () => {
    const long = 'Belief-reversal hook: state a belief the reader holds, then invert it with present-tense evidence they are already feeling. Ivan can anchor it to a client pipeline number and show the mechanism right away instead of withholding it for the close.'
    const posts = [
      rp({ who: 'Lara', comments: 900, angle: long, topic: 'Personal brand as layoff insurance' }),
      rp({ who: 'Matt', comments: 50, angle: 'Short angle.', actioned: true }),
      rp({ who: 'Luke', comments: 40, angle: 'Old angle.', at: '2026-01-01T00:00:00Z' }),
      rp({ who: 'Alex', comments: 30, angle: '   ' }),
      rp({ who: 'Timi', comments: 20, angle: 'Kept angle.' }),
    ]
    const a = rosterAngles(posts, NOW)
    expect(a.map(x => x.who)).toEqual(['Lara', 'Timi'])
    expect(a[0].angle.length).toBeLessThanOrEqual(181)
    expect(a[0].angle.endsWith('…')).toBe(true)
    expect(a[0].topic).toBe('Personal brand as layoff insurance')
  })
})
