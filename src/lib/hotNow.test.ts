import { describe, expect, it, vi } from 'vitest'
const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
import { brokeAgo, fetchHotNow, skipHotNow, timeLeft } from './hotNow'

const now = Date.parse('2026-10-16T15:00:00Z')

describe('hot now', () => {
  it('drops cards past their deadline', async () => {
    rpc.mockResolvedValueOnce({ data: [{ draft_id: 'a', post_by: '2026-10-16T14:59:00Z' }, { draft_id: 'b', post_by: '2026-10-16T18:00:00Z', validation: {status:'validated',policy_version:'market-v1',validated_at:'2026-10-16T14:50:00Z'} }], error: null })
    expect((await fetchHotNow(now)).map(c => c.draft_id)).toEqual(['b'])
  })
  it('skips with the reviewed timestamp and surfaces a refusal', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, error: 'stale_draft' }, error: null })
    await expect(skipHotNow({ draft_id: 'd', draft_updated_at: 't' })).rejects.toThrow(/changed since/)
    expect(rpc).toHaveBeenLastCalledWith('hot_now_skip', { p_draft_id: 'd', p_expected_updated_at: 't' })
  })
  it('reads the clock in plain words', () => {
    expect(timeLeft('2026-10-16T16:20:00Z', now)).toBe('1h 20m left')
    expect(timeLeft('2026-10-16T15:40:00Z', now)).toBe('40m left')
    expect(brokeAgo('2026-10-16T12:00:00Z', now)).toBe('broke 3h ago')
    expect(brokeAgo(null, now)).toBeNull()
  })
})

it('hides held rows without current market validation',async()=>{rpc.mockResolvedValueOnce({data:[{draft_id:'vendor',post_by:'2026-10-16T18:00:00Z'}],error:null});expect(await fetchHotNow(now)).toEqual([])})
