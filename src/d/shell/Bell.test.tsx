// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationGroup, Notification } from '../../lib/turns'
import type { SystemAlert } from '../../lib/systemAlerts'
import { renderInFrame } from '../test-utils'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

// Verb wiring for the bell: Clear all goes through today's clearAll (the
// db/056 supersede PATCH) and its Undo through undoClear(stamp); a refused
// write says so and changes nothing. The data hook is today's, stubbed here.
const feed = {
  rows: [] as Notification[], groups: [] as NotificationGroup[], unreadTotal: 1, loaded: true, error: false,
  lastEmptySince: null, expanded: new Set<string>(),
  refresh: vi.fn(async () => {}), markRead: vi.fn(), dismissOne: vi.fn(async () => true),
  dismissGroupRows: vi.fn(async () => true), restore: vi.fn(), toggle: vi.fn(),
  clearAll: vi.fn(async (): Promise<string | null> => 'STAMP'), undoClear: vi.fn(async () => {}),
}
vi.mock('../../exp/brain/b/useFeedData', () => ({ useFeedData: () => feed }))
// Waiting on you reads the brief and the queue piles; it has its own test.
vi.mock('./WorkQueue', () => ({ WorkQueue: () => null }))

const resolveAllSystemAlerts = vi.fn(async () => 'ALERT-STAMP')
const undoResolveAll = vi.fn(async (_stamp: string) => {})
vi.mock('../../lib/systemAlerts', async orig => ({ ...(await orig<typeof import('../../lib/systemAlerts')>()), resolveAllSystemAlerts: () => resolveAllSystemAlerts(), undoResolveAll: (stamp: string) => undoResolveAll(stamp) }))
const { BellButton, BellFeed } = await import('./Bell')

const note: Notification = {
  id: 'n1', family: 'inbound_reply_notice', source: 'x', severity: 'info', title: '[ARCH] New inbound reply — Martti',
  body: 'Martti Paatela: "sorry, we\'re pretty set"', url: './#exp/brain-b/dms?thread=abc', media: null, group_key: null,
  tenant: 'arch', count: 1, created_at: '2026-09-27T08:46:00Z', last_seen_at: '2026-09-27T08:46:00Z', read_at: null, dismissed_at: null,
} as unknown as Notification

beforeEach(() => {
  vi.clearAllMocks()
  feed.groups = [{ key: 'k1', groupKey: null, family: note.family, latest: note, items: [note], count: 1, unread: 1, lastSeenAt: note.last_seen_at! } as NotificationGroup]
})

const readers = { bell: async () => ({ unreadGroups: 104, open: 1102 }) }
const alert: SystemAlert = { id: 'a1', source: 'test', dedupe_key: 'a1', severity: 'critical', title: 'Test alert', body: null, action_url: null, action_label: null, created_at: '2026-09-28T08:00:00Z', resolved_at: null }
const alertReaders = { ...readers, alerts: async () => ({ rows: [alert], groups: [{ key: 'a1', severity: 'critical' as const, members: [{ ids: ['a1'], source: 'test', severity: 'critical' as const, title: 'Test alert', body: null, action_url: null, action_label: null, created_at: alert.created_at }], count: 1, newestCreatedAt: alert.created_at }], critical: 1 }) }

describe('BellFeed verbs', () => {
  it('files auto-queued DM1 progress under Routine updates without an approval action', async () => {
    const queued = ['Jamie Woodbridge', 'Kate Sikora', 'Sambhav Chadha', 'Ben Wood'].map((name, i) => ({
      ...note, id: `queued-${i}`, family: 'reply_draft_pending', severity: 'info' as const,
      title: `DM1 wins auto-queued for ${name}:`, body: `DM1 wins auto-queued for ${name}:`,
      group_key: 'reply_draft_pending:wins-builder', tenant: null,
    }))
    feed.groups = [{ key: 'queue', groupKey: queued[0].group_key, family: queued[0].family,
      latest: queued[0], items: queued, count: 4, unread: 4, lastSeenAt: queued[0].last_seen_at! } as NotificationGroup]
    renderInFrame(<BellFeed />, { readers })
    expect(await screen.findByText('Routine updates')).toBeTruthy()
    fireEvent.click(screen.getByText('Routine updates'))
    expect(document.querySelector('[data-feed-group] .d-fn-m b')?.textContent).toContain('4 queued')
    expect(document.querySelector('[data-feed-group]')?.textContent).not.toContain('Needs you')
    expect(document.querySelector('[data-feed-group]')?.textContent).not.toContain('Pick this up')
  })

  it('one click clears notifications and alerts, then Undo restores both stamps', async () => {
    renderInFrame(<BellFeed />, { readers: alertReaders })
    await screen.findByText('104 unread in the last 4 hours · 1,102 not cleared')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="clear-all"]')!) })
    expect(feed.clearAll).toHaveBeenCalledTimes(1)
    expect(resolveAllSystemAlerts).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(document.querySelector('[data-sys-group]')).toBeNull()
    await act(async () => { fireEvent.click(document.querySelector('.d-toast [data-verb="undo"]')!) })
    expect(feed.undoClear).toHaveBeenCalledWith('STAMP')
    expect(undoResolveAll).toHaveBeenCalledWith('ALERT-STAMP')
  })

  it('a refused Clear all says so and offers Retry', async () => {
    feed.clearAll.mockResolvedValueOnce(null)
    renderInFrame(<BellFeed />, { readers })
    await screen.findByText('104 unread in the last 4 hours · 1,102 not cleared')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="clear-all"]')!) })
    await screen.findByText('Could not clear notifications.')
  })

  it('offers Clear all when system alerts are the only rows', async () => {
    feed.groups = []
    renderInFrame(<BellFeed />, { readers: { ...alertReaders, bell: async () => ({ unreadGroups: 0, open: 0 }) } })
    await screen.findByText('Test alert')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="clear-all"]')!) })
    expect(resolveAllSystemAlerts).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-sys-group]')).toBeNull()
  })

  it('keeps system rows visible when alert clearing fails and offers Undo for cleared notifications', async () => {
    resolveAllSystemAlerts.mockRejectedValueOnce(new Error('offline'))
    renderInFrame(<BellFeed />, { readers: alertReaders })
    await screen.findByText('Test alert')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="clear-all"]')!) })
    expect(document.querySelector('[data-sys-group]')).not.toBeNull()
    expect(screen.queryByText('All clear')).toBeNull()
    await screen.findByText('Could not clear system alerts.')
    await act(async () => { fireEvent.click(document.querySelector('.d-toast [data-verb="undo"]')!) })
    expect(feed.undoClear).toHaveBeenCalledWith('STAMP')
    expect(undoResolveAll).not.toHaveBeenCalled()
  })

  it('does not claim All clear when a new notification arrives after clearing', async () => {
    renderInFrame(<BellFeed />, { readers: alertReaders })
    await screen.findByText('Test alert')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="clear-all"]')!) })
    feed.groups = [{ key: 'new', groupKey: null, family: note.family, latest: { ...note, id: 'new' }, items: [{ ...note, id: 'new' }], count: 1, unread: 1, lastSeenAt: note.last_seen_at! } as NotificationGroup]
    await act(async () => { fireEvent(window, new Event('focus')) })
    expect(screen.queryByText('All clear')).toBeNull()
    expect(document.querySelector('[data-feed-row]')).not.toBeNull()
  })

  it('shows Retry if the system alert reread fails after clear', async () => {
    const alerts = vi.fn().mockResolvedValueOnce(await alertReaders.alerts()).mockRejectedValue(new Error('offline'))
    renderInFrame(<BellFeed />, { readers: { ...alertReaders, alerts } })
    await screen.findByText('Test alert')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="clear-all"]')!) })
    await waitFor(() => expect(document.querySelector('[data-sys-alerts="failed"] [data-verb="retry"]')).not.toBeNull())
    expect(screen.queryByText('All clear')).toBeNull()
  })

  it('never draws an empty system-alerts box: none open, reading and failed are one line each', async () => {
    renderInFrame(<BellFeed />, { readers: { ...readers, alerts: async () => ({ rows: [], groups: [], critical: 0 }) } })
    await waitFor(() => expect(document.querySelector('[data-sys-alerts]')).toBeNull())
    expect(document.querySelector('.d-sys')).toBeNull()
    cleanup()
    renderInFrame(<BellFeed />, { readers: { ...readers, alerts: async () => { throw new Error('503') } } })
    await waitFor(() => expect(document.querySelector('[data-sys-alerts="failed"]')).not.toBeNull())
    expect(document.querySelector('.d-sys')).toBeNull()
    expect(document.querySelector('[data-sys-alerts="failed"] [data-verb="retry"]')).not.toBeNull()
  })

  it('a feed that never answers leaves the skeleton after 12 s for the failed line with Retry', async () => {
    vi.useFakeTimers()
    try {
      feed.loaded = false; feed.groups = []
      renderInFrame(<BellFeed />, { readers })
      expect(screen.getByLabelText('Reading notifications')).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(12_000) })
      expect(screen.queryByLabelText('Reading notifications')).toBeNull()
      expect(screen.getByText('Could not read the notifications.')).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(20_000) })
      expect(feed.refresh).toHaveBeenCalled()
    } finally { feed.loaded = true; vi.useRealTimers() }
  })

  it('rows read as a person would say them; × dismisses with an Undo', async () => {
    renderInFrame(<BellFeed />, { readers })
    const row = await waitFor(() => document.querySelector('[data-feed-row] .d-fn-open')!)
    expect(row.textContent).toContain('Martti')
    expect(row.textContent).not.toContain('[ARCH]')
    expect(row.textContent).not.toContain('—')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="dismiss"]')!) })
    expect(feed.dismissOne).toHaveBeenCalledWith('n1', note)
    await act(async () => { fireEvent.click(await waitFor(() => document.querySelector('.d-toast [data-verb="undo"]')!)) })
    expect(feed.restore).toHaveBeenCalledWith([note])
  })

  it('tapping a row marks it read and opens its link inside D', async () => {
    const navigate = vi.fn()
    renderInFrame(<BellFeed />, { readers, frame: { navigate } })
    fireEvent.click(await waitFor(() => document.querySelector<HTMLElement>('[data-feed-row] .d-fn-open')!))
    expect(feed.markRead).toHaveBeenCalledWith(note)
    expect(navigate).toHaveBeenCalledWith('#exp/d/dms?thread=abc')
  })
})

describe('BellButton', () => {
  it('shows no number when only older unread history remains', async () => {
    renderInFrame(<BellButton />, { readers: { ...readers, bell: async () => ({ unreadGroups: 0, open: 1102 }) } })
    await waitFor(() => expect(document.querySelector('.d-bell')!.getAttribute('aria-label')).toBe('Alerts, 0 unread in the last 4 hours'))
    expect(document.querySelector('.d-bell-n')).toBeNull()
  })
  it('a white count of recent unread groups, capped at 99+', async () => {
    renderInFrame(<BellButton />, { readers })
    const b = await screen.findByText('99+')
    expect(b.closest('button')!.className).not.toContain('d-crit')
    expect(b.closest('button')!.getAttribute('aria-label')).toBe('Alerts, 104 unread in the last 4 hours')
  })
  it('turns lime (d-crit) only while a critical alert is open', async () => {
    renderInFrame(<BellButton />, { readers: { ...readers, alerts: async () => ({ rows: [], groups: [], critical: 1 }) } })
    await waitFor(() => expect(document.querySelector('.d-bell')!.className).toContain('d-crit'))
  })
  it('keeps the critical alert fallback when recent unread count is zero', async () => {
    renderInFrame(<BellButton />, { readers: { ...readers, bell: async () => ({ unreadGroups: 0, open: 1102 }), alerts: async () => ({ rows: [], groups: [], critical: 1 }) } })
    await screen.findByText('!')
    expect(document.querySelector('.d-bell')!.getAttribute('aria-label')).toBe('Alerts, 0 unread in the last 4 hours, 1 critical alert open')
  })
  it('says so when the count could not be read', async () => {
    renderInFrame(<BellButton />, { readers: { bell: async () => { throw new Error('down') } } })
    await screen.findByText('?')
    expect(document.querySelector('.d-bell')!.getAttribute('aria-label')).toBe('Alerts, count could not be read')
  })
})
