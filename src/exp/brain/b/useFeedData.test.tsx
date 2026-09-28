// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
vi.mock('../../../lib/turns', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/turns')>()
  return { ...original, listNotifications: list }
})
vi.mock('../../v2c/mock', () => ({ mockFlag: () => null }))
const { useFeedData } = await import('./useFeedData')

function FeedCount() { const feed = useFeedData(); return <span data-testid="feed-count">{feed.rows.length}</span> }
afterEach(() => { vi.useRealTimers(); list.mockReset() })

describe('feed expiry while open', () => {
  it('removes a visible row at its exact deadline without dismissal', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T10:00:00Z'))
    list.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111', family: 'system_infra_alarm',
      created_at: '2026-09-28T06:00:04Z', last_seen_at: '2026-09-28T06:00:04Z',
      expires_at: '2026-09-28T10:00:04Z', dismissed_at: null, read_at: null,
      group_key: null, title: 'Failed', count: 1,
    }]).mockResolvedValue([])
    render(<FeedCount />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('feed-count').textContent).toBe('1')
    await act(async () => { await vi.advanceTimersByTimeAsync(3999) })
    expect(screen.getByTestId('feed-count').textContent).toBe('1')
    await act(async () => { await vi.advanceTimersByTimeAsync(2) })
    expect(screen.getByTestId('feed-count').textContent).toBe('0')
    expect(list).toHaveBeenCalledTimes(3) // live refresh plus historical empty-state timestamp
  })
})
