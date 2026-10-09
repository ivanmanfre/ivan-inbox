// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forget } from '../../lib/pageMemo'
import { fetchPackIndex, fetchWeekEvents, type SalesPack, type WeekEvent } from '../../lib/salesPacks'
import { fetchCalls, type CallRow } from '../../lib/transcripts'
import { useSalesData } from './useSalesData'

vi.mock('../../lib/salesPacks', () => ({ fetchPackIndex: vi.fn(), fetchWeekEvents: vi.fn(), subscribePacks: () => () => {} }))
vi.mock('../../lib/transcripts', () => ({ fetchCalls: vi.fn() }))

const event = { id: 'e1' } as WeekEvent
const pack = { slug: 'p1' } as unknown as SalesPack
const call = { id: 'c1' } as CallRow
beforeEach(() => { localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } })) })
afterEach(() => { forget(); localStorage.clear(); vi.mocked(fetchWeekEvents).mockReset(); vi.mocked(fetchPackIndex).mockReset(); vi.mocked(fetchCalls).mockReset() })

it('seeds all three reads on revisit and retains each last good result on failure or empty-over-known', async () => {
  vi.mocked(fetchWeekEvents).mockResolvedValueOnce([event])
  vi.mocked(fetchPackIndex).mockResolvedValueOnce([pack])
  vi.mocked(fetchCalls).mockResolvedValueOnce([call])
  const first = renderHook(() => useSalesData())
  await waitFor(() => expect(first.result.current.state).toEqual({ events: 'ok', packs: 'ok', calls: 'ok' }))
  first.unmount()

  vi.mocked(fetchWeekEvents).mockRejectedValueOnce(new Error('calendar down'))
  vi.mocked(fetchPackIndex).mockResolvedValueOnce([])
  vi.mocked(fetchCalls).mockRejectedValueOnce(new Error('calls down'))
  const second = renderHook(() => useSalesData())
  expect(second.result.current.events).toEqual([event])
  expect(second.result.current.packs).toEqual([pack])
  expect(second.result.current.calls).toEqual([call])
  expect(second.result.current.saved).toEqual({ events: true, packs: true, calls: true })
  await waitFor(() => expect(second.result.current.state).toEqual({ events: 'failed', packs: 'failed', calls: 'failed' }))
  expect(second.result.current.eventsError).toBe('calendar down')
  expect(second.result.current.events).toEqual([event])
  expect(second.result.current.packs).toEqual([pack])
  expect(second.result.current.calls).toEqual([call])

  vi.mocked(fetchWeekEvents).mockResolvedValueOnce([event])
  vi.mocked(fetchPackIndex).mockResolvedValueOnce([pack])
  vi.mocked(fetchCalls).mockResolvedValueOnce([call])
  act(() => second.result.current.retry())
  await waitFor(() => expect(second.result.current.state).toEqual({ events: 'ok', packs: 'ok', calls: 'ok' }))
  expect(second.result.current.saved).toEqual({ events: false, packs: false, calls: false })
})

it('lands the calendar without waiting for a slow call archive or pack index', async () => {
  vi.mocked(fetchWeekEvents).mockResolvedValueOnce([event])
  vi.mocked(fetchPackIndex).mockReturnValueOnce(new Promise(() => {}))
  vi.mocked(fetchCalls).mockReturnValueOnce(new Promise(() => {}))
  const read = renderHook(() => useSalesData())
  await waitFor(() => expect(read.result.current.state.events).toBe('ok'))
  expect(read.result.current.events).toEqual([event])
  expect(read.result.current.state.packs).toBe('loading')
  expect(read.result.current.state.calls).toBe('loading')
})
