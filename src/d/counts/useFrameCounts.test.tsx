// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZERO_READERS } from '../test-utils'
import { FrameCountsProvider, useFrameCounts } from './useFrameCounts'

function Count() { return <span data-testid="bell-count">{useFrameCounts().bell.value?.open ?? 'loading'}</span> }
function RefreshCount() { const counts = useFrameCounts(); return <button onClick={() => counts.refresh('bell')}>{counts.bell.value?.open ?? 'loading'}</button> }

afterEach(() => vi.useRealTimers())

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
