// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { renderInFrame } from '../../test-utils'
import type { PlanRead } from '../../../lib/contentPlan'
import type { Lane } from '../model'
import riseFx from './fixtures/rise.json'
import riseFull from './fixtures/risedtc.json'
import ivanFx from './fixtures/ivan.json'
import archFx from './fixtures/arch.json'

const api = vi.hoisted(() => ({ fetchPlan: vi.fn(), moveSlotWeek: vi.fn() }))
vi.mock('../../../lib/contentPlan', async o => ({ ...await o<typeof import('../../../lib/contentPlan')>(), fetchPlan: api.fetchPlan, moveSlotWeek: api.moveSlotWeek }))
import { PlanV2 } from './PlanV2'

const rise = () => structuredClone(riseFx) as unknown as PlanRead
const ivan = () => structuredClone(ivanFx) as unknown as PlanRead
const FX: Record<Lane, () => PlanRead> = { ivan, risedtc: () => structuredClone(riseFull) as unknown as PlanRead, arch: () => structuredClone(archFx) as unknown as PlanRead , swishdm: () => structuredClone(archFx) as unknown as PlanRead}
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const emptyRead = (): PlanRead => ({
  account: 'arch', today: '2026-10-12', target: 3, target_week: null, open: 0, state: 'planning', proposals_only: false, founder_story_max: 1, cadence_source: '',
  weeks: [
    { start: '2026-10-12', which: 'this', target: 3, filled: 0, open: 3, posts: [], planned: [] },
    { start: '2026-10-19', which: 'next', target: 3, filled: 0, open: 3, posts: [], planned: [] },
    { start: '2026-10-26', which: 'after', target: 3, filled: 0, open: 3, posts: [], planned: [] },
  ],
  done: [], warnings: [], last_run: null, brain_strip: { rules: [] } as unknown as PlanRead['brain_strip'],
})

function Harness({ start, showInsights = false }: { start: Lane; showInsights?: boolean }) {
  const [lane, setLane] = useState<Lane>(start)
  return <PlanV2 lane={lane} setLane={setLane} showInsights={showInsights} />
}

const consoleErr = vi.spyOn(console, 'error')
afterEach(() => {
  const keyWarnings = consoleErr.mock.calls.filter(c => String(c[0]).includes('same key'))
  cleanup(); vi.clearAllMocks(); localStorage.clear()
  expect(keyWarnings).toEqual([])
})

/** The Weeks card (the waiting list under the headline carries the same title). */
const cardOf = (re: RegExp) => screen.getAllByText(re).map(e => e.closest<HTMLElement>('.pl2-card')).find(Boolean)!

describe('PlanV2', () => {
  it('shows held SwishDM drafts without a cadence or planner actions', async () => {
    const read = emptyRead()
    read.account = 'swishdm'
    read.state = 'awaiting_cadence'
    read.target = 0
    read.held_drafts = [{ id: 'held-1', title: 'Getting cited' }]
    api.fetchPlan.mockResolvedValue(read)
    renderInFrame(<Harness start="swishdm" />)
    expect(await screen.findByRole('heading', { name: 'Planning cadence awaits confirmation' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Getting cited/ }).getAttribute('href')).toBe('#exp/d/content/now?draft=held-1&lane=swishdm')
    expect(document.body.textContent).toContain('No posts are scheduled or queued for publication.')
    expect(document.body.textContent).not.toContain('The planner has not run yet.')
    expect(document.querySelector('[data-verb="plan-generate"]')).toBeNull()
  })

  it('opens on the answer line and its parts', async () => {
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    expect(await screen.findByRole('heading', { name: '3 planned posts wait for your OK' })).toBeTruthy()
    expect(document.querySelector('.pl2-parts')!.textContent).toBe('3 later')
    expect(api.fetchPlan).toHaveBeenCalledWith('risedtc', expect.any(AbortSignal))
  })

  it('the posts the headline counts sit right under it, and a tap opens the panel', async () => {
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { name: '3 planned posts wait for your OK' })
    const list = screen.getByRole('list', { name: 'Waiting for your OK' })
    expect(list.previousElementSibling!.classList.contains('pl2-ans')).toBe(true)
    const rows = list.querySelectorAll('[data-verb="plan-wait-open"]')
    expect(rows).toHaveLength(3)
    fireEvent.click(rows[0])
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('a slow first seat never paints under the seat switched to', async () => {
    const first = deferred<PlanRead>(), second = deferred<PlanRead>()
    api.fetchPlan.mockImplementation((lane: Lane) => (lane === 'ivan' ? first.promise : second.promise))
    renderInFrame(<Harness start="ivan" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Rise' }))
    await act(async () => { second.resolve(rise()) })
    await act(async () => { first.resolve(ivan()) })
    expect(screen.getByRole('heading', { name: '3 planned posts wait for your OK' })).toBeTruthy()
    expect(screen.getAllByText(/If a channel can't grow/).length).toBeGreaterThan(0)
    const ivanTitle = (ivanFx as unknown as PlanRead).weeks[1].posts[0].title
    expect(document.body.textContent).not.toContain(ivanTitle)
  })

  it('resets account-local insight state when switching seats before the next plan arrives', async () => {
    const next = deferred<PlanRead>()
    api.fetchPlan.mockImplementation((lane: Lane) => lane === 'ivan' ? Promise.resolve(ivan()) : next.promise)
    renderInFrame(<Harness start="ivan" showInsights />)
    await waitFor(() => expect(document.querySelector('.pl2-ans')).toBeTruthy())
    const first = document.querySelector('[data-niche]')!
    expect(first).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Rise' }))
    const second = document.querySelector('[data-niche]')!
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
    await act(async () => { next.resolve(rise()) })
  })

  it('a failed read says so with Retry', async () => {
    api.fetchPlan.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    expect(await screen.findByText('Could not read the plan.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: '3 planned posts wait for your OK' })).toBeTruthy()
    expect(api.fetchPlan).toHaveBeenCalledTimes(2)
  })

  it('keeps independent Brain insights available when the plan read fails, then restores the strip on Retry', async () => {
    api.fetchPlan.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" showInsights />)
    expect(await screen.findByText('Could not read the plan.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Content Brain insights/ }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.pl2-insights [data-niche]')).toBeTruthy()
    expect(document.querySelector('.pl2-insights [data-best-posts]')).toBeTruthy()
    expect(document.querySelector('.pl2-insights [aria-label="Your recent decisions"]')).toBeTruthy()
    expect(document.querySelector('.pl2-strip')).toBeNull()
    expect(screen.getByText(/Plan rules, forecasts and results could not load/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry plan insights' }))
    expect(await screen.findByRole('heading', { name: '3 planned posts wait for your OK' })).toBeTruthy()
    expect(document.querySelector('.pl2-insights .pl2-strip')).toBeTruthy()
  })

  it('an empty read scopes the zero-review headline to planned posts', async () => {
    api.fetchPlan.mockResolvedValue(emptyRead())
    renderInFrame(<Harness start="arch" />)
    expect(await screen.findByRole('heading', { name: 'No planned posts need approval' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open Review/ }).getAttribute('href')).toBe('#exp/d/content/now?lane=arch')
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/)
  })

  it('warnings carry their plain words and a fix link', async () => {
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    const w = await screen.findByText('Out of ideas for sales posts (3 used in 8 weeks)')
    const link = w.closest('.pl2-warn')!.querySelector('a')!
    expect(link.textContent).toBe('Add ideas')
    expect(link.getAttribute('href')).toBe('#exp/d/content/ideas?lane=risedtc')
  })

  it('lead magnet due links Lead magnets; no photos has no link; a failed draft links the draft', async () => {
    const r = ivan()
    r.warnings = [{ code: 'lm_due', text: 'No lead magnet in the week of 26 Oct' }, { code: 'no_photos', text: 'Only 2 fitting photos left in your library' }, { code: 'draft_failed', text: '1 planned draft failed the check twice. The planner is picking a new topic.' }]
    r.weeks[2].planned[0].status = 'failed'
    r.weeks[2].planned[0].draft_id = 'd-failed'
    api.fetchPlan.mockResolvedValue(r)
    renderInFrame(<Harness start="ivan" />)
    const lm = (await screen.findByText('No lead magnet in the week of 26 Oct')).closest('.pl2-warn')!
    expect(lm.querySelector('a')!.getAttribute('href')).toBe('#exp/d/content/magnets?lane=ivan')
    expect(screen.getByText('Only 2 fitting photos left in your library').closest('.pl2-warn')!.querySelector('a')).toBeNull()
    const df = screen.getByText(/failed the check twice/).closest('.pl2-warn')!.querySelector('a')!
    expect(df.getAttribute('href')).toBe('#exp/d/content/now?draft=d-failed&lane=ivan')
  })

  it.each([['weeks', 'ivan'], ['weeks', 'risedtc'], ['weeks', 'arch'], ['list', 'ivan'], ['list', 'risedtc'], ['list', 'arch']] as [string, Lane][])(
    'no rendered text has an em dash: %s view, %s seat, rows open', async (view, lane) => {
      localStorage.setItem('pl2-view', view)
      api.fetchPlan.mockResolvedValue(FX[lane]())
      renderInFrame(<Harness start={lane} />)
      await screen.findByRole('heading', { level: 2 })
      expect(document.querySelector(view === 'weeks' ? '.pl2-wks' : '.pl2-list')).not.toBeNull()
      document.querySelectorAll<HTMLButtonElement>('.pl2-row-b').forEach(b => fireEvent.click(b))
      expect(document.body.textContent).not.toContain('—')
      expect(document.body.textContent).not.toMatch(/NaN|undefined/)
    })

  it('the desktop opens on Weeks; List is kept once picked; the phone is always List', async () => {
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    expect(document.querySelector('.pl2-wks')).not.toBeNull()
    expect(document.querySelector('.pl2-list')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'List' }))
    expect(document.querySelector('.pl2-list')).not.toBeNull()
    expect(localStorage.getItem('pl2-view')).toBe('list')
    cleanup()
    localStorage.setItem('pl2-view', 'weeks')
    renderInFrame(<Harness start="risedtc" />, { layout: 'phone' })
    await screen.findByRole('heading', { level: 2 })
    expect(document.querySelector('.pl2-wks')).toBeNull()
    expect(document.querySelector('.pl2-list')).not.toBeNull()
  })

  it('the hover card closes when the panel opens and stays shut while it is open', async () => {
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('hover: hover'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      api.fetchPlan.mockResolvedValue(rise())
      renderInFrame(<Harness start="risedtc" />)
      await screen.findByRole('heading', { level: 2 })
      const card = cardOf(/Your Google Shopping feed/)
      fireEvent.pointerOver(card)
      expect(await screen.findByRole('tooltip', {}, { timeout: 1500 })).toBeTruthy()
      fireEvent.click(card)
      expect(screen.queryByRole('tooltip')).toBeNull()
      expect(document.querySelector('.pl2')!.getAttribute('data-open')).toBe(card.getAttribute('data-plan-key'))
      const other = cardOf(/broken links/i)
      fireEvent.pointerOver(other)
      await new Promise(res => setTimeout(res, 700))
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      window.matchMedia = real
    }
  })

  it('a post still waiting from an earlier day comes first, under its own waiting header; today reads Today', async () => {
    localStorage.setItem('pl2-view', 'list')
    const r = rise()
    r.weeks[1].planned[0].day = '2026-10-09'
    api.fetchPlan.mockResolvedValue(r)
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    const heads = [...document.querySelectorAll('.pl2-day')]
    expect(heads[0].textContent).toContain('Waiting since Fri 9 Oct')
    expect(heads[0].classList.contains('pl2-day-late')).toBe(true)
    expect(heads[1].textContent).toContain('Today')
    expect(heads[1].classList.contains('pl2-day-today')).toBe(true)
  })

  it('a row opens in place with its guess and Read and approve; the phone keeps the status word', async () => {
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />, { layout: 'phone' })
    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByRole('tablist', { name: 'View' })).toBeNull()
    const row = screen.getAllByText(/If a channel can't grow/).map(e => e.closest<HTMLElement>('.pl2-row')).find(Boolean)!
    expect(row.querySelector('.pl2-st')!.textContent).toBe('Waiting for your OK')
    // R2.2 order: the status line comes before the title, so the title gets the full width on the phone.
    expect(row.querySelector('.pl2-row-b')!.firstElementChild!.className).toBe('pl2-meta')
    const b = row.querySelector<HTMLButtonElement>('.pl2-row-b')!
    expect(b.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(b)
    await waitFor(() => expect(b.getAttribute('aria-expanded')).toBe('true'))
    expect(row.textContent).toContain('Bad sign.')
    const ok = [...row.querySelectorAll('a')].find(a => a.textContent === 'Read and approve')!
    expect(ok.getAttribute('href')).toBe('#exp/d/content/now?draft=994bc449-2212-0b86-cdc0-fc26bb59b33e&lane=risedtc')
    expect([...row.querySelectorAll('button')].some(x => x.textContent === 'Why, in full')).toBe(true)
  })

  it('entry fades are marked done after the first mount, so they never replay when motion comes back', async () => {
    localStorage.setItem('pl2-view', 'list')
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    expect(document.querySelector('.pl2-list')!.hasAttribute('data-entered')).toBe(false)
    await waitFor(() => expect(document.querySelector('.pl2-list')!.hasAttribute('data-entered')).toBe(true), { timeout: 2500 })
    expect(document.querySelector('.pl2-warns')!.hasAttribute('data-entered')).toBe(true)
  })

  it('an empty plan says when the planner fills it', async () => {
    localStorage.setItem('pl2-view', 'list')
    api.fetchPlan.mockResolvedValue(emptyRead())
    renderInFrame(<Harness start="arch" />)
    expect(await screen.findByText('Nothing planned for the next two weeks.')).toBeTruthy()
    expect(screen.getByText('The planner plans the next two weeks every morning.')).toBeTruthy()
  })

  it('a row with no brain data says so in plain words', async () => {
    localStorage.setItem('pl2-view', 'list')
    const r = rise()
    r.weeks[2].planned[0].brain = undefined
    api.fetchPlan.mockResolvedValue({ ...r, brain_strip: null })
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    expect(screen.getAllByText('No brain guess yet for this draft.').length).toBeGreaterThan(0)
  })
  it('a card opens the panel with the seven questions; closing it puts focus back on the card without its hover card; Tab wakes it', async () => {
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('hover: hover'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      api.fetchPlan.mockResolvedValue(rise())
      renderInFrame(<Harness start="risedtc" />)
      await screen.findByRole('heading', { level: 2 })
      const card = cardOf(/Your Google Shopping feed/)
      fireEvent.click(card)
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('Why this post')
      expect(dialog.textContent).toContain('Will it do well')
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(card)
      fireEvent.focus(card)
      await new Promise(res => setTimeout(res, 650))
      expect(screen.queryByRole('tooltip')).toBeNull()
      // A keyboard user moves on: Tab wakes the hover card for the next card focus.
      const next = cardOf(/broken links/i)
      fireEvent.keyDown(window, { key: 'Tab' })
      next.focus()
      fireEvent.focus(next)
      expect(await screen.findByRole('tooltip', {}, { timeout: 1500 })).toBeTruthy()
    } finally {
      window.matchMedia = real
    }
  })

  it('Escape closes the panel and focus returns to the List row that opened it', async () => {
    localStorage.setItem('pl2-view', 'list')
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    const row = screen.getAllByText(/If a channel can't grow/).map(e => e.closest<HTMLElement>('.pl2-row')).find(Boolean)!
    fireEvent.click(row.querySelector('.pl2-row-b')!)
    fireEvent.click([...row.querySelectorAll('button')].find(b => b.textContent === 'Why, in full')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(row.querySelector('.pl2-row-b'))
  })

  it('a move re-reads the plan and keeps the panel open on the fresh data; a seat switch closes it', async () => {
    const first = FX.arch(); first.weeks[1].filled = 2
    const second = FX.arch(); second.weeks[2].planned[0].why_now = 'A fresh reason after the move.'
    api.fetchPlan.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue(ivan())
    api.moveSlotWeek.mockResolvedValue({ from_week: '2026-10-26', to_week: '2026-10-19' })
    renderInFrame(<Harness start="arch" />)
    await screen.findByRole('heading', { level: 2 })
    fireEvent.click(screen.getAllByText(/Judge creators like AppLovin/).map(e => e.closest<HTMLElement>('.pl2-card')).find(Boolean)!)
    fireEvent.click(screen.getByRole('button', { name: 'Move day' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Next week/ })) })
    expect(api.moveSlotWeek).toHaveBeenCalledWith('48dcd764-c830-452f-92cf-f6557177658a', '2026-10-19')
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('A fresh reason after the move.'))
    fireEvent.click(screen.getByRole('tab', { name: 'Ivan' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the full brain strip after the plan; a failed brain read leaves the plan readable', async () => {
    api.fetchPlan.mockResolvedValue(FX.risedtc())
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    expect(document.querySelector('.pl2-wks + .pl2-insights')).toBeTruthy()
    fireEvent.click(screen.getByText('Content Brain insights'))
    expect(document.querySelector('.pl2-insights .pl2-stripw')).toBeTruthy()
    expect(document.querySelector('.pl2-insights [data-niche]')).toBeTruthy()
    expect(document.querySelector('.pl2-insights [data-best-posts]')).toBeTruthy()
    expect(document.querySelector('.pl2-insights [aria-label="Your recent decisions"]')).toBeTruthy()
    expect(screen.getByText('What moves views')).toBeTruthy()
    cleanup()
    const broke = FX.arch(); broke.brain_strip = null; broke.brain_error = 'canceling statement due to statement timeout'
    api.fetchPlan.mockResolvedValue(broke)
    renderInFrame(<Harness start="arch" />)
    await screen.findByRole('heading', { level: 2 })
    fireEvent.click(screen.getByText('Content Brain insights'))
    expect(document.querySelector('.pl2-strip')).toBeNull()
    expect(document.body.textContent).not.toMatch(/NaN|undefined/)
  })

  it('opens insights for an old daily Brain link and keeps the stock action working', async () => {
    api.fetchPlan.mockResolvedValue(FX.risedtc())
    renderInFrame(<Harness start="risedtc" showInsights />)
    await screen.findByRole('heading', { name: '6 planned posts wait for your OK' })
    expect(screen.getByRole('button', { name: /Content Brain insights/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Ideas in stock' }))
    expect(screen.getByRole('dialog', { name: 'Ideas in stock' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Content Brain insights/ }))
    expect(document.querySelector('.pl2-insights [data-niche]')).toBeNull()
  })

  it('a client seat\'s Out of ideas chip opens the idea stock; Escape closes it and gives focus back; a seat switch closes it', async () => {
    api.fetchPlan.mockImplementation((l: Lane) => Promise.resolve(FX[l]()))
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    const chip = screen.getByRole('button', { name: /Out of ideas for sales posts/ })
    expect(screen.queryByRole('dialog', { name: 'Ideas in stock' })).toBeNull()
    fireEvent.click(chip)
    const dlg = screen.getByRole('dialog', { name: 'Ideas in stock' })
    expect(dlg.querySelectorAll('.pl2-ch-tick').length).toBe(6)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Ideas in stock' })).toBeNull()
    expect(document.activeElement).toBe(chip)
    fireEvent.click(chip)
    expect(screen.getByRole('dialog', { name: 'Ideas in stock' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Ivan' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ideas in stock' })).toBeNull())
  })

  it('Ivan keeps the text warning: no chip button for ideas', async () => {
    const r = ivan()
    r.warnings = [{ code: 'empty_topic_area', text: 'Out of ideas for sales posts (3 used in 8 weeks)' }]
    api.fetchPlan.mockResolvedValue(r)
    renderInFrame(<Harness start="ivan" />)
    await screen.findByRole('heading', { level: 2 })
    expect(screen.getByText(/Out of ideas for sales posts/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Out of ideas/ })).toBeNull()
  })
})
