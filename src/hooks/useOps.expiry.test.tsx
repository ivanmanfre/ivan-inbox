// @vitest-environment jsdom
import { useMemo } from 'react'
import { cleanup, act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { fetchOpsDrafts, pendingOps, type OpsDraft } from '../lib/ops'
import { forget, remember } from '../lib/pageMemo'
import { useOps } from './useOps'

vi.mock('../lib/ops', async orig => ({ ...(await orig<typeof import('../lib/ops')>()), fetchOpsDrafts: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: {
  channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel: vi.fn(),
} }))
const NOW = Date.parse('2026-10-24T12:00:00Z')
const draft = (id: string, posted_at: string): OpsDraft => ({
  id, client_id: 'ivan', kind: 'comment_outbound', body: 'draft', slack_channel: '',
  context: { posted_at }, created_at: '2026-10-24T12:00:00Z', approved_at: null, sent_at: null, send_blocked_reason: null,
})
function useVisible() {
  const ops = useOps()
  const ids = useMemo(() => pendingOps(ops.drafts).map(d => d.id), [ops.drafts])
  return { ...ops, ids }
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); forget(); localStorage.clear() })

it('invalidates memoized consumers at each original deadline while idle, retaining history rows', async () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  const rows = [draft('first', '2026-10-23T12:00:02Z'), draft('second', '2026-10-23T12:00:04Z')]
  vi.mocked(fetchOpsDrafts).mockResolvedValue(rows)
  const { result } = renderHook(useVisible)
  await act(async () => {})
  expect(result.current.ids).toEqual(['second', 'first'])
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(result.current.ids).toHaveLength(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(result.current.ids).toEqual(['second'])
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(result.current.ids).toEqual([])
  expect(result.current.drafts).toEqual(rows)
  expect(fetchOpsDrafts).toHaveBeenCalledTimes(1)
})

it.each(['focus', 'visibilitychange'])('expires a saved copy on %s even when the refresh fails', async event => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'expiry-user' } }))
  remember('ops:drafts', [draft('old', '2026-10-23T12:00:02Z')])
  vi.mocked(fetchOpsDrafts).mockRejectedValue(new Error('offline'))
  const { result } = renderHook(useVisible)
  await act(async () => {})
  expect(result.current.ids).toEqual(['old'])
  // A suspended browser may return after its timer deadline without running it.
  vi.setSystemTime(NOW + 3000)
  await act(async () => { (event === 'focus' ? window : document).dispatchEvent(new Event(event)) })
  expect(result.current.ids).toEqual([])
  expect(result.current.error).toBe('offline')
})
