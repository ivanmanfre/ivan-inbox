// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { DirectionView, directionWords, type DirectionState } from './ContentBrain'

vi.mock('../../lib/editorialDirection', () => ({ readEditorialDirection: vi.fn() }))
const policy = { status: 'adopted', weekly_total: 4, objective: 'Grow relevant reach', allocation: { unit: 'count', values: { reach: 2, consideration: 1, buyer: 1 } } }
const st = { d: { client_id: 'ivan', status: 'active', active_version: 'september', direction: { weekly_policy: policy } }, err: null, refresh: vi.fn() } as unknown as DirectionState
afterEach(cleanup)

describe('current Plan posting target', () => {
  it('uses the current planner target without inventing a new purpose allocation', () => {
    const words = directionWords(policy, 5)
    expect(words.main).toBe('5 posts a week')
    expect(words.weekly).toBe(5)
    expect(words.aim).toBe('Grow relevant reach.')
    expect(policy.weekly_total).toBe(4)
  })
  it('retains the purpose mix when its adopted total still matches', () => {
    expect(directionWords(policy, 4).main).toBe('4 posts a week: 2 for reach, 1 for trust, 1 for buyers')
  })
  it('does not show the old target while the current target is unconfirmed', () => {
    expect(directionWords(policy, null).main).toBe('No weekly count set.')
  })
  it('renders the actual current plan target with its direction and edit action', () => {
    renderInFrame(<DirectionView lane="ivan" st={st} weeklyTarget={5} />)
    expect(screen.getByText('5 posts a week')).toBeTruthy()
    expect(screen.queryByText(/4 posts a week/)).toBeNull()
    expect(screen.getByText('Grow relevant reach.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  })
})
