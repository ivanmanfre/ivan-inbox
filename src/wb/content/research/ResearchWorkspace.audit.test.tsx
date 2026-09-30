// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import type { EditorialClient } from '../../../lib/editorialTypes'
import { brief, stubClient } from '../../../lib/editorialBriefs.fixtures'
import * as workspace from './ResearchWorkspace'
import { groupBriefVersions, weekRefreshBlock } from './weeklyReview'
afterEach(cleanup)

it('renders composed base strategy and current steering as readable prose with precedence', async () => {
  const direction = { schema: 'editorial-direction-composed-v2',
    base_strategy: { sections: [{ key: 'buyer', title: 'Reader', body: 'Synthetic retained base paragraph.' }] },
    visible_user_steering: { quotes: [{ id: 'synthetic-quote', text: 'Synthetic current steering.', client_id: 'ivan' }], boundaries: ['Synthetic current boundary.'] },
    priority_rules: [{ rank: 1, rule: 'Synthetic permission precedence.' }],
    proof_boundary: 'Synthetic strategy is context and requires sourced proof.',
    supplemental_patch: { payload: { audience: 'Synthetic supplemental reader', a2_scoped_direction: { allowed_research_themes: ['Synthetic research theme'], voice_register: 'Plain synthetic voice', boundaries: ['Synthetic supplemental boundary'] } } },
    explicit_conflicts: [{ field: 'theme', resolution: 'Synthetic reviewed resolution.', review_required: 'Synthetic review remains required.' }],
  }
  const client = stubClient({ editorial_read_direction: () => ({ data: { client_id: 'ivan', status: 'active', active_version: 'synthetic-v1', direction, source: 'synthetic-source', updated_at: '2026-09-28' }, error: null }) })
  render(<workspace.EditorialClientProvider client={client}><workspace.ClientDirectionPanel lane="ivan" /></workspace.EditorialClientProvider>)
  expect(await screen.findByText('Synthetic retained base paragraph.')).toBeTruthy()
  expect(screen.getByText('Synthetic current steering.')).toBeTruthy()
  expect(screen.getByText('Synthetic permission precedence.')).toBeTruthy()
  expect(screen.getByText('Synthetic review remains required.')).toBeTruthy()
  expect(screen.getByText('Synthetic strategy is context and requires sourced proof.')).toBeTruthy()
  expect(screen.getByText('Synthetic supplemental reader')).toBeTruthy()
  expect(screen.getByText('Synthetic research theme')).toBeTruthy()
})

it('shows one newest brief and retains older exact-version eligibility inside history', async () => {
  const older = brief({ review: null }); const newest = structuredClone(older); newest.identity.version = 2
  newest.review = { reviewer_seat: 'independent-reviewer', reviewer_model: 'human', verdict: 'pass', reviewed_at: '2026-09-23', notes: 'Reviewed exact version' }
  const hash = 'a'.repeat(64)
  const manifest = { client_id: 'ivan', contract_version: 1, direction_version: 'old', week_start: '2026-09-28', policy_status: 'adopted', slots: [{ slot_id: 'slot', client_id: 'ivan', direction_version: 'old', week_start: '2026-09-28', ordinal: 1, purpose: 'reach', format: 'text' }] }
  const client = stubClient({
    editorial_read_direction: () => ({ data: { client_id: 'ivan', active_version: 'current', status: 'active', direction: {}, source: 'source', updated_at: '2026-09-28' }, error: null }),
    editorial_read_weekly_review: () => ({ data: { state: 'ready', client_id: 'ivan', manifest, manifest_hash: hash, links: [older, newest].map(b => ({ slot_id: 'slot', brief_id: b.identity.brief_id, brief_version: b.identity.version, linked_at: '2026-09-28' })), available_weeks: ['2026-09-28'], available_plans: [{ week_start: '2026-09-28', direction_version: 'old', manifest_hash: hash }] }, error: null }),
    editorial_read_brief: params => ({ data: { found: true, brief: params.p_version === 2 ? newest : older }, error: null }),
  })
  render(<workspace.EditorialClientProvider client={client}><workspace.ThisWeekPanel lane="ivan" /></workspace.EditorialClientProvider>)
  const history = await screen.findByText('Earlier linked versions (1)')
  expect((screen.getByRole('button', { name: 'Refresh suggestions' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/Refresh requires a saved evidence plan for the current direction/)).toBeTruthy()
  expect((screen.getAllByRole('button', { name: 'Create draft' })[0] as HTMLButtonElement).disabled).toBe(false)
  expect(history.parentElement!.hasAttribute('open')).toBe(false)
  const oldCreate = [...history.parentElement!.querySelectorAll('button')].find(b => b.textContent === 'Create draft')!
  expect(oldCreate.disabled).toBe(true)
  expect(history.parentElement!.textContent).toContain('v1')
  expect(history.parentElement!.textContent).toContain(older.identity.content_hash)
})

it('includes legacy statement, source and adoption reason in the parent dirty guard', async () => {
  const onDirtyChange = vi.fn()
  const client = { rpc: vi.fn(async () => ({ data: { client_id: 'ivan', status: 'active', active_version: 'v1', direction: { statement: 'Original direction' }, source: 'Original source', updated_at: '2026-09-28' }, error: null })) } as unknown as EditorialClient
  render(<workspace.EditorialClientProvider client={client}><workspace.ClientDirectionPanel lane="ivan" onDirtyChange={onDirtyChange} /></workspace.EditorialClientProvider>)
  await screen.findByDisplayValue('Original direction')
  fireEvent.change(screen.getByLabelText('Legacy direction statement'), { target: { value: 'Revised statement' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  fireEvent.change(screen.getByLabelText('Legacy direction statement'), { target: { value: 'Original direction' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Updated source' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Original source' } })
  fireEvent.change(screen.getByLabelText('Why adopt'), { target: { value: 'New reason' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
})

it('groups exact linked versions newest first without dropping historical identities', () => {
  const v1 = brief(); const v3 = structuredClone(v1); v3.identity.version = 3
  const other = structuredClone(v1); other.identity.brief_id = 'other'
  const group = groupBriefVersions
  expect(group([v1, other, v3])?.map(g => g.map(b => [b.identity.brief_id, b.identity.version]))).toEqual([
    [[v1.identity.brief_id, 3], [v1.identity.brief_id, 1]], [['other', 1]],
  ])
})
it('explains unusable saved-plan refresh before an operator requests it', () => {
  const guard = weekRefreshBlock
  expect(String(guard({ direction_version: 'old', contract_version: 1, policy_status: 'adopted' }, 'current', true, 'hash'))).toMatch(/earlier direction/)
  expect(String(guard({ direction_version: 'current', contract_version: 1, policy_status: 'adopted' }, 'current', false, null))).toMatch(/saved evidence plan/)
  expect(guard({ direction_version: 'current', contract_version: 1, policy_status: 'adopted' }, 'current', true, 'hash')).toBeNull()
})
