import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import {
  dayLabel, formatShares, isoWeek, reachShares, reachedOf, splitOf, summarizeReach, topBuckets,
  reachInsights, shortTitle, weekStartOf, weightedSplit, type PostAudienceRow,
} from './reach'

const post = (o: Partial<PostAudienceRow>): PostAudienceRow => ({
  activity_id: o.activity_id ?? Math.random().toString().slice(2),
  post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1', published_at: '2026-09-14T08:00:00Z',
  title: 'A post', impressions: 100, in_pct: null, out_pct: null, members_reached: null,
  demographics: null, captured_at: '2026-09-15T00:00:00Z', source: 'tracker', ...o,
})

describe('weekly bucketing', () => {
  it('buckets by ISO week starting Monday, in UTC', () => {
    expect(weekStartOf('2026-09-14T00:00:00Z')).toBe('2026-09-14') // Monday
    expect(weekStartOf('2026-09-20T23:59:59Z')).toBe('2026-09-14') // Sunday night
    expect(weekStartOf('2026-09-21T00:00:00Z')).toBe('2026-09-21')
    expect(weekStartOf('2026-09-13T23:30:00-02:00')).toBe('2026-09-14') // 01:30Z Monday
    expect(weekStartOf(null)).toBeNull()
    expect(weekStartOf('not a date')).toBeNull()
  })
  it('keeps a week whole across a year boundary', () => {
    // Thu 1 Jan 2026 and Sun 4 Jan 2026 sit in the week of Mon 29 Dec 2025 = ISO 2026-W01.
    expect(weekStartOf('2025-12-29T09:00:00Z')).toBe('2025-12-29')
    expect(weekStartOf('2026-01-01T12:00:00Z')).toBe('2025-12-29')
    expect(weekStartOf('2026-01-04T23:00:00Z')).toBe('2025-12-29')
    expect(isoWeek('2025-12-29')).toEqual({ year: 2026, week: 1 })
    expect(isoWeek('2026-12-28')).toEqual({ year: 2026, week: 53 })
    expect(isoWeek('2027-01-04')).toEqual({ year: 2027, week: 1 })
    expect(dayLabel('2025-12-29', 2026)).toBe('29 Dec 2025')
    expect(dayLabel('2026-09-14', 2026)).toBe('14 Sep')
    const s = summarizeReach([
      post({ published_at: '2026-01-02T10:00:00Z', in_pct: 40, out_pct: 60, members_reached: 100 }),
      post({ published_at: '2025-12-30T10:00:00Z', in_pct: 80, out_pct: 20, members_reached: 300 }),
      post({ published_at: '2025-12-27T10:00:00Z', in_pct: 50, out_pct: 50, members_reached: 50 }),
    ], Date.parse('2026-01-03T12:00:00Z'))
    expect(s.weeks.map(w => [w.start, w.posts.length])).toEqual([['2025-12-29', 2], ['2025-12-22', 1]])
    expect(s.weeks[0].posts[0].published_at).toBe('2026-01-02T10:00:00Z') // newest first inside a week
  })
  it('lists every week from the current one back to the oldest post, empty weeks included, newest first', () => {
    const s = summarizeReach([post({ published_at: '2026-08-25T10:00:00Z' })], Date.parse('2026-09-15T12:00:00Z'))
    expect(s.weeks.map(w => w.start)).toEqual(['2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24'])
    expect(s.weeks.slice(0, 3).every(w => w.posts.length === 0 && w.split === null && w.reached === 0)).toBe(true)
  })
  it('counts undated posts without inventing a week for them', () => {
    const s = summarizeReach([post({ published_at: null }), post({})], Date.parse('2026-09-15T12:00:00Z'))
    expect(s.undated).toBe(1)
    expect(s.total).toBe(2)
    expect(s.weeks.flatMap(w => w.posts)).toHaveLength(1)
  })
})

describe('null splits', () => {
  it('draws a split only when both halves are numbers', () => {
    expect(splitOf(post({ in_pct: 61, out_pct: 39 }))).toEqual({ inPct: 61, outPct: 39 })
    expect(splitOf(post({ in_pct: 61, out_pct: null }))).toBeNull()
    expect(splitOf(post({ in_pct: 120, out_pct: -5 }))).toEqual({ inPct: 100, outPct: 0 })
    expect(reachedOf(post({ members_reached: 0 }))).toBeNull()
  })
  it('a week with posts and no split says so through withSplit 0 and a null split', () => {
    const s = summarizeReach([post({ members_reached: 200 }), post({ members_reached: 40 })], Date.parse('2026-09-15T12:00:00Z'))
    const w = s.weeks[0]
    expect(w.posts).toHaveLength(2)
    expect(w.withSplit).toBe(0)
    expect(w.split).toBeNull()
    expect(w.reached).toBe(240)
    expect(s.recent).toMatchObject({ posts: 2, withSplit: 0, split: null, reached: 240, withReach: 2 })
  })
})

describe('weighting', () => {
  it('weights out of network by members reached, a post without reach counting once', () => {
    const rows = [
      post({ in_pct: 5, out_pct: 95, members_reached: 3670 }),
      post({ in_pct: 61, out_pct: 39, members_reached: 68 }),
      post({ in_pct: 77, out_pct: 23, members_reached: 60 }),
      post({ in_pct: null, out_pct: null, members_reached: 5000 }), // no split: not in the split at all
    ]
    // (5*3670 + 61*68 + 77*60) / 3798 = 7.15 -> 7 ; out = (95*3670 + 39*68 + 23*60)/3798 = 92.85 -> 93
    expect(weightedSplit(rows)).toEqual({ inPct: 7, outPct: 93, n: 3 })
    expect(weightedSplit([post({ in_pct: 20, out_pct: 80 }), post({ in_pct: 60, out_pct: 40 })])).toEqual({ inPct: 40, outPct: 60, n: 2 })
    expect(weightedSplit([post({})])).toBeNull()
  })
  it('headline covers the current ISO week and the 3 before it, posts with and without a split', () => {
    const now = Date.parse('2026-09-15T12:00:00Z') // Tuesday; window starts Mon 24 Aug
    const s = summarizeReach([
      post({ published_at: '2026-09-14T08:00:00Z', in_pct: 40, out_pct: 60, members_reached: 100 }),
      post({ published_at: '2026-08-24T00:00:00Z', in_pct: 80, out_pct: 20, members_reached: 300 }),
      post({ published_at: '2026-08-30T10:00:00Z', members_reached: 50 }),
      post({ published_at: '2026-08-23T23:59:00Z', in_pct: 0, out_pct: 100, members_reached: 9999 }), // outside
    ], now)
    expect(s.recent.from).toBe('2026-08-24')
    expect(s.recent).toMatchObject({ posts: 3, withSplit: 2, reached: 450, withReach: 3 })
    expect(s.recent.split).toEqual({ inPct: 70, outPct: 30, n: 2 })
  })
})

describe('share of members reached, truncated buckets', () => {
  it('divides by the summed reach of only the posts that list the category', () => {
    const rows = [
      post({ members_reached: 1000, demographics: { industry: [{ label: 'Advertising Services', pct: 20 }, { label: 'Marketing Services', pct: 10 }] } }),
      post({ members_reached: 100, demographics: { industry: [{ label: 'Marketing Services', pct: 50 }] } }),
      post({ members_reached: 5000, demographics: { industry: [] } }), // lists nothing: excluded from the denominator
      post({ members_reached: null, demographics: { industry: [{ label: 'Computer Games', pct: 90 }] } }), // no reach: excluded
    ]
    // Advertising 200/1100 = 18.2% ; Marketing (100+50)/1100 = 13.6%
    expect(reachShares(rows, 'industry')).toEqual({
      labels: [{ label: 'Advertising Services', pct: 18 }, { label: 'Marketing Services', pct: 14 }], posts: 2, reached: 1100,
    })
  })
  it('never fills the missing buckets: shares need not sum to 100', () => {
    const r = reachShares([post({ members_reached: 60, demographics: { seniority: [{ label: 'Senior', pct: 38 }] } })], 'seniority')
    expect(r?.labels).toEqual([{ label: 'Senior', pct: 38 }])
  })
  it('drops labels under 1%, keeps the top n, ignores malformed buckets', () => {
    const r = reachShares([post({
      members_reached: 1000,
      demographics: { job_title: [
        { label: 'Founder', pct: 30 }, { label: 'CEO', pct: 20 }, { label: 'CMO', pct: 10 }, { label: 'Designer', pct: 5 },
        { label: 'Tiny', pct: 0.4 }, { label: '', pct: 50 }, { label: 'Bad', pct: null as unknown as number },
      ] },
    })], 'job_title', 3)
    expect(r?.labels.map(l => l.label)).toEqual(['Founder', 'CEO', 'CMO'])
    expect(reachShares([post({ members_reached: 1000, demographics: { job_title: [{ label: 'Tiny', pct: 0.4 }] } })], 'job_title')).toBeNull()
    expect(topBuckets([{ label: 'A', pct: 1 }, { label: 'B', pct: 2 }, { label: 'C', pct: 3 }], 2).map(b => b.label)).toEqual(['A', 'B'])
    expect(topBuckets(undefined, 2)).toEqual([])
  })
  it('the week carries its top industry by share, and labels join with a middle dot', () => {
    const s = summarizeReach([
      post({ members_reached: 100, demographics: { industry: [{ label: 'Technology, Information and Internet', pct: 30 }] } }),
      post({ members_reached: 900, demographics: { industry: [{ label: 'Retail', pct: 10 }] } }),
    ], Date.parse('2026-09-15T12:00:00Z'))
    expect(s.weeks[0].topIndustry).toEqual({ label: 'Retail', pct: 9 })
    expect(formatShares([{ label: 'Technology, Information and Internet', pct: 3 }, { label: 'Retail', pct: 9 }]))
      .toBe('Technology, Information and Internet 3% · Retail 9%')
  })
})

describe('what the history says', () => {
  const now = Date.parse('2026-09-16T12:00:00Z') // Wednesday; 4-week window from Mon 24 Aug, 12-week from Mon 29 Jun
  const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString()
  const hist = (n: number, o: Partial<PostAudienceRow>, from = 10, step = 3) =>
    Array.from({ length: n }, (_, i) => post({ published_at: at(from + i * step), ...o }))

  it('names the one post behind the 4-week total, with the median post beside it', () => {
    const rows = [
      post({ published_at: at(8), title: 'The big one', in_pct: 5, out_pct: 95, members_reached: 3670 }),
      post({ published_at: at(9), in_pct: 60, out_pct: 40, members_reached: 52 }),
      post({ published_at: at(10), in_pct: 60, out_pct: 40, members_reached: 40 }),
      post({ published_at: at(11), in_pct: 60, out_pct: 40, members_reached: 60 }),
      post({ published_at: at(60), in_pct: 60, out_pct: 40, members_reached: 9999 }), // outside the window
    ]
    const i = reachInsights(rows, now)
    expect(i.concentration).toEqual({ posts: 4, reached: 3822, top: { title: 'The big one', reached: 3670, pct: 96 }, median: 56 })
  })
  it('needs three posts with reach before it names a top post', () => {
    expect(reachInsights([post({ published_at: at(2), members_reached: 100 }), post({ published_at: at(3), members_reached: 50 })], now).concentration).toBeNull()
    expect(reachInsights([], now).concentration).toBeNull()
  })
  it('states the in-network floor from the last 12 weeks as a median and a 9-in-10 line', () => {
    // in-network people = reached x in%: 20, 20, 20, 20, 30, 30, 40, 50, 60, 184
    const rows = [
      ...hist(4, { in_pct: 50, out_pct: 50, members_reached: 40 }),
      ...hist(2, { in_pct: 30, out_pct: 70, members_reached: 100 }, 30),
      post({ published_at: at(40), in_pct: 40, out_pct: 60, members_reached: 100 }),
      post({ published_at: at(41), in_pct: 25, out_pct: 75, members_reached: 200 }),
      post({ published_at: at(42), in_pct: 20, out_pct: 80, members_reached: 300 }),
      post({ published_at: at(43), in_pct: 5, out_pct: 95, members_reached: 3680 }),
      post({ published_at: at(200), in_pct: 100, out_pct: 0, members_reached: 5000 }), // older than 12 weeks
      post({ published_at: at(5), members_reached: 5000 }), // no split: cannot say how many were in network
    ]
    expect(reachInsights(rows, now).floor).toEqual({ posts: 10, median: 30, p90: 60 })
  })
  it('needs five posts with a split and reach before it states a floor', () => {
    expect(reachInsights(hist(4, { in_pct: 50, out_pct: 50, members_reached: 40 }), now).floor).toBeNull()
  })
  it('shows out of network following reach only when both ends have five posts', () => {
    const rows = [
      ...hist(5, { in_pct: 66, out_pct: 34, members_reached: 40 }),
      ...hist(5, { in_pct: 18, out_pct: 82, members_reached: 500 }, 40),
      post({ published_at: at(3), in_pct: 50, out_pct: 50, members_reached: 150 }), // the middle band is not in either end
    ]
    expect(reachInsights(rows, now).outcome).toEqual({ small: { n: 5, outPct: 34 }, large: { n: 5, outPct: 82 } })
    expect(reachInsights(rows.slice(1), now).outcome).toBeNull()
  })
  it('compares the median reach of commented and uncommented posts, five of each', () => {
    const rows = [
      ...hist(5, { comments: 1, members_reached: 56 }),
      ...hist(5, { comments: 0, members_reached: 33 }, 40),
      post({ published_at: at(3), comments: null, members_reached: 9999 }), // unknown comments: in neither group
    ]
    expect(reachInsights(rows, now).comments).toEqual({ withComments: { n: 5, median: 56 }, without: { n: 5, median: 33 } })
    expect(reachInsights(rows.slice(0, 9), now).comments).toBeNull()
  })
  it('shortens a top-post title on a word boundary, never mid-word', () => {
    expect(shortTitle("I'm in Warsaw, Poland right now & I don't want to leave. I'm Argentinian. M")).toBe("I'm in Warsaw, Poland right now & I don't want to leave…")
    expect(shortTitle('I hate it when an agency hands the client a list of 1,000 creators and calls tha')).toBe('I hate it when an agency hands the client a list of 1,000…')
    expect(shortTitle("I didn't want to do this...")).toBe("I didn't want to do this...")
    expect(shortTitle('  ')).toBeNull()
  })
  it('lists the top location beside the other shares', () => {
    const s = summarizeReach([post({ members_reached: 100, demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 33 }] } })], now)
    expect(s.recent.shares.location?.labels).toEqual([{ label: 'Zagreb Metropolitan Area', pct: 33 }])
  })
})
