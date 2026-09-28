import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn(), update: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: {
  rpc: db.rpc,
  from: () => ({ select: () => ({ eq: () => ({ single: db.read }) }), update: db.update }),
} }))
import { approveDraft } from './inbox'
beforeEach(() => {
  vi.clearAllMocks()
  db.read.mockResolvedValue({ data: { ai_model: 'inbox_on_demand_reply' }, error: null })
  db.rpc.mockResolvedValue({ error: null })
})
it('sends on-demand approval through the atomic ownership RPC', async () => {
  await approveDraft('draft-id', 'Reviewed text', 'existing-chat')
  expect(db.rpc).toHaveBeenCalledWith('approve_inbox_on_demand_reply', {
    p_message_id: 'draft-id', p_text: 'Reviewed text', p_chat_id: 'existing-chat',
  })
  expect(db.update).not.toHaveBeenCalled()
})
it('surfaces an ownership refusal without falling back to an unguarded approval', async () => {
  db.rpc.mockResolvedValue({ error: new Error('Conversation ownership could not be confirmed.') })
  await expect(approveDraft('draft-id', 'Reply')).rejects.toThrow(/ownership/)
  expect(db.update).not.toHaveBeenCalled()
})
it('fails closed when draft identity cannot be read', async () => {
  db.read.mockResolvedValue({ data: null, error: new Error('Read failed') })
  await expect(approveDraft('draft-id', 'Reply')).rejects.toThrow('Read failed')
  expect(db.rpc).not.toHaveBeenCalled()
  expect(db.update).not.toHaveBeenCalled()
})
it('keeps existing pipeline drafts on their established approval path', async () => {
  db.read.mockResolvedValue({ data: { ai_model: 'arch_reply_draft_v2' }, error: null })
  const chain = { eq: () => chain, is: () => chain, or: async () => ({ error: null }) }
  db.update.mockReturnValue(chain)
  await approveDraft('pipeline-draft', 'Reviewed pipeline reply', 'chat')
  expect(db.rpc).not.toHaveBeenCalled()
  expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ message_text: 'Reviewed pipeline reply', unipile_chat_id: 'chat' }))
  expect(db.update.mock.calls[0][0]).not.toHaveProperty('message_type')
})
