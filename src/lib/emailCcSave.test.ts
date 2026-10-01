import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), finish: vi.fn(), filters: [] as unknown[][] }))
vi.mock('./supabase', () => ({ supabase: { from: () => ({
  select: () => ({ eq: () => ({ single: db.read }) }),
  update: db.update,
}) } }))
import { saveDraftEmailCc } from './inbox'
beforeEach(() => {
  vi.clearAllMocks(); db.filters = []
  db.read.mockResolvedValue({ data: { draft_evidence: { generated_text: 'keep this', email_cc: [] } }, error: null })
  db.finish.mockResolvedValue({ data: [{ id: 'd' }], error: null })
  const chain = { eq: (...args: unknown[]) => { db.filters.push(['eq', ...args]); return chain }, is: (...args: unknown[]) => { db.filters.push(['is', ...args]); return chain }, or: (...args: unknown[]) => { db.filters.push(['or', ...args]); return chain }, select: db.finish }
  db.update.mockReturnValue(chain)
})
it('preserves unrelated evidence and guards the exact evidence and pending state', async () => {
  expect(await saveDraftEmailCc('d', 'michael@vmisports.com')).toEqual(['michael@vmisports.com'])
  expect(db.update).toHaveBeenCalledWith({ draft_evidence: { generated_text: 'keep this', email_cc: ['michael@vmisports.com'] } })
  expect(db.filters).toContainEqual(['eq', 'draft_evidence', JSON.stringify({ generated_text: 'keep this', email_cc: [] })])
  expect(db.filters).toContainEqual(['is', 'approved_at', null])
  expect(db.filters).toContainEqual(['is', 'sent_at', null])
})
it('rejects invalid recipients before touching the database', async () => {
  await expect(saveDraftEmailCc('d', 'bad')).rejects.toThrow(/CC/)
  expect(db.read).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled()
})
it('refuses a stale or already approved draft instead of claiming the save succeeded', async () => {
  db.finish.mockResolvedValue({ data: [], error: null })
  await expect(saveDraftEmailCc('d', 'michael@vmisports.com')).rejects.toThrow(/draft changed/)
})
it('does not replace evidence when its read fails', async () => {
  db.read.mockResolvedValue({ data: null, error: new Error('read failed') })
  await expect(saveDraftEmailCc('d', '')).rejects.toThrow('read failed')
  expect(db.update).not.toHaveBeenCalled()
})
