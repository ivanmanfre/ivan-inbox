// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnaLane } from './AnnaLane'
import { parseAnnaStatus, useAnnaLane, type AnnaStatus } from './anna'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))
const status: AnnaStatus = {
  enabled: true, pause_reason: null, daily_cap: 25, sent_today: 7, pending: 12, accepted: 4, replied: 2, queued: 40,
  last_sync_at: '2026-11-04T10:00:00Z', events: [{ id: 'anna-prospect', name: 'Taylor', company: 'Example', linkedin_url: 'https://www.linkedin.com/in/taylor', status: 'replied', invited_at: '2026-11-01T10:00:00Z', accepted_at: '2026-11-02T10:00:00Z', last_reply_at: '2026-11-04T09:00:00Z', error: null }],
}
beforeEach(() => rpc.mockReset())
afterEach(cleanup)

describe('Anna lane', () => {
  it('shows only the supplied account’s counts and opens replies in Anna’s inbox', () => {
    const control = vi.fn()
    render(<AnnaLane read={{ value: status, error: null, busy: false }} refresh={vi.fn()} control={control} />)
    expect(screen.getByText('Invited today').parentElement?.textContent).toBe('Invited today7')
    expect(screen.getByText('Accepted', { selector: 'small' }).parentElement?.textContent).toBe('Accepted4')
    expect(screen.getByRole('link', { name: 'Open conversation' }).getAttribute('href')).toContain('seat=anna')
    expect(screen.getByRole('link', { name: 'Open conversation' }).getAttribute('href')).toContain('thread=anna-prospect')
    fireEvent.click(screen.getByRole('button', { name: 'Pause lane' }))
    expect(control).toHaveBeenCalledWith(false)
  })
  it('never shows an unread value as zero or offers a toggle after a failed read', () => {
    const view = render(<AnnaLane read={{ value: null, error: null, busy: false }} refresh={vi.fn()} control={vi.fn()} />)
    expect(screen.getByRole('status', { name: 'Reading Anna’s lane' })).toBeTruthy()
    expect(screen.queryByText('Invited today')).toBeNull()
    view.rerender(<AnnaLane read={{ value: null, error: 'No answer', busy: false }} refresh={vi.fn()} control={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('No answer')
    expect(screen.queryByRole('button', { name: /Pause lane|Resume lane/ })).toBeNull()
  })
  it('rejects incomplete counts', () => {
    expect(() => parseAnnaStatus({ ...status, sent_today: null })).toThrow('incomplete')
    expect(() => parseAnnaStatus({ ...status, events: [{}] })).toThrow('incomplete')
  })
  it('pause writes the requested setting then reads the actual result', async () => {
    rpc.mockResolvedValueOnce({ data: status, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: { ...status, enabled: false }, error: null })
    const { result } = renderHook(useAnnaLane)
    await waitFor(() => expect(result.current.read.value?.enabled).toBe(true))
    await act(() => result.current.control(false))
    expect(rpc).toHaveBeenNthCalledWith(2, 'anna_lane_control', { p_enabled: false })
    expect(rpc).toHaveBeenNthCalledWith(3, 'anna_lane_status')
    expect(result.current.read.value?.enabled).toBe(false)
  })
  it('does not claim a toggle succeeded when the write got no answer', async () => {
    rpc.mockResolvedValueOnce({ data: status, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
    const { result } = renderHook(useAnnaLane)
    await waitFor(() => expect(result.current.read.value?.enabled).toBe(true))
    await act(() => result.current.control(false))
    expect(result.current.read.value).toBeNull()
    expect(result.current.read.error).toContain('Refresh before changing it again')
    expect(result.current.read.busy).toBe(false)
  })
})
