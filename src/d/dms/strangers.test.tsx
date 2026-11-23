// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { ColumnBody, type ColumnProps } from './Column'
import { Folders } from './Chrome'
import { NOW, drafted, threads } from './fixtures'
import { seatView, spamCount } from './model'
import { SEATS } from '../seats'
import type { Stranger } from './strangers'

afterEach(cleanup)

const DAY = 86_400_000
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
const row = (id: string, client_id: string, verdict: string, daysAgo: number, extra: Partial<Stranger> = {}): Stranger =>
  ({ id, client_id, who: `Person ${id}`, verdict: verdict as Stranger['verdict'], reason: `reason ${id}`, message_text: `Pitch ${id}`, decided_at: at(daysAgo), ...extra })

const rows: Stranger[] = [
  row('a', 'swishdm', 'vendor', 5), row('b', 'swishdm', 'unsure', 1), row('c', 'swishdm', 'personal', 1),
  row('d', 'swishdm', 'buyer', 1), row('e', 'swishdm', 'vendor', 40), row('f', 'risedtc', 'vendor', 2),
  row('g', 'rise', 'unsure', 3), row('h', 'ivan', 'vendor', 1), row('i', 'arch', 'vendor', 0.5),
]

describe('strangers in the seat view', () => {
  it('keeps vendor and unsure rows of the last 30 days on their own seat, newest first', () => {
    expect(seatView([], 'swishdm', NOW, new Map(), new Map(), rows).strangers.map(s => s.id)).toEqual(['b', 'a'])
    expect(seatView([], 'risedtc', NOW, new Map(), new Map(), rows).strangers.map(s => s.id)).toEqual(['f', 'g'])
    expect(seatView([], 'arch', NOW, new Map(), new Map(), rows).strangers.map(s => s.id)).toEqual(['i'])
  })
  it('has no stranger folder on a seat without Likely spam', () => {
    expect(seatView([], 'ivan', NOW, new Map(), new Map(), rows).strangers).toEqual([])
  })
  it('counts spam threads and strangers together', () => {
    const spamThread = threads(drafted('s', { client_id: 'swishdm', prospect_skip_reason: 'inbound_vendor_pitch' }))
    const v = seatView(spamThread, 'swishdm', NOW, new Map(), new Map(), rows)
    expect(v.spam).toHaveLength(1)
    expect(spamCount(v)).toBe(3)
  })
})

function views(list: Stranger[]) {
  return Object.fromEntries(SEATS.map(s => [s, seatView([], s, NOW, new Map(), new Map(), list)])) as Record<(typeof SEATS)[number], ReturnType<typeof seatView>>
}

describe('Likely spam folder', () => {
  function mount(seat: 'swishdm' | 'risedtc', v4 = true, list = rows) {
    const open = vi.fn()
    const p = { seat, mode: 'spam', view: views(list)[seat], matches: [], byId: new Map(),
      c: { selected: null, checked: new Set(), open, now: NOW, verbs: {}, busy: null, setBusy: vi.fn(), fail: vi.fn(), pre: { get: () => ({ s: 'none' }) }, more: vi.fn(), v4 },
    } as unknown as ColumnProps
    renderInFrame(<ColumnBody {...p} />)
    return { open }
  }
  it.each([false, true])('draws who, text, verdict with reason and date, tagged and read-only (v4=%s)', v4 => {
    const { open } = mount('swishdm', v4)
    expect(screen.getByText('Likely spam')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('Person a')).toBeTruthy()
    expect(screen.getByText(/Pitch b/)).toBeTruthy()
    expect(screen.getByText('Vendor: reason a')).toBeTruthy()
    expect(screen.getByText('Unsure: reason b')).toBeTruthy()
    expect(screen.getAllByText('LinkedIn DM, not in engine')).toHaveLength(2)
    expect(screen.queryByText('Person c')).toBeNull()
    expect(screen.queryByText('Person e')).toBeNull()
    expect(document.querySelectorAll('[data-d-row]')).toHaveLength(0)
    expect(screen.queryByRole('button')).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })
  it('says nothing filed only when there are no spam threads and no strangers', () => {
    mount('risedtc', true, [])
    expect(screen.getByText('Nothing filed on this seat.')).toBeTruthy()
  })
})

describe('folder counts', () => {
  it('print the stranger rows in the folder bar', () => {
    const v = views(rows)
    renderInFrame(<Folders folder="spam" setFolder={vi.fn()} views={v} />)
    expect(screen.getByRole('tab', { name: /Likely spam/ }).textContent).toContain('Rise 2')
    expect(screen.getByRole('tab', { name: /Likely spam/ }).textContent).toContain('Arch 1')
    })
  it('does not light the unread dot for strangers alone', () => {
    renderInFrame(<Folders folder={null} setFolder={vi.fn()} views={views(rows)} />)
    expect(document.querySelector('.dm-fdot')).toBeNull()
  })
})
