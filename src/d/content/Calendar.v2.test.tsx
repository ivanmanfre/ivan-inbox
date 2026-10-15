// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { Calendar } from './Calendar'
import { byDay, seatItems } from './planModel'
import { ClientRpcError, clientRpcMessage, type ContentDraft } from '../../lib/content'
import { clearBoardState, setBoardState } from '../../lib/clientBoardState'
import { postTagsOf } from './calTags'
import { MISSED_DROP, plainWhy } from './calWhy'
import type { ContentData, SeatRead } from './useContentData'
import type { Lane } from './model'

// The 2026-10-15 calendar pass: a refused or missed drop says why, client posts carry "On board",
// every card and buffer tile shows its format and strategy, and a dated card can lose its date.

const writes = vi.hoisted(() => ({ unpublishPost: vi.fn(), setScheduleDateAt: vi.fn(), clearScheduleDate: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...writes }))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'select', 'in', 'order', 'limit', 'eq']) chain[k] = () => chain
  chain.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f)
  return { supabase: chain }
})
beforeEach(() => { window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); localStorage.clear(); clearBoardState('risedtc') })

function pointer(target: Element | Window, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
  fireEvent(target, event)
}

const NOW = Date.parse('2026-10-15T10:00:00Z')
const row = (id: string, extra: Partial<ContentDraft> = {}) => ({ id, client_id: null, status: 'review', type: 'text', title: id, post_body: `${id} hook line\nbody`, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z', scheduled_at: null, published_at: null, board_visible: false, image_urls: null, taxonomy: null, funnel_stage: null, ...extra } as ContentDraft)
const seat = (rows: ContentDraft[]): SeatRead => ({ rows, loading: false, error: null, loadedAt: '2026-10-15T10:00:00Z', refresh: vi.fn() })
function setup(rows: Partial<Record<Lane, ContentDraft[]>>) {
  const r = { ivan: [], risedtc: [], arch: [], swishdm: [], ...rows } as Record<Lane, ContentDraft[]>
  const data = { seats: { ivan: seat(r.ivan), risedtc: seat(r.risedtc), arch: seat(r.arch), swishdm: seat(r.swishdm) }, armed: null, armedFailed: false, verdict: null, blocks: null, queueRows: [], refreshAll: vi.fn(), failed: 0 } as unknown as ContentData
  const items = { ivan: byDay(seatItems(r.ivan, 'ivan', [], NOW)), risedtc: byDay(seatItems(r.risedtc, 'risedtc', null, NOW)), arch: byDay(seatItems(r.arch, 'arch', null, NOW)), swishdm: byDay(seatItems(r.swishdm, 'swishdm', null, NOW)) }
  return { data, items }
}
const props = { now: NOW, setPick: vi.fn(), onOpen: vi.fn(), onMove: vi.fn(), onArm: vi.fn(), onDay: vi.fn(), onChanged: vi.fn(), v2: true, wide: true }

describe('drop refusals say why', () => {
  const mine = row('mine', { status: 'scheduled', scheduled_at: '2026-10-20T07:00:00Z' })
  const drag = (to: string | null) => {
    const { data, items } = setup({ ivan: [mine] })
    renderInFrame(<Calendar {...props} data={data} items={items} phone={false} pick="ivan" />)
    const card = document.querySelector('.cv2-mc[data-cal-id="mine"]')!
    const start = card.closest('[data-cal-day]')!
    const target = to ? document.querySelector(`.cal-day[data-cal-day="${to}"]`)! : document.querySelector('.cv2-cov')!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn((x: number) => (x >= 200 ? target : start)) })
    pointer(card, 'pointerdown', 100, 100)
    pointer(window, 'pointermove', 110, 100)
    pointer(window, 'pointermove', 220, 100)
    pointer(window, 'pointerup', 220, 100)
    fireEvent.click(card) // the browser's click after a drag (the engine swallows it)
  }
  it('a refusal from the database shows in plain words, and the post stays where it was', async () => {
    writes.setScheduleDateAt.mockRejectedValue(new ClientRpcError('past_date', clientRpcMessage('past_date')))
    drag('2026-10-22')
    expect(await screen.findByText('Not moved to Thu 22 Oct.')).toBeTruthy()
    expect(screen.getByText(/That time has already passed\. Pick a later one\. Nothing changed\./)).toBeTruthy()
    expect(writes.setScheduleDateAt).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.cal-day[data-cal-day="2026-10-20"] [data-cal-id="mine"]')).toBeTruthy()
  })
  it('a dropped connection is said as such, never "TypeError: Failed to fetch"', async () => {
    writes.setScheduleDateAt.mockRejectedValue(new TypeError('Failed to fetch'))
    drag('2026-10-22')
    expect(await screen.findByText(/Could not reach the database, so nothing changed/)).toBeTruthy()
  })
  it('letting go where no day is says so instead of doing nothing', async () => {
    drag(null)
    expect(await screen.findByText(MISSED_DROP)).toBeTruthy()
    expect(writes.setScheduleDateAt).not.toHaveBeenCalled()
  })
})

describe('the On board tag and the post tags', () => {
  const onBoard = row('beach', { client_id: 'risedtc', status: 'review', board_visible: true, funnel_stage: 'trust', taxonomy: { pillar: 'case_study' } })
  const internal = row('cookie', { client_id: 'risedtc', status: 'review', board_visible: false, type: 'single_image', funnel_stage: 'reach' })
  const dated = row('supp', { client_id: 'risedtc', status: 'scheduled', board_visible: true, scheduled_at: '2026-10-16T14:00:00Z', type: 'carousel', funnel_stage: 'buyers', taxonomy: { pillar: 'teardown' } })
  it('a client post on the board says "On board" on its card and buffer tile; one that is not has no tag', () => {
    const { data, items } = setup({ risedtc: [onBoard, internal, dated] })
    renderInFrame(<Calendar {...props} data={data} items={items} phone={false} pick="risedtc" />)
    const card = document.querySelector<HTMLElement>('.cv2-mc[data-cal-id="supp"]')!
    expect(within(card).getByText('On board')).toBeTruthy()
    expect(within(card).getByText('Carousel')).toBeTruthy()
    expect(within(card).getByText('Buyers')).toBeTruthy()
    expect(within(card).getByText('Teardown')).toBeTruthy()
    const tile = document.querySelector<HTMLElement>('.cv2-tile[data-cal-id="beach"]')!
    expect(within(tile).getByText('On board')).toBeTruthy()
    expect(within(tile).getByText('Text')).toBeTruthy()
    expect(within(tile).getByTitle('Aim: Trust').textContent).toMatch(/Trust/)
    expect(within(tile).getByText('Case study')).toBeTruthy()
    const other = document.querySelector<HTMLElement>('.cv2-tile[data-cal-id="cookie"]')!
    expect(within(other).queryByText('On board')).toBeNull()
    expect(within(other).getByText('Image')).toBeTruthy()
  })
  it('a post the client took off his panel says so instead of On board; Ivan’s lane never has a board tag', () => {
    setBoardState('risedtc', [{ id: 'beach', approval: null, approval_at: null, veto: 'post_removed', veto_at: '2026-10-14T10:00:00Z', note: null, note_by: null, note_at: null }])
    expect(postTagsOf(onBoard, 'risedtc')).toMatchObject({ board: 'removed', boardWord: 'Removed by Mattan' })
    expect(postTagsOf(dated, 'risedtc')).toMatchObject({ board: 'on', boardWord: 'On board', format: 'Carousel', aim: 'Buyers', pillar: 'Teardown' })
    expect(postTagsOf({ ...dated, funnel_stage: 'reach', taxonomy: { pillar: 'reach' } } as typeof dated, 'risedtc')).toMatchObject({ aim: 'Reach', pillar: null })
    expect(postTagsOf(row('ivan-one', { board_visible: true }), 'ivan')?.board).toBeNull()
  })
  it('a dated card offers Remove date in its ⋯ menu and next to it, with Undo on the receipt', async () => {
    writes.clearScheduleDate.mockResolvedValue(undefined)
    const { data, items } = setup({ risedtc: [dated] })
    renderInFrame(<Calendar {...props} data={data} items={items} phone={false} pick="risedtc" />)
    fireEvent.click(document.querySelector('.cv2-mc[data-cal-id="supp"] [data-verb="card-more"]')!)
    const menu = [...document.querySelectorAll<HTMLElement>('.cv2-menu')].find(m => !m.hidden)!
    expect(within(menu).getByRole('menuitem', { name: 'Change date or time' })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove date' }))
    expect(await screen.findByText('Date removed.')).toBeTruthy()
    expect(writes.clearScheduleDate).toHaveBeenCalledWith('supp')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })
})

describe('plainWhy', () => {
  it('keeps the database’s own words, and words the rest', () => {
    expect(plainWhy(new ClientRpcError('bad_status', clientRpcMessage('bad_status')))).toMatch(/^Only a draft at Needs review or Scheduled/)
    expect(plainWhy(new Error('This post needs Mattan’s OK before it can get a date: its idea is flagged for him. Nothing changed.'))).toMatch(/needs Mattan’s OK/)
    expect(plainWhy(new Error('JWT expired'))).toMatch(/sign-in ran out/)
    expect(plainWhy(new Error('some_raw_code'))).toBe('The database refused it (some_raw_code), so nothing changed.')
  })
})
