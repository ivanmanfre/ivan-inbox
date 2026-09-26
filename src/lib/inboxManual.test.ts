import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Thread } from './inbox'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), insert: vi.fn(), update: vi.fn(), discarded: [] as string[], refuse: new Set<string>() }))
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

describe('composeReply discards every leg of the pending draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.discarded.length = 0
    mocks.refuse.clear()
    mocks.rpc.mockResolvedValue({ data: { ok: true, allow_send: true, revision: 1, in_flight: false }, error: null })
    mocks.insert.mockResolvedValue({ error: null })
    // A chainable guarded update that records which id it was asked to discard.
    mocks.from.mockReturnValue({
      insert: mocks.insert,
      update: () => {
        let id = ''
        const q = {
          eq: (col: string, v: string) => { if (col === 'id') id = v; return q },
          is: () => q,
          select: async () => {
            if (mocks.refuse.has(id)) return { data: [], error: null }
            mocks.discarded.push(id); return { data: [{ id }], error: null }
          },
        }
        return q
      },
    })
  })

  // check3-drafts E1.1: a hand reply discarded the DM draft and left its email
  // leg pending and approvable.
  it('discards the DM and its paired email', async () => {
    const thread = {
      prospect_id: 'p', channel: 'linkedin',
      draft: { id: 'dm', channel: 'linkedin', message_type: 'dm' },
      companionDraft: { id: 'em', channel: 'email', message_type: 'dm' },
    } as unknown as Thread
    const failed = await composeReply(thread, 'On it.')
    expect(mocks.discarded).toEqual(['dm', 'em'])
    expect(failed).toEqual([])
  })

  it('reports a leg that was already approved instead of swallowing it', async () => {
    mocks.refuse.add('em')
    const thread = {
      prospect_id: 'p', channel: 'linkedin',
      draft: { id: 'dm', channel: 'linkedin', message_type: 'dm' },
      companionDraft: { id: 'em', channel: 'email', message_type: 'dm' },
    } as unknown as Thread
    const failed = await composeReply(thread, 'On it.')
    expect(failed.map(f => f.leg.id)).toEqual(['em'])
    expect(failed[0].error).toBeNull()
  })
})
