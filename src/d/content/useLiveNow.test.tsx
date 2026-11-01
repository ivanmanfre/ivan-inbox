// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useDayAnchor, useLiveNow } from './useLiveNow'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-01T10:00:00Z')) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useLiveNow', () => {
  it('moves forward every minute while the page stays open', () => {
    const { result } = renderHook(() => useLiveNow())
    const first = result.current
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current - first).toBe(60_000)
  })
  it('re-reads the clock when the tab comes back to the front', () => {
    const { result } = renderHook(() => useLiveNow())
    const first = result.current
    vi.setSystemTime(first + 3 * 3_600_000)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current).toBe(first + 3 * 3_600_000)
  })
})

describe('useDayAnchor', () => {
  it('holds still within a Warsaw day and moves when the day changes', () => {
    const start = Date.parse('2026-11-01T10:00:00Z')
    const { result, rerender } = renderHook(({ n }) => useDayAnchor(n), { initialProps: { n: start } })
    expect(result.current).toBe(start)
    rerender({ n: start + 3 * 3_600_000 })
    expect(result.current).toBe(start)
    const next = Date.parse('2026-11-02T08:00:00Z')
    rerender({ n: next })
    expect(result.current).toBe(next)
  })
})
