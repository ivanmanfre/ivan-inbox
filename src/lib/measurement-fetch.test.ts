import { describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import { fetchMeasurement } from './audience'
describe('measurement coverage when comparisons are empty', () => {
 it('retains classification and collection evidence without eligible snapshots', async () => {
  const data = { client_id: 'risedtc', matched_age: [], coverage: [{ canonical_post_id: 'p1', collection_status: 'not_collected' }], classifications: [], monthly_trend: [] }
  rpc.mockResolvedValue({ data, error: null })
  expect(await fetchMeasurement('risedtc')).toEqual({ kind: 'ready', data })
 })
 it('rejects another lane even with no snapshots', async () => {
  rpc.mockResolvedValue({ data: { client_id: 'arch', matched_age: [] }, error: null })
  expect((await fetchMeasurement('risedtc')).kind).toBe('denied')
 })
})
