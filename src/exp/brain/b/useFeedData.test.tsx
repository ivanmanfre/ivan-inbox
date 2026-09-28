// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const dismissAll = vi.fn(async () => {})
const restoreAll = vi.fn(async () => {})
vi.mock('../../../lib/turns', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/turns')>()
  return { ...original, listNotifications: list, dismissAllNotifications: dismissAll, restoreDismissedAt: restoreAll }
})
vi.mock('../../v2c/mock', () => ({ mockFlag: () => null }))
const { useFeedData } = await import('./useFeedData')

function FeedCount() { const feed = useFeedData(); return <span data-testid="feed-count">{feed.rows.length}</span> }
function ClearFeed() { const feed = useFeedData(); return <button onClick={() => void feed.clearAll()}>{feed.rows.length}</button> }
function ClearAndRefreshFeed() { const feed = useFeedData(); return <><span data-testid="count">{feed.rows.length}</span><button onClick={() => void feed.clearAll()}>Clear</button><button onClick={() => void feed.refresh()}>Refresh</button></> }
function UndoFeed() { const feed = useFeedData(); const [stamp, setStamp] = useState<string | null>(null); return <><span data-testid="count">{feed.rows.length}</span><button onClick={() => void feed.clearAll().then(setStamp)}>Clear</button><button onClick={() => { if (stamp) void feed.undoClear(stamp) }}>Undo</button></> }
afterEach(() => { cleanup(); vi.useRealTimers(); list.mockReset(); dismissAll.mockClear(); restoreAll.mockClear() })

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

describe('feed clear against an older read', () => {
  it('does not restore old rows when a pre-clear refresh finishes late', async () => {
    let finish!: (rows: unknown[]) => void
    list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue([])
    render(<ClearFeed />)
    await act(async () => { screen.getByRole('button').click(); await Promise.resolve() })
    await act(async () => { finish([{ id: 'old', family: 'system_infra_alarm', created_at: '2026-09-28T09:00:00Z', last_seen_at: '2026-09-28T09:00:00Z', expires_at: null, dismissed_at: null, read_at: null, group_key: null, title: 'Old', count: 1 }]); await Promise.resolve() })
    expect(screen.getByRole('button').textContent).toBe('0')
  })
  it('does not resurrect a stale read started while the clear write is pending', async () => {
    let finish!: () => void
    dismissAll.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const old = { id: 'old', family: 'system_infra_alarm', created_at: '2026-09-28T09:00:00Z', last_seen_at: '2026-09-28T09:00:00Z', expires_at: null, dismissed_at: null, read_at: null, group_key: null, title: 'Old', count: 1 }
    list.mockResolvedValueOnce([old]).mockResolvedValue([])
    render(<ClearAndRefreshFeed />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('count').textContent).toBe('1')
    await act(async () => { screen.getByText('Clear').click(); screen.getByText('Refresh').click(); await Promise.resolve() })
    expect(list).toHaveBeenCalledTimes(1)
    await act(async () => { finish(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(list).toHaveBeenCalledTimes(3) // initial read, post-clear read, empty-history timestamp
  })
  it('does not erase restored rows when the post-clear read finishes after Undo', async () => {
    let finish!: (rows: unknown[]) => void
    const old = { id: 'old', family: 'system_infra_alarm', created_at: '2026-09-28T09:00:00Z', last_seen_at: '2026-09-28T09:00:00Z', expires_at: null, dismissed_at: null, read_at: null, group_key: null, title: 'Old', count: 1 }
    list.mockResolvedValueOnce([old]).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue([old])
    render(<UndoFeed />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { screen.getByText('Clear').click(); await Promise.resolve(); await Promise.resolve() })
    await act(async () => { screen.getByText('Undo').click(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('count').textContent).toBe('1')
    await act(async () => { finish([]); await Promise.resolve() })
    expect(screen.getByTestId('count').textContent).toBe('1')
  })
})
