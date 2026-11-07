// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { PlanRead, PlanWeek } from '../../../lib/contentPlan'
import type { ArchFillOffer, ArchFillRead, ArchFillWeek } from '../../../lib/archFill'
import { itemsOf } from './planBrain'
import { PlanWeeks, type ArchFillMeter } from './PlanWeeks'
import { fillPairs, heldWhy } from './archFill'

// ARCH "FILL NEXT WEEK" (review 2026-11-06 #25). Only repurposed posts that pass the 0.40 overlap check (the
// database decides which, arch_fill_read) go into next week's open weekdays at ARCH's own time; one key, nothing
// written before the tap. Ivan 27 Oct: everything else waits for Davorin.
const offer = (id: string, overlap = 0.27, title = `Post ${id}`): ArchFillOffer => ({ id, title, post_body: 'Body.', body_sha256: `sha-${id}`, overlap, original_title: 'Orig', original_at: '2026-09-16T09:20:00Z' })
const week = (o: Partial<PlanWeek> = {}): PlanWeek => ({ start: '2026-11-09', which: 'next', target: 3, filled: 0, open: 3, posts: [], planned: [], dated: 0, ...o })
const fw = (o: Partial<ArchFillWeek> = {}): ArchFillWeek => ({ start: '2026-11-09', end: '2026-11-13', target: 3, dated: 0, ...o })
const NOW = Date.parse('2026-11-07T12:00:00Z')
const fill = (o: Partial<Parameters<typeof fillPairs>[0]> = {}) => fillPairs({ offered: [offer('a'), offer('b'), offer('c')], week: fw(), busy: [], slotHm: '09:00', tz: 'Europe/Zagreb', now: NOW, ...o })

describe('fillPairs', () => {
  it('fills the week short of its target at 09:00 Zagreb, two days apart, oldest offer first', () => {
    const p = fill()
    expect(p.map(x => [x.offer.id, x.day, x.at])).toEqual([
      ['a', '2026-11-09', '2026-11-09T08:00:00.000Z'],
      ['b', '2026-11-11', '2026-11-11T08:00:00.000Z'],
      ['c', '2026-11-13', '2026-11-13T08:00:00.000Z'],
    ])
  })
  it('offers nothing when no repurposed post qualifies, or the week is already at target', () => {
    expect(fill({ offered: [] })).toEqual([])
    expect(fill({ week: fw({ dated: 3 }) })).toEqual([])
  })
  it('takes only as many as the week is short, and keeps 24 h and the day from posts already dated', () => {
    const p = fill({ week: fw({ dated: 1 }), busy: ['2026-11-09T08:00:00Z'] })
    expect(p.map(x => x.day)).toEqual(['2026-11-10', '2026-11-12'])
    // Mon and Wed taken: Tue, Thu and Fri are left; Tue and Thu two days apart, then Fri one day after Thu.
    const q = fill({ busy: ['2026-11-09T08:00:00Z', '2026-11-11T08:00:00Z'] })
    expect(q.map(x => x.day)).toEqual(['2026-11-10', '2026-11-12', '2026-11-13'])
  })
  it('falls back to one day apart when two-day spacing cannot fit them', () => {
    const p = fillPairs({ offered: [offer('a'), offer('b')], week: fw(), busy: ['2026-11-09T08:00:00Z', '2026-11-10T08:00:00Z', '2026-11-11T08:00:00Z'], slotHm: '09:00', tz: 'Europe/Zagreb', now: NOW })
    expect(p.map(x => x.day)).toEqual(['2026-11-12', '2026-11-13'])
  })
  it('never offers a slot that is already past or too soon', () => {
    const p = fill({ now: Date.parse('2026-11-11T07:50:00Z') })
    expect(p.map(x => x.day)).toEqual(['2026-11-12', '2026-11-13'])
  })
  it('says why a repurposed draft is held', () => {
    expect(heldWhy('overlap', 0.42)).toBe('too close to the original (0.42 overlap, limit 0.40)')
    expect(heldWhy('removed_by_davorin', null)).toBe('Davorin took it off his board')
  })
})

const read = (): PlanRead => ({
  account: 'arch', today: '2026-11-07', target: 3, target_week: null, open: 3, state: 'planning', proposals_only: false, founder_story_max: 2, cadence_source: '',
  tz: { name: 'Europe/Warsaw', label: 'Warsaw' },
  weeks: [
    { start: '2026-11-02', which: 'this', target: 3, filled: 1, open: 0, posts: [{ draft_id: 'p0', day: '2026-11-03', at: '2026-11-03T08:05:00Z', title: 'One launch day', status: 'published', format: 'carousel' }], planned: [], dated: 1 },
    week(),
    { start: '2026-11-16', which: 'after', target: 3, filled: 0, open: 3, posts: [], planned: [] },
  ],
  done: [], warnings: [], last_run: null, brain_strip: { rules: [] } as unknown as PlanRead['brain_strip'],
} as unknown as PlanRead)
const fr = (o: Partial<ArchFillRead> = {}): ArchFillRead => ({ tz: 'Europe/Zagreb', slot_hm: '09:00', limit: 0.4, week: fw(), offered: [], held: [], waiting_davorin: 9, ...o })

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
afterEach(() => cleanup())

describe('PlanWeeks with the fill key', () => {
  const show = (m: ArchFillMeter) => { const rd = read(); renderInFrame(<PlanWeeks read={rd} items={itemsOf(rd)} today={rd.today} onOpen={() => {}} archFill={m} />) }
  const next = () => document.querySelectorAll<HTMLElement>('.pl2-wk')[1]

  it('shows which repurposed post goes to which slot, and one key that fills them', () => {
    const onFill = vi.fn()
    const offered = [offer('r1', 0.27, 'I don’t approve a pitch on follower count'), offer('r2', 0.1, 'A promo code needs a reason')]
    const pairs = fillPairs({ offered, week: fw(), busy: [], slotHm: '09:00', tz: 'Europe/Zagreb', now: NOW })
    show({ read: fr({ offered }), failed: false, week: '2026-11-09', pairs, busy: false, onFill })
    const w = next()
    const cards = [...w.querySelectorAll<HTMLElement>('.pl2-fill-gap')]
    expect(cards.map(c => [c.dataset.fillDraft, c.closest<HTMLElement>('.pl2-dcol')!.dataset.day])).toEqual([['r1', '2026-11-09'], ['r2', '2026-11-11']])
    expect(cards[0].textContent).toContain('Repurposed · 09:00 · 0.27 overlap')
    expect(cards[0].textContent).toMatch(/From his 16 Sept? post/)
    expect(w.querySelector('.pl2-fill')!.textContent).toContain('2 repurposed posts can fill this week without Davorin. 9 other drafts wait for Davorin.')
    // only next week carries the strip
    expect(document.querySelectorAll('.pl2-fill').length).toBe(1)
    fireEvent.click(w.querySelector('[data-verb="plan-arch-fill"]')!)
    expect(onFill).toHaveBeenCalledTimes(1)
  })
  it('with nothing that qualifies, says so and shows no key; held reworks say why', () => {
    show({ read: fr({ held: [{ id: 'h1', title: 'Creator lists', reason: 'overlap', overlap: 0.42 }] }), failed: false, week: '2026-11-09', pairs: [], busy: false, onFill: () => {} })
    const s = next().querySelector('.pl2-fill')!
    expect(s.textContent).toContain('Nothing to fill without Davorin: no repurposed post is waiting. 9 other drafts wait for Davorin.')
    expect(s.textContent).toContain('Held: Creator lists, too close to the original (0.42 overlap, limit 0.40).')
    expect(s.querySelector('[data-verb="plan-arch-fill"]')).toBeNull()
    expect(next().querySelector('.pl2-fill-gap')).toBeNull()
  })
  it('a held tap disables the key', () => {
    const pairs = fillPairs({ offered: [offer('r1')], week: fw(), busy: [], slotHm: '09:00', tz: 'Europe/Zagreb', now: NOW })
    show({ read: fr({ offered: [offer('r1')] }), failed: false, week: '2026-11-09', pairs, busy: true, onFill: () => {} })
    const k = next().querySelector<HTMLButtonElement>('[data-verb="plan-arch-fill"]')!
    expect(k.disabled).toBe(true)
    expect(k.textContent).toBe('Filling…')
  })
})
