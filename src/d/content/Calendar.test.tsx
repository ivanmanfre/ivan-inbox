// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { Calendar } from './Calendar'
import { calendarDays, isMagnetPost, looseOf, refuseOf } from './calModel'
import { byDay, seatItems } from './planModel'
import type { ContentDraft, ScheduledQueueRow } from '../../lib/content'
import type { ContentData, SeatRead } from './useContentData'
import type { Lane } from './model'

const writes = vi.hoisted(() => ({ unpublishPost: vi.fn(), setScheduleDateAt: vi.fn(), clearScheduleDate: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...writes }))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'select', 'in', 'order', 'limit', 'eq']) chain[k] = () => chain
  chain.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f)
  return { supabase: chain }
})
beforeEach(() => { window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); localStorage.clear() })

function pointer(target: Element | Window, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
  fireEvent(target, event)
}

const NOW = Date.parse('2026-09-30T10:00:00Z')
const row = (id: string, extra: Partial<ContentDraft> = {}) => ({ id, client_id: null, status: 'review', type: 'text', title: id, post_body: `${id} hook line\nbody`, created_at: '2026-09-20T09:00:00Z', updated_at: '2026-09-20T09:00:00Z', scheduled_at: null, published_at: null, board_visible: false, image_urls: null, taxonomy: null, ...extra } as ContentDraft)
const seat = (rows: ContentDraft[]): SeatRead => ({ rows, loading: false, error: null, loadedAt: '2026-09-30T10:00:00Z', refresh: vi.fn() })
const queue = { id: 'queue', clickup_task_id: 'legacy', status: 'posted', post_text: 'Our own post', scheduled_at: '2026-09-30T09:00:00Z', posted_at: '2026-09-30T09:01:00Z', unipile_share_url: 'https://linkedin.com/posts/ours' } as ScheduledQueueRow
function setup(rows: Record<Lane, ContentDraft[]>, q: ScheduledQueueRow[] = []) {
  const data = { seats: { ivan: seat(rows.ivan), risedtc: seat(rows.risedtc), arch: seat(rows.arch) }, armed: null, armedFailed: false, verdict: null, blocks: null, queueRows: q, refreshAll: vi.fn(), failed: 0 } as unknown as ContentData
  const items = { ivan: byDay(seatItems(rows.ivan, 'ivan', q, NOW)), risedtc: byDay(seatItems(rows.risedtc, 'risedtc', null, NOW)), arch: byDay(seatItems(rows.arch, 'arch', null, NOW)) }
  return { data, items }
}

describe('calendar model', () => {
  const rise = row('rise', { client_id: 'risedtc', status: 'scheduled', scheduled_at: '2026-10-07T14:00:00Z', board_visible: true, taxonomy: { source: 'lead-magnet', lead_magnet_id: 'x' }, image_urls: ['https://x/cover.png'] })
  const ivan = row('ivan', { status: 'scheduled', scheduled_at: '2026-10-06T08:45:00Z' })
  const { data, items } = setup({ ivan: [ivan, row('loose')], risedtc: [rise], arch: [] })
  const rows = { ivan: data.seats.ivan.rows, risedtc: data.seats.risedtc.rows, arch: [] }
  it('"All" merges every seat on its Warsaw day with a real preview and the lead-magnet mark', () => {
    const days = calendarDays(items, rows, 'all', new Map())
    expect(days.get('2026-10-06')!.map(e => e.lane)).toEqual(['ivan'])
    const e = days.get('2026-10-07')![0]
    expect(e).toMatchObject({ lane: 'risedtc', lm: true, thumb: 'https://x/cover.png', hook: 'rise hook line', dot: 'set', refuse: null })
    expect(calendarDays(items, rows, 'arch', new Map()).size).toBe(0)
  })
  it('a dropped post shows on its new day until the re-read agrees', () => {
    const days = calendarDays(items, rows, 'all', new Map([['ivan', '2026-10-09']]))
    expect(days.get('2026-10-06')).toBeUndefined()
    expect(days.get('2026-10-09')![0].it.id).toBe('ivan')
  })
  it('posted and publish-queue-only posts refuse to move, and say why', () => {
    const posted = seatItems([], 'ivan', [queue], NOW)[0]
    expect(refuseOf(posted, null)).toMatch(/Already posted/)
    expect(refuseOf({ ...posted, stage: 'scheduled' }, null)).toMatch(/publish queue/)
  })
  it('the undated rail holds datable drafts only, and an undone date comes back to it', () => {
    expect(looseOf(rows, 'all', new Map()).map(l => l.id)).toEqual(['loose'])
    expect(looseOf(rows, 'all', new Map([['loose', '2026-10-02']]))).toEqual([])
  })
  it('lead-magnet posts are found by the stager tag or ARCH’s label', () => {
    expect(isMagnetPost({ taxonomy: { source: 'lead-magnet' } })).toBe(true)
    expect(isMagnetPost({ taxonomy: null, source_label: 'Original ARCH resource · lead magnet' })).toBe(true)
    expect(isMagnetPost({ taxonomy: { source: 'client-risedtc' }, source_label: 'Call' })).toBe(false)
  })
})

describe('Calendar', () => {
  const props = { now: NOW, setPick: vi.fn(), onOpen: vi.fn(), onMove: vi.fn(), onArm: vi.fn(), onDay: vi.fn(), onChanged: vi.fn() }
  const dragSetup = () => {
    const r = row('Matt was my employee for 12 years', { client_id: 'risedtc', status: 'scheduled', scheduled_at: '2026-09-28T14:00:00Z', board_visible: true })
    const { data, items } = setup({ ivan: [], risedtc: [r], arch: [] })
    renderInFrame(<Calendar {...props} data={data} items={items} phone={false} pick="all" />)
    const card = screen.getByRole('button', { name: 'Open Matt was my employee for 12 years' })
    const start = card.closest('[data-cal-day]')!
    const target = document.querySelector('.cn-cell[data-cal-lane="risedtc"][data-cal-day="2026-09-29"]')!
    return { card, start, target }
  }
  it('dropping on a Lines day heading opens the client confirmation for that day', async () => {
    const { card, start } = dragSetup()
    const heading = [...document.querySelectorAll('.cn-wh')].find(el => el.textContent?.includes('Tue 29'))!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn((x: number) => x >= 200 ? heading : start) })
    pointer(card, 'pointerdown', 100, 100)
    pointer(window, 'pointermove', 200, 20)
    pointer(window, 'pointermove', 201, 20)
    pointer(window, 'pointerup', 201, 20)
    fireEvent.click(card)
    expect(await screen.findByRole('heading', { name: 'Schedule this to post?' })).toBeTruthy()
    expect(screen.getByText(/publisher will post it on Tue 29 Sep at 16:00/)).toBeTruthy()
    expect(writes.setScheduleDateAt).not.toHaveBeenCalled()
  })
  it('a quick drag uses the release position when the first move only lifted the card', async () => {
    const { card, start, target } = dragSetup()
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn((x: number) => x >= 200 ? target : start) })
    pointer(card, 'pointerdown', 100, 100)
    pointer(window, 'pointermove', 110, 100)
    pointer(window, 'pointerup', 200, 100)
    fireEvent.click(card)
    expect(await screen.findByRole('heading', { name: 'Schedule this to post?' })).toBeTruthy()
    expect(screen.getByText(/publisher will post it on Tue 29 Sep at 16:00/)).toBeTruthy()
    expect(writes.setScheduleDateAt).not.toHaveBeenCalled()
  })
  it('opens on today with the posted post, Open post and Unpublish on its card', async () => {
    const { data, items } = setup({ ivan: [], risedtc: [], arch: [] }, [queue])
    renderInFrame(<Calendar {...props} data={data} items={items} phone={false} pick="ivan" />)
    expect(screen.getByRole('group', { name: /Ivan, September 2026/ })).toBeTruthy()
    const agenda = screen.getByRole('region', { name: /Posts on/ })
    expect(agenda.textContent).toContain('Our own post')
    expect(screen.getByRole('link', { name: 'Open post' }).getAttribute('href')).toBe(queue.unipile_share_url)
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }))
    expect(await screen.findByText('Take this post off LinkedIn?')).toBeTruthy()
    expect(writes.unpublishPost).not.toHaveBeenCalled()
    expect(document.querySelector('[data-cal-id="queue"]')!.getAttribute('data-cal-refuse')).toMatch(/Already posted/)
  })
  it('pages months ahead and back, and Today returns', () => {
    const { data, items } = setup({ ivan: [], risedtc: [], arch: [] })
    renderInFrame(<Calendar {...props} data={data} items={items} phone={false} pick="risedtc" />)
    for (const m of ['October', 'November', 'December']) { fireEvent.click(screen.getByRole('button', { name: 'Next month' })); expect(screen.getByRole('group', { name: new RegExp(`${m} 2026`) })).toBeTruthy() }
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('group', { name: /September 2026/ })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByRole('group', { name: /August 2026/ })).toBeTruthy()
  })
  it('on a phone a tap on a day shows that day’s posts big underneath, never opening a post', () => {
    const r = row('later', { status: 'scheduled', scheduled_at: '2026-09-15T08:45:00Z', image_urls: ['https://x/a.png'] })
    const { data, items } = setup({ ivan: [r], risedtc: [], arch: [] })
    renderInFrame(<Calendar {...props} data={data} items={items} phone pick="ivan" />, { layout: 'phone' })
    fireEvent.click(document.querySelector('[data-cal-day="2026-09-15"] [data-cal-id="later"]')!)
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: /Posts on Tue 15 Sep/ }).textContent).toContain('later hook line')
  })
  it('"All" defaults to the lines wall and remembers the view per client', () => {
    const { data, items } = setup({ ivan: [], risedtc: [], arch: [] })
    renderInFrame(<Calendar {...props} data={data} items={items} phone={false} pick="all" />)
    expect(screen.getByRole('group', { name: 'Posts by seat and day' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Month' }))
    expect(localStorage.getItem('d-cal-view-all')).toBe('month')
    fireEvent.click(screen.getByRole('tab', { name: /Rise/ }))
    expect(localStorage.getItem('d-cal-pick')).toBe('risedtc')
    expect(props.setPick).toHaveBeenCalledWith('risedtc')
  })
})

it('renders the Brain mark on an undated review draft on phone and desktop with Open intact', () => {
 const brain = row('brain', { taxonomy: { source: 'content-brain' } })
 const { data, items } = setup({ ivan: [brain], risedtc: [], arch: [] })
 const open = vi.fn()
 for (const phone of [true, false]) {
  const view = renderInFrame(<Calendar data={data} items={items} now={NOW} phone={phone} pick="all" setPick={() => {}} onOpen={open} onMove={() => {}} onArm={() => {}} onDay={() => {}} onChanged={() => {}} />)
  expect(screen.getAllByText('Brain').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /brain hook line/ }))
  expect(open).toHaveBeenCalledWith('brain', 'ivan')
  view.unmount()
 }
})
