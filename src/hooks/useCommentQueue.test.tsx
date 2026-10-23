// @vitest-environment jsdom
import { cleanup, act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { dispatchCommentGate, fetchCommentFeedStates, type GateVerdict, type OpsDraft } from '../lib/ops'
import { useCommentQueue } from './useCommentQueue'
vi.mock('../lib/ops', async orig => ({ ...(await orig<typeof import('../lib/ops')>()),
  dispatchCommentGate: vi.fn(), fetchCommentFeedStates: vi.fn(async () => new Map()),
}))
const NOW = Date.parse('2026-10-24T12:00:00Z')
const d: OpsDraft = { id: 'a', client_id: 'ivan', kind: 'comment_outbound', body: 'draft', slack_channel: '',
  context: { posted_at: '2026-10-23T12:01:00Z', feed_id: 'f', approve_url: 'https://gate.test/approve?id=f' },
  created_at: '2026-10-24T12:00:00Z', approved_at: null, sent_at: null, send_blocked_reason: null }
const timing: GateVerdict = { outcome: 'timing', message: 'cooldown', retryable: true }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.mocked(dispatchCommentGate).mockResolvedValue(timing) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

it('prunes a waiting entry when its draft disappears', async () => {
  const { result, rerender } = renderHook(({ rows }) => useCommentQueue(rows, () => {}), { initialProps: { rows: [d] } })
  await act(async () => { result.current.record('a', timing) })
  expect(result.current.waiting).toHaveLength(1)
  rerender({ rows: [] })
  expect(result.current.waiting).toEqual([])
})
it('rechecks original freshness immediately before a timed retry', async () => {
  const { result } = renderHook(() => useCommentQueue([d], () => {}))
  await act(async () => { result.current.record('a', timing) })
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(dispatchCommentGate).not.toHaveBeenCalled()
  expect(result.current.waiting).toEqual([])
})
it('retries a still-fresh manually approved entry', async () => {
  const fresh = { ...d, context: { ...d.context, posted_at: '2026-10-24T11:00:00Z' } }
  const { result } = renderHook(() => useCommentQueue([fresh], () => {}))
  await act(async () => { result.current.record('a', timing); await Promise.resolve() })
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(dispatchCommentGate).toHaveBeenCalledWith('https://gate.test/approve?id=f')
})
it('retains fresh approved held cards from full rows and drops expired held cards', async () => {
  const held: GateVerdict = { outcome: 'accepted', message: 'held', retryable: false, held: true }
  const { result, rerender } = renderHook(({ rows }) => useCommentQueue(rows, () => {}), { initialProps: { rows: [d] } })
  await act(async () => { result.current.record('a', held) })
  rerender({ rows: [{ ...d, approved_at: '2026-10-24T12:00:00Z' }] })
  expect(result.current.held.has('a')).toBe(true)
  vi.setSystemTime(NOW + 60_001)
  rerender({ rows: [{ ...d, approved_at: '2026-10-24T12:00:00Z' }] })
  expect(result.current.held.size).toBe(0)
})

it('reads feed state for actionable originals when given full history rows', async () => {
  const completed = { ...d, id: 'done', sent_at: '2026-10-24T11:00:00Z', context: { ...d.context, feed_id: 'completed' } }
  const expired = { ...d, id: 'old', context: { ...d.context, feed_id: 'expired', posted_at: '2026-10-22T12:00:00Z' } }
  renderHook(() => useCommentQueue([completed, expired, d], () => {}))
  await act(async () => {})
  expect(fetchCommentFeedStates).toHaveBeenCalledWith(['f'])
})
