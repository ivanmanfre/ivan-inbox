// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forget, recall } from '../lib/pageMemo'
import { fetchOpsDrafts, type OpsDraft } from '../lib/ops'
import { useOps } from './useOps'

vi.mock('../lib/ops', () => ({
  fetchOpsDrafts: vi.fn(),
  emptyReadOverRows: (a: unknown[], b: unknown[]) => a.length > 0 && b.length === 0,
}))
vi.mock('../lib/supabase', () => ({ supabase: {
  channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel: vi.fn(),
} }))

const draft = { id: 'a', client_id: 'ivan', kind: 'task', created_at: '2026-10-09T12:00:00Z' } as OpsDraft
beforeEach(() => { localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } })) })
afterEach(() => { forget(); localStorage.clear(); vi.mocked(fetchOpsDrafts).mockReset() })

it('paints a user-scoped saved queue immediately, keeps it on failure and empty-over-known, and keeps confirmed cards off on revisit', async () => {
  vi.mocked(fetchOpsDrafts).mockResolvedValueOnce([draft])
  const first = renderHook(() => useOps())
  await waitFor(() => expect(first.result.current.drafts).toEqual([draft]))
  first.unmount()

  vi.mocked(fetchOpsDrafts).mockRejectedValueOnce(new Error('offline'))
  const second = renderHook(() => useOps())
  expect(second.result.current.drafts).toEqual([draft])
  expect(second.result.current.saved).toBe(true)
  await waitFor(() => expect(second.result.current.error).toBe('offline'))
  vi.mocked(fetchOpsDrafts).mockResolvedValueOnce([])
  act(() => second.result.current.refresh())
  await waitFor(() => expect(second.result.current.error).toMatch(/empty over/))
  expect(second.result.current.drafts).toEqual([draft])
  act(() => second.result.current.markDone('a'))
  expect(second.result.current.drafts).toEqual([])
  vi.mocked(fetchOpsDrafts).mockResolvedValueOnce([])
  act(() => second.result.current.refresh())
  await waitFor(() => expect(second.result.current.error).toBeNull())
  expect(recall<OpsDraft[]>('ops:drafts')?.value).toEqual([])
  second.unmount()

  vi.mocked(fetchOpsDrafts).mockReturnValueOnce(new Promise(() => {}))
  const third = renderHook(() => useOps())
  expect(third.result.current.drafts).toEqual([])
  third.unmount()

  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u2' } }))
  vi.mocked(fetchOpsDrafts).mockReturnValueOnce(new Promise(() => {}))
  const other = renderHook(() => useOps())
  expect(other.result.current.loadedAt).toBeNull()
  expect(other.result.current.saved).toBe(false)
})
