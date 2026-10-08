// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forget, remember } from '../../lib/pageMemo'
import { seedLanes, useLanesData } from './useLanesData'
import { useRetryRead } from './useRead'
import { fetchReady } from './glance/ready'
vi.mock('./glance/ready', () => ({ fetchReady: vi.fn() }))

// PERF-SMOOTH (2026-10-08): a revisit opens on the last good answer of this session, and reads again.
const AUTH = 'sb-test-auth-token'
beforeEach(() => { localStorage.setItem(AUTH, JSON.stringify({ user: { id: 'u1' } })) })
afterEach(() => { forget(); localStorage.clear(); vi.restoreAllMocks() })

it('seedLanes paints only remembered keys, and claims a time only when every asked key was remembered', () => {
  remember('lanes:ready', { saturdayNy: false, lanes: [] }, { at: 1000 })
  const one = seedLanes(['ready'], 2000)
  expect(one.data.ready).toEqual({ value: { saturdayNy: false, lanes: [] }, failed: null })
  expect(one.at).toBe(1000)
  const two = seedLanes(['ready', 'gov'], 2000)
  expect(two.data.gov).toEqual({ value: null, failed: null })
  expect(two.at).toBeNull()
})

it('a second mount opens on the first mount\'s answer and still reads', async () => {
  vi.mocked(fetchReady).mockResolvedValueOnce({ saturdayNy: false, lanes: [] }).mockReturnValueOnce(new Promise(() => {}))
  const keys = ['ready'] as const
  const first = renderHook(() => useLanesData(keys))
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  first.unmount()
  const second = renderHook(() => useLanesData(keys))
  expect(second.result.current.loading).toBe(false)
  expect(second.result.current.data.ready.value).toEqual({ saturdayNy: false, lanes: [] })
  expect(second.result.current.at).not.toBeNull()
  expect(fetchReady).toHaveBeenCalledTimes(2)
})

it('a failed read is never remembered', async () => {
  vi.mocked(fetchReady).mockRejectedValueOnce(new Error('down')).mockReturnValue(new Promise(() => {}))
  const keys = ['ready'] as const
  const first = renderHook(() => useLanesData(keys))
  await act(async () => { await Promise.resolve() })
  first.unmount()
  const second = renderHook(() => useLanesData(keys))
  expect(second.result.current.loading).toBe(true)
  expect(second.result.current.data.ready.value).toBeNull()
})

it('useRetryRead: a remembered key opens ready, a Retry still shows loading, a new key opens on its own copy', async () => {
  let n = 0
  const fn = vi.fn(() => Promise.resolve(`v${++n}`))
  const a = renderHook(({ k }) => useRetryRead(fn, k), { initialProps: { k: 'x' } })
  expect(a.result.current[0]).toEqual({ kind: 'loading' })
  await waitFor(() => expect(a.result.current[0]).toEqual({ kind: 'ready', data: 'v1' }))
  a.unmount()
  const slow = vi.fn(() => new Promise<string>(() => {}))
  const b = renderHook(({ k }) => useRetryRead(slow, k), { initialProps: { k: 'x' } })
  expect(b.result.current[0]).toEqual({ kind: 'ready', data: 'v1' })
  expect(slow).toHaveBeenCalledTimes(1)
  b.rerender({ k: 'never-read' })
  expect(b.result.current[0]).toEqual({ kind: 'loading' })
  b.rerender({ k: 'x' })
  expect(b.result.current[0]).toEqual({ kind: 'ready', data: 'v1' })
  act(() => b.result.current[1]())
  expect(b.result.current[0]).toEqual({ kind: 'loading' })
})

it('useRetryRead without a session remembers nothing', async () => {
  localStorage.clear()
  const fn = vi.fn(() => Promise.resolve('v'))
  const a = renderHook(() => useRetryRead(fn, 'y'))
  await waitFor(() => expect(a.result.current[0].kind).toBe('ready'))
  a.unmount()
  const b = renderHook(() => useRetryRead(() => new Promise<string>(() => {}), 'y'))
  expect(b.result.current[0]).toEqual({ kind: 'loading' })
})
