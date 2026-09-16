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
  it('shows the denied copy and attribute when the RPC reports unauthorized', () => {
    const html = renderToStaticMarkup(<DriftView read={{ kind: 'denied', message: 'unauthorized: not your seat' }} own={[]} lane="arch" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/data-reach-drift="denied"/)
    expect(html).toMatch(/The network read didn.t load/)
    expect(html).toMatch(/unauthorized: not your seat/)
  })
  it('renders counts, country and title shares, and the reach line', () => {
    const rows = [...many(12, { country: 'US' }), ...many(4, { country: 'Israel', title: 'CMO' }), joined({ country: 'Croatia', location: 'Zagreb, Croatia' }), ...many(10, { connected_at: at(120), country: 'Poland' })]
    const own = [
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }] } }),
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }] } }),
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }] } }),
    ]
    const html = renderToStaticMarkup(<DriftView read={ready(rows)} own={own} lane="arch" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/data-reach-drift="ready"/)
    expect(html).toMatch(/data-drift-recent="17"/)
    expect(html).toMatch(/17 connections accepted/)
    expect(html).toMatch(/Top countries:.*United States 71%/)
    expect(html).toMatch(/Top titles:.*Founder 76%/)
    expect(html).toMatch(/data-drift-reach="1"/)
    expect(html).toMatch(/Zagreb/)
    expect(html).toMatch(/1 of 17/)
    expect(html).not.toMatch(/NaN|undefined/)
  })
  it('renders at most four shift lines when the module finds more', () => {
    const six = ['US', 'Israel', 'Croatia', 'Poland', 'Germany', 'France']
    // Recent: 12 placed, two per country, 17% each. Prior: 12 placed, US 58% and 8% each for the rest.
    // Every country moves at least 5 points, so driftSummary returns six shifts.
    const recent = six.flatMap(country => many(2, { country }))
    const prior = [...many(7, { country: 'US', connected_at: at(120) }), ...six.slice(1).map(country => joined({ country, connected_at: at(120) }))]
    const html = renderToStaticMarkup(<DriftView read={ready([...recent, ...prior])} own={[]} lane="arch" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/data-drift-shifts="6"/)
    expect(html.match(/data-drift-line="shift-/g) ?? []).toHaveLength(4)
    expect(html).not.toMatch(/NaN|undefined/)
  })
  it('shows counts only under the floor and says so', () => {
    const html = renderToStaticMarkup(<DriftView read={ready(many(4, {}))} own={[]} lane="ivan" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/4 connections accepted/)
    expect(html).not.toMatch(/%/)
    expect(html).toMatch(/Under 10 placed accepts, so no country or title shares yet/)
  })
  it('still renders the reach line under the floor, with copy that names what is missing', () => {
    const own = [
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }] }, members_reached: 100 }),
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }] }, members_reached: 100 }),
      post({ demographics: { location: [{ label: 'Zagreb Metropolitan Area', pct: 32 }] }, members_reached: 100 }),
    ]
    const html = renderToStaticMarkup(<DriftView read={ready(many(4, {}))} own={own} lane="ivan" now={NOW} onRetry={() => {}} />)
    expect(html).toMatch(/data-drift-reach="1"/)
    expect(html).toMatch(/Under 10 placed accepts, so no country or title shares yet/)
    expect(html).toMatch(/Zagreb/)
  })
})
