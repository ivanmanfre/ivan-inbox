// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EditorialClient } from '../../../lib/editorialTypes'
import { WeeklyPolicyPanel } from './WeeklyPolicyPanel'

const stored = { version: 'v1', direction: { statement: 'Legacy statement', unexpected_original: { keep: true } } as Record<string, unknown> }
const calls: { name: string; params: Record<string, unknown> }[] = []
const client: EditorialClient = {
  rpc: vi.fn(async (name, params) => {
    calls.push({ name, params })
    if (name === 'editorial_read_direction') return { data: { client_id: 'ivan', active_version: stored.version, status: 'active', direction: stored.direction, source: 'original-source', updated_at: '2026-09-21' }, error: null }
    if (name === 'editorial_adopt_direction') {
      if (params.p_expected_version !== stored.version) return { data: { state: 'conflict', observed_version: stored.version }, error: null }
      stored.version = 'v2'; stored.direction = params.p_payload as Record<string, unknown>
      return { data: { state: 'active', active_version: 'v2' }, error: null }
    }
    return { data: null, error: { message: `Unexpected ${name}` } }
  }),
  functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
}

beforeEach(() => {
  stored.version = 'v1'; stored.direction = { statement: 'Legacy statement', unexpected_original: { keep: true } }
  calls.length = 0
})

describe('editable weekly policy through the actual direction adapter', () => {
  it('previews purpose separately from format and saves/readbacks while retaining unknown direction fields', async () => {
    render(<WeeklyPolicyPanel lane="ivan" client={client} />)
    await screen.findByText(/Current direction v1/)
    fireEvent.change(screen.getByLabelText('Weekly total'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('New purpose'), { target: { value: 'buyer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add purpose' }))
    fireEvent.change(screen.getByLabelText('buyer slots'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('buyer desired outcome'), { target: { value: 'Qualified conversations' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add format' }))
    fireEvent.change(screen.getByLabelText('text maximum slots'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show objectives and evidence' }))
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Conversations with buyers' } })
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'Agency owners' } })
    fireEvent.change(screen.getByLabelText('Offer'), { target: { value: 'LinkedIn inbound' } })
    fireEvent.change(screen.getByLabelText('Positioning'), { target: { value: 'Operator-led' } })
    fireEvent.change(screen.getByLabelText('Evidence observed on'), { target: { value: '2026-09-23' } })
    fireEvent.change(screen.getByLabelText('Policy rationale'), { target: { value: 'Dated client decision' } })
    expect(document.querySelectorAll('.a-policy-slots li')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Why adopt this version'), { target: { value: 'Client approved revised week' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adopt weekly policy' }))
    await waitFor(() => expect(stored.version).toBe('v2'))
    expect(stored.direction).toMatchObject({ statement: 'Legacy statement', unexpected_original: { keep: true }, weekly_policy: {
      status: 'adopted', weekly_total: 3, objective: 'Conversations with buyers', audience: 'Agency owners', offer: 'LinkedIn inbound', positioning: 'Operator-led',
      allocation: { unit: 'count', values: { buyer: 3 } }, format_preferences: [{ format: 'text', max_slots: 3 }],
    } })
    expect(calls.find(c => c.name === 'editorial_adopt_direction')?.params).toMatchObject({ p_client_id: 'ivan', p_expected_version: 'v1' })
    await screen.findByText(/Adopted direction v2/)
  })
})
