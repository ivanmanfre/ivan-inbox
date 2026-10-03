import { describe, it, expect, vi, beforeEach } from 'vitest'

// Run 39: a brain draft's pre-edit body is captured (cb39_capture_origin) before the first edit save.
// The capture is a courtesy to the verdict: it must never stop Ivan's edit.
type Step = { table: string; op: 'select' | 'update'; payload?: unknown }
type Call = { name: string; args: Record<string, unknown>; at: number }
const steps: Step[] = []
const rpcCalls: Call[] = []
let order = 0
let rpcQueue: Array<{ data: unknown; error: unknown } | 'throw'> = []

function builder(table: string) {
  const make = (op: Step['op'], payload?: unknown) => {
    const step: Step & { at?: number } = { table, op, payload }
    steps.push(step)
    ;(step as { at: number }).at = ++order
    const chain = {
      eq() { return chain }, is() { return chain }, not() { return chain },
      select() { return op === 'update' ? Promise.resolve({ data: [{ id: 'd1' }], error: null }) : chain },
      maybeSingle() { return Promise.resolve({ data: { post_body: 'mine', updated_at: '2026-10-03T10:00:00Z' }, error: null }) },
    }
    return chain
  }
  return { select: () => make('select'), update: (p: unknown) => make('update', p) }
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args, at: ++order })
      const next = rpcQueue.shift()
      if (next === 'throw') return Promise.reject(new Error('network down'))
      return Promise.resolve(next ?? { data: { ok: true }, error: null })
    },
  },
}))

const { saveDraftBody, saveClientDraftBody } = await import('./content')
const OLD = '2026-10-03T10:00:00Z'
const BRAIN = { source: 'content-brain', pillar: 'authority' }
const captures = () => rpcCalls.filter(c => c.name === 'cb39_capture_origin')

beforeEach(() => { steps.length = 0; rpcCalls.length = 0; rpcQueue = []; order = 0 })

describe('saveDraftBody: capture the pre-edit body of a brain draft', () => {
  it('calls cb39_capture_origin for a brain draft, before the body write', async () => {
    await saveDraftBody('d1', 'mine, edited', BRAIN, 'mine', OLD)
    expect(captures()).toEqual([expect.objectContaining({ args: { p_draft: 'd1' } })])
    const write = steps.find(s => s.op === 'update') as unknown as { at: number }
    expect(captures()[0].at).toBeLessThan(write.at)
  })

  it('also reads the source off a JSON string taxonomy', async () => {
    await saveDraftBody('d1', 'x', JSON.stringify(BRAIN), 'mine', OLD)
    expect(captures()).toHaveLength(1)
  })

  it('does not call it for a normal draft', async () => {
    await saveDraftBody('d1', 'mine, edited', { pillar: 'authority' }, 'mine', OLD)
    await saveDraftBody('d1', 'mine, edited', null, 'mine', OLD)
    expect(captures()).toHaveLength(0)
  })

  it('a failed capture (error or thrown) never stops the save', async () => {
    rpcQueue = [{ data: null, error: { message: 'permission denied' } }]
    await expect(saveDraftBody('d1', 'mine, edited', BRAIN, 'mine', OLD)).resolves.toBeUndefined()
    expect(steps.some(s => s.op === 'update')).toBe(true)
    steps.length = 0
    rpcQueue = ['throw']
    await expect(saveDraftBody('d1', 'mine, edited', BRAIN, 'mine', OLD)).resolves.toBeUndefined()
    expect(steps.some(s => s.op === 'update')).toBe(true)
  })

  it('a save that loses the race on the preflight captures nothing', async () => {
    await expect(saveDraftBody('d1', 'x', BRAIN, 'something else', OLD)).rejects.toThrow()
    expect(captures()).toHaveLength(0)
  })
})

describe('saveClientDraftBody: the same capture on the client lane', () => {
  it('calls it for a brain draft before the stamp and the body RPC', async () => {
    await saveClientDraftBody('d1', 'mine, edited', BRAIN, 'mine', OLD)
    expect(captures()).toHaveLength(1)
    const edit = rpcCalls.find(c => c.name === 'operator_edit_draft_body')!
    expect(captures()[0].at).toBeLessThan(edit.at)
    const stamp = steps.find(s => s.op === 'update') as unknown as { at: number }
    expect(captures()[0].at).toBeLessThan(stamp.at)
  })

  it('does not call it for a normal client draft', async () => {
    await saveClientDraftBody('d1', 'mine, edited', { pillar: 'authority' }, 'mine', OLD)
    expect(captures()).toHaveLength(0)
    expect(rpcCalls.map(c => c.name)).toEqual(['operator_edit_draft_body'])
  })

  it('a failed capture does not stop the client save', async () => {
    rpcQueue = ['throw']
    await expect(saveClientDraftBody('d1', 'mine, edited', BRAIN, 'mine', OLD)).resolves.toBeUndefined()
    expect(rpcCalls.map(c => c.name)).toEqual(['cb39_capture_origin', 'operator_edit_draft_body'])
  })
})
