import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { MAX_BRIEF_CHARS, queueT3Job, STALL_AFTER_MS, sweepT3Stalls, t3OpenUrl, t3StatusLine } from './desk-t3.ts'

// A tiny chainable fake of the supabase-js query builder, recording calls.
function fakeDb(result: { data?: unknown; error?: unknown } = {}) {
  const calls: { op: string; args: unknown[] }[] = []
  const chain: Record<string, unknown> = {}
  for (const op of ['insert', 'update', 'select', 'single', 'in', 'is', 'lt', 'eq']) {
    chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain }
  }
  chain.then = (res: (v: unknown) => unknown) => res({ data: result.data ?? null, error: result.error ?? null })
  return { calls, db: { from: (t: string) => { calls.push({ op: 'from', args: [t] }); return chain } } }
}

Deno.test('queue inserts a queued row with a hashed placeholder token and bounded text', async () => {
  const { calls, db } = fakeDb({ data: { id: '11111111-1111-4111-8111-111111111111' } })
  const r = await queueT3Job(db, { userId: 'u', title: '  Build   the thing  ', brief: 'x'.repeat(MAX_BRIEF_CHARS + 50) })
  assertEquals(r.status, 'queued')
  assertEquals(r.job_id, '11111111-1111-4111-8111-111111111111')
  const ins = calls.find((c) => c.op === 'insert')!.args[0] as Record<string, unknown>
  assertEquals(ins.status, 'queued')
  assertEquals(ins.title, 'Build the thing')
  assertEquals((ins.brief as string).length, MAX_BRIEF_CHARS)
  assertMatch(ins.report_token_hash as string, /^[0-9a-f]{64}$/)
  assertEquals(calls[0], { op: 'from', args: ['desk_t3_jobs'] })
})

Deno.test('queue never throws and refuses an empty job', async () => {
  const { db } = fakeDb()
  const r = await queueT3Job(db, { userId: 'u', title: ' ', brief: 'b' })
  assertEquals(r.status, 'failed')
  assertEquals(r.error, 'empty_job')
  const bad = { from: () => { throw new Error('boom') } }
  const r2 = await queueT3Job(bad, { userId: 'u', title: 't', brief: 'b' })
  assertEquals(r2.status, 'failed')
  assertEquals(r2.error, 'boom')
})

Deno.test('queue reports an insert error as failed', async () => {
  const { db } = fakeDb({ error: { message: 'rls' } })
  const r = await queueT3Job(db, { userId: 'u', title: 't', brief: 'b' })
  assertEquals(r.status, 'failed')
  assertEquals(r.error, 'rls')
})

Deno.test('stall sweep targets only unlaunched queued/sent rows older than 10 minutes', async () => {
  const { calls, db } = fakeDb({ data: [{ id: 'a' }, { id: 'b' }] })
  const now = Date.parse('2026-11-18T12:00:00Z')
  const n = await sweepT3Stalls(db, now)
  assertEquals(n, 2)
  assertEquals(calls.find((c) => c.op === 'in')!.args, ['status', ['queued', 'sent']])
  assertEquals(calls.find((c) => c.op === 'is')!.args, ['t3_thread_id', null])
  assertEquals(calls.find((c) => c.op === 'lt')!.args, ['updated_at', new Date(now - STALL_AFTER_MS).toISOString()])
})

Deno.test('links and status lines', () => {
  assertEquals(t3OpenUrl(), 'https://app.t3.codes/#/2a18874a-64d0-4c8c-8c7a-9be5c8706279')
  assert(t3OpenUrl('thread:project:p:t').endsWith('/thread:project:p:t'))
  const line = t3StatusLine({ id: 'x', title: 'Fix it', status: 'stalled', t3_link: null, result_summary: null, created_at: '', updated_at: '' })
  assertMatch(line, /Mac may be asleep/)
  assert(!line.includes('—'))
})
