// @vitest-environment jsdom
import { cleanup, act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { approveWeeklyReport, dispatchCommentGate, type OpsDraft } from '../../lib/ops'
import { usePendingCard } from './usePendingCard'
import { dispatchApprove } from './batchActs'
import { PendingCard as LegacyCard } from '../../screens/OpsScreen'

const confirmHold = vi.hoisted(() => ({ confirm: vi.fn<() => Promise<boolean>>() }))
vi.mock('../../components/ConfirmSheet', () => ({ useConfirm: () => confirmHold.confirm }))
vi.mock('../../lib/ops', async orig => ({ ...(await orig<typeof import('../../lib/ops')>()),
  approveWeeklyReport: vi.fn(async () => {}), dispatchCommentGate: vi.fn(),
}))
const NOW = Date.parse('2026-10-24T12:00:00Z')
const row = (gate: boolean, posted_at = '2026-10-23T12:00:01Z'): OpsDraft => ({
  id: 'out', client_id: 'ivan', kind: 'comment_outbound', body: 'draft', slack_channel: '',
  context: { posted_at, ...(gate ? { approve_url: 'https://gate.test/approve' } : {}) },
  created_at: '2026-10-24T12:00:00Z', approved_at: null, sent_at: null, send_blocked_reason: null,
})
const clipboard = vi.fn(async () => {})
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  vi.mocked(dispatchCommentGate).mockResolvedValue({ outcome: 'accepted', message: 'approved', retryable: false })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

it.each([true, false])('shared card rechecks after confirmation, gate=%s', async gate => {
  let finish!: (v: boolean) => void
  const confirm = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const { result } = renderHook(() => usePendingCard({ draft: row(gate), refresh: () => {}, confirm }))
  let approval!: Promise<void>
  act(() => { approval = result.current.onApprove() })
  expect(confirm).toHaveBeenCalledTimes(1)
  vi.setSystemTime(NOW + 1002)
  await act(async () => { finish(true); await approval })
  expect(result.current.error).toMatch(/24.hour/)
  expect(dispatchCommentGate).not.toHaveBeenCalled()
  expect(clipboard).not.toHaveBeenCalled()
  expect(approveWeeklyReport).not.toHaveBeenCalled()
})

it.each([true, false])('legacy card rechecks after confirmation, gate=%s', async gate => {
  let finish!: (v: boolean) => void
  confirmHold.confirm.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
  render(<LegacyCard draft={row(gate)} refresh={() => {}} />)
  fireEvent.click(screen.getByText(gate ? 'Approve & queue' : 'Approve & copy'))
  vi.setSystemTime(NOW + 1002)
  await act(async () => { finish(true) })
  expect(screen.getByText(/24.hour/)).toBeTruthy()
  expect(dispatchCommentGate).not.toHaveBeenCalled()
  expect(clipboard).not.toHaveBeenCalled()
  expect(approveWeeklyReport).not.toHaveBeenCalled()
})

it('batch approval checks each sequential item after time spent on the previous gate', async () => {
  vi.mocked(dispatchCommentGate).mockImplementationOnce(async () => {
    vi.setSystemTime(NOW + 1002)
    return { outcome: 'accepted', message: 'approved', retryable: false }
  })
  const outcomes = []
  for (const d of [row(true, '2026-10-24T11:00:00Z'), { ...row(true), id: 'second' }]) outcomes.push(await dispatchApprove(d))
  expect(outcomes[1]).toMatchObject({ ok: false, outcome: 'refused' })
  expect(dispatchCommentGate).toHaveBeenCalledTimes(1)
  // The first original is still inside the window when its approval is recorded.
  expect(approveWeeklyReport).toHaveBeenCalledTimes(1)
})

it('batch manual-copy path rejects unknown original time despite a fresh ops timestamp', async () => {
  expect(await dispatchApprove(row(false, ''))).toMatchObject({ ok: false, outcome: 'refused' })
  expect(clipboard).not.toHaveBeenCalled()
  expect(approveWeeklyReport).not.toHaveBeenCalled()
})

it('fresh card approval still requires confirmation', async () => {
  const confirm = vi.fn(async () => false)
  const { result } = renderHook(() => usePendingCard({ draft: row(true), refresh: () => {}, confirm }))
  await act(async () => { await result.current.onApprove() })
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(dispatchCommentGate).not.toHaveBeenCalled()
})

it.each([true, false])('shared card dispatches a fresh original after approval, gate=%s', async gate => {
  const confirm = vi.fn(async () => true)
  const { result } = renderHook(() => usePendingCard({ draft: row(gate), refresh: () => {}, confirm }))
  await act(async () => { await result.current.onApprove() })
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(result.current.error).toBe('')
  expect(approveWeeklyReport).toHaveBeenCalledWith('out', 'draft')
  if (gate) expect(dispatchCommentGate).toHaveBeenCalledWith('https://gate.test/approve')
  else expect(clipboard).toHaveBeenCalledWith('draft')
})
