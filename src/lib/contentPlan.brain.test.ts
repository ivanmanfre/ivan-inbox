import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import { BrainActionError, decideProposal, undoRuleChange } from './contentPlan'

afterEach(() => rpc.mockReset())

describe('decideProposal', () => {
  it('accept calls the gated wrapper with the gate, the id and accept=true', async () => {
    rpc.mockResolvedValue({ data: { event_id: 7, from: 'shadow', to: 'live', proposal: 12 }, error: null })
    await expect(decideProposal(12, true)).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('operator_brain_proposal_decide', { p_gate: 'clientops', p_id: 12, p_accept: true })
  })
  it('dismiss needs {dismissed:true}', async () => {
    rpc.mockResolvedValue({ data: { dismissed: true, proposal: 12 }, error: null })
    await expect(decideProposal(12, false)).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('operator_brain_proposal_decide', { p_gate: 'clientops', p_id: 12, p_accept: false })
    rpc.mockResolvedValue({ data: { dismissed: false, proposal: 12 }, error: null })
    await expect(decideProposal(12, false)).rejects.toMatchObject({ code: 'not_open' })
  })
  it('a closed proposal raises on accept: not_open; any other error is failed; bad gate keeps its code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'brain_proposal_accept: 12 is not an open proposal' } })
    await expect(decideProposal(12, true)).rejects.toMatchObject({ code: 'not_open' })
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(decideProposal(12, true)).rejects.toMatchObject({ code: 'failed' })
    rpc.mockResolvedValue({ data: { ok: false, error: 'bad_gate' }, error: null })
    await expect(decideProposal(12, true)).rejects.toBeInstanceOf(BrainActionError)
    rpc.mockResolvedValue({ data: { skipped: 'locked', lock_reason: 'x' }, error: null })
    await expect(decideProposal(12, true)).rejects.toMatchObject({ code: 'skipped_locked' })
  })
  it('a direction change is made by hand: its own code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'brain_proposal_accept: a direction change is edited by hand in an owner session (claimed_sign, statement), never executed from a proposal' } })
    await expect(decideProposal(12, true)).rejects.toMatchObject({ code: 'by_hand' })
  })
})

describe('undoRuleChange', () => {
  it('calls the gated wrapper with the token', async () => {
    rpc.mockResolvedValue({ data: { rollback_event_id: 9, event_id: 8 }, error: null })
    await expect(undoRuleChange('11111111-2222-3333-4444-555555555555')).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('operator_brain_rule_undo', { p_gate: 'clientops', p_token: '11111111-2222-3333-4444-555555555555' })
  })
  it('an unknown token, a bad gate and an already put back change are refusals', async () => {
    rpc.mockResolvedValue({ data: { error: 'unknown_token' }, error: null })
    await expect(undoRuleChange('x')).rejects.toMatchObject({ code: 'unknown_token' })
    rpc.mockResolvedValue({ data: { ok: false, error: 'bad_gate' }, error: null })
    await expect(undoRuleChange('x')).rejects.toMatchObject({ code: 'bad_gate' })
    rpc.mockResolvedValue({ data: { already_rolled_back: true, rollback_event_id: 70, event_id: 69 }, error: null })
    await expect(undoRuleChange('x')).rejects.toMatchObject({ code: 'not_open' })
  })
})
