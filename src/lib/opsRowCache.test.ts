import { beforeEach, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./handoff', () => ({
  readHandoff: async (k: string) => structuredClone(store.get(k) ?? null),
  writeHandoff: async (k: string, v: unknown) => { store.set(k, structuredClone(v)) },
}))
import { OPS_REFETCH_MAX, OpsEmptyOverCache, readOpsRows, resetOpsRowMemory, type DigestRow } from './opsRowCache'
import type { OpsDraft } from './ops'

// A fake table: rows newest first, digest = a hash of the row's JSON (any change changes it), like the md5.
let table: OpsDraft[] = []
const hash = (r: OpsDraft) => { let h = 2166136261; for (const c of JSON.stringify(r)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(16) }
const digested = (r: OpsDraft): DigestRow => ({ ...r, digest: hash(r) })
const calls = { index: 0, whole: 0, byIds: [] as string[][] }
const io = (user: string | null = 'ivan') => ({
  user,
  index: async () => { calls.index++; return table.slice(0, 300).map(r => ({ id: r.id, digest: hash(r) })) },
  whole: async () => { calls.whole++; return table.slice(0, 300).map(digested) },
  byIds: async (ids: string[]) => { calls.byIds.push(ids); return table.filter(r => ids.includes(r.id)).map(digested) },
})
const row = (n: number, extra: Partial<OpsDraft> = {}): OpsDraft => ({ id: `id-${n}`, client_id: 'ivan', kind: 'task', slack_channel: null, body: `body ${n}`, context: { n }, created_at: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(), approved_at: null, sent_at: null, send_blocked_reason: null, ...extra } as OpsDraft)
const truth = () => table.slice(0, 300)

beforeEach(() => { store.clear(); resetOpsRowMemory(); calls.index = 0; calls.whole = 0; calls.byIds = []; table = Array.from({ length: 320 }, (_, i) => row(400 - i)) })

it('first read is whole and saved; the next one reads only digests and returns the same rows in order', async () => {
  expect(await readOpsRows(io())).toEqual(truth())
  expect(calls).toEqual({ index: 0, whole: 1, byIds: [] })
  expect(await readOpsRows(io())).toEqual(truth())
  expect(calls).toEqual({ index: 1, whole: 1, byIds: [] })
})

it('a changed, a new and a vanished row: only the changed and new ones are read in full', async () => {
  await readOpsRows(io())
  table[5] = { ...table[5], sent_at: '2026-11-16T08:00:00Z' }
  table[9] = { ...table[9], context: { n: 9, posted_at: 'later' } }
  table.splice(20, 1)
  table.unshift(row(999))
  const got = await readOpsRows(io())
  expect(got).toEqual(truth())
  expect(calls.byIds).toEqual([[table[0].id, table[6].id, table[10].id]])
})

it('the device copy survives a reload (memory gone), and is per user', async () => {
  await readOpsRows(io())
  resetOpsRowMemory()
  expect(await readOpsRows(io())).toEqual(truth())
  expect(calls.whole).toBe(1)
  expect(await readOpsRows(io('someone-else'))).toEqual(truth())
  expect(calls.whole).toBe(2)
})

it('no user: whole read, nothing saved', async () => {
  await readOpsRows(io(null))
  await readOpsRows(io(null))
  expect(calls.whole).toBe(2); expect(store.size).toBe(0)
})

it('an empty index over a device copy is a failure and does not wipe the copy', async () => {
  await readOpsRows(io())
  resetOpsRowMemory() // a reload: nothing on screen, only the device copy
  const saved = table; table = []
  await expect(readOpsRows(io())).rejects.toBeInstanceOf(OpsEmptyOverCache)
  table = saved
  expect(await readOpsRows(io())).toEqual(truth())
  expect(calls.whole).toBe(1); expect(calls.byIds).toEqual([])
})

it('an empty whole read on a fallback path over a device copy is a failure too', async () => {
  await readOpsRows(io())
  resetOpsRowMemory()
  table[0] = { ...table[0], body: 'changed' }
  const reads = io()
  await expect(readOpsRows({ ...reads, byIds: async () => [], whole: async () => [] })).rejects.toBeInstanceOf(OpsEmptyOverCache)
  expect(await readOpsRows(io())).toEqual(truth())
})

it('an empty whole read is never saved', async () => {
  table = []
  await readOpsRows(io())
  expect(store.size).toBe(0)
})

it('a changed row missing from the by-id read, or changed again since the index, means one whole read', async () => {
  await readOpsRows(io())
  table[3] = { ...table[3], body: 'edited' }
  const gone = table[3].id
  const reads = io()
  expect(await readOpsRows({ ...reads, byIds: async ids => (await reads.byIds(ids)).filter(r => r.id !== gone) })).toEqual(truth())
  expect(calls.whole).toBe(2)
  table[4] = { ...table[4], body: 'edited once' }
  const later = io()
  expect(await readOpsRows({ ...later, byIds: async ids => { table[4] = { ...table[4], body: 'edited twice' }; return later.byIds(ids) } })).toEqual(truth())
  expect(calls.whole).toBe(3)
})

it('capability links never reach the device: finished rows are saved without them, open rows not at all', async () => {
  table[0] = row(500, { kind: 'comment_outbound', context: { approve_url: 'https://n8n.example/a?k=secret', skip_url: 'https://n8n.example/s?k=secret', post_url: 'https://linkedin.com/p/1' } })
  table[1] = row(501, { kind: 'comment_outbound', send_blocked_reason: 'expired_post_too_old', body: 'see https://n8n.example/x?k=secret', context: { approve_url: 'https://n8n.example/a?k=s2', hook: 'h' } })
  const got = await readOpsRows(io())
  expect(got).toEqual(truth()) // in memory the rows are whole
  const stored = JSON.stringify([...store.values()])
  expect(stored).not.toMatch(/approve_url|skip_url|[?&]k=/)
  const saved = (store.get('ops-rows:v1') as { rows: Record<string, { row: { body: string; context: Record<string, unknown> } }> }).rows
  expect(saved['id-500']).toBeUndefined()
  expect(saved['id-501'].row.context).toEqual({ hook: 'h' })
  // After a reload the open row is read again by id, in full.
  resetOpsRowMemory()
  const again = await readOpsRows(io())
  expect(calls.byIds).toEqual([['id-500']])
  expect(again[0]).toEqual(table[0])
})

it('more changed rows than the cap: one whole read instead of id batches', async () => {
  await readOpsRows(io())
  table = table.map((r, i) => i <= OPS_REFETCH_MAX ? { ...r, body: 'x' } : r)
  expect(await readOpsRows(io())).toEqual(truth())
  expect(calls.whole).toBe(2); expect(calls.byIds).toEqual([])
})

it('changed rows are read in batches of 50', async () => {
  await readOpsRows(io())
  table = table.map((r, i) => i < 55 ? { ...r, body: 'y' } : r)
  expect(await readOpsRows(io())).toEqual(truth())
  expect(calls.byIds.map(b => b.length)).toEqual([50, 5])
})

it('a failed read throws and leaves the copy as it was', async () => {
  await readOpsRows(io())
  table[0] = { ...table[0], body: 'changed' }
  await expect(readOpsRows({ ...io(), byIds: async () => { throw new Error('offline') } })).rejects.toThrow('offline')
  expect(await readOpsRows(io())).toEqual(truth())
})

it('random edits over many reads always match the whole read', async () => {
  let seed = 7
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  for (let round = 0; round < 40; round++) {
    for (let k = rnd(6); k > 0; k--) {
      const i = rnd(table.length), op = rnd(4)
      if (op === 0) table[i] = { ...table[i], body: `b${round}-${k}` }
      else if (op === 1) table[i] = { ...table[i], send_blocked_reason: 'discarded_by_operator' }
      else if (op === 2) table.splice(i, 1)
      else table.unshift(row(1000 + round * 10 + k))
    }
    expect(await readOpsRows(io())).toEqual(truth())
    if (rnd(5) === 0) resetOpsRowMemory()
  }
})
