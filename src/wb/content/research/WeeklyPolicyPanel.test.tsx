// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EditorialClient } from '../../../lib/editorialTypes'
import { WeeklyPolicyPanel } from './WeeklyPolicyPanel'

// This file's vitest.config.ts does not set `test.globals: true`, so RTL's
// automatic afterEach(cleanup) (which detects a GLOBAL afterEach) never
// registers. A single-`it()` file never noticed; this file now has two, and
// without this, the second test's queries see both components' DOM at once.
afterEach(cleanup)

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
  it('previews purpose only (no format editor) and saves/readbacks while retaining unknown direction fields', async () => {
    render(<WeeklyPolicyPanel lane="ivan" client={client} />)
    await screen.findByText(/Current direction v1/)
    // content-brain-15 (fork 5): formats are retired from this panel. There is no "Add format"
    // control any more — a fresh proposal is count + purpose only, and buildWeeklySlotManifest's
    // dynamic-slot path fills every purpose slot without any format capacity input.
    expect(screen.queryByRole('button', { name: 'Add format' })).toBeNull()
    screen.getByText(/Formats are dynamic/, { selector: 'p' })
    fireEvent.change(screen.getByLabelText('Weekly total'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('New purpose'), { target: { value: 'buyer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add purpose' }))
    fireEvent.change(screen.getByLabelText('buyer slots'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('buyer desired outcome'), { target: { value: 'Qualified conversations' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show objectives and evidence' }))
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Conversations with buyers' } })
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'Agency owners' } })
    fireEvent.change(screen.getByLabelText('Offer'), { target: { value: 'LinkedIn inbound' } })
    fireEvent.change(screen.getByLabelText('Positioning'), { target: { value: 'Operator-led' } })
    fireEvent.change(screen.getByLabelText('Evidence observed on'), { target: { value: '2026-09-23' } })
    fireEvent.change(screen.getByLabelText('Policy rationale'), { target: { value: 'Dated client decision' } })
    // Three purpose slots fill on count + purpose alone, no format entries needed.
    expect(document.querySelectorAll('.a-policy-slots li')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Why adopt this version'), { target: { value: 'Client approved revised week' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adopt weekly policy' }))
    await waitFor(() => expect(stored.version).toBe('v2'))
    expect(stored.direction).toMatchObject({ statement: 'Legacy statement', unexpected_original: { keep: true }, weekly_policy: {
      status: 'adopted', weekly_total: 3, objective: 'Conversations with buyers', audience: 'Agency owners', offer: 'LinkedIn inbound', positioning: 'Operator-led',
      allocation: { unit: 'count', values: { buyer: 3 } },
    } })
    // The write path never carries the retired key, saved or not.
    expect((stored.direction.weekly_policy as Record<string, unknown>)).not.toHaveProperty('format_preferences')
    expect(calls.find(c => c.name === 'editorial_adopt_direction')?.params).toMatchObject({ p_client_id: 'ivan', p_expected_version: 'v1' })
    await screen.findByText(/Adopted direction v2/)
  })

  it('shows a legacy format quota read-only and lets it be retired, never edited', async () => {
    stored.direction = {
      statement: 'Legacy statement',
      weekly_policy: {
        schema_version: 1, status: 'adopted', weekly_total: 2,
        allocation: { unit: 'count', values: { buyer: 2 } },
        format_preferences: [{ format: 'text', max_slots: 2 }],
        topic_priorities: [], exclusions: [], campaign_dates: [],
        target_outcomes: { buyer: 'Qualified conversations' }, conflict_priority: ['buyer'],
        evidence: { source_ids: ['s1'], observed_at: '2026-09-01', rationale: 'Frozen before formats went dynamic' },
      },
    }
    render(<WeeklyPolicyPanel lane="ivan" client={client} />)
    await screen.findByText(/Current direction v1/)
    screen.getByText(/legacy format quota/)
    expect(screen.queryByRole('button', { name: 'Add format' })).toBeNull()
    expect(document.querySelectorAll('.a-policy-format-legacy li')).toHaveLength(1)
    // H2 F5: Adopt is blocked while the legacy quota is still present, so it
    // can never be re-saved into a new direction version the DB would refuse.
    expect(screen.getByRole('button', { name: 'Adopt weekly policy' })).toBeDisabled()
    expect(document.querySelectorAll('.a-policy-errors li')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /Retire format quota/ }))
    expect(screen.queryByText(/legacy format quota/)).toBeNull()
    expect(document.querySelectorAll('.a-policy-format-legacy')).toHaveLength(0)
    screen.getByText(/Formats are dynamic/, { selector: 'p' })
    // Retiring clears the block by itself (no other field changed).
    expect(document.querySelectorAll('.a-policy-errors li')).toHaveLength(0)
  })
})
