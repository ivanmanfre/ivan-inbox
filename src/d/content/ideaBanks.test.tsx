// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { useIdeaBanks } from './Ideas'
import { fetchRankedIdeas } from '../../lib/rankedIdeas'
import type { Lane } from './model'
vi.mock('../../lib/rankedIdeas', () => ({ fetchRankedIdeas: vi.fn(), visibleIdeas: vi.fn() }))
const read = vi.mocked(fetchRankedIdeas)
beforeEach(() => { read.mockReset(); read.mockResolvedValue([]) })
afterEach(cleanup)

describe('Ideas reads only the visible client', () => {
  it('reads one route client, switches to one new client, and re-reads when re-enabled', async () => {
    const view = renderHook(({ enabled, lane }: { enabled: boolean; lane: Lane }) => useIdeaBanks(enabled, lane),
      { initialProps: { enabled: false, lane: 'risedtc' as Lane } })
    expect(read).not.toHaveBeenCalled()
    view.rerender({ enabled: true, lane: 'risedtc' })
    await waitFor(() => expect(view.result.current.risedtc.loading).toBe(false))
    expect(read.mock.calls.map(([l]) => l)).toEqual(['risedtc'])
    view.rerender({ enabled: true, lane: 'arch' })
    await waitFor(() => expect(view.result.current.arch.loading).toBe(false))
    expect(read.mock.calls.map(([l]) => l)).toEqual(['risedtc', 'arch'])
    view.rerender({ enabled: false, lane: 'ivan' })
    expect(read.mock.calls.map(([l]) => l)).toEqual(['risedtc', 'arch'])
    view.rerender({ enabled: true, lane: 'arch' })
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
    expect(read.mock.calls.map(([l]) => l)).toEqual(['risedtc', 'arch', 'arch'])
    expect(read.mock.calls.some(([l]) => l === 'ivan')).toBe(false)
  })

  it('cancels an in-flight read when its client is no longer selected', () => {
    read.mockImplementation(() => new Promise(() => {}))
    const view=renderHook(({lane}:{lane:Lane})=>useIdeaBanks(true,lane),{initialProps:{lane:'ivan' as Lane}})
    const firstSignal=read.mock.calls[0][1]
    expect(firstSignal?.aborted).toBe(false)
    view.rerender({lane:'risedtc'})
    expect(firstSignal?.aborted).toBe(true)
    expect(read.mock.calls.map(([l])=>l)).toEqual(['ivan','risedtc'])
    view.unmount()
    expect(read.mock.calls[1][1]?.aborted).toBe(true)
  })

  it('preserves the default all-client API and disabled API', async () => {
    const view = renderHook(({ enabled }) => useIdeaBanks(enabled), { initialProps: { enabled: false } })
    expect(read).not.toHaveBeenCalled()
    view.rerender({ enabled: true })
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
    expect(read.mock.calls.map(([l]) => l)).toEqual(['ivan', 'risedtc', 'arch'])
  })

  it('keeps a failed selected read visible instead of converting it to a successful empty bank', async () => {
    read.mockRejectedValueOnce(new Error('Statement timeout'))
    const view = renderHook(() => useIdeaBanks(true, 'ivan'))
    await waitFor(() => expect(view.result.current.ivan.error).toBe('Statement timeout'))
    expect(view.result.current.ivan.loading).toBe(false)
    expect(read.mock.calls.map(([l]) => l)).toEqual(['ivan'])
  })
})
