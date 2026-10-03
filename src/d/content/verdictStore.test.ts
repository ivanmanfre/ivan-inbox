// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({ setVerdict: vi.fn() }))
vi.mock('../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../lib/verdicts')>()), ...lib }))

import { VERDICT_HOLD_MS, forgetVerdict, giveReason, judge, judgedNow, resetVerdictsForTest, retryVerdict, undoVerdict } from './verdictStore'

const saved = (draft: string, verdict: 'keep' | 'drop', reasons: string[] = []) => ({
  verdict_id: 'v1', draft_id: draft, client_id: 'ivan', verdict, reasons, note: null, how_made: 'brain', draft_action: 'deleted',
  source: 'app', decided_at: '2026-10-03T10:00:00Z', updated_at: null,
})
const meta = { lane: 'ivan' as const, title: 'A brain post' }

beforeEach(() => {
  vi.useFakeTimers()
  lib.setVerdict.mockReset()
  lib.setVerdict.mockImplementation(async (id: string, v: 'keep' | 'drop', o: { reasons?: string[] } = {}) => saved(id, v, o.reasons ?? []))
  resetVerdictsForTest()
})
afterEach(() => { resetVerdictsForTest(); vi.useRealTimers() })

describe('verdictStore: hold, then write', () => {
  it('holds the tap for 5 s, then writes once with the invocation id', async () => {
    const onCommitted = vi.fn()
    judge('a', 'drop', { ...meta, onCommitted })
    expect(VERDICT_HOLD_MS).toBe(5000)
    expect(judgedNow().get('a')?.phase).toBe('held')
    await vi.advanceTimersByTimeAsync(4999)
    expect(lib.setVerdict).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(lib.setVerdict).toHaveBeenCalledTimes(1)
    const [id, verdict, o] = lib.setVerdict.mock.calls[0]
    expect([id, verdict, o.reasons, o.note]).toEqual(['a', 'drop', [], null])
    expect(o.invocation).toBe(judgedNow().get('a')?.invocation)
    expect(o.invocation).toMatch(/^[0-9a-f-]{36}$/)
    expect(judgedNow().get('a')?.phase).toBe('saved')
    expect(onCommitted).toHaveBeenCalledTimes(1)
  })

  it('Undo inside the window writes nothing', async () => {
    judge('a', 'keep', meta)
    await vi.advanceTimersByTimeAsync(3000)
    expect(undoVerdict('a')).toBe(true)
    expect(judgedNow().has('a')).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(lib.setVerdict).not.toHaveBeenCalled()
  })

  it('Undo after the write started says too late', async () => {
    judge('a', 'keep', meta)
    await vi.advanceTimersByTimeAsync(5000)
    expect(undoVerdict('a')).toBe(false)
    expect(judgedNow().get('a')?.phase).toBe('saved')
  })

  it('a second tap on the same card is ignored: one entry, one call', async () => {
    judge('a', 'drop', meta)
    judge('a', 'keep', meta)
    judge('a', 'drop', meta)
    expect(judgedNow().size).toBe(1)
    expect(judgedNow().get('a')?.verdict).toBe('drop')
    await vi.advanceTimersByTimeAsync(6000)
    expect(lib.setVerdict).toHaveBeenCalledTimes(1)
  })

  it('a reason tapped during the hold rides along in the one call, and the strip folds away', async () => {
    judge('a', 'drop', meta)
    giveReason('a', 'generic')
    expect(lib.setVerdict).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(lib.setVerdict).toHaveBeenCalledTimes(1)
    expect(lib.setVerdict.mock.calls[0][2].reasons).toEqual(['generic'])
    expect(judgedNow().get('a')).toMatchObject({ phase: 'saved', collapsed: true })
  })

  it('a reason after the save is one more call with the same verdict, and the strip folds away', async () => {
    judge('a', 'keep', { ...meta, lane: 'risedtc' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(judgedNow().get('a')?.collapsed).toBe(false)
    giveReason('a', 'strong_hook')
    await vi.advanceTimersByTimeAsync(0)
    expect(lib.setVerdict).toHaveBeenCalledTimes(2)
    expect(lib.setVerdict.mock.calls[1][0]).toBe('a')
    expect(lib.setVerdict.mock.calls[1][1]).toBe('keep')
    expect(lib.setVerdict.mock.calls[1][2].reasons).toEqual(['strong_hook'])
    expect(judgedNow().get('a')).toMatchObject({ collapsed: true, reasonSaving: false })
  })

  it('an Other reason keeps its note (500 characters at most)', async () => {
    judge('a', 'drop', meta)
    giveReason('a', 'other', `  ${'x'.repeat(600)}  `)
    await vi.advanceTimersByTimeAsync(5000)
    expect(lib.setVerdict.mock.calls[0][2].reasons).toEqual(['other'])
    expect(lib.setVerdict.mock.calls[0][2].note).toHaveLength(500)
  })

  it('a failed write goes to failed with the reason; Try again reuses the same invocation id', async () => {
    lib.setVerdict.mockRejectedValueOnce(new Error('Network down'))
    judge('a', 'drop', meta)
    await vi.advanceTimersByTimeAsync(5000)
    const e = judgedNow().get('a')!
    expect(e.phase).toBe('failed')
    expect(e.error).toBe('Network down')
    retryVerdict('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(lib.setVerdict).toHaveBeenCalledTimes(2)
    expect(lib.setVerdict.mock.calls[1][2].invocation).toBe(lib.setVerdict.mock.calls[0][2].invocation)
    expect(judgedNow().get('a')?.phase).toBe('saved')
  })

  it('forgetting a failed tap removes it (nothing was written), and a new tap starts a fresh hold', async () => {
    lib.setVerdict.mockRejectedValueOnce(new Error('Nope'))
    judge('a', 'drop', meta)
    await vi.advanceTimersByTimeAsync(5000)
    forgetVerdict('a')
    expect(judgedNow().has('a')).toBe(false)
    judge('a', 'keep', meta)
    expect(judgedNow().get('a')).toMatchObject({ phase: 'held', verdict: 'keep' })
  })

  it('a failed reason write after the save keeps the verdict and says the reason did not save', async () => {
    judge('a', 'drop', meta)
    await vi.advanceTimersByTimeAsync(5000)
    lib.setVerdict.mockRejectedValueOnce(new Error('Timeout'))
    giveReason('a', 'too_long')
    await vi.advanceTimersByTimeAsync(0)
    const e = judgedNow().get('a')!
    expect(e).toMatchObject({ phase: 'saved', collapsed: false })
    expect(e.error).toMatch(/reason was not saved/i)
  })

  it('Close on a saved strip folds it away; judging the next card folds the previous one', async () => {
    judge('a', 'drop', meta)
    await vi.advanceTimersByTimeAsync(5000)
    forgetVerdict('a')
    expect(judgedNow().get('a')?.collapsed).toBe(true)
    judge('b', 'keep', meta)
    await vi.advanceTimersByTimeAsync(5000)
    judge('c', 'drop', meta)
    expect(judgedNow().get('b')?.collapsed).toBe(true)
  })
})
