import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))

import { enrollConversationAgent } from './conversationAgentData'

describe('conversation agent enrollment RPC', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('enrolls only after an explicit call with the reviewed policy version', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, reason: 'enrolled', revision: 1 }, error: null })

    await enrollConversationAgent('prospect-1', 'review')

    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('conversation_agent_enroll', {
      p_prospect_id: 'prospect-1',
      p_mode: 'review',
      p_policy_version: 'conversation-agent-ivan-v1',
    })
  })

  it('shows an install-readiness error when the enrollment RPC is absent', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } })
    await expect(enrollConversationAgent('prospect-1', 'shadow')).rejects.toThrow('controls are not installed')
  })
})
