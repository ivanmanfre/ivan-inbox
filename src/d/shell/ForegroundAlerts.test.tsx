// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInFrame } from '../test-utils'
import { useFrame } from './frame'
import { useFrameCounts } from '../counts/useFrameCounts'
import { parseDHash } from '../route'
import type { Notification } from '../../lib/turns'

const id = '123e4567-e89b-42d3-a456-426614174000'
const row = (overrides: Partial<Notification> = {}): Notification => ({
  id, family: 'system_infra_alarm', source: 'tracker', severity: 'error', title: 'Mattan: booking checks paused',
  body: 'HubSpot read failed.', url: './#exp/d/ops', media: null, group_key: null, tenant: 'rise', count: 1,
  first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), created_at: new Date().toISOString(),
  read_at: null, dismissed_at: null, expires_at: new Date(Date.now() + 4 * 60 * 60_000).toISOString(), incident_key: 'one',
  ...overrides,
})
const getActiveNotification = vi.fn(async (_id: string): Promise<Notification | null> => row())
const listNotifications = vi.fn(async (): Promise<Notification[]> => [])
const dismissNotification = vi.fn(async () => {})
const markNotificationsRead = vi.fn(async () => {})
vi.mock('../../lib/turns', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/turns')>(),
  getActiveNotification: (...args: Parameters<typeof getActiveNotification>) => getActiveNotification(...args),
  listNotifications: () => listNotifications(),
  dismissNotification: (...args: Parameters<typeof dismissNotification>) => dismissNotification(...args),
  markNotificationsRead: (...args: Parameters<typeof markNotificationsRead>) => markNotificationsRead(...args),
}))
const { ForegroundAlerts } = await import('./ForegroundAlerts')
const worker = new EventTarget()
function Alert() {
  const frame = useFrame()
  const counts = useFrameCounts()
  return <ForegroundAlerts host={{ bellOpen: frame.bellOpen, openBell: () => frame.setBellOpen(true), navigate: frame.navigate, refreshBell: () => counts.refresh('bell') }} />
}

async function push(family = 'system_infra_alarm', notificationId = id) {
  await act(async () => worker.dispatchEvent(new MessageEvent('message', { data: { type: 'push', family, notificationId } })))
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  location.hash = '#exp/d/lanes'
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('foreground important alerts', () => {
  it('shows a canonical eligible row only while visible, once per ID; ordinary pushes stay quiet', async () => {
    renderInFrame(<Alert />)
    await push('claude_turn')
    await push('inbound_reply_notice')
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await push()
    expect(getActiveNotification).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await push()
    expect(screen.getByText('Mattan: booking checks paused')).toBeTruthy()
    await push()
    expect(getActiveNotification).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('2 important alerts')).toBeNull()
  })

  it('does not show expired, dismissed, or payload-only eligible rows', async () => {
    getActiveNotification.mockResolvedValueOnce(row({ expires_at: new Date(Date.now() - 1).toISOString() }))
    renderInFrame(<Alert />)
    await push()
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    cleanup()
    getActiveNotification.mockResolvedValueOnce(row({ dismissed_at: new Date().toISOString() }))
    renderInFrame(<Alert />)
    await push()
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    cleanup()
    getActiveNotification.mockResolvedValueOnce(row({ family: 'booking_notice' }))
    renderInFrame(<Alert />)
    await push()
    expect(screen.queryByLabelText('Important alert')).toBeNull()
  })

  it('folds a burst into one summary that opens the bell and leaves keyboard focus alone', async () => {
    const setBellOpen = vi.fn()
    renderInFrame(<><input aria-label="Reply" /><Alert /></>, { frame: { setBellOpen } })
    const input = screen.getByLabelText('Reply')
    input.focus()
    await push()
    await push('send_failed_alert', '123e4567-e89b-42d3-a456-426614174001')
    expect(screen.getByText('2 important alerts')).toBeTruthy()
    expect(document.activeElement).toBe(input)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(setBellOpen).toHaveBeenCalledWith(true)
    expect(markNotificationsRead).not.toHaveBeenCalled()
  })

  it('opens the canonical deep link and marks its row read', async () => {
    const navigate = vi.fn()
    renderInFrame(<Alert />, { frame: { navigate } })
    await push()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(navigate).toHaveBeenCalledWith('#exp/d/ops')
    expect(parseDHash(navigate.mock.calls[0][0]).place).toBe('ops')
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith([id]))
  })

  it('expires after eight seconds without navigating or dismissing the bell row', async () => {
    vi.useFakeTimers()
    const navigate = vi.fn()
    renderInFrame(<Alert />, { frame: { navigate } })
    await push()
    expect(screen.getByLabelText('Important alert')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(8_001) })
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    expect(dismissNotification).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('respects the row TTL even when it ends before the eight-second display timer', async () => {
    vi.useFakeTimers()
    getActiveNotification.mockResolvedValueOnce(row({ expires_at: new Date(Date.now() + 2_000).toISOString() }))
    renderInFrame(<Alert />)
    await push()
    expect(screen.getByLabelText('Important alert')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(2_001) })
    expect(screen.queryByLabelText('Important alert')).toBeNull()
  })

  it('shows a distinct incident while its shared Ops destination is open', async () => {
    location.hash = '#exp/d/ops'
    renderInFrame(<Alert />)
    await push()
    expect(screen.getByText('Mattan: booking checks paused')).toBeTruthy()
  })

  it('stays quiet while the bell is already open and reading arrivals', async () => {
    renderInFrame(<Alert />, { frame: { bellOpen: true } })
    await push()
    expect(screen.queryByLabelText('Important alert')).toBeNull()
  })

  it('restores a failed dismissal and explains it; a successful dismissal refreshes counts', async () => {
    dismissNotification.mockRejectedValueOnce(new Error('403'))
    renderInFrame(<Alert />)
    await push()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await screen.findByText('Could not dismiss. Alert restored.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByLabelText('Important alert')).toBeNull())
    expect(dismissNotification).toHaveBeenCalledTimes(2)
  })

  it('seeds launch backlog and resumes without replay, then polls a newly arrived row', async () => {
    vi.useFakeTimers()
    listNotifications.mockResolvedValueOnce([row()])
    renderInFrame(<Alert />)
    await act(async () => { await Promise.resolve() })
    expect(listNotifications).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    listNotifications.mockResolvedValueOnce([row({ id: '123e4567-e89b-42d3-a456-426614174002' }), row()])
    await act(async () => { vi.advanceTimersByTime(20_000); await Promise.resolve() })
    expect(getActiveNotification).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174002')
  })

  it('clears an open popup on hide or offline and does not replay it on reconnect', async () => {
    renderInFrame(<Alert />)
    await push()
    expect(screen.getByLabelText('Important alert')).toBeTruthy()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    await push('send_failed_alert', '123e4567-e89b-42d3-a456-426614174003')
    expect(screen.getByLabelText('Important alert')).toBeTruthy()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await act(async () => window.dispatchEvent(new Event('offline')))
    expect(screen.queryByLabelText('Important alert')).toBeNull()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(screen.queryByLabelText('Important alert')).toBeNull()
  })
})
