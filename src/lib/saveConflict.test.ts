import { describe, it, expect, vi, beforeEach } from 'vitest'

// A fake PostgREST builder, only as capable as saveDraftBody actually is.
// `select()` on an UPDATE resolves; `maybeSingle()` on a SELECT resolves.
type Step = { table: string; op: 'select' | 'update'; filters: Record<string, unknown>; payload?: unknown }
const steps: Step[] = []
let selectQueue: Array<{ data: unknown; error: unknown }> = []
let updateQueue: Array<{ data: unknown; error: unknown }> = []

function builder(table: string) {
  const make = (op: 'select' | 'update', payload?: unknown) => {
    const step: Step = { table, op, filters: {}, payload }
    steps.push(step)
    const chain = {
      eq(k: string, v: unknown) { step.filters[`eq:${k}`] = v; return chain },
      is(k: string, v: unknown) { step.filters[`is:${k}`] = v; return chain },
      select() { return op === 'update' ? Promise.resolve(updateQueue.shift() ?? { data: [{ id: 'd1' }], error: null }) : chain },
      maybeSingle() { return Promise.resolve(selectQueue.shift() ?? { data: null, error: null }) },
    }
    return chain
  }
  return {
    select: () => make('select'),
    update: (payload: unknown) => make('update', payload),
  }
}

vi.mock('./supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const { saveDraftBody, DraftSaveConflict } = await import('./content')

beforeEach(() => { steps.length = 0; selectQueue = []; updateQueue = [] })

const OLD = '2026-08-03T10:00:00Z'

describe('saveDraftBody — a conflict surfaces, it never picks a winner', () => {
  it('writes when the stored body still matches what the editor opened on', async () => {
    selectQueue = [{ data: { post_body: 'mine', updated_at: OLD }, error: null }]
    updateQueue = [{ data: [{ id: 'd1' }], error: null }]
    await saveDraftBody('d1', 'mine, edited', {}, 'mine', OLD)
    const upd = steps.find(s => s.op === 'update')!
    expect((upd.payload as Record<string, unknown>).post_body).toBe('mine, edited')
    // The CAS rides in the predicate, and it uses the PRE-FLIGHT value.
    expect(upd.filters['eq:updated_at']).toBe(OLD)
    // Ivan lane only, same scope as approve.
    expect(upd.filters['is:client_id']).toBe(null)
  })

  it('REFUSES to write when an engine moved the body underneath the edit', async () => {
    selectQueue = [{ data: { post_body: 'the engine rewrote this', updated_at: '2026-08-03T11:00:00Z' }, error: null }]
    await expect(saveDraftBody('d1', 'mine, edited', {}, 'mine', OLD))
      .rejects.toBeInstanceOf(DraftSaveConflict)
    // The load-bearing property: NO update was attempted.
    expect(steps.filter(s => s.op === 'update')).toHaveLength(0)
  })

  it('hands back the OTHER text so the operator can decide', async () => {
    selectQueue = [{ data: { post_body: 'theirs', updated_at: '2026-08-03T11:00:00Z' }, error: null }]
    const err = await saveDraftBody('d1', 'mine', {}, 'base', OLD).catch(e => e)
    expect(err).toBeInstanceOf(DraftSaveConflict)
    expect(err.detail.kind).toBe('conflict')
    expect(err.detail.theirs).toBe('theirs')
    expect(err.detail.theirUpdatedAt).toBe('2026-08-03T11:00:00Z')
  })

  it('reports a deleted row as GONE, not as a conflict', async () => {
    selectQueue = [{ data: null, error: null }]
    const err = await saveDraftBody('d1', 'mine', {}, 'base', OLD).catch(e => e)
    expect(err).toBeInstanceOf(DraftSaveConflict)
    expect(err.detail.kind).toBe('gone')
    expect(err.detail.theirs).toBe(null)
  })

  it('treats a null stored body and an empty base as the same thing', async () => {
    selectQueue = [{ data: { post_body: null, updated_at: OLD }, error: null }]
    updateQueue = [{ data: [{ id: 'd1' }], error: null }]
    await expect(saveDraftBody('d1', 'first words', {}, '', OLD)).resolves.toBeUndefined()
  })

  it('an RLS-filtered write is an ERROR, never a silent success', async () => {
    // pre-flight agrees, the UPDATE returns zero rows, the re-read shows the
    // body never moved -> the write was filtered away, not raced.
    selectQueue = [
      { data: { post_body: 'mine', updated_at: OLD }, error: null },
      { data: { post_body: 'mine', updated_at: OLD }, error: null },
    ]
    updateQueue = [{ data: [], error: null }]
    await expect(saveDraftBody('d1', 'edited', {}, 'mine', OLD))
      .rejects.toThrow('the database did not accept the edit')
  })

  it('a zero-row UPDATE whose re-read shows a MOVED body is a conflict, not an RLS error', async () => {
    selectQueue = [
      { data: { post_body: 'mine', updated_at: OLD }, error: null },
      { data: { post_body: 'raced in', updated_at: '2026-08-03T12:00:00Z' }, error: null },
    ]
    updateQueue = [{ data: [], error: null }]
    const err = await saveDraftBody('d1', 'edited', {}, 'mine', OLD).catch(e => e)
    expect(err).toBeInstanceOf(DraftSaveConflict)
    expect(err.detail.theirs).toBe('raced in')
  })

  it('stamps the db/025 human-edit marker in the SAME patch as the body', async () => {
    selectQueue = [{ data: { post_body: 'mine', updated_at: OLD }, error: null }]
    updateQueue = [{ data: [{ id: 'd1' }], error: null }]
    await saveDraftBody('d1', 'edited', { pillar: 'authority' }, 'mine', OLD)
    const tax = (steps.find(s => s.op === 'update')!.payload as Record<string, Record<string, unknown>>).taxonomy
    expect(tax.human_edited).toBe(true)
    expect(tax.pillar).toBe('authority')
  })

  it('skips the CAS rather than inventing one when the row carries no updated_at', async () => {
    selectQueue = [{ data: { post_body: 'mine', updated_at: null }, error: null }]
    updateQueue = [{ data: [{ id: 'd1' }], error: null }]
    await saveDraftBody('d1', 'edited', {}, 'mine', null)
    expect(steps.find(s => s.op === 'update')!.filters['eq:updated_at']).toBeUndefined()
  })
})
