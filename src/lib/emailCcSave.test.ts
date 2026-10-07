import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ single: db.read }) }) }), rpc: db.rpc,
} }))
import { saveDraftEmailCc } from './inbox'
beforeEach(() => {
  vi.clearAllMocks()
  db.read.mockResolvedValue({ data: { draft_evidence: { generated_text: 'keep this', email_cc: [] } }, error: null })
  db.rpc.mockResolvedValue({ error: null })
})
it('normalizes CC and passes all unrelated evidence to the atomic save', async () => {
  expect(await saveDraftEmailCc('d', 'michael@vmisports.com, michael@vmisports.com')).toEqual(['michael@vmisports.com'])
  expect(db.rpc).toHaveBeenCalledWith('save_inbox_draft_email_cc', {
    p_message_id: 'd', p_cc: ['michael@vmisports.com'], p_expected_evidence: { generated_text: 'keep this', email_cc: [] },
  })
})
it('rejects invalid recipients before touching the database', async () => {
  await expect(saveDraftEmailCc('d', 'bad')).rejects.toThrow(/CC/)
  expect(db.read).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled()
})
it('refuses a stale or already approved draft without claiming the save succeeded', async () => {
  db.rpc.mockResolvedValue({ error: new Error('The draft changed. Refresh before approving.') })
  await expect(saveDraftEmailCc('d', 'michael@vmisports.com')).rejects.toThrow(/draft changed/)
})
it('does not replace evidence when its read fails', async () => {
  db.read.mockResolvedValue({ data: null, error: new Error('read failed') })
  await expect(saveDraftEmailCc('d', '')).rejects.toThrow('read failed')
  expect(db.rpc).not.toHaveBeenCalled()
})
