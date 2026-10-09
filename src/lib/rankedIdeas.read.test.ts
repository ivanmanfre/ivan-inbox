import { beforeEach, expect, it, vi } from 'vitest'
import { fetchRankedIdeas } from './rankedIdeas'

const sdk = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: sdk.rpc } }))

const answer = (result: unknown) => ({
  then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  abortSignal: () => Promise.resolve(result),
})
const empty = { ok: true, client: 'ivan', rows: [] }

beforeEach(() => { sdk.rpc.mockReset() })

it('uses the cached RPC on open and forces a fresh ranking on explicit refresh', async () => {
  sdk.rpc.mockReturnValue(answer({ data: empty, error: null }))
  expect(await fetchRankedIdeas('ivan')).toEqual([])
  expect(await fetchRankedIdeas('ivan', undefined, true)).toEqual([])
  expect(sdk.rpc.mock.calls.map(([name, args]) => [name, args.p_client, args.p_fresh])).toEqual([
    ['inbox_phone_ranked_ideas_r2', 'ivan', false],
    ['inbox_phone_ranked_ideas_r2', 'ivan', true],
  ])
})

it('uses the old function only when the new RPC is missing', async () => {
  sdk.rpc.mockReturnValueOnce(answer({ data: null, error: { code: 'PGRST202', message: 'missing' } }))
    .mockReturnValueOnce(answer({ data: empty, error: null }))
  expect(await fetchRankedIdeas('ivan')).toEqual([])
  expect(sdk.rpc.mock.calls.map(([name]) => name)).toEqual(['inbox_phone_ranked_ideas_r2', 'operator_ranked_ideas'])
  sdk.rpc.mockReset().mockReturnValue(answer({ data: null, error: { code: '57014', message: 'timed out' } }))
  await expect(fetchRankedIdeas('ivan')).rejects.toThrow('timed out')
  expect(sdk.rpc).toHaveBeenCalledTimes(1)
})
