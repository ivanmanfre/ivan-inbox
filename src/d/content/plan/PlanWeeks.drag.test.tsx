// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { PlanRead } from '../../../lib/contentPlan'
import ivanFx from './fixtures/ivan.json'
import { itemsOf } from './planBrain'
import { PlanWeeks } from './PlanWeeks'

const writes = vi.hoisted(() => ({ setScheduleDateAt: vi.fn(), moveSlotWeek: vi.fn() }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), setScheduleDateAt: writes.setScheduleDateAt }))
vi.mock('../../../lib/contentPlan', async orig => ({ ...(await orig<typeof import('../../../lib/contentPlan')>()), moveSlotWeek: writes.moveSlotWeek }))

const ivan = () => structuredClone(ivanFx) as unknown as PlanRead
function pointer(target: Element | Window, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
  fireEvent(target, event)
}
const col = (day: string) => document.querySelector<HTMLElement>(`.pl2-dcol[data-day='${day}']`)!
function dragTo(card: Element, target: Element) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn((x: number) => (x >= 200 ? target : card)) })
  pointer(card, 'pointerdown', 100, 100)
  pointer(window, 'pointermove', 110, 100)
  pointer(window, 'pointerup', 200, 100)
}
function show(read: PlanRead, onChanged = vi.fn(), onOpen = vi.fn()) {
  renderInFrame(<PlanWeeks read={read} items={itemsOf(read)} today={read.today} onOpen={onOpen} onChanged={onChanged} />, { layout: 'desktop' })
  return { onChanged, onOpen }
}
beforeEach(() => {
  writes.setScheduleDateAt.mockReset().mockImplementation(async (_id: string, when: string) => when)
  writes.moveSlotWeek.mockReset().mockImplementation(async (_id: string, week: string) => ({ from_week: '2026-10-26', to_week: week }))
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
afterEach(() => cleanup())

describe('PlanWeeks drag', () => {
  it('only today and later days take a drop; a published card refuses', () => {
    const r = ivan(); r.today = '2026-10-14'
    show(r)
    expect(col('2026-10-12').hasAttribute('data-cal-day')).toBe(false)
    expect(col('2026-10-14').getAttribute('data-cal-day')).toBe('2026-10-14')
    expect(col('2026-10-20').getAttribute('data-cal-day')).toBe('2026-10-20')
    expect(col('2026-10-12').querySelector('.pl2-card')!.getAttribute('data-cal-refuse')).toMatch(/Already published/)
  })
  it('dropping a post on another day moves it there at its own time, re-reads, and offers Undo', async () => {
    const { onChanged, onOpen } = show(ivan())
    const card = col('2026-10-14').querySelector('.pl2-card')!
    dragTo(card, col('2026-10-20'))
    fireEvent.click(card)
    expect(onOpen).not.toHaveBeenCalled()
    await waitFor(() => expect(writes.setScheduleDateAt).toHaveBeenCalledWith(expect.any(String), '2026-10-20T08:45:00.000Z'))
    expect(await screen.findByText('Moved to Tue 20 Oct · 10:45 Warsaw.')).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
    // The engine swallows clicks for 400ms after a drop (the release click); a real Undo tap comes later.
    await new Promise(r => setTimeout(r, 450))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(writes.setScheduleDateAt).toHaveBeenLastCalledWith(expect.any(String), '2026-10-14T08:45:00+00:00'))
  })
  it('a failed write puts the card back and says nothing changed', async () => {
    writes.setScheduleDateAt.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'past_date' }))
    show(ivan())
    const card = col('2026-10-14').querySelector('.pl2-card')!
    dragTo(card, col('2026-10-20'))
    expect(await screen.findByText('That time has already passed. Nothing changed.')).toBeTruthy()
    await waitFor(() => expect(col('2026-10-14').querySelector('.pl2-card')).not.toBeNull())
  })
  it('a planned slot dropped in another week moves to that week', async () => {
    show(ivan())
    const card = col('2026-10-26').querySelector('.pl2-card')!
    dragTo(card, col('2026-10-21'))
    await waitFor(() => expect(writes.moveSlotWeek).toHaveBeenCalledWith(expect.any(String), '2026-10-19'))
    expect(await screen.findByText('Moved to the week of 19 Oct.')).toBeTruthy()
  })
})
