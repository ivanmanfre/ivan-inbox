// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameCountsProvider, useFrameCounts, type Readers } from '../counts/useFrameCounts'
import { useRetryRead } from '../lanes/useRead'
import { READ_TIMEOUT_MS, ReadTimeout, RETRY_MS, useStalled, withTimeout } from './timeout'

// Final gate 09-27: no D read waits forever. A read that has not answered in
// 12 s turns into the failed state (with Retry), and keeps retrying quietly.

const never = <T,>() => new Promise<T>(() => {})

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('withTimeout', () => {
  it('passes an answer that lands in time', async () => {
    const p = withTimeout(Promise.resolve(7))
    await expect(p).resolves.toBe(7)
  })
  it('rejects with ReadTimeout once 12 s pass without an answer', async () => {
    const p = withTimeout(never<number>())
    const seen = p.catch(e => e)
    await act(async () => { vi.advanceTimersByTime(READ_TIMEOUT_MS - 1) })
    let settled = false
    void p.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    await act(async () => { vi.advanceTimersByTime(1) })
    const e = await seen
    expect(e).toBeInstanceOf(ReadTimeout)
    expect((e as Error).message).toBe('no answer after 12 s')
  })
  it('keeps a real failure as it is', async () => {
    await expect(withTimeout(Promise.reject(new Error('503')))).rejects.toThrow('503')
  })
})

describe('useStalled', () => {
  it('turns true after 12 s of loading, retries quietly every 20 s, and clears when loading ends', () => {
    const retry = vi.fn()
    const { result, rerender } = renderHook(({ loading }) => useStalled(loading, retry), { initialProps: { loading: true } })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(READ_TIMEOUT_MS) })
    expect(result.current).toBe(true)
    expect(retry).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(RETRY_MS) })
    expect(retry).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(RETRY_MS) })
    expect(retry).toHaveBeenCalledTimes(2)
    rerender({ loading: false })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(RETRY_MS * 3) })
    expect(retry).toHaveBeenCalledTimes(2)
  })
  it('never fires for a read that answers in time', () => {
    const retry = vi.fn()
    const { result, rerender } = renderHook(({ loading }) => useStalled(loading, retry), { initialProps: { loading: true } })
    act(() => { vi.advanceTimersByTime(5_000) })
    rerender({ loading: false })
    act(() => { vi.advanceTimersByTime(READ_TIMEOUT_MS * 3) })
    expect(result.current).toBe(false)
    expect(retry).not.toHaveBeenCalled()
  })
})

describe('useRetryRead (Settings devices + Money plate, Lanes sheets)', () => {
  it('a hanging read is failed after 12 s, then a quiet retry lands the answer', async () => {
    let n = 0
    const fn = vi.fn(() => (++n === 1 ? never<string[]>() : Promise.resolve(['iPhone'])))
    const { result } = renderHook(() => useRetryRead(fn, 'devices'))
    expect(result.current[0].kind).toBe('loading')
    await act(async () => { vi.advanceTimersByTime(READ_TIMEOUT_MS) })
    expect(result.current[0]).toEqual({ kind: 'failed', message: 'no answer after 12 s' })
    await act(async () => { vi.advanceTimersByTime(RETRY_MS) })
    expect(result.current[0]).toEqual({ kind: 'ready', data: ['iPhone'] })
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('Retry reads again at once', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('503')))
    const { result } = renderHook(() => useRetryRead(fn, 'money'))
    await act(async () => { await Promise.resolve() })
    expect(result.current[0].kind).toBe('failed')
    await act(async () => { result.current[1]() })
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('FrameCountsProvider (rail sub-counts, bell count, glance drafts)', () => {
  it('a slice whose read hangs goes failed after 12 s and fills in on the quiet retry', async () => {
    let calls = 0
    const ok = <T,>(v: T) => () => Promise.resolve(v)
    const readers: Readers = {
      dm: () => Promise.resolve({ needs: 0, drafts: 0 } as never),
      content: () => Promise.resolve(0),
      ops: ok({ ivan: 0, risedtc: 0, arch: 0 }),
      nextCall: ok({ label: 'none booked', title: null, start: null } as never),
      bell: () => (++calls === 1 ? never() : Promise.resolve({ unreadGroups: 4, open: 9 })),
      alerts: ok({ rows: [], groups: [], critical: 0 }),
      health: ok({ urgent: [], alerts: [], olderErrored: 0, olderStalled: 0, acknowledged: 0 }),
      magnets: ok(0),
      calls: ok(0),
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let seen: ReturnType<typeof useFrameCounts> | null = null
    const Probe = () => { seen = useFrameCounts(); return null }
    render(<FrameCountsProvider readers={readers}><Probe /></FrameCountsProvider>)
    await act(async () => { await Promise.resolve() })
    expect(seen!.bell).toMatchObject({ value: null, failed: false })
    await act(async () => { vi.advanceTimersByTime(READ_TIMEOUT_MS) })
    expect(seen!.bell).toMatchObject({ value: null, failed: true })
    await act(async () => { vi.advanceTimersByTime(RETRY_MS) })
    expect(seen!.bell).toMatchObject({ value: { unreadGroups: 4, open: 9 }, failed: false })
  })
})
