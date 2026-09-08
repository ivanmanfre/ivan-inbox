import { describe, expect, it, vi } from 'vitest'
import { fetchDraftContextGaps } from './inbox'
const { requests } = vi.hoisted(() => ({ requests: [] as { table: string; ids: string[] }[] }))
vi.mock('./supabase', () => ({ supabase: { from: (table: string) => ({ select: () => ({
  in: (_column: string, ids: string[]) => {
    requests.push({ table, ids })
    return Promise.resolve({ data: [...ids].reverse().map(id => table === 'outreach_messages'
      ? { id, prospect_id: `p-${id}`, context_gap: { question: `Question ${id}`, why: 'Needs a fact' } }
      : { id, linkedin_url: `https://example.com/${id}` }), error: null })
  },
}) }) } }))
describe('context gap association', () => {
  it('loads displayable hold questions beyond 500 in bounded batches and joins by ID', async () => {
    const ids = Array.from({ length: 625 }, (_, i) => `hold-${i}`)
    const gaps = await fetchDraftContextGaps([...ids, ids[0]])
    expect(gaps.size).toBe(625)
    expect(gaps.get('hold-624')).toEqual({ question: 'Question hold-624', why: 'Needs a fact', chat_url: 'https://example.com/p-hold-624' })
    expect(requests.every(r => r.ids.length <= 100)).toBe(true)
    expect(requests.filter(r => r.table === 'outreach_messages').flatMap(r => r.ids)).toEqual(ids)
  })
})
