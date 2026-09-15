import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}))

import { approveConversationTakeover, approveOpsDraft, discardConversationTakeover, discardOpsDraft, fetchConversationTakeoverReadiness, TAKEOVER_SENDING_HELD } from '../../lib/ops'
import { TAKEOVER_CONSEQUENCE } from './ConversationTakeoverCard'

describe('conversation takeover approval', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the dedicated authenticated RPC with the original hash and edited opener', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, reason: 'approved', thread_id: 'thread-1', draft_id: 'draft-1' }, error: null })

    await approveConversationTakeover('draft-1', 'proposal-hash', 'Edited opener\nwith its line break')

    expect(mocks.rpc).toHaveBeenCalledWith('conversation_agent_approve_takeover', {
      p_draft_id: 'draft-1',
      p_expected_hash: 'proposal-hash',
      p_body: 'Edited opener\nwith its line break',
    })
  })

  it.each([
    ['proposal_hash_mismatch', 'changed'],
    ['proposal_expired', 'expired'],
    ['stale_eligibility', 'viewer or conversation changed'],
    ['operator_denied', 'authenticated operator'],
  ])('does not claim success when the RPC returns ok:false (%s)', async (reason, message) => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, reason }, error: null })
    await expect(approveConversationTakeover('draft-1', 'proposal-hash', 'Hello')).rejects.toThrow(message)
  })

  it('rejects takeover use through the generic approval helper', async () => {
    await expect(approveOpsDraft('draft-1', 'Hello', 'conversation_takeover')).rejects.toThrow('dedicated approval route')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('uses the dedicated hash-bound discard RPC and rejects ok:false', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, reason: 'discarded', draft_id: 'draft-1' }, error: null })
    await discardConversationTakeover('draft-1', 'proposal-hash')
    expect(mocks.rpc).toHaveBeenCalledWith('conversation_agent_discard_takeover', {
      p_draft_id: 'draft-1',
      p_expected_hash: 'proposal-hash',
    })

    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'proposal_hash_mismatch' }, error: null })
    await expect(discardConversationTakeover('draft-1', 'proposal-hash')).rejects.toThrow('changed')
  })

  it('rejects takeover use through the generic discard helper', async () => {
    await expect(discardOpsDraft('draft-1', 'conversation_takeover')).rejects.toThrow('dedicated discard route')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('blocks a missing hash and an over-limit opener before any RPC call', async () => {
    await expect(approveConversationTakeover('draft-1', '', 'Hello')).rejects.toThrow('no approval hash')
    await expect(approveConversationTakeover('draft-1', 'proposal-hash', 'x'.repeat(401))).rejects.toThrow('400 characters or fewer')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('states the complete one-time authorization before approval', () => {
    expect(TAKEOVER_CONSEQUENCE).toBe('Approving sends this opener and lets the agent handle replies, reactions, relevant post likes and resource sharing for this conversation. You can pause or take over in Inbox.')
  })
})

describe('conversation takeover release readiness', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([null, {}, { ready: false, reason: 'sending_held' }, { ready: 'true' }])('holds approval without explicit server readiness: %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect(await fetchConversationTakeoverReadiness('draft-1')).toBe(false)
    expect(mocks.rpc).toHaveBeenCalledWith('conversation_agent_takeover_readiness', { p_draft_id: 'draft-1' })
  })

  it('allows one-click approval once the server verifies readiness', async () => {
    mocks.rpc.mockResolvedValue({ data: { ready: true, reason: 'ready' }, error: null })
    expect(await fetchConversationTakeoverReadiness('draft-1')).toBe(true)
  })

  it('propagates unavailable readiness and uses explicit held copy', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('unavailable') })
    await expect(fetchConversationTakeoverReadiness('draft-1')).rejects.toThrow('unavailable')
    expect(TAKEOVER_SENDING_HELD).toBe('Draft ready. Sending is held while LinkedIn checks finish.')
  })
})
