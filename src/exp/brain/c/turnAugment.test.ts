import { describe, expect, it } from 'vitest'
import { augmentTurns, isThreadBusy, THREAD_BUSY_CODE } from './turnAugment'
import type { Turn } from '../../v2c/chat/events'

function turn(over: Partial<Turn>): Turn {
  return {
    id: over.id ?? 't1', role: over.role ?? 'assistant', text: over.text ?? '',
    tools: [], error: over.error ?? null, turnId: over.turnId, ...over,
  }
}

describe('augmentTurns', () => {
  it('reads the row time for a turn backed by a row', () => {
    const out = augmentTurns(
      [turn({ turnId: 'row1' })],
      { row1: { at: '2026-09-04T10:00:00Z' } },
      () => 'FALLBACK',
    )
    expect(out[0].at).toBe('2026-09-04T10:00:00Z')
  })

  it('falls back for a turn with no row yet (still streaming)', () => {
    const out = augmentTurns([turn({ turnId: undefined })], {}, () => 'FALLBACK-TIME')
    expect(out[0].at).toBe('FALLBACK-TIME')
  })

  it('carries the row error_code onto the turn', () => {
    const out = augmentTurns(
      [turn({ turnId: 'row1' })],
      { row1: { at: 'x', errorCode: 'thread_busy' } },
      () => 'x',
    )
    expect(out[0].errorCode).toBe('thread_busy')
    expect(isThreadBusy(out[0])).toBe(true)
  })

  it('is null, not undefined-crashing, when the row has no error', () => {
    const out = augmentTurns([turn({ turnId: 'row1' })], { row1: { at: 'x' } }, () => 'x')
    expect(out[0].errorCode).toBeNull()
    expect(isThreadBusy(out[0])).toBe(false)
  })
})

describe('THREAD_BUSY_CODE', () => {
  it('matches the code the broker sends', () => {
    expect(THREAD_BUSY_CODE).toBe('thread_busy')
  })
})
