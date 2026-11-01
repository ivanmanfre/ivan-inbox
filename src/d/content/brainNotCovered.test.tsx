// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BRAIN_NOT_COVERED, brainSeatError } from '../../lib/brainAccount'
import { WhatWorksNowBody } from './WhatWorksNow'
import { BrainScoreboardBody } from './BrainScoreboard'
import { RepeatEngagersBody } from './RepeatEngagers'

describe('a seat the content brain does not read', () => {
  it('maps the database refusal to a plain note', () => {
    expect(brainSeatError('unknown seat')).toBe(BRAIN_NOT_COVERED)
    expect(brainSeatError('permission denied')).toBeNull()
  })
  it('shows the note with no retry button on every brain panel', () => {
    const noop = () => {}
    render(<>
      <WhatWorksNowBody lane="swishdm" data={null} error={BRAIN_NOT_COVERED} onRetry={noop} />
      <BrainScoreboardBody lane="swishdm" data={null} error={BRAIN_NOT_COVERED} onRetry={noop} />
      <RepeatEngagersBody lane="swishdm" data={null} error={BRAIN_NOT_COVERED} onRetry={noop} />
    </>)
    expect(screen.getAllByText(BRAIN_NOT_COVERED)).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /again|retry/i })).toBeNull()
  })
})

describe('Results for a seat with no post tracker', () => {
  it('says the posts are not tracked, with no failure and no retry', async () => {
    const { ResultsBody } = await import('./Results')
    render(<ResultsBody untracked="SwishDM posts are not tracked yet." own={null} evidence={null} now={Date.parse('2026-11-01T12:00:00Z')} onRetry={() => {}} />)
    expect(screen.getByText('SwishDM posts are not tracked yet.')).toBeTruthy()
    expect(screen.queryByText(/Could not read your post results/)).toBeNull()
  })
})
