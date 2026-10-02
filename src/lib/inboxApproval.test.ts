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
it('routes pipeline approval through the guarded RPC with its current evidence', async () => {
  const evidence = { generated_text: 'Original', inbound_id: 'inbound-1' }
  db.read.mockResolvedValue({ data: { ai_model: 'arch_reply_draft_v2', draft_evidence: evidence }, error: null })
  await approveDraft('pipeline-draft', 'Reviewed pipeline reply', 'chat')
  expect(db.rpc).toHaveBeenCalledWith('approve_inbox_pipeline_draft', {
    p_message_id: 'pipeline-draft', p_text: 'Reviewed pipeline reply', p_expected_evidence: evidence, p_chat_id: 'chat',
  })
  expect(db.update).not.toHaveBeenCalled()
})
it('passes absent evidence and chat as SQL null', async () => {
  db.read.mockResolvedValue({ data: { ai_model: 'arch_reply_draft_v2', draft_evidence: null }, error: null })
  await approveDraft('draft', 'Reviewed reply')
  expect(db.rpc).toHaveBeenCalledWith('approve_inbox_pipeline_draft', {
    p_message_id: 'draft', p_text: 'Reviewed reply', p_expected_evidence: null, p_chat_id: null,
  })
})
it('surfaces a concurrent metadata change without falling back to an unguarded approval', async () => {
  db.read.mockResolvedValue({ data: { ai_model: 'arch_reply_draft_v2', draft_evidence: { inbound_id: 'old' } }, error: null })
  db.rpc.mockResolvedValue({ error: new Error('The draft changed before approval. Refresh before sending.') })
  await expect(approveDraft('draft', 'Reviewed reply')).rejects.toThrow(/changed|refresh/i)
  expect(db.update).not.toHaveBeenCalled()
})
it('approves a research-heavy draft without putting its evidence in the request URL', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const evidence = { generated_text: 'Original', research: 'x'.repeat(90000) }
  db.read.mockResolvedValue({ data: { ai_model: 'arch_reply_draft_v2', draft_evidence: evidence }, error: null })
  const requests: { url: string; body: string }[] = []
  const client = createClient('https://test.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = String(input)
      requests.push({ url, body: String(init?.body ?? '') })
      if (url.length > 8192) throw new TypeError('Failed to fetch')
      return new Response('null', { headers: { 'Content-Type': 'application/json' } })
    } },
  })
  db.update.mockImplementation(client.from('outreach_messages').update.bind(client.from('outreach_messages')))
  db.rpc.mockImplementation(client.rpc.bind(client))
  await expect(approveDraft('draft', 'Reviewed PC games reply', 'chat')).resolves.toBeUndefined()
  expect(requests).toHaveLength(1)
  expect(requests[0].url.length).toBeLessThan(8192)
  expect(JSON.parse(requests[0].body)).toMatchObject({ p_message_id: 'draft', p_text: 'Reviewed PC games reply', p_expected_evidence: evidence })
})
