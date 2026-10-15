// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { RecentDecisions } from './ContentBrain'

const history = vi.hoisted(() => vi.fn())
vi.mock('../../lib/brainPage', async original => ({ ...await original<typeof import('../../lib/brainPage')>(), fetchDecisionHistory: history }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows scoped SwishDM verdict history even when the legacy three-seat verdict read is empty', async () => {
  history.mockResolvedValue({ rulings: [], links: new Map([['held-1', {
    draft_id: 'held-1', status: 'review', published_at: null, post_url: null, impressions: null, likes: null, comments: null,
    verdict: 'keep', reasons: ['useful'], note: 'Strong source', decided_at: '2026-10-15T10:00:00Z', title: 'Getting cited',
  }]]) })
  renderInFrame(<RecentDecisions lane="swishdm" verdicts={new Map()} />)
  expect(await screen.findByText('Getting cited')).toBeTruthy()
  expect(document.body.textContent).toContain('Strong source')
  expect(document.body.textContent).not.toContain('No decisions saved')
  expect(history).toHaveBeenCalledWith('swishdm')
})
