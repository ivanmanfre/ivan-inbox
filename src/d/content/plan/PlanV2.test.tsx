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

const api = vi.hoisted(() => ({ fetchPlan: vi.fn() }))
vi.mock('../../../lib/contentPlan', async o => ({ ...await o<typeof import('../../../lib/contentPlan')>(), fetchPlan: api.fetchPlan }))
import { PlanV2 } from './PlanV2'

const rise = () => structuredClone(riseFx) as unknown as PlanRead
const ivan = () => structuredClone(ivanFx) as unknown as PlanRead
const FX: Record<Lane, () => PlanRead> = { ivan, risedtc: () => structuredClone(riseFull) as unknown as PlanRead, arch: () => structuredClone(archFx) as unknown as PlanRead }
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

function Harness({ start }: { start: Lane }) {
  const [lane, setLane] = useState<Lane>(start)
  return <PlanV2 lane={lane} setLane={setLane} />
}

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

describe('PlanV2', () => {
  it('opens on the answer line and its parts', async () => {
    api.fetchPlan.mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    expect(await screen.findByRole('heading', { name: '3 posts wait for your OK' })).toBeTruthy()
    expect(document.querySelector('.pl2-parts')!.textContent).toBe('3 later')
    expect(api.fetchPlan).toHaveBeenCalledWith('risedtc', expect.any(AbortSignal))
  })

  it('a slow first seat never paints under the seat switched to', async () => {
    const first = deferred<PlanRead>(), second = deferred<PlanRead>()
    api.fetchPlan.mockImplementation((lane: Lane) => (lane === 'ivan' ? first.promise : second.promise))
    renderInFrame(<Harness start="ivan" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Rise' }))
    await act(async () => { second.resolve(rise()) })
    await act(async () => { first.resolve(ivan()) })
    expect(screen.getByRole('heading', { name: '3 posts wait for your OK' })).toBeTruthy()
    expect(screen.getAllByText(/If a channel can't grow/).length).toBeGreaterThan(0)
    const ivanTitle = (ivanFx as unknown as PlanRead).weeks[1].posts[0].title
    expect(document.body.textContent).not.toContain(ivanTitle)
  })

  it('a failed read says so with Retry', async () => {
    api.fetchPlan.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(rise())
    renderInFrame(<Harness start="risedtc" />)
    expect(await screen.findByText('Could not read the plan.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: '3 posts wait for your OK' })).toBeTruthy()
    expect(api.fetchPlan).toHaveBeenCalledTimes(2)
  })

  it('an empty read says nothing waits and never shows NaN or undefined', async () => {
    api.fetchPlan.mockResolvedValue(emptyRead())
    renderInFrame(<Harness start="arch" />)
    expect(await screen.findByRole('heading', { name: 'Nothing waits for you' })).toBeTruthy()
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

  it('no rendered text has an em dash, on any seat, rows open', async () => {
    for (const lane of ['ivan', 'risedtc', 'arch'] as Lane[]) {
      api.fetchPlan.mockResolvedValue(FX[lane]())
      renderInFrame(<Harness start={lane} />)
      await screen.findByRole('heading', { level: 2 })
      document.querySelectorAll<HTMLButtonElement>('.pl2-row-b').forEach(b => fireEvent.click(b))
      expect(document.body.textContent).not.toContain('—')
      expect(document.body.textContent).not.toMatch(/NaN|undefined/)
      cleanup()
    }
  })

  it('a post still waiting from an earlier day comes first, under its own waiting header; today reads Today', async () => {
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
    const row = screen.getAllByText(/If a channel can't grow/)[0].closest('.pl2-row')!
    expect(row.querySelector('.pl2-st')!.textContent).toBe('Waiting for your OK')
    const b = row.querySelector<HTMLButtonElement>('.pl2-row-b')!
    expect(b.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(b)
    await waitFor(() => expect(b.getAttribute('aria-expanded')).toBe('true'))
    expect(row.textContent).toContain('Bad sign.')
    const ok = [...row.querySelectorAll('a')].find(a => a.textContent === 'Read and approve')!
    expect(ok.getAttribute('href')).toBe('#exp/d/content/now?draft=994bc449-2212-0b86-cdc0-fc26bb59b33e&lane=risedtc')
    expect([...row.querySelectorAll('button')].some(x => x.textContent === 'Why, in full')).toBe(true)
  })

  it('a row with no brain data says so in plain words', async () => {
    const r = rise()
    r.weeks[2].planned[0].brain = undefined
    api.fetchPlan.mockResolvedValue({ ...r, brain_strip: null })
    renderInFrame(<Harness start="risedtc" />)
    await screen.findByRole('heading', { level: 2 })
    expect(screen.getAllByText('No brain guess yet for this draft.').length).toBeGreaterThan(0)
  })
})
