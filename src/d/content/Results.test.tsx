// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { ResultsBody } from './Results'
import type { ContentEvidenceViews } from '../../lib/contentEvidence'
import type { ReachRead } from '../../lib/reach'
afterEach(cleanup)
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
