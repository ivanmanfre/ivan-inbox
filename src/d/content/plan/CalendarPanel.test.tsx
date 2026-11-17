// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { CalendarPanel as Panel } from '../../../lib/contentPlanPanel'
import { BeliefChips, CalendarChipsProvider, CalendarPanel } from './CalendarPanel'
import { chipsFor, lookupOf, quotaLine, weekTarget } from './calendarPanelModel'

// Every id, name and line below is invented.
const S1 = '00000000-0000-4000-8000-0000000000a1'
const S2 = '00000000-0000-4000-8000-0000000000a2'
const D3 = '00000000-0000-4000-8000-0000000000b3'
const P = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`
const panel = (): Panel => ({
  as_of: '2026-11-16T10:00:00Z', this_week: '2026-11-16',
  slots: [
    { slot_id: S1, week_start: '2026-11-16', draft_id: null, belief: 3, vehicle: 'scene_dialogue', is_copy: false },
    { slot_id: S2, week_start: '2026-11-16', draft_id: D3, belief: null, vehicle: null, is_copy: false },
  ],
  quotas: [
    { slot_kind: 'business_event', belief: null, vehicle: null, per_week: 2, every_n_weeks: 1, note: null },
    { slot_kind: 'own_story_or_proof', belief: null, vehicle: null, per_week: 1, every_n_weeks: 1, note: null },
    { slot_kind: 'life_origin', belief: null, vehicle: 'turning_point', per_week: 1, every_n_weeks: 1, note: null },
    { slot_kind: 'poland_with_him', belief: 5, vehicle: 'poland_place', per_week: 1, every_n_weeks: 1, note: null },
    { slot_kind: 'selling_claim', belief: null, vehicle: null, per_week: 1, every_n_weeks: 2, note: null },
    { slot_kind: 'outlier_copy_extra', belief: null, vehicle: null, per_week: null, every_n_weeks: 1, note: null },
  ],
  week_fill: [
    { week_start: '2026-11-16', slots: 2, copies: 1, no_belief: 1, by_belief: { '3': 1 }, by_vehicle: { scene_dialogue: 1 } },
    { week_start: '2026-11-23', slots: 0, copies: 0, no_belief: 0, by_belief: {}, by_vehicle: {} },
  ],
  profile_first: {
    score: '1 of 3', proof: false, outreach_belief: false, him: true, unlabeled: [P(2)],
    posts: [
      { id: P(1), posted_at: '2026-11-12T09:00:00Z', first_line: 'Made-up opening line one', kind: 'poland_with_him', belief: 5, vehicle: 'poland_place', proof: false, him: true, is_copy: false },
      { id: P(2), posted_at: '2026-11-10T09:00:00Z', first_line: 'Made-up opening line two', kind: null, belief: null, vehicle: null, proof: false, him: false, is_copy: false },
    ],
  },
  pv48: [{ posted_at: '2026-11-12T09:00:00Z', first_line: 'Made-up opening line one', kind: 'poland_with_him', contacted_viewers_48h: 7, contacted_fit_viewers_48h: 4, baseline_per_48h: 5.5, window_open: true }],
  cohorts: {
    filter_key: '2026-11-02|v3|campaign-x', note: 'Compare rates only inside one group.',
    rows: [{
      filter_key: '2026-11-02|v3|campaign-x', campaign_name: 'Campaign X', period_from: '2026-11-02', period_to: null, top_post_kind: 'proof', top_belief: 1, top_vehicle: 'rant', scorer_version: 'v3', note_arm: 'note',
      invites: 30, accept_base: 24, accepts: 12, reply_base: 10, replies: 2, booking_base: 0, bookings: 0, accept_rate: 0.5, reply_rate: 0.2, booking_rate: null, small_n: false,
    }],
  },
  booking_reasons: [{ call_date: '2026-11-02T10:00:00Z', reason_class: 'content', quote: 'Made-up quote about a post.' }],
  enforce: 'off',
})

afterEach(cleanup)

describe('chips on a planned post', () => {
  it('shows belief and vehicle by slot id, and by draft id as the fallback', () => {
    const l = lookupOf(panel())
    expect(chipsFor(l, S1, null)).toEqual({ belief: 3, vehicle: 'scene_dialogue' })
    expect(chipsFor(l, null, D3)).toBeNull() // that slot has neither: nothing, never a guess
    expect(chipsFor(l, '00000000-0000-4000-8000-0000000000ff', null)).toBeNull()
  })
  it('renders chips for a slot that has them and nothing for one that has none', () => {
    const { container } = render(<CalendarChipsProvider panel={panel()}><BeliefChips slotId={S1} draftId={null} /><BeliefChips slotId={S2} draftId={D3} /></CalendarChipsProvider>)
    const chips = [...container.querySelectorAll('.cp17-chip')].map(c => c.textContent)
    expect(chips).toEqual(['Belief 3', 'a scene with dialogue'])
  })
})

describe('week strip', () => {
  it('reads the quotas in plain words and counts copies as extras', () => {
    expect(quotaLine(panel().quotas)).toBe('2 from events, 1 own story or proof, 1 life story, 1 Poland with you')
    expect(weekTarget(panel().quotas)).toBe(5)
    render(<CalendarPanel state={{ panel: panel(), failed: false }} />)
    const strip = screen.getByLabelText('The week')
    expect(within(strip).getByText('2 from events, 1 own story or proof, 1 life story, 1 Poland with you')).toBeTruthy()
    expect(within(strip).getByText('2 of 5 filled, 3 open')).toBeTruthy()
    expect(within(strip).getByText('Belief 3: 1')).toBeTruthy()
    expect(within(strip).getByText('1 with no belief yet')).toBeTruthy()
    expect(within(strip).getByText('1 copy as extras')).toBeTruthy()
    expect(within(strip).getByText(/one every 2 weeks/)).toBeTruthy()
  })
})

describe('top of your profile', () => {
  it('shows the score, the six posts and "not read yet" for an unlabeled one', () => {
    render(<CalendarPanel state={{ panel: panel(), failed: false }} />)
    const sec = screen.getByLabelText('Top of your profile')
    expect(within(sec).getByText('Top of your profile: 1 of 3')).toBeTruthy()
    expect(within(sec).getByText('Yes: you in it')).toBeTruthy()
    expect(within(sec).getByText('Not yet: proof')).toBeTruthy()
    expect(within(sec).getByText('not read yet')).toBeTruthy()
    expect(within(sec).getByText('you in it')).toBeTruthy()
  })
})

describe('measurement', () => {
  it('shows 48 hour views against the normal level, the filter key, and the booking quote with date and class', () => {
    const { container } = render(<CalendarPanel state={{ panel: panel(), failed: false }} />)
    const m = container.querySelector('.cp17-measure') as HTMLElement
    expect(within(m).getByText('7 people, 4 a fit')).toBeTruthy()
    expect(m.textContent).toContain('usual 5.5 per 48 h')
    expect(m.textContent).toContain('still counting')
    expect(m.textContent).toContain('Campaign X · scorer v3 · with a note · from 2026-11-02')
    expect(m.textContent).toContain('accepted 12 of 24 (50%)')
    expect(m.textContent).toContain('booked 0 of 0, small sample')
    expect(m.textContent).not.toContain('accepted 12 of 24, small sample')
    expect(within(m).getByText('Made-up quote about a post.')).toBeTruthy()
    expect(m.textContent).toContain('Content')
  })
  it('has no em dash, undefined or NaN anywhere', () => {
    const { container } = render(<CalendarPanel state={{ panel: panel(), failed: false }} />)
    expect(container.textContent).not.toMatch(/\u2014|undefined|NaN|null/)
  })
})

describe('small samples and key groups', () => {
  it('shows small sample instead of a bare rate and keeps each filter key in its own group', () => {
    const p = panel(); const r = p.cohorts.rows[0]
    p.cohorts.rows = [{ ...r, accept_base: 8, accepts: 2, small_n: true, reply_small_n: true },
      { ...r, filter_key: '2026-11-02|v4|campaign-y', campaign_name: 'Campaign Y', scorer_version: 'v4', top_post_kind: 'how_to' }]
    const { container } = render(<CalendarPanel state={{ panel: p, failed: false }} />)
    const m = container.querySelector('.cp17-measure') as HTMLElement
    expect(m.textContent).toContain('accepted 2 of 8, small sample')
    expect(m.textContent).toContain('replied 2 of 10, small sample')
    expect(m.querySelectorAll('.cp17-group')).toHaveLength(2)
    expect(m.querySelector('.cp17-group')!.textContent).toContain('scorer v4')
  })
})

describe('fit not measured and unrecorded scorer', () => {
  it('prints "fit not measured" for a null fit count, never blank or 0', () => {
    const p = panel()
    p.pv48 = [{ ...p.pv48[0], contacted_fit_viewers_48h: null, contacted_fit_known_48h: null }]
    const { container } = render(<CalendarPanel state={{ panel: p, failed: false }} />)
    const m = container.querySelector('.cp17-measure') as HTMLElement
    expect(m.textContent).toContain('7 people, fit not measured')
    expect(m.textContent).not.toContain(' a fit')
  })
  it('says "scorer not recorded" and "no note" in words and keeps the raw key out of the text', () => {
    const p = panel()
    p.cohorts.rows = [{ ...p.cohorts.rows[0], scorer_version: 'unstamped', note_arm: 'blank' }]
    const { container } = render(<CalendarPanel state={{ panel: p, failed: false }} />)
    const m = container.querySelector('.cp17-measure') as HTMLElement
    expect(m.textContent).toContain('Campaign X · scorer not recorded · no note · from 2026-11-02')
    expect(m.textContent).not.toContain('campaign-x')
    expect(m.textContent).not.toContain('vunstamped')
  })
})

describe('a failed read', () => {
  it('shows one quiet line', () => {
    render(<CalendarPanel state={{ panel: null, failed: true }} />)
    expect(screen.getByRole('status').textContent).toBe('The calendar check could not load.')
  })
  it('shows nothing while loading', () => {
    const { container } = render(<CalendarPanel state={{ panel: null, failed: false }} />)
    expect(container.innerHTML).toBe('')
  })
})
