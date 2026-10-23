// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchOpsDrafts, type OpsDraft } from '../../lib/ops'
import { fetchContentErrorPile, fetchContentReviewPile, fetchStagedIdeaPile } from '../../lib/workQueue'
import { WorkQueue } from './WorkQueue'

const inbox = vi.hoisted(() => ({ threads: [] }))
vi.mock('../counts/inbox', () => ({ useDInbox: () => inbox }))
vi.mock('../../hooks/useToday', () => ({ useToday: () => ({
  brief: null, counts: { urgencies_count: 0, approvals: { comments: 0, dms: 0, feed: 0 } },
  fromCache: false, degraded: false, cachedAt: null, loading: false, refreshing: false,
  error: null, authError: false, health: null, refresh: async () => {},
}) }))
vi.mock('../../hooks/useBrainMembers', () => ({ useBrainMembers: () => {} }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/ops', async orig => ({ ...(await orig<typeof import('../../lib/ops')>()), fetchOpsDrafts: vi.fn() }))
vi.mock('../../lib/workQueue', async orig => ({
  ...(await orig<typeof import('../../lib/workQueue')>()),
  fetchContentReviewPile: vi.fn(), fetchContentErrorPile: vi.fn(), fetchStagedIdeaPile: vi.fn(),
}))

const NOW = Date.parse('2026-10-24T12:00:00Z')
const draft = (id: string, posted_at: string, kind: OpsDraft['kind'] = 'comment_outbound'): OpsDraft => ({
  id, client_id: 'ivan', kind, body: id, slack_channel: '', context: { posted_at },
  created_at: '2026-10-24T12:00:00Z', approved_at: null, sent_at: null, send_blocked_reason: null,
})
const count = () => document.querySelector('[data-waiting-n]')?.textContent
const mount = async () => { render(<WorkQueue go={() => {}} />); await act(async () => {}) }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  vi.mocked(fetchContentReviewPile).mockResolvedValue([])
  vi.mocked(fetchContentErrorPile).mockResolvedValue([])
  vi.mocked(fetchStagedIdeaPile).mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks() })

it('drops each outbound original at 24 hours plus 1 ms while idle, preserving incoming policy', async () => {
  vi.mocked(fetchOpsDrafts).mockResolvedValue([
    draft('first original', '2026-10-23T12:00:02Z'),
    draft('second original', '2026-10-23T12:00:04Z'),
    draft('incoming reply', '2026-10-23T00:00:00Z', 'comment_reply'),
    draft('invalid original', 'invalid'),
    draft('future original', '2026-10-25T12:00:00Z'),
    draft('missing original', ''),
  ])
  await mount()
  expect(count()).toBe('3')
  expect(screen.queryByText('invalid original')).toBeNull()
  expect(screen.queryByText('future original')).toBeNull()
  expect(screen.queryByText('missing original')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(count()).toBe('3') // exactly 24 hours is still actionable
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.queryByText('first original')).toBeNull()
  expect(count()).toBe('2')
  await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
  expect(count()).toBe('2')
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.queryByText('second original')).toBeNull()
  expect(screen.getByText('incoming reply')).toBeTruthy()
  expect(count()).toBe('1')
  expect(fetchOpsDrafts).toHaveBeenCalledTimes(1)
})

it.each(['focus', 'visibilitychange'])('invalidates expired snapshot immediately on %s while offline', async event => {
  vi.mocked(fetchOpsDrafts).mockResolvedValueOnce([draft('expired on resume', '2026-10-23T12:00:02Z')])
  await mount()
  expect(count()).toBe('1')
  vi.mocked(fetchOpsDrafts).mockRejectedValue(new Error('offline'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // Resume a suspended tab without running its overdue timers.
  vi.setSystemTime(NOW + 3000)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  act(() => { (event === 'focus' ? window : document).dispatchEvent(new Event(event)) })
  expect(screen.queryByText('expired on resume')).toBeNull()
  expect(count()).toBe('0')
  await act(async () => {})
  expect(count()).toBe('0')
})

it('keeps expired originals hidden when a fallback read returns the same rows later', async () => {
  const rows = [draft('late original', '2026-10-23T12:00:02Z')]
  vi.mocked(fetchOpsDrafts).mockResolvedValueOnce(rows)
  await mount()
  expect(count()).toBe('1')
  let resolve!: (rows: OpsDraft[]) => void
  vi.mocked(fetchOpsDrafts).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  act(() => { window.dispatchEvent(new Event('wb-rows-changed')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(2001) })
  expect(screen.queryByText('late original')).toBeNull()
  expect(count()).toBe('0')
  await act(async () => { resolve([...rows]) })
  expect(screen.queryByText('late original')).toBeNull()
  expect(count()).toBe('0')
})
