// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZERO_READERS } from '../test-utils'
import { FrameCountsProvider, useFrameCounts } from './useFrameCounts'

function Count() { return <span data-testid="bell-count">{useFrameCounts().bell.value?.open ?? 'loading'}</span> }

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
