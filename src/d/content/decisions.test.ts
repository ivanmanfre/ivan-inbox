import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({ approveDraft: vi.fn(), skipDraft: vi.fn() }))
vi.mock('../../lib/content', () => lib)
import { HOLD_MS, flushDecisions, heldDecisions, holdDecision, resetDecisionsForTest, undoDecision } from './decisions'

beforeEach(() => { vi.useFakeTimers(); lib.approveDraft.mockReset().mockResolvedValue(undefined); lib.skipDraft.mockReset().mockResolvedValue(undefined) })
afterEach(() => { resetDecisionsForTest(); vi.useRealTimers() })

describe('one-tap decisions with Undo', () => {
  it('holds the write for the life of the Undo receipt, then writes today’s approveDraft', async () => {
    const done = vi.fn()
    holdDecision('a', 'approve', { onCommitted: done })
    expect(heldDecisions().get('a')).toBe('approve')
    await vi.advanceTimersByTimeAsync(HOLD_MS - 1)
    expect(lib.approveDraft).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(lib.approveDraft).toHaveBeenCalledWith('a')
    expect(done).toHaveBeenCalled()
    expect(heldDecisions().has('a')).toBe(false)
  })

  it('Undo inside the window cancels a write that never happened', async () => {
    holdDecision('s', 'skip')
    expect(undoDecision('s')).toBe(true)
    await vi.advanceTimersByTimeAsync(HOLD_MS * 2)
    expect(lib.skipDraft).not.toHaveBeenCalled()
    expect(heldDecisions().size).toBe(0)
  })

  it('Undo after the write started says too late (false) rather than pretending', async () => {
    let finish!: () => void
    lib.approveDraft.mockImplementation(() => new Promise<void>(r => { finish = r }))
    holdDecision('a', 'approve')
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(undoDecision('a')).toBe(false)
    finish()
  })

  it('leaving the page writes every held decision at once', async () => {
    holdDecision('a', 'approve')
    holdDecision('b', 'skip')
    await flushDecisions()
    expect(lib.approveDraft).toHaveBeenCalledWith('a')
    expect(lib.skipDraft).toHaveBeenCalledWith('b')
    expect(heldDecisions().size).toBe(0)
  })

  it('a refused write drops the hold (the draft is back in review) and reports it', async () => {
    const failed = vi.fn()
    lib.skipDraft.mockRejectedValue(new Error('RLS said no'))
    holdDecision('s', 'skip', { onFailed: failed })
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'RLS said no' }))
    expect(heldDecisions().has('s')).toBe(false)
  })

  it('a second decision on the same draft replaces the first (one write)', async () => {
    holdDecision('x', 'approve')
    holdDecision('x', 'skip')
    await vi.advanceTimersByTimeAsync(HOLD_MS)
    expect(lib.approveDraft).not.toHaveBeenCalled()
    expect(lib.skipDraft).toHaveBeenCalledTimes(1)
  })
})
