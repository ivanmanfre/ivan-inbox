// PERF-SMOOTH (2026-10-08): inbox_followup_sources (~2 MB) is read once per freshness window,
// shared while in flight, and an explicit reload always reads.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))
import { forget } from '../../lib/pageMemo'
import { FOLLOWUP_FRESH, readFollowupSources, rememberedFollowups } from './useDmsData'

const store = new Map<string, string>()
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) },
    key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size },
  })
  store.set('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } }))
  rpc.mockReset()
})
afterEach(() => { forget(); store.clear(); vi.unstubAllGlobals() })

const src = (id: string) => ({ seat: 'ivan', prospect: { id, stage: 'replied', icp_score: 8, enrichment_data: {} }, rows: [] })

it('background asks share the read in flight and a young answer; an explicit reload always reads', async () => {
  rpc.mockResolvedValue({ data: [src('p1')], error: null })
  const a = readFollowupSources(FOLLOWUP_FRESH.mount)
  const b = readFollowupSources(FOLLOWUP_FRESH.land)
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(await a).toEqual(await b)
  await readFollowupSources(FOLLOWUP_FRESH.tick)
  expect(rpc).toHaveBeenCalledTimes(1)
  await readFollowupSources()
  expect(rpc).toHaveBeenCalledTimes(2)
  expect(rememberedFollowups()).toEqual([src('p1')])
})

it('an explicit reload never rides on a read that started before it', async () => {
  let release!: (v: unknown) => void
  rpc.mockReturnValueOnce(new Promise(r => { release = r })).mockResolvedValueOnce({ data: [src('after-write')], error: null })
  const before = readFollowupSources(FOLLOWUP_FRESH.mount)
  const forced = readFollowupSources(FOLLOWUP_FRESH.force)
  expect(rpc).toHaveBeenCalledTimes(2)
  release({ data: [src('before-write')], error: null })
  expect((await forced)[0].prospect.id).toBe('after-write')
  await before
  // the older read landing last does not overwrite the newer copy
  expect(rememberedFollowups()?.[0].prospect.id).toBe('after-write')
})

it('an answer past its window reads again; a failure is never remembered', async () => {
  rpc.mockResolvedValueOnce({ data: [src('p1')], error: null })
  const t0 = Date.now()
  await readFollowupSources(FOLLOWUP_FRESH.mount, t0)
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
  await expect(readFollowupSources(FOLLOWUP_FRESH.land, t0 + FOLLOWUP_FRESH.land + 1)).rejects.toBeTruthy()
  expect(rpc).toHaveBeenCalledTimes(2)
  expect(rememberedFollowups()).toEqual([src('p1')])
})

it('an empty answer over a non-empty copy drops the copy, so the next open reads', async () => {
  rpc.mockResolvedValueOnce({ data: [src('p1')], error: null })
  await readFollowupSources()
  rpc.mockResolvedValueOnce({ data: [], error: null })
  expect(await readFollowupSources()).toEqual([])
  expect(rememberedFollowups()).toBeNull()
  rpc.mockResolvedValueOnce({ data: [src('p2')], error: null })
  await readFollowupSources(FOLLOWUP_FRESH.mount)
  expect(rpc).toHaveBeenCalledTimes(3)
})
