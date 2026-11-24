// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLanesData } from './useLanesData'
import { fetchReady } from './glance/ready'
vi.mock('./glance/ready', () => ({ fetchReady: vi.fn() }))
afterEach(() => vi.restoreAllMocks())
it('an explicit Retry bypasses the five-minute Ready polling throttle', async () => {
  vi.mocked(fetchReady).mockRejectedValueOnce(new Error('temporary timeout')).mockResolvedValueOnce({ saturdayNy: false, lanes: [] })
  const keys = ['ready'] as const
  const { result } = renderHook(() => useLanesData(keys))
  await act(async () => { await Promise.resolve() })
  expect(result.current.data.ready.failed).toBe('temporary timeout')
  await act(async () => { result.current.refresh(); await Promise.resolve() })
  expect(result.current.data.ready).toEqual({ value: { saturdayNy: false, lanes: [] }, failed: null })
})

it('lets a slow stock read finish without replacing it with a timeout at twelve seconds', async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(fetchReady).mockImplementationOnce(() => new Promise(resolve => {
      setTimeout(() => resolve({ saturdayNy: false, lanes: [] }), 15_000)
    }))
    const keys = ['ready'] as const
    const { result, unmount } = renderHook(() => useLanesData(keys))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(result.current.data.ready).toEqual({ value: { saturdayNy: false, lanes: [] }, failed: null })
    unmount()
  } finally { vi.useRealTimers() }
})
