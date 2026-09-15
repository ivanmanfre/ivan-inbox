import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { ReachView } from './ReachBlock'
import type { PostAudienceRow } from '../../lib/reach'

const NOW = Date.parse('2026-09-15T12:00:00Z')
const post = (o: Partial<PostAudienceRow>): PostAudienceRow => ({
  activity_id: o.activity_id ?? String(Math.random()), post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
  published_at: '2026-09-14T08:00:00Z', title: 'A post', impressions: 100, in_pct: null, out_pct: null,
  members_reached: null, demographics: null, captured_at: '2026-09-15T00:00:00Z', source: 'tracker', ...o,
})

describe('reach view states', () => {
  it('loading says it is reading', () => {
    expect(renderToStaticMarkup(<ReachView read={null} />)).toContain('data-reach-state="loading"')
  })
  it('a failed read renders Failed with a retry, never a calm empty', () => {
    const html = renderToStaticMarkup(<ReachView read={{ kind: 'failed', message: 'The read returned no posts' }} onRetry={() => {}} />)
    expect(html).toContain('didn’t load')
    expect(html).toContain('Try again')
    expect(html).not.toContain('Out of network')
  })
  it('ready carries its denominators and says when a week has no split', () => {
    const rows = [
      post({ activity_id: 'a', in_pct: 40, out_pct: 60, members_reached: 100, demographics: { job_title: [{ label: 'Founder', pct: 20 }, { label: 'CEO', pct: 10 }, { label: 'CMO', pct: 5 }] } }),
      post({ activity_id: 'b', members_reached: 300 }),
      post({ activity_id: 'c', published_at: '2026-09-01T08:00:00Z' }),
    ]
    const html = renderToStaticMarkup(<ReachView read={{ kind: 'ready', rows, readAt: new Date(NOW).toISOString() }} now={NOW} />)
    expect(html).toContain('3 posts, 1 with a split')
    expect(html).toContain('60%')
    expect(html).toContain('Summed over 2 of 3 posts')
    expect(html).toContain('No split on this post') // week of 31 Aug: one post, no split
    expect(html).toContain('Split on 1 of 2 posts')
    expect(html).toContain('Top job titles Founder 20% · CEO 10%')
    expect(html).not.toContain('CMO 5%</')
    expect(html).not.toMatch(/NaN|undefined/)
  })
  it('folds weeks older than 12 behind a control', () => {
    const rows = [post({ published_at: '2026-04-01T08:00:00Z', in_pct: 50, out_pct: 50, members_reached: 10 })]
    const html = renderToStaticMarkup(<ReachView read={{ kind: 'ready', rows, readAt: new Date(NOW).toISOString() }} now={NOW} />)
    const weeks = (html.match(/W\d+</g) ?? []).length
    expect(weeks).toBe(12)
    expect(html).toMatch(/Show older weeks \(\d+\)/)
  })
})
