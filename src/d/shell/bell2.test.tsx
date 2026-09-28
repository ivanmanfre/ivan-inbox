// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Notification, NotificationGroup } from '../../lib/turns'
import type { SystemAlert } from '../../lib/systemAlerts'
import { renderInFrame } from '../test-utils'

// Parity pass 2 for the bell: one system alert at a time, its link, body and
// members; a group's members one at a time; the Claude-turn route; the
// fallback for an address nothing routes; the routine fold.

afterEach(() => { cleanup() })

const feed = {
  rows: [] as Notification[], groups: [] as NotificationGroup[], unreadTotal: 1, loaded: true, error: false,
  lastEmptySince: null, expanded: new Set<string>(),
  refresh: vi.fn(async () => {}), markRead: vi.fn(), dismissOne: vi.fn(async () => true),
  dismissGroupRows: vi.fn(async () => true), restore: vi.fn(), toggle: vi.fn(),
  clearAll: vi.fn(async (): Promise<string | null> => 'STAMP'), undoClear: vi.fn(async () => {}),
}
vi.mock('../../exp/brain/b/useFeedData', () => ({ useFeedData: () => feed }))
vi.mock('./WorkQueue', () => ({ WorkQueue: () => null }))
const dismissSystemAlert = vi.fn(async (_id: string) => {})
vi.mock('../../lib/systemAlerts', async orig => ({ ...(await orig<typeof import('../../lib/systemAlerts')>()), dismissSystemAlert: (id: string) => dismissSystemAlert(id) }))
const getTurn = vi.fn(async (_id: string) => ({ id: 'turn-1', thread_id: 'thr-1' }))
vi.mock('../../lib/turns', async orig => ({ ...(await orig<typeof import('../../lib/turns')>()), getTurn: (id: string) => getTurn(id) }))

const { BellFeed } = await import('./Bell')
const { shapeAlerts } = await import('../../lib/systemAlerts')

const row = (over: Partial<Notification>): Notification => ({
  id: 'n1', family: 'inbound_reply_notice', source: 'x', severity: 'info', title: 'New inbound reply — Martti',
  body: 'Martti: "sounds good"', url: './#exp/brain-b/dms?thread=abc', media: null, group_key: null,
  tenant: 'ivan', count: 1, first_seen_at: '2026-09-27T08:46:00Z', created_at: '2026-09-27T08:46:00Z', last_seen_at: '2026-09-27T08:46:00Z', read_at: null, dismissed_at: null,
  ...over,
} as Notification)

const group = (items: Notification[], over: Partial<NotificationGroup> = {}): NotificationGroup => ({
  key: items[0].group_key ?? items[0].id, groupKey: items[0].group_key, family: items[0].family, latest: items[0], items,
  count: items.length, unread: items.filter(i => !i.read_at).length, lastSeenAt: items[0].last_seen_at, ...over,
})

const alert = (over: Partial<SystemAlert>): SystemAlert => ({
  id: 'a1', source: 'ig_grant', dedupe_key: 'k', severity: 'critical', title: 'Instagram grant expires in 3 days',
  body: 'Rise mirror stops posting on Oct 1.\nToken issued Aug 2', action_url: 'https://example.com/reconnect', action_label: 'Reconnect Instagram',
  created_at: '2026-09-27T07:00:00Z', resolved_at: null, ...over,
})

function readersWith(rows: SystemAlert[], extra: object = {}) {
  const groups = shapeAlerts(rows)
  return { bell: async () => ({ unreadGroups: 1, open: 1 }), alerts: async () => ({ rows, groups, critical: groups.filter(g => g.severity === 'critical').length }), ...extra }
}

beforeEach(() => { vi.clearAllMocks(); feed.groups = [] })

/** Wait until the selector matches (waitFor retries only on a throw). */
const q = <T extends Element = HTMLElement>(sel: string) => waitFor(() => {
  const el = document.querySelector<T & Element>(sel)
  if (!el) throw new Error(`no ${sel}`)
  return el as T
})

describe('bell system alerts', () => {
  it('shows the body, Full detail and the Open link, and dismisses ONE alert through system_alerts', async () => {
    renderInFrame(<BellFeed />, { readers: readersWith([alert({})]) })
    const link = await q<HTMLAnchorElement>('[data-verb="open-link"]')
    expect(link.getAttribute('href')).toBe('https://example.com/reconnect')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.textContent).toContain('Reconnect Instagram')
    expect(screen.getByText('Rise mirror stops posting on Oct 1.')).toBeTruthy()
    expect(screen.getByText('Full detail')).toBeTruthy()
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="dismiss-alert"]')!) })
    expect(dismissSystemAlert).toHaveBeenCalledWith('a1')
    await screen.findByText('Alert dismissed. It does not come back.')
  })

  it('a grouped shape opens to its members, each with its own dismiss', async () => {
    const rows = ['x', 'y', 'z'].map((s, i) => alert({ id: `s${i}`, source: 'dtc_scan_integrity', severity: 'warn', title: `Scan integrity: store-${s}`, body: '- Meta unread, no ad claim shipped: unknown', action_url: null, action_label: null }))
    renderInFrame(<BellFeed />, { readers: readersWith(rows) })
    const head = await q<HTMLElement>('[data-sys-group] .d-sys-t')
    fireEvent.click(head)
    await waitFor(() => expect(document.querySelectorAll('[data-sys-member]').length).toBe(3))
    await act(async () => { fireEvent.click(document.querySelectorAll('[data-sys-member] [data-verb="dismiss-alert"]')[1]) })
    expect(dismissSystemAlert).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.querySelectorAll('[data-sys-member]').length).toBe(2))
  })

  it('every group is reachable: past four, "Show N more" opens the rest in place', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => alert({ id: `g${i}`, source: `src${i}`, severity: 'warn', title: `Alert number ${i}`, body: `body ${i}`, action_url: null }))
    renderInFrame(<BellFeed />, { readers: readersWith(rows) })
    await waitFor(() => expect(document.querySelectorAll('[data-sys-group]').length).toBe(4))
    fireEvent.click(screen.getByText('Show 2 more'))
    expect(document.querySelectorAll('[data-sys-group]').length).toBe(6)
    expect(document.body.textContent).not.toContain("in today's app")
  })

  it('system alerts use the header Clear all without a second clear button', async () => {
    renderInFrame(<BellFeed />, { readers: readersWith([alert({})]) })
    await q('[data-sys-group]')
    expect(document.querySelector('[data-verb="clear-all"]')).not.toBeNull()
    expect(document.querySelector('[data-verb="clear-alerts"]')).toBeNull()
  })
})

describe('bell rows', () => {
  it('a group opens with "Show each one" and one member is dismissed alone, with Undo', async () => {
    const a = row({ id: 'm1', group_key: 'g', title: 'Reply from Anna' })
    const b = row({ id: 'm2', group_key: 'g', title: 'Reply from Ben' })
    feed.groups = [group([a, b])]
    renderInFrame(<BellFeed />, { readers: readersWith([]) })
    fireEvent.click(await screen.findByText('Show each one (2)'))
    const xs = document.querySelectorAll('.d-fg-items [data-verb="dismiss"]')
    expect(xs.length).toBe(2)
    await act(async () => { fireEvent.click(xs[1]) })
    expect(feed.dismissOne).toHaveBeenCalledWith('m2', b)
    expect(feed.dismissGroupRows).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(await q('.d-toast [data-verb="undo"]')) })
    expect(feed.restore).toHaveBeenCalledWith([b])
  })

  it('a row Claude folded opens that Claude turn, marked "in chat"', async () => {
    const n = row({ id: 'b1', group_key: 'bot:turn-1' })
    feed.groups = [group([n])]
    const navigate = vi.fn()
    renderInFrame(<BellFeed />, { readers: readersWith([]), frame: { navigate } })
    await waitFor(() => expect(document.querySelector('[data-in-chat]')).toBeTruthy())
    await act(async () => { fireEvent.click(document.querySelector('[data-feed-row] .d-fn-open')!) })
    expect(getTurn).toHaveBeenCalledWith('turn-1')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('#exp/d/claude?thread=thr-1&turn=turn-1'))
  })

  it('an address nothing routes lands on Lanes, never nowhere', async () => {
    feed.groups = [group([row({ url: null })])]
    const navigate = vi.fn()
    renderInFrame(<BellFeed />, { readers: readersWith([]), frame: { navigate } })
    fireEvent.click(await q<HTMLElement>('[data-feed-row] .d-fn-open'))
    expect(navigate).toHaveBeenCalledWith('#exp/d/lanes')
  })

  it('a row that needs him carries "Pick this up"', async () => {
    feed.groups = [group([row({ family: 'reply_draft_pending', severity: 'attention', title: 'Draft ready for Anna' })])]
    renderInFrame(<BellFeed />, { readers: readersWith([]) })
    await waitFor(() => expect(document.querySelector('[data-verb="pick-up"]')?.textContent).toBe('Pick this up'))
  })

  it('digests fold under Routine updates', async () => {
    feed.groups = [group([row({ id: 'd1', family: 'system_watchdog_digest', title: 'Watchdog digest' })])]
    renderInFrame(<BellFeed />, { readers: readersWith([]) })
    const h = await q<HTMLElement>('.d-routine-h')
    expect(document.querySelector('.d-routine [data-feed-row]')).toBeNull()
    fireEvent.click(h)
    expect(document.querySelector('.d-routine [data-feed-row]')).toBeTruthy()
  })

  it('workflow health summaries do not remain in the bell after clearing rows', async () => {
    const health = async () => ({ urgent: [{ key: 'w', name: 'Rise DM sender', kind: 'both' as const, source: 'n8n', category: null, lastAt: null, detail: null, acknowledged: false }], alerts: [], olderErrored: 0, olderStalled: 0, acknowledged: 0 })
    renderInFrame(<BellFeed />, { readers: readersWith([], { health }) })
    await q('[data-bell-feed]')
    expect(document.querySelector('.d-wfban')).toBeNull()
  })
})
