import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { RosterView } from './RosterBlock'
import type { PostAudienceRow } from '../../lib/reach'
import type { RosterPost } from '../../lib/roster'

const NOW = Date.parse('2026-09-16T12:00:00Z')
const own = (o: Partial<PostAudienceRow>): PostAudienceRow => ({
  activity_id: o.activity_id ?? String(Math.random()), post_url: null, published_at: '2026-09-01T08:00:00Z', title: 'p',
  impressions: null, in_pct: null, out_pct: null, members_reached: null, demographics: null, captured_at: '2026-09-15T00:00:00Z', source: 'tracker', ...o,
})
const rp = (o: Partial<RosterPost>): RosterPost => ({
  who: 'Nick Shackelford', role: 'direct_competitor', at: '2026-09-01T08:00:00Z', comments: 5, reposts: 0, url: 'https://x/1',
  text: null, angle: null, topic: null, actioned: null, ...o,
})
const roster = [{ account: 'Nick Shackelford', role: 'direct_competitor' }, { account: 'Ben Sharf', role: 'direct_competitor' }]

describe('roster view', () => {
  it('a failed roster read renders Failed with a retry inside its own section', () => {
    const html = renderToStaticMarkup(<RosterView read={{ kind: 'failed', message: 'roster down' }} own={[]} lane="risedtc" now={NOW} onRetry={() => {}} />)
    expect(html).toContain('data-reach-roster="failed"')
    expect(html).toContain('Try again')
  })
  it('ready: you and each competitor at the floor carry posts, comments and reposts; silent accounts and the angle gap are named', () => {
    const mine = [1, 2, 3, 4, 9].map((c, i) => own({ activity_id: `m${i}`, comments: c, shares: 0 }))
    const posts = [1, 2, 30, 4, 5].map((c, i) => rp({ comments: c, at: `2026-08-1${i}T08:00:00Z`, text: i === 2 ? 'The big one about creative testing' : null }))
    const html = renderToStaticMarkup(<RosterView read={{ kind: 'ready', roster, posts, readAt: '2026-09-16T12:00:00Z' }} own={mine} lane="risedtc" now={NOW} />)
    expect(html).toContain('data-roster-competitors="1"')
    expect(html).toContain('Mattan')
    expect(html).toContain('Nick Shackelford')
    expect(html).toContain('No post collected in the window: Ben Sharf')
    expect(html).toContain('The big one about creative testing')
    expect(html).toContain('7.5× their median of 4')
    expect(html).toContain('No analysed angles exist for this roster yet')
    expect(html).not.toMatch(/NaN|undefined/)
  })
  it('ivan: angles not taken list the topic, the author and the angle', () => {
    const posts = [rp({ who: 'Lara Acosta', comments: 900, angle: 'Belief-reversal hook: state a belief, then invert it.', topic: 'Personal brand as layoff insurance' })]
    const html = renderToStaticMarkup(<RosterView read={{ kind: 'ready', roster: [], posts, readAt: '2026-09-16T12:00:00Z' }} own={[]} lane="ivan" now={NOW} />)
    expect(html).toContain('data-roster-angles="1"')
    expect(html).toContain('Personal brand as layoff insurance')
    expect(html).toContain('Belief-reversal hook')
  })
})
