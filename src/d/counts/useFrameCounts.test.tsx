// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZERO_READERS } from '../test-utils'
import type { Thread } from '../../lib/inbox'

const inboxHold = vi.hoisted(() => ({ value: null as null | { threads: Thread[]; loadedAt: string | null; cachedAt: string | null } }))
vi.mock('./inbox', () => ({ useDInboxMaybe: () => inboxHold.value }))
import { FrameCountsProvider, useFrameCounts } from './useFrameCounts'

function Count() { return <span data-testid="bell-count">{useFrameCounts().bell.value?.open ?? 'loading'}</span> }
function RefreshCount() { const counts = useFrameCounts(); return <button onClick={() => counts.refresh('bell')}>{counts.bell.value?.open ?? 'loading'}</button> }

afterEach(() => { vi.useRealTimers(); inboxHold.value = null })

describe('frame bell expiry deadline', () => {
  it('refreshes at nextExpiryAt while the tab remains open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T10:00:00Z'))
    const bell = vi.fn()
      .mockResolvedValueOnce({ unreadGroups: 1, open: 1, nextExpiryAt: '2026-09-28T10:00:04Z' })
      .mockResolvedValue({ unreadGroups: 0, open: 0, nextExpiryAt: null })
    render(<FrameCountsProvider readers={{ ...ZERO_READERS, bell }}><Count /></FrameCountsProvider>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('bell-count').textContent).toBe('1')
    await act(async () => { await vi.advanceTimersByTimeAsync(4001) })
    expect(bell).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('bell-count').textContent).toBe('0')
  })
})

describe('frame count refresh during an in-flight read', () => {
  it('re-reads after the old request settles so Clear can replace a stale badge', async () => {
    let finish!: (value: { unreadGroups: number; open: number }) => void
    const bell = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue({ unreadGroups: 0, open: 0 })
    render(<FrameCountsProvider readers={{ ...ZERO_READERS, bell }}><RefreshCount /></FrameCountsProvider>)
    await act(async () => { screen.getByRole('button').click(); finish({ unreadGroups: 1, open: 1 }); await Promise.resolve(); await Promise.resolve() })
    expect(bell).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button').textContent).toBe('0')
  })
})

describe('DMs counts come off the frame inbox when it has rows', () => {
  const thread = { prospect_id: 'p1', client_id: 'ivan', messages: [], stage: 'replied' } as unknown as Thread
  it('the per-seat DM read runs while the inbox has no rows', async () => {
    const dm = vi.fn().mockResolvedValue({ drafts: 0, needs: 0 })
    render(<FrameCountsProvider readers={{ ...ZERO_READERS, dm }}><Count /></FrameCountsProvider>)
    await act(async () => { await Promise.resolve() })
    expect(dm).toHaveBeenCalledTimes(3)
  })
  it('no per-seat DM re-read on the 3-minute poll once the inbox covers the numbers', async () => {
    vi.useFakeTimers()
    inboxHold.value = { threads: [thread], loadedAt: '2026-09-29T00:00:00Z', cachedAt: null }
    const dm = vi.fn().mockResolvedValue({ drafts: 0, needs: 0 })
    const bell = vi.fn().mockResolvedValue({ unreadGroups: 0, open: 0 })
    render(<FrameCountsProvider readers={{ ...ZERO_READERS, dm, bell }}><Count /></FrameCountsProvider>)
    await act(async () => { await Promise.resolve() })
    const atMount = dm.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000 + 10) })
    expect(dm.mock.calls.length).toBe(atMount)
    expect(bell.mock.calls.length).toBeGreaterThan(1)
  })
})
