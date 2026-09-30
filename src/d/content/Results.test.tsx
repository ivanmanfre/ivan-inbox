// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { ResultsBody } from './Results'
import type { ContentEvidenceViews } from '../../lib/contentEvidence'
import type { ReachRead } from '../../lib/reach'
afterEach(cleanup)
it('offers every flagged winner while initially describing five of nine', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ ...own.kind === 'ready' ? own.rows[0] : {}, activity_id: String(i), title: `Winner ${i}`, captured_at: '2026-09-29T12:00:00Z' }))
  renderInFrame(<ResultsBody own={{ ...own, rows } as ReachRead} evidence={evidence} onRetry={() => {}} now={Date.parse('2026-09-30')} />)
  expect(screen.getByText('Showing 5 of 9 winning posts.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show all 9 winners' }))
  expect(screen.getAllByRole('heading', { level: 3, name: /Winner / })).toHaveLength(9)
  expect(screen.getAllByText(/Metrics captured Tue 29 Sep/)).toHaveLength(9)
})
it('keeps candidate, review and publication stages distinct and exposes measurement context', () => {
  const choices = ['candidate', 'ready_for_review', 'awaiting_publication'].map(status => ({ ...evidence.results.choices[1], id: status, topic: status, status, objective: 'buyer_response', evaluation_age_days: 4, denominator_note: 'Four comparable posts' }))
  renderInFrame(<ResultsBody own={own} evidence={{ ...evidence, results: { ...evidence.results, state: 'stale', choices } } as ContentEvidenceViews} onRetry={() => {}} now={Date.parse('2026-09-30')} />)
  expect(screen.getByText('Candidate')).toBeTruthy()
  expect(screen.getByText('Ready for review')).toBeTruthy()
  expect(screen.getByText('Waiting to publish')).toBeTruthy()
  expect(screen.getAllByText(/Objective: buyer response/)).toHaveLength(3)
  expect(screen.getAllByText(/Evaluation age: 4 days/)).toHaveLength(3)
  expect(screen.getAllByText(/Four comparable posts/)).toHaveLength(3)
  expect(screen.getByText(/Weekly evidence is stale/)).toBeTruthy()
})
const evidence = { thisWeek: { state: 'ready', candidates: [{ id: 'pick', topic: 'Weekly source pick', evidence_sentence: 'Source received 120 likes', source_url: null }], asOf: '2026-09-28' }, results: { state: 'ready', choices: [{ id: 'choice', topic: 'Our published adaptation', status: 'evaluated', published_at: '2026-09-28', outcome: { metric_label: 'reach', observed_value: 4200, comparison_label: 'Above the account median.' } }, { id: 'pending', topic: 'Waiting adaptation', status: 'awaiting_publication', outcome: { metric_label: 'reach', observed_value: 0, comparison_label: 'Below median' } }], priorFailures: [] } } as unknown as ContentEvidenceViews
const own = { kind: 'ready', rows: [{ activity_id: 'own', title: 'Real own winner', published_at: '2026-09-29', is_winner: true, impressions: 9000, comments: 23, reactions: 90 }], followers: null, readAt: '2026-09-30' } as ReachRead
it('shows own observed metrics and weekly choices, with awaiting publication remaining pending', () => {
  renderInFrame(<ResultsBody own={own} evidence={evidence} onRetry={() => {}} now={Date.parse('2026-09-30')} />)
  expect(screen.getByText('Real own winner')).toBeTruthy()
  expect(screen.getByText(/9,000 impressions/)).toBeTruthy()
  expect(screen.getByText(/reach: 4,200/)).toBeTruthy()
  expect(screen.getByText('Waiting to publish')).toBeTruthy()
  expect(screen.queryByText(/Below median/)).toBeNull()
  expect(screen.getByRole('heading', { name: 'Weekly source pick' })).toBeTruthy()
  expect(screen.getByText('Source received 120 likes')).toBeTruthy()
})
it('keeps failed reads visibly failed instead of claiming no winners', () => {
  renderInFrame(<ResultsBody own={{ kind: 'failed', message: 'Network refused' }} evidence={null} onRetry={() => {}} now={Date.parse('2026-09-30')} />)
  expect(screen.getByText(/Network refused/)).toBeTruthy()
  expect(screen.getByText('Some results could not be read.')).toBeTruthy()
  expect(screen.queryByText(/0 posts with the most comments/)).toBeNull()
  expect(screen.queryByText("You're done")).toBeNull()
})

it('a fully settled failed evidence read and own read do not print false zero outcomes', () => {
  const failed = { ...evidence, thisWeek: { ...evidence.thisWeek, state: 'failed', candidates: [], message: 'Evidence unavailable' }, results: { ...evidence.results, state: 'failed', choices: [], message: 'Evidence unavailable' } } as ContentEvidenceViews
  renderInFrame(<ResultsBody own={{ kind: 'failed', message: 'Network refused' }} evidence={failed} onRetry={() => {}} now={Date.parse('2026-09-30')} />)
  expect(screen.getByText('Some results could not be read.')).toBeTruthy()
  expect(screen.queryByText(/0 posts with the most comments/)).toBeNull()
})
it('an unexpected weekly reader rejection is a visible failure instead of a perpetual loading state', () => {
  renderInFrame(<ResultsBody own={own} evidence={null} evidenceError="Weekly payload failed" onRetry={() => {}} now={Date.parse('2026-09-30')} />)
  expect(screen.getByText('Weekly payload failed')).toBeTruthy()
  expect(screen.queryByLabelText('Reading weekly picks')).toBeNull()
})
