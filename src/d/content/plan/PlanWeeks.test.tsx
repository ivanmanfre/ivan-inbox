// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { PlanRead } from '../../../lib/contentPlan'
import riseFull from './fixtures/risedtc.json'
import ivanFx from './fixtures/ivan.json'
import archFx from './fixtures/arch.json'
import { itemsOf, mixLine, reasonFor, resultLine, type PlanItem } from './planBrain'
import { PlanWeeks } from './PlanWeeks'

const rise = () => structuredClone(riseFull) as unknown as PlanRead
const ivan = () => structuredClone(ivanFx) as unknown as PlanRead
const arch = () => structuredClone(archFx) as unknown as PlanRead
const emptyRead = (): PlanRead => ({
  account: 'arch', today: '2026-10-12', target: 3, target_week: null, open: 0, state: 'planning', proposals_only: false, founder_story_max: 1, cadence_source: '',
  weeks: [
    { start: '2026-10-12', which: 'this', target: 3, filled: 0, open: 3, posts: [], planned: [] },
    { start: '2026-10-19', which: 'next', target: 3, filled: 0, open: 3, posts: [], planned: [] },
    { start: '2026-10-26', which: 'after', target: 3, filled: 0, open: 3, posts: [], planned: [] },
  ],
  done: [], warnings: [], last_run: null, brain_strip: { rules: [] } as unknown as PlanRead['brain_strip'],
})

let hoverable = true
const realMatchMedia = window.matchMedia
beforeEach(() => {
  hoverable = true
  window.matchMedia = ((q: string) => ({ matches: q.includes('hover: hover') ? hoverable : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
afterEach(() => { cleanup(); vi.useRealTimers(); window.matchMedia = realMatchMedia })

function show(read: PlanRead, onOpen: (it: PlanItem) => void = () => {}, layout: 'desktop' | 'phone' = 'desktop') {
  const items = itemsOf(read)
  renderInFrame(<PlanWeeks read={read} items={items} today={read.today} onOpen={onOpen} />, { layout })
  return items
}
const STORE = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1'
const weeks = () => [...document.querySelectorAll<HTMLElement>('.pl2-wk')]
const col = (day: string) => document.querySelector<HTMLElement>(`.pl2-dcol[data-day='${day}']`)!
const card = (title: RegExp) => screen.getAllByText(title)[0].closest<HTMLButtonElement>('.pl2-card')!

describe('PlanWeeks', () => {
  it('three week rows: name, range, meter n of target, the week mix', () => {
    const items = show(rise())
    const w = weeks()
    expect(w.length).toBe(3)
    expect(w.map(x => x.querySelector('.pl2-wk-h b')!.textContent)).toEqual(['This week', 'Next week', 'Week after'])
    expect(w[0].querySelector('.pl2-wk-range')!.textContent).toBe('12 Oct to 16 Oct')
    expect(w[0].querySelector('.pl2-wk-n')!.textContent).toBe('5 of 5')
    expect(w[0].querySelectorAll('.pl2-meter i').length).toBe(5)
    expect(w[0].querySelectorAll('.pl2-meter i.pl2-on').length).toBe(5)
    const mix = mixLine(items.filter(i => i.week === '2026-10-12'))
    expect(mix).not.toBe('')
    expect(w[0].querySelector('.pl2-wk-mix')!.textContent).toBe(mix)
  })

  it('a Saturday post adds a sixth column in its week only', () => {
    show(ivan())
    const [a, b, c] = weeks()
    expect(a.querySelectorAll('.pl2-dcol').length).toBe(6)
    expect(a.querySelector('.pl2-wk-range')!.textContent).toBe('12 Oct to 17 Oct')
    expect(b.querySelectorAll('.pl2-dcol').length).toBe(5)
    expect(c.querySelectorAll('.pl2-dcol').length).toBe(5)
    expect(col('2026-10-17').textContent).toContain('Sat')
  })

  it('today reads Today; past days get the past class', () => {
    const r = rise()
    r.today = '2026-10-14'
    show(r)
    const t = col('2026-10-14')
    expect(t.classList.contains('pl2-today')).toBe(true)
    expect(t.querySelector('.pl2-dh')!.textContent).toContain('Today')
    expect(col('2026-10-12').classList.contains('pl2-past')).toBe(true)
    expect(col('2026-10-13').classList.contains('pl2-past')).toBe(true)
    expect(col('2026-10-15').classList.contains('pl2-past')).toBe(false)
    expect(document.querySelectorAll('.pl2-today').length).toBe(1)
  })

  it('free wells only up to week.open, on future weekdays, never on past days or weekends', () => {
    show(emptyRead())
    const [a, b] = weeks()
    // This week: today (12th) is not a future day, so 13, 14, 15 get the 3 open wells.
    expect([...a.querySelectorAll('.pl2-free')].map(f => f.closest<HTMLElement>('.pl2-dcol')!.dataset.day)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15'])
    expect(b.querySelectorAll('.pl2-free').length).toBe(3)
    expect(a.querySelector('.pl2-free')!.textContent).toBe('Free')
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/)
    cleanup()
    show(arch())
    // Arch: week one and two are full (open 0), the week after has 1 open day.
    const w = weeks()
    expect(w[0].querySelectorAll('.pl2-free').length).toBe(0)
    expect(w[1].querySelectorAll('.pl2-free').length).toBe(0)
    expect(w[2].querySelectorAll('.pl2-free').length).toBe(1)
  })

  it('a planned slot card is dashed and says Suggested day', () => {
    show(rise())
    const c = card(/If a channel can't grow/)
    expect(c.classList.contains('pl2-sugg')).toBe(true)
    expect(c.querySelector('.pl2-st')!.textContent).toBe('Waiting for your OK')
    expect(c.querySelector('.pl2-time')!.textContent).toBe('Suggested day')
    expect(c.closest<HTMLElement>('.pl2-dcol')!.dataset.day).toBe('2026-10-23')
    const dated = card(/Elemental Air/)
    expect(dated.classList.contains('pl2-sugg')).toBe(false)
  })

  it('card face: status, time with zone, thumbnail, 3-line title, reason only without a thumbnail, exception flags only', () => {
    const items = show(rise())
    const withThumb = card(/Elemental Air/)
    expect(withThumb.querySelector('.pl2-st')!.textContent).toBe('Scheduled')
    expect(withThumb.querySelector('.pl2-time')!.textContent).toBe('07:00 PT')
    expect(withThumb.querySelector('img.pl2-thumb')).not.toBeNull()
    expect(withThumb.querySelector('.pl2-ct')).not.toBeNull()
    expect(withThumb.querySelector('.pl2-why1')).toBeNull()
    const plain = card(/What does storage cost/)
    expect(plain.querySelector('img')).toBeNull()
    const it = items.find(i => /What does storage cost/.test(i.title))!
    expect(plain.querySelector('.pl2-why1')!.textContent).toBe(reasonFor(it, 'risedtc'))
    // Low score on a scheduled Rise post is an exception; nothing else is.
    expect([...plain.querySelectorAll('[data-flag]')].map(f => f.getAttribute('data-flag'))).toEqual(['low'])
    expect(document.body.textContent).not.toMatch(/Check passed|Passed:/)
    expect(document.querySelector('.pl2-wks')!.textContent).not.toContain('—')
  })

  it('X mark on a day header when the day is in x_days', () => {
    const r = rise()
    r.x_days = ['2026-10-14']
    show(r)
    const x = col('2026-10-14').querySelector('.pl2-x')!
    expect(x.getAttribute('role')).toBe('img')
    expect(x.getAttribute('aria-label')).toBe('An X post goes out this day')
    expect(col('2026-10-15').querySelector('.pl2-x')).toBeNull()
  })

  it('a post still waiting from before its week sits at the top of today, marked Waiting since; the meters follow', () => {
    const r = rise()
    r.weeks[1].planned[0].day = '2026-10-09'
    show(r)
    const top = col('2026-10-12').querySelector('.pl2-cards')!.firstElementChild!
    expect(top.classList.contains('pl2-card-late')).toBe(true)
    expect(top.textContent).toContain('Waiting since Fri 9 Oct')
    expect(top.textContent).toContain("If a channel can't grow")
    expect(top.textContent).not.toContain('Suggested day')
    expect(screen.getAllByText(/If a channel can't grow/).length).toBe(1)
    // The meter and n count what each row draws: the moved post counts in this week, not in next week.
    const [a, b] = weeks()
    expect(a.querySelector('.pl2-wk-n')!.textContent).toBe('6 posts, plan says 5')
    expect(a.querySelectorAll('.pl2-meter i.pl2-on').length).toBe(6)
    expect(b.querySelector('.pl2-wk-n')!.textContent).toBe('4 of 5')
    expect(b.querySelectorAll('.pl2-dcol .pl2-card').length).toBe(4)
  })

  it('a post waiting since an earlier day of this week leaves its past column and sits at the top of today', () => {
    const r = rise()
    r.today = '2026-10-14'
    r.weeks[0].posts[0].status = 'review' // Mon 12 Oct
    show(r)
    expect(col('2026-10-12').querySelector('.pl2-card')).toBeNull()
    const top = col('2026-10-14').querySelector('.pl2-cards')!.firstElementChild!
    expect(top.classList.contains('pl2-card-late')).toBe(true)
    expect(top.textContent).toContain('Waiting since Mon 12 Oct')
    expect(top.textContent).toContain('I wish we got a piece of that')
    expect(screen.getAllByText(/I wish we got a piece of that/).length).toBe(1)
    expect(weeks()[0].querySelector('.pl2-wk-n')!.textContent).toBe('5 of 5')
  })

  it('a slot with no day at all is still shown, under No day yet in its week', () => {
    const r = rise()
    r.weeks[2].planned[0].day = null
    show(r)
    const nd = weeks()[2].querySelector('.pl2-wk-nd')!
    expect(nd.textContent).toContain('No day yet')
    expect(nd.textContent).toContain('Your Google Shopping feed')
  })

  it('hover opens after 500 ms with the R2.3 contents in order; opening the panel closes it', () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    show(rise(), onOpen)
    const c = card(/Your Google Shopping feed/)
    fireEvent.pointerOver(c)
    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    const tip = screen.getByRole('tooltip')
    expect(c.getAttribute('aria-describedby')).toBe(tip.id)
    const text = tip.textContent!
    const order = ['Waiting for your OK', 'No day yet', 'Your Google Shopping feed', 'Why this post', 'Why it should do well', 'Quality check']
    const at = order.map(s => text.indexOf(s))
    expect(at.every(n => n >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(tip.querySelector('q')).not.toBeNull()
    fireEvent.click(c)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(c.hasAttribute('aria-describedby')).toBe(false)
  })

  it('a published post shows its result; a boosted lead magnet with a link says the link is allowed', () => {
    vi.useFakeTimers()
    const r = rise()
    const items = show(r)
    fireEvent.pointerOver(card(/I wish we got a piece/))
    act(() => { vi.advanceTimersByTime(500) })
    const pub = items.find(i => i.st === 'published')!
    expect(screen.getByRole('tooltip').textContent).toContain(resultLine(pub, r.brain_strip)!)
    cleanup()
    show(ivan())
    fireEvent.pointerOver(card(/Target companies matching/))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip').textContent).toContain('Link allowed: boosted lead magnet.')
  })

  it('keyboard focus opens it too', () => {
    vi.useFakeTimers()
    show(rise())
    fireEvent.focus(card(/Elemental Air/))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip').textContent).toContain('Elemental Air')
  })

  it('no hover card without a hovering pointer', () => {
    vi.useFakeTimers()
    hoverable = false
    show(rise())
    fireEvent.pointerOver(card(/Elemental Air/))
    fireEvent.focus(card(/Elemental Air/))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('thumbnails ask storage for a resized copy; on error the original once, then the reason line', () => {
    const r = rise()
    const p = r.weeks[0].posts[1] // Elemental Air
    p.brain!.thumb = `${STORE}/object/public/client-photos/risedtc-com/x.png`
    const items = show(r)
    const c = card(/Elemental Air/)
    const img = () => c.querySelector<HTMLImageElement>('img.pl2-thumb')
    expect(img()!.getAttribute('src')).toBe(`${STORE}/render/image/public/client-photos/risedtc-com/x.png?width=360&height=144&resize=cover`)
    fireEvent.error(img()!)
    expect(img()!.getAttribute('src')).toBe(`${STORE}/object/public/client-photos/risedtc-com/x.png`)
    expect(c.querySelector('.pl2-why1')).toBeNull()
    fireEvent.error(img()!)
    expect(img()).toBeNull()
    const it = items.find(i => /Elemental Air/.test(i.title))!
    const reason = reasonFor(it, 'risedtc')
    if (reason) expect(c.querySelector('.pl2-why1')!.textContent).toBe(reason)
  })

  it('Escape closes a hover card opened by the mouse, wherever focus is', () => {
    vi.useFakeTimers()
    show(rise())
    fireEvent.pointerOver(card(/Elemental Air/))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('no hover card while the panel is open, and none on the focus that returns after, until the pointer moves', () => {
    vi.useFakeTimers()
    const r = rise()
    const items = itemsOf(r)
    const ui = (hover: boolean) => <PlanWeeks read={r} items={items} today={r.today} onOpen={() => {}} hover={hover} />
    const v = renderInFrame(ui(false))
    fireEvent.pointerOver(card(/Elemental Air/))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    v.rerender(ui(true))
    v.rerender(ui(false))
    v.rerender(ui(true))
    fireEvent.focus(card(/Elemental Air/))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerMove(window)
    fireEvent.pointerOver(card(/What does storage cost/))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip').textContent).toContain('What does storage cost')
  })

  it('a card click opens the panel item', () => {
    const onOpen = vi.fn()
    const items = show(rise(), onOpen)
    fireEvent.click(card(/Elemental Air/))
    expect(onOpen).toHaveBeenCalledWith(items.find(i => /Elemental Air/.test(i.title)))
  })
})
