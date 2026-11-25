// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Thread, TurnRow } from '../../lib/turns'
import { useChat } from './useChat'

const reads = vi.hoisted(() => ({ page: vi.fn(), bot: vi.fn(async () => null) }))
vi.mock('../../lib/turns', async original => ({
  ...await original<typeof import('../../lib/turns')>(),
  getBotThread: reads.bot,
  latestThread: async () => null,
  getThread: async (id: string) => ({ id } as Thread),
  listTurnPage: reads.page,
}))

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const row = (id: string) => ({ id, origin: 'operator', prompt: id, answer: id, status: 'done', created_at: '2026-11-25T12:00:00Z' } as TurnRow)
const before = { id: 'recent', created_at: '2026-11-25T12:00:00Z' }
const initial = { rows: [row('recent')], linked: row('linked'), before }
const more = { rows: [row('linked'), row('older')], linked: null, before: null }

afterEach(() => { cleanup(); localStorage.clear(); reads.page.mockReset() })

it('keeps the transcript on a failed earlier read, and merges a pinned notification once on retry', async () => {
  reads.page.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(more)
  const { result } = renderHook(() => useChat())
  act(() => result.current.openThread(first))
  await waitFor(() => expect(result.current.hasEarlier).toBe(true))
  await act(() => result.current.loadEarlier())
  expect(result.current.earlierState).toBe('error')
  expect(result.current.turns.filter(t => t.role === 'user').map(t => t.text)).toEqual(['linked', 'recent'])
  await act(() => result.current.loadEarlier())
  expect(result.current.hasEarlier).toBe(false)
  expect(result.current.turns.filter(t => t.role === 'user').map(t => t.text)).toEqual(['linked', 'older', 'recent'])
})

it('ignores a slow earlier-page response after opening another thread', async () => {
  let finish!: (value: typeof more) => void
  reads.page.mockResolvedValueOnce(initial)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ rows: [row('other')], before: null, linked: null })
  const { result } = renderHook(() => useChat())
  act(() => result.current.openThread(first))
  await waitFor(() => expect(result.current.hasEarlier).toBe(true))
  act(() => { void result.current.loadEarlier(); void result.current.loadEarlier() })
  act(() => result.current.openThread(second))
  await waitFor(() => expect(result.current.threadId).toBe(second))
  await act(async () => { finish(more) })
  expect(result.current.turns.filter(t => t.role === 'user').map(t => t.text)).toEqual(['other'])
  expect(reads.page).toHaveBeenCalledTimes(3)
})

it('keeps the in-flight linked turn when a visibility refresh arrives', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  reads.bot.mockResolvedValue({ id: first } as never)
  let finish!: (value: typeof initial) => void
  reads.page.mockResolvedValueOnce({ ...initial, linked: null })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(() => useChat())
  act(() => result.current.openThread(first))
  await waitFor(() => expect(result.current.hasEarlier).toBe(true))
  act(() => result.current.openThread(first, second))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => finish({ ...initial, linked: row(second) }))
  expect(result.current.turns.some(turn => turn.turnId === second)).toBe(true)
  expect(reads.page.mock.calls.map(call => call[2])).toEqual([undefined, second])
})

it('retries an interrupted link on visibility and lets a newer link replace it', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  reads.bot.mockResolvedValue({ id: first } as never)
  let finish!: (value: typeof initial) => void
  reads.page.mockResolvedValueOnce({ ...initial, linked: null })
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ ...initial, linked: row(first) })
  const { result } = renderHook(() => useChat())
  act(() => result.current.openThread(first))
  await waitFor(() => expect(result.current.hasEarlier).toBe(true))
  act(() => result.current.openThread(first, second))
  await waitFor(() => expect(result.current.turnsStale).toBe(true))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  act(() => result.current.openThread(first, first))
  await waitFor(() => expect(result.current.turns.some(turn => turn.turnId === first)).toBe(true))
  await act(async () => finish({ ...initial, linked: row(second) }))
  expect(result.current.turns.some(turn => turn.turnId === second)).toBe(false)
  expect(reads.page.mock.calls.map(call => call[2])).toEqual([undefined, second, second, first])
})

it('bridges all missing pages on resume, keeps the explored cursor, and ignores a pinned outlier', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  reads.bot.mockResolvedValue({ id: first } as never)
  const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => row(String(lo + i)))
  const page = (lo: number, hi: number) => ({ rows: range(lo, hi), linked: null, before: lo > 1 ? { ...before, id: String(lo) } : null })
  // The pinned row belongs to a link resolved after the first head snapshot.
  reads.page.mockResolvedValueOnce({ ...page(21, 32), linked: row('50') })
    .mockResolvedValueOnce(page(9, 20))
    .mockResolvedValueOnce(page(45, 56))
    .mockRejectedValueOnce(new Error('lost connection before the missing interval arrived'))
    .mockResolvedValueOnce(page(45, 56))
    .mockResolvedValueOnce(page(33, 44))
    .mockResolvedValueOnce(page(21, 32))
    .mockResolvedValueOnce(page(1, 8))
  const { result } = renderHook(() => useChat())
  act(() => result.current.openThread(first))
  await waitFor(() => expect(result.current.hasEarlier).toBe(true))
  await act(() => result.current.loadEarlier())
  const ids = () => result.current.turns.filter(turn => turn.role === 'user').map(turn => turn.turnId)
  const old = ids()
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await waitFor(() => expect(result.current.turnsStale).toBe(true))
  expect(ids()).toEqual(old)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await waitFor(() => expect(ids()).toEqual(range(9, 56).map(r => r.id)))
  await act(() => result.current.loadEarlier())
  expect(reads.page.mock.calls.at(-1)?.[1]?.id).toBe('9')
  expect(ids()).toEqual(range(1, 56).map(r => r.id))
  expect(result.current.hasEarlier).toBe(false)
})
