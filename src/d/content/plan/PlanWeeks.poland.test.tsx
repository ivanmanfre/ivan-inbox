// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { PlanRead } from '../../../lib/contentPlan'
import type { ContentDraft } from '../../../lib/content'
import type { PolandRead } from '../../../lib/poland'
import { itemsOf } from './planBrain'
import { PlanWeeks, type PolandMeter } from './PlanWeeks'
import { mixWords, polandPicks, weekMix } from './poland'

// THE POLAND METER (review 2026-11-06 #31): "Poland 2/2 · Business 2/3" per week, and a short week's free day holds
// the best waiting Poland draft as a dashed card with one key. Poland comes from the reasoned read, never keywords.
const post = (id: string, day: string, title: string, hm = '06:00') => ({ draft_id: id, day, at: `${day}T${hm}:00Z`, title, status: 'scheduled', format: 'text' })
const read = (tueAt = '06:00'): PlanRead => ({
  account: 'ivan', today: '2026-10-12', target: 5, target_week: null, open: 0, state: 'planning', proposals_only: false, founder_story_max: 3, cadence_source: '',
  weeks: [
    { start: '2026-10-12', which: 'this', target: 5, filled: 2, open: 3, posts: [post('b1', '2026-10-12', 'Outreach limits'), post('b2', '2026-10-13', 'Follow-ups', tueAt)], planned: [] },
    { start: '2026-10-19', which: 'next', target: 5, filled: 5, open: 0, posts: [post('p1', '2026-10-19', 'Warsaw riots'), post('p2', '2026-10-20', 'Train tickets'), post('b3', '2026-10-21', 'Leads'), post('b4', '2026-10-22', 'Panels'), post('u1', '2026-10-23', 'Brand new')], planned: [] },
    { start: '2026-10-26', which: 'after', target: 5, filled: 0, open: 0, posts: [], planned: [] },
  ],
  done: [], warnings: [], last_run: null, brain_strip: { rules: [] } as unknown as PlanRead['brain_strip'],
} as unknown as PlanRead)
const r = (o: Partial<ContentDraft>): ContentDraft => ({ id: 'x', client_id: null, status: 'review', type: 'text', title: 'Draft', post_body: 'Body.', scheduled_at: null, published_at: null, created_at: '2026-10-10T10:00:00Z', taxonomy: null, ...o } as ContentDraft)
const reads = new Map<string, PolandRead>([
  ...['b1', 'b2', 'b3', 'b4'].map(id => [id, { poland: false, source: 'read', why: null }] as const),
  ...['p1', 'p2', 'w1', 'w2', 'polemic'].map(id => [id, { poland: true, source: 'read', why: null }] as const),
  ['biz', { poland: false, source: 'brain_check', why: null }],
])
const NOW = Date.parse('2026-10-12T08:00:00Z')

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
afterEach(() => cleanup())

describe('the Poland split', () => {
  it('counts Poland and business per week from the reads; an unread post is said, never guessed', () => {
    const items = itemsOf(read())
    const m = weekMix(items.filter(i => i.week === '2026-10-19'), reads, 5)
    expect(m).toEqual({ poland: 2, business: 2, unread: 1, businessTarget: 3 })
    expect(mixWords(m)).toBe('Poland 2/2 · Business 2/3 · 1 not read yet')
  })
  it('picks only undated Poland drafts in review, off the plan, fresh first then the source lift; polemic takes stay in', () => {
    const rows = [
      r({ id: 'w1', created_at: '2026-10-11T10:00:00Z', source_label: 'X outlier by @a (tracked account; 50 likes vs own median 10)' }),
      r({ id: 'polemic', title: 'The EU is trying to crush Poland', created_at: '2026-10-09T10:00:00Z', source_label: 'X outlier by @b (tracked account; 900 likes vs own median 10)' }),
      r({ id: 'w2', created_at: '2026-09-01T10:00:00Z', source_label: 'X outlier by @c (tracked account; 5000 likes vs own median 10)' }),
      r({ id: 'biz' }),
      r({ id: 'p1' }),
      r({ id: 'held', qa_verdict: 'QA_HELD' }),
    ]
    expect(polandPicks(rows, reads, new Set(['p1']), NOW).map(x => x.id)).toEqual(['polemic', 'w1', 'w2'])
  })
})

describe('PlanWeeks with the meter', () => {
  const show = (meter: PolandMeter, tueAt?: string) => {
    const rd = read(tueAt)
    renderInFrame(<PlanWeeks read={rd} items={itemsOf(rd)} today={rd.today} onOpen={() => {}} poland={meter} />)
  }
  const weeks = () => [...document.querySelectorAll<HTMLElement>('.pl2-wk')]

  it('a short week shows its split in the header and the best Poland drafts in its free days; a met week shows none', () => {
    const onTake = vi.fn()
    show({ reads, failed: false, picks: [r({ id: 'w1', title: '[X outlier @a] Warsaw at night' }), r({ id: 'w2', title: 'Kraków weekend' }), r({ id: 'w3' })], hm: { h: 10, m: 45 }, reserved: new Map(), onTake })
    const [w0, w1] = weeks()
    expect(w0.querySelector('.pl2-wk-pol')!.textContent).toBe('Poland 0/2 · Business 2/3')
    expect(w0.querySelector('.pl2-wk-pol')!.classList.contains('pl2-wk-short')).toBe(true)
    const gaps = [...w0.querySelectorAll<HTMLElement>('.pl2-gap')]
    expect(gaps.map(g => g.dataset.gapDraft)).toEqual(['w1', 'w2'])
    expect(gaps[0].closest<HTMLElement>('.pl2-dcol')!.dataset.day).toBe('2026-10-14')
    expect(gaps[0].querySelector('.pl2-gap-t')!.textContent).toBe('Warsaw at night')
    expect(w0.querySelectorAll('.pl2-free').length).toBe(1)
    expect(w1.querySelector('.pl2-wk-pol')!.textContent).toBe('Poland 2/2 · Business 2/3 · 1 not read yet')
    expect(w1.querySelector('.pl2-gap')).toBeNull()
    fireEvent.click(gaps[0].querySelector('[data-verb="plan-poland-take"]')!)
    expect(onTake).toHaveBeenCalledTimes(1)
    expect(onTake.mock.calls[0][0].id).toBe('w1')
    // Wed 14 Oct at the seat's 10:45 Warsaw (CEST in October = 08:45 UTC)
    expect((onTake.mock.calls[0][1] as Date).toISOString()).toBe('2026-10-14T08:45:00.000Z')
  })

  it('no waiting Poland draft: the free days stay free; a failed read says so', () => {
    show({ reads: null, failed: true, picks: [], hm: { h: 10, m: 45 }, reserved: new Map(), onTake: vi.fn() })
    expect(weeks()[0].querySelector('.pl2-wk-pol')!.textContent).toBe('Poland split could not be read')
    expect(document.querySelector('.pl2-gap')).toBeNull()
    expect(weeks()[0].querySelectorAll('.pl2-free').length).toBe(3)
  })

  it('a free day within 24 h of a dated post is skipped (the database would refuse it); a held tap keeps its day and counts', () => {
    const picks = [r({ id: 'w1' }), r({ id: 'w2' })]
    // Tue's post at 09:45 UTC sits 23 h before Wed 10:45 Warsaw: the first gap is Thu
    show({ reads, failed: false, picks, hm: { h: 10, m: 45 }, reserved: new Map(), onTake: vi.fn() }, '09:45')
    let gaps = [...weeks()[0].querySelectorAll<HTMLElement>('.pl2-gap')]
    expect(gaps.map(g => g.closest<HTMLElement>('.pl2-dcol')!.dataset.day)).toEqual(['2026-10-15', '2026-10-16'])
    cleanup()
    // w1 held for Wed: Wed is taken, w1 is not offered again, and the week already counts it
    show({ reads, failed: false, picks, hm: { h: 10, m: 45 }, reserved: new Map([['w1', { at: '2026-10-14T08:45:00.000Z', poland: true }]]), onTake: vi.fn() })
    gaps = [...weeks()[0].querySelectorAll<HTMLElement>('.pl2-gap')]
    expect(gaps.map(g => g.dataset.gapDraft)).toEqual(['w2'])
    // Thu 10:45 is exactly 24 h after the held Wed slot: allowed
    expect(gaps[0].closest<HTMLElement>('.pl2-dcol')!.dataset.day).toBe('2026-10-15')
    expect(weeks()[0].querySelector('.pl2-wk-pol')!.textContent).toBe('Poland 1/2 · Business 2/3')
  })
})
