import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { BenchmarkView } from './BenchmarkBlock'
import type { MeasurementPayload, MeasurementRow } from '../../lib/audience'
import type { Benchmark } from '../../lib/benchmark'
const row = { client_id: 'ivan', canonical_post_id: 'post-1', metric: 'impressions', target_age_days: 7, status: 'supported', eligible_n: 8, minimum_n: 8, p50: 100, p75: 200, p90: 300 } as MeasurementRow
const measurement: MeasurementPayload = { client_id: 'ivan', contract_version: 1, targets: [7, 14], tolerance_days: 1, cohort_days: 90, self_inclusive: true, minimum_n: 8, matched_age: Array.from({ length: 30 }, (_, i) => ({ ...row, canonical_post_id: `post-${i}` })), monthly_trend: [], coverage: [], classifications: [] }
describe('benchmark evidence view', () => {
  it('renders own results even when the competitor source failed; all rows are reachable', () => {
    const html = renderToStaticMarkup(<BenchmarkView lane="ivan" state={{ kind: 'failed', message: 'Competitors down' }} measurement={{ kind: 'ready', data: measurement }} view="results" />)
    expect(html).toContain('p90 300'); expect(html).toContain('post-29'); expect(html).not.toContain('Competitors down')
  })
  it('shows an under-floor cohort count before the post disclosure', () => {
    const html = renderToStaticMarkup(<BenchmarkView lane="ivan" state={{ kind: 'loading' }} measurement={{ kind: 'ready', data: { ...measurement, matched_age: [{ ...row, eligible_n: 3, status: 'below_floor' }] } }} />)
    expect(html.indexOf('eligible n=3 / minimum 8')).toBeGreaterThan(0)
    expect(html.indexOf('eligible n=3 / minimum 8')).toBeLessThan(html.indexOf('<details'))
    expect(html).not.toContain('p90 300')
  })
  it('rejects cross-lane measurement rows', () => {
    const html = renderToStaticMarkup(<BenchmarkView lane="ivan" state={{ kind: 'loading' }} measurement={{ kind: 'ready', data: { ...measurement, matched_age: [{ ...row, client_id: 'other' }] } }} />)
    expect(html).toContain('different lane'); expect(html).not.toContain('p90 300')
  })
  it('retains all accounts, categories, source links and provided p90 independently of measurements', () => {
    const b = { client_id: 'ivan', days: 90, read_at: '2026-09-14', floors: { author_min: 8 }, roster: [], accounts: Array.from({ length: 27 }, (_, i) => ({ who: `Author ${i}`, role: 'direct_competitor', n: 10, per_wk: 2, median: 30, p90: 88, media: 'text', best: { url: 'https://example.com/post' } })), top: [], outliers: [], source_classifications: Array.from({ length: 30 }, (_, i) => ({ author_name: `Category ${i}`, n: 1 })) } as unknown as Benchmark
    const html = renderToStaticMarkup(<BenchmarkView lane="ivan" view="competitors" state={{ kind: 'ready', data: b }} measurement={{ kind: 'failed', message: 'Measurements down' }} />)
    expect(html).toContain('Author 26'); expect(html).toContain('Category 29'); expect(html).toContain('p90 88'); expect(html).toContain('https://example.com/post'); expect(html).not.toContain('Measurements down')
  })
})
