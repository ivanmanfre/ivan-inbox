// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWeekClock } from './reads'

afterEach(() => { vi.useRealTimers() })

describe('useWeekClock', () => {
  it('holds still inside a week and rolls over when the target week changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T10:00:00Z')) // Friday
    const { result } = renderHook(() => useWeekClock())
    const first = result.current
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 1) })
    expect(result.current).toBe(first)
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z')) // Monday
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 1) })
    expect(result.current).toBeGreaterThan(first)
  })
})
