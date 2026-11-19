// Stop vs the turn's end of generation: exactly one wins (made-up rows only).
import { assertEquals } from 'jsr:@std/assert@1'
import { closeStopWindow, stopTurn } from './stop.ts'

// a one-table fake with PostgREST-like CAS: update(...).eq(id).filter('meta->>k', 'is', null).select()
function fakeDb(row: { id: string; client_key: string; meta: Record<string, unknown> }, opts: { failRead?: boolean; beforeUpdate?: () => void } = {}) {
  return {
    row,
    from: () => {
      const f: { id?: string; nullKey?: string; patch?: Record<string, unknown> } = {}
      const q = {
        select: () => q, eq: (c: string, v: string) => { if (c === 'id') f.id = v; return q },
        filter: (k: string) => { f.nullKey = k.replace('meta->>', ''); return q },
        update: (p: { meta: Record<string, unknown> }) => { f.patch = p.meta; return q },
        maybeSingle: () => Promise.resolve(opts.failRead ? { data: null, error: { message: 'down' } } : { data: { id: row.id, meta: { ...row.meta } }, error: null }),
        then: (res: (v: unknown) => void) => {
          opts.beforeUpdate?.()
          const ok = !f.nullKey || row.meta[f.nullKey] == null
          if (ok && f.patch) row.meta = f.patch
          res({ data: ok ? [{ id: row.id }] : [], error: null })
        },
      }
      return q
    },
  }
}

Deno.test('stop: Stop first wins, the turn then sees it and plans nothing', async () => {
  const db = fakeDb({ id: 'q1', client_key: 'k1', meta: {} })
  assertEquals(await stopTurn(db, 'u', 'k1'), { ok: true })
  assertEquals(await closeStopWindow(db, 'q1'), false)
})

Deno.test('stop: the turn first wins, a late Stop says too_late', async () => {
  const db = fakeDb({ id: 'q1', client_key: 'k1', meta: {} })
  assertEquals(await closeStopWindow(db, 'q1'), true)
  assertEquals(await stopTurn(db, 'u', 'k1'), { ok: false, error: 'too_late' })
})

Deno.test('stop: a Stop landing between the turn read and its write still wins (CAS), never both', async () => {
  const row = { id: 'q1', client_key: 'k1', meta: {} as Record<string, unknown> }
  const db = fakeDb(row, { beforeUpdate: () => { if (!row.meta.stop_at && !row.meta.gen_done_at) row.meta = { stop_at: 'now' } } })
  assertEquals(await closeStopWindow(db, 'q1'), false)
  assertEquals(row.meta.gen_done_at, undefined)
})

Deno.test('stop: a failed read on the turn side fails closed', async () => {
  assertEquals(await closeStopWindow(fakeDb({ id: 'q1', client_key: 'k1', meta: {} }, { failRead: true }), 'q1'), false)
})
