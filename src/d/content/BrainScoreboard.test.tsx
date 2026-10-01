// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { BrainScoreboardBody } from './BrainScoreboard'
import type { BrainScoreboardData, BrainMetrics } from '../../lib/brainAccount'
afterEach(cleanup)
const missing: BrainMetrics = { published_n: 0, engagement_n: 0, engagement_median: null, impressions_n: 0, impressions_median: null, above_floor_p75_n: 0, above_floor_p75_eligible_n: 0, above_floor_p75_share: null, relevant_scored_engager_posts_n: 0, scored_engagers_total: null, relevant_engagers_total: null, relevant_engagers_per_post: null }
const fixture: BrainScoreboardData = { client: 'ivan', refresh_status: 'ready', source_posts_sha256: null, metric_basis: null, as_of: '2026-10-01', refreshed_at: null, stale: false, floor: null, cohort: { status: 'no_cohort', brain_published_n: 0, unlinked_brain_n: 0, comparison_status: 'no_cohort', comparison_available: false, weeks_utc: [], brain: missing, other: missing }, rolling_4w: { start_at: '2026-09-03', end_exclusive: '2026-10-01', account: missing, engagement_vs_floor_ratio: null, impressions_vs_floor_ratio: null, engagement_vs_floor_delta: null, impressions_vs_floor_delta: null, engagement_ratio_reason: 'no_metrics', impressions_ratio_reason: 'no_metrics' }, limitations: ['Paid status unknown.'] }
it('keeps an empty brain cohort separate from account context and does not invent medians', () => {
 renderInFrame(<BrainScoreboardBody lane="ivan" data={fixture} error={null} onRetry={() => {}} />)
 expect(screen.getByText(/No brain posts are published.*n=0/)).toBeTruthy()
 expect(screen.getByRole('heading', { name: 'Account · rolling four weeks' })).toBeTruthy()
 expect(screen.queryByRole('table')).toBeNull()
 expect(screen.getAllByText(/Not recorded/).length).toBeGreaterThan(0)
 expect(screen.queryByText('0× the frozen floor')).toBeNull()
})
it('shows early sample and every metric denominator, preserving a real measured zero', () => {
 const brain = { ...missing, published_n: 2, engagement_n: 1, engagement_median: 0, above_floor_p75_eligible_n: 1, above_floor_p75_share: 0 }
 renderInFrame(<BrainScoreboardBody lane="ivan" data={{ ...fixture, cohort: { ...fixture.cohort!, comparison_status: 'available', comparison_available: true, status: 'early', brain_published_n: 2, weeks_utc: ['2026-09-28'], brain } }} error={null} onRetry={() => {}} />)
 expect(screen.getByText('Early · fewer than 8 brain posts')).toBeTruthy()
 expect(screen.getAllByText('n=1')).toHaveLength(2)
 expect(screen.getByText('0%')).toBeTruthy()
 expect(screen.getByText('0')).toBeTruthy()
 expect(screen.getByText(/Engagement is reactions \+ comments\./)).toBeTruthy()
})
it('fails visibly for a client mismatch and failed read without exposing metrics', () => {
 renderInFrame(<BrainScoreboardBody lane="arch" data={fixture} error={null} onRetry={() => {}} />)
 expect(screen.getByText('The scoreboard returned a different client.')).toBeTruthy()
 expect(screen.queryByRole('table')).toBeNull()
 expect(screen.queryByText(/No brain posts are published/)).toBeNull()
})
it('shows partial floor and refreshed date next to the actual comparison', () => {
 const floor = { client_id: 'ivan' as const, frozen_at: '2026-10-01', observed_through: '2026-10-01', window_start: '2026-08-10', window_end_exclusive: '2026-10-05', window_complete: false, metric_basis: 'reactions_plus_comments', published_n: 20, engagement_n: 19, engagement_median: 4, engagement_p75: 10, impressions_n: 8, impressions_median: 200, impressions_p75: 400, first_published_at: null, last_published_at: null, source_rows_sha256: 'fixture', limitation: 'Mixed post ages.' }
 renderInFrame(<BrainScoreboardBody lane="ivan" data={{ ...fixture, floor, stale: true }} error={null} onRetry={() => {}} />)
 expect(screen.getByText('Partial window')).toBeTruthy()
 expect(screen.getByText(/frozen 1 Oct 2026/)).toBeTruthy()
 expect(screen.getByText(/weekly refresh is overdue/)).toBeTruthy()
 expect(screen.getByText(/comparisons are correlation/)).toBeTruthy()
 expect(screen.getAllByText('n=19')).toHaveLength(2)
 expect(screen.getByText('n=8')).toBeTruthy()
 expect(screen.getByText('Floor median engagement')).toBeTruthy()
 expect(screen.getByText('Floor median impressions')).toBeTruthy()
 expect(screen.getByText('Floor engagement p75')).toBeTruthy()
 expect(screen.getByLabelText('Brain scoreboard').textContent).not.toMatch(/forecast|predict/i)
})
