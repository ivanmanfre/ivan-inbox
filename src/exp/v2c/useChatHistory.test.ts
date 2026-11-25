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
