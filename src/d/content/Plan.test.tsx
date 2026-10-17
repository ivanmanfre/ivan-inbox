// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { PlanRead } from '../../lib/contentPlan'
import { Plan } from './Plan'

const api = vi.hoisted(() => ({ fetchPlan: vi.fn(), fetchRankedIdeas: vi.fn(), decideClientIdea: vi.fn() }))
vi.mock('../../lib/contentPlan', async original => ({ ...await original<typeof import('../../lib/contentPlan')>(), fetchPlan: api.fetchPlan }))
vi.mock('../../lib/rankedIdeas', async original => ({ ...await original<typeof import('../../lib/rankedIdeas')>(), fetchRankedIdeas: api.fetchRankedIdeas }))
vi.mock('../../lib/clientIdeas', async original => ({ ...await original<typeof import('../../lib/clientIdeas')>(), decideClientIdea: api.decideClientIdea }))

function plan(account: 'risedtc' | 'arch'): PlanRead {
  return {
    account, today: '2026-10-17', target: 1, target_week: '2026-10-19', open: 0,
    state: 'planning', proposals_only: true, founder_story_max: 1, cadence_source: 'test',
    weeks: [
      { start: '2026-10-12', which: 'this', target: 0, filled: 0, open: 0, posts: [], planned: [] },
      { start: '2026-10-19', which: 'next', target: 1, filled: 1, open: 0, posts: [], planned: [{
        kind: 'planned', slot_id: 's1', topic: 'One idea', why_now: 'Now', evidence: [], format: 'text', picture: null,
        idea_source: 'client_ideas', idea_ref: 'i1', proposal: true, status: 'proposal', status_label: 'Proposal', draft_id: null,
      }] },
      { start: '2026-10-26', which: 'after', target: 0, filled: 0, open: 0, posts: [], planned: [] },
    ], done: [], warnings: [], last_run: null,
  }
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('plan proposal format choice', () => {
  it('uses the source idea format for RISE and sends the edited selection', async () => {
    api.fetchPlan.mockResolvedValue(plan('risedtc'))
    api.fetchRankedIdeas.mockResolvedValue([{ id: 'i1', client: { format: 'post', planned_format: 'carousel' } }])
    api.decideClientIdea.mockResolvedValue(undefined)
    renderInFrame(<Plan lane="risedtc" setLane={() => {}} />)
    const picker = await screen.findByRole('combobox', { name: 'Draft format for One idea' }) as HTMLSelectElement
    await waitFor(() => expect(picker.value).toBe('carousel'))
    fireEvent.change(picker, { target: { value: 'text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    await waitFor(() => expect(api.decideClientIdea).toHaveBeenCalledWith('i1', 'approved', 'risedtc', 'text'))
  })

  it('keeps the existing approval call for another client', async () => {
    api.fetchPlan.mockResolvedValue(plan('arch'))
    api.fetchRankedIdeas.mockResolvedValue([])
    api.decideClientIdea.mockResolvedValue(undefined)
    renderInFrame(<Plan lane="arch" setLane={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate draft' }))
    await waitFor(() => expect(api.decideClientIdea).toHaveBeenCalledWith('i1', 'approved', 'arch'))
    expect(screen.queryByRole('combobox', { name: 'Draft format for One idea' })).toBeNull()
  })
})
