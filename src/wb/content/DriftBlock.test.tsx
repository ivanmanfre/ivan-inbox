import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { DriftView } from './DriftBlock'
import type { DriftRead, JoinedRow } from '../../lib/drift'
import type { PostAudienceRow } from '../../lib/reach'

const NOW = Date.parse('2026-09-16T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86400e3).toISOString()
const joined = (o: Partial<JoinedRow>): JoinedRow => ({ connected_at: at(10), title: 'Founder', country: 'US', location: 'New York, New York, United States', company: null, ...o })
const many = (n: number, o: Partial<JoinedRow>) => Array.from({ length: n }, () => joined(o))
const post = (o: Partial<PostAudienceRow>): PostAudienceRow => ({
  activity_id: String(Math.random()), post_url: null, published_at: at(5), title: 'p', impressions: null,
  in_pct: 40, out_pct: 60, members_reached: 100, demographics: null, captured_at: at(1), source: 'tracker', ...o,
})
const ready = (rows: JoinedRow[]): DriftRead => ({ kind: 'ready', joined: rows, readAt: at(0) })

describe('DriftView', () => {
  it('shows the failure inside the section, never hiding the reach block', () => {
    const html = renderToStaticMarkup(<DriftView read={{ kind: 'failed', message: 'boom' }} own={[]} lane="arch" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/data-reach-drift="failed"/)
    expect(html).toMatch(/Who joined the network/)
  })
  it('renders counts, country and title shares, and the reach line', () => {
    const rows = [...many(12, { country: 'US' }), ...many(4, { country: 'Israel', title: 'CMO' }), joined({ country: 'Croatia', location: 'Zagreb, Croatia' }), ...many(10, { connected_at: at(120), country: 'Poland' })]
    const own = [post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }] } })]
    const html = renderToStaticMarkup(<DriftView read={ready(rows)} own={own} lane="arch" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/data-reach-drift="ready"/)
    expect(html).toMatch(/data-drift-recent="17"/)
    expect(html).toMatch(/17 connections accepted/)
    expect(html).toMatch(/United States 71%/)
    expect(html).toMatch(/Founder 76%/)
    expect(html).toMatch(/data-drift-reach="1"/)
    expect(html).toMatch(/Zagreb/)
    expect(html).toMatch(/1 of 17/)
    expect(html).not.toMatch(/NaN|undefined/)
  })
  it('shows counts only under the floor and says so', () => {
    const html = renderToStaticMarkup(<DriftView read={ready(many(4, {}))} own={[]} lane="ivan" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/4 connections accepted/)
    expect(html).not.toMatch(/%/)
    expect(html).toMatch(/Under 10/)
  })
})
