import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ from: vi.fn(), result: { data: [] as unknown, error: null as unknown, count: 0 } }))
vi.mock('./supabase', () => ({ supabase: { from: mock.from } }))
import { fetchContentWaiting } from '../d/counts/content'
import { crossSearch } from './crossSearch'
import { fetchContentErrorPile, fetchContentReviewPile, fetchStagedIdeaPile } from './workQueue'
import { fetchContentDrafts, fetchDraftDetail, fetchWeekDrafts, fetchLaneProbe } from './content'
beforeEach(() => {
 mock.from.mockReset()
 mock.result = { data: [], error: null, count: 0 }
 const chain: Record<string, unknown> = {}
 for (const key of ['select', 'is', 'eq', 'in', 'or', 'order', 'limit', 'maybeSingle', 'gt', 'not']) chain[key] = vi.fn(() => chain)
 chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(mock.result).then(resolve)
 mock.from.mockReturnValue(chain)
})
it('Calendar, Review and editor read only the server guarded membership view', async () => {
 await fetchContentDrafts('ivan')
 await fetchWeekDrafts('2026-09-29T00:00:00Z', '2026-10-08T00:00:00Z')
 await fetchDraftDetail('fixture')
 expect(mock.from.mock.calls.map(call => call[0])).toEqual(['cb34_p2_safe_drafts', 'cb34_p2_safe_drafts', 'cb34_p2_safe_drafts'])
})
it('a missing guarded service fails visibly without an unsafe base-table fallback', async () => {
 mock.result.error = new Error('guard unavailable')
 await expect(fetchContentDrafts('arch')).rejects.toThrow('guard unavailable')
 await expect(fetchWeekDrafts('2026-09-29', '2026-10-08')).rejects.toThrow('guard unavailable')
 await expect(fetchDraftDetail('fixture')).rejects.toThrow('guard unavailable')
 expect(mock.from.mock.calls.every(call => call[0] === 'cb34_p2_safe_drafts')).toBe(true)
})

it('search and review/error piles use guarded draft rows; unrelated surfaces keep their tables', async () => {
 mock.result.data = [{ id: 'ordinary', client_id: null, created_at: '2026-10-01', title: 'Ordinary post', topic: null, post_body: 'ordinary receipt', status: 'review', type: 'text', updated_at: '2026-10-01' }]
 const search = await crossSearch('ordinary', 'ivan')
 expect(search.hits.find(r => r.surface === 'draft')?.title).toBe('Ordinary post')
 const review = await fetchContentReviewPile(), errors = await fetchContentErrorPile()
 expect(review[0]).toMatchObject({ lane: 'ivan', n: 1, oldestTitle: 'Ordinary post' })
 expect(errors[0]).toMatchObject({ lane: 'ivan', n: 1, oldestTitle: 'Ordinary post' })
 await fetchStagedIdeaPile()
 const tables = mock.from.mock.calls.map(call => call[0])
 expect(tables.filter(table => table === 'cb34_p2_safe_drafts')).toHaveLength(3)
 expect(tables).toContain('lm_drafts_v2'); expect(tables).toContain('inbox_messages_v'); expect(tables).toContain('client_ideas')
 expect(tables).not.toContain('carousel_drafts')
})

it('a safely hidden lane reports zero visible rows and zero waiting count without a false broken-query denominator', async () => {
 expect(await fetchLaneProbe('ivan')).toEqual({ scoped: 0, total: 0 })
 expect(await fetchContentWaiting('ivan')).toBe(0)
 expect(await fetchContentWaiting('risedtc')).toBe(0)
 expect(mock.from.mock.calls.map(call => call[0])).toEqual(['cb34_p2_safe_drafts', 'cb34_p2_safe_drafts', 'cb34_p2_safe_drafts'])
 mock.result.count = 3
 expect(await fetchLaneProbe('arch')).toEqual({ scoped: 3, total: 3 })
 expect(await fetchContentWaiting('arch')).toBe(3)
})

it('hides explicit internal fixtures from both readers while retaining real posts about tests', async () => {
 mock.result.data = [
  { id: 'fixture', title: '[new voice test] Example', taxonomy: { internal_test: true } },
  { id: 'image', title: 'Internal researched image verification', taxonomy: '{"internal_test":true}' },
  { id: 'real', title: 'What I would test with a first creator budget', taxonomy: { human_edited: true } },
  { id: 'ordinary', title: 'Testing structures', taxonomy: { internal_test: false } },
 ]
 expect((await fetchContentDrafts('ivan')).rows.map(r => r.id)).toEqual(['real', 'ordinary'])
 expect((await fetchWeekDrafts('2026-10-01', '2026-10-08')).rows.map(r => r.id)).toEqual(['real', 'ordinary'])
})
