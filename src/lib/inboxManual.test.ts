import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Thread } from './inbox'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), insert: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

import { composeReply } from './inbox'

describe('composeReply conversation ownership evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: { ok: true, allow_send: true, reason: 'takeover', revision: 12, in_flight: false }, error: null })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ insert: mocks.insert })
  })

  it('writes the takeover revision into the queued manual draft evidence', async () => {
    const thread = { prospect_id: 'prospect-1', channel: 'linkedin', draft: null } as Thread
    await composeReply(thread, 'I will take this one.')

    expect(mocks.rpc).toHaveBeenCalledWith('conversation_agent_before_manual_send', { p_prospect_id: 'prospect-1' })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      prospect_id: 'prospect-1', message_text: 'I will take this one.',
      draft_evidence: { conversation_agent_manual_revision: 12 },
    }))
  })
})
