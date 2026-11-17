// @vitest-environment jsdom
// X is a Content tab (daily-brief-trim Task 6.1; was its own place since X desk plan P3, 2026-11-03):
// every old X address redirects onto the tab, query kept; the Content number carries what waits on
// X; Ops no longer reads or shows X.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { XReviewList } from '../../lib/xReview'

const api = vi.hoisted(() => ({ fetchXReview: vi.fn(), fetchOpsDrafts: vi.fn() }))
vi.mock('../../lib/xReview', async (orig) => ({ ...(await orig<typeof import('../../lib/xReview')>()), fetchXReview: api.fetchXReview }))
vi.mock('../../lib/ops', async (orig) => ({ ...(await orig<typeof import('../../lib/ops')>()), fetchOpsDrafts: api.fetchOpsDrafts }))
vi.mock('../counts/inbox', () => ({
  useDInbox: () => ({ refresh: () => {} }),
  useDInboxMaybe: () => null,
  DInboxProvider: ({ children }: { children: ReactNode }) => children,
}))

const { canonicalHash, dHash, movedXHash, parseDHash, PLACE_IDS } = await import('../route')
const { PLACES, PLACE_ORDER } = await import('../places')
const { SUBS, SUB_LABEL, subOf } = await import('../content/SubNav')
const { fetchOpsWaiting } = await import('../counts/ops')
const { supabase } = await import('../../lib/supabase')
const { navLines } = await import('../shell/navModel')
const { Side } = await import('../shell/Side')
const { PhoneTabs } = await import('../shell/Phone')
const { renderInFrame } = await import('../test-utils')
const { __resetXForTests } = await import('./useXReview')
const { XFlag } = await import('./XFlag')
const { XMarks } = await import('../content/xDays')

const at = '2026-11-07T10:00:00Z'
const quick = (id: string, status: 'draft' | 'posted') => ({ id, status, text: `post ${id}`, created_at: at }) as unknown as XReviewList['quicks'][number]
const LIST: XReviewList = {
  articles: [{ id: 'a1', status: 'review', title: 'Article', created_at: at, updated_at: at } as unknown as XReviewList['articles'][number]],
  quotes: [],
  quicks: [quick('q1', 'draft'), quick('q2', 'draft'), quick('q3', 'posted')],
}

beforeEach(() => {
  __resetXForTests()
  api.fetchXReview.mockResolvedValue(LIST)
  api.fetchOpsDrafts.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('X desk route', () => {
  it('is a Content tab after Review, not a place; the dock has five keys', () => {
    expect(PLACE_IDS).not.toContain('x')
    expect(PLACE_ORDER).not.toContain('x')
    expect('x' in PLACES).toBe(false)
    expect(SUBS).toEqual(['plan', 'calendar', 'ideas', 'now', 'x', 'magnets', 'results'])
    expect(SUB_LABEL.x).toBe('X')
    expect(subOf('x')).toBe('x')
    // the dock as it is really derived (PhoneTabs, Dock): the places flagged dock, in draw order
    expect(PLACE_ORDER.filter(id => PLACES[id].dock)).toEqual(['home', 'dms', 'content', 'ops', 'sales'])
    expect(PLACES.lanes.nav).toBe('main')
  })

  it('redirects the X desk and the older Ops address for good, query kept (runner links, delivered pushes)', () => {
    expect(canonicalHash('#exp/d/ops/x?id=abc')).toBe('#exp/d/content/x?id=abc')
    expect(canonicalHash('#exp/d/ops/x')).toBe('#exp/d/content/x')
    expect(canonicalHash('#exp/d/ops/X?id=abc&y=1')).toBe('#exp/d/content/x?id=abc&y=1')
    expect(canonicalHash('#exp/d/x?id=abc&y=1')).toBe('#exp/d/content/x?id=abc&y=1')
    for (const h of ['#exp/d/ops/x?id=abc', '#exp/d/x?id=abc']) {
      const r = parseDHash(h)
      expect(r.place).toBe('content')
      expect(r.sub).toBe('x')
      expect(r.query.get('id')).toBe('abc')
    }
    expect(dHash('content', 'x', { id: 'abc' })).toBe('#exp/d/content/x?id=abc')
  })

  it('leaves every other address alone', () => {
    for (const h of ['#exp/d/ops', '#exp/d/ops?card=1', '#exp/d/ops/xyz', '#exp/d/opsx', '#exp/d/xyz', '#exp/d/content/x?id=1']) expect(movedXHash(h)).toBe(h)
    expect(parseDHash('#exp/d/ops?card=1').place).toBe('ops')
    expect(parseDHash('#exp/d/ops/xyz')).toMatchObject({ place: 'ops', sub: 'xyz' })
  })

  it('the X flag and the calendar marks write the Content address', async () => {
    renderInFrame(<XFlag />, { hash: '#exp/d/home' })
    await waitFor(() => expect(document.querySelector('a[data-x-item="a1"]')?.getAttribute('href')).toBe('#exp/d/content/x?id=a1'))
    cleanup()
    render(<XMarks items={[{ id: 'm1', title: 'T', status: 'approved', x_url: null, at }]} />)
    expect(document.querySelector('a.xmark')?.getAttribute('href')).toBe('#exp/d/content/x?id=m1')
  })
})

describe('X desk count', () => {
  it('Ops no longer reads X or adds it to its number', async () => {
    // The Ops number reads its own count columns (counts/ops.ts, 2026-11-15): an empty answer, no network.
    const empty: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }
    for (const k of ['select', 'neq', 'eq', 'is', 'in', 'or', 'not', 'gte', 'lte', 'order', 'limit']) empty[k] = () => empty
    const from = vi.spyOn(supabase, 'from').mockReturnValue(empty as unknown as ReturnType<typeof supabase.from>)
    expect(await fetchOpsWaiting()).toEqual({ ivan: 0, risedtc: 0, arch: 0, swishdm: 0, anna: 0 })
    expect(api.fetchXReview).not.toHaveBeenCalled()
    from.mockRestore()
  })

  it('the Content line is review drafts plus X waiting (Ivan only); an X read that fails or is loading leaves it alone', () => {
    const sl = { value: null, failed: false, at: null }
    const cs = (v: number) => ({ value: v, failed: false, at: 1 })
    const content = { ivan: cs(2), risedtc: cs(1), arch: cs(0), swishdm: cs(0), anna: cs(0) }
    const seats = { ivan: sl, risedtc: sl, arch: sl, swishdm: sl, anna: sl }
    const c = { ops: sl, dms: seats, content, nextCall: sl } as unknown as Parameters<typeof navLines>[0]
    const lines = navLines(c, { n: 3, failed: false })
    expect('x' in lines).toBe(false)
    expect(lines.content).toMatchObject({ failed: 0, line: { kind: 'seats', numbers: { ivan: 5, risedtc: 1, arch: 0 } } })
    expect(navLines(c, { n: null, failed: false }).content).toMatchObject({ failed: 0, line: { numbers: { ivan: 2, risedtc: 1 } } })
    expect(navLines(c, { n: null, failed: true }).content).toMatchObject({ failed: 0, line: { numbers: { ivan: 2, risedtc: 1 }, failed: { ivan: false } } })
  })

  it('the left panel opens X under Content and the Content number counts X (3 waiting: article + 2 drafts)', async () => {
    renderInFrame(<Side />, { layout: 'desktop', hash: '#exp/d/content/x' })
    const link = await waitFor(() => { const a = document.querySelector<HTMLAnchorElement>('a[href="#exp/d/content"]'); expect(a?.textContent).toContain('3'); return a! })
    expect(link.querySelector('.d-nt')?.getAttribute('aria-label')).toMatch(/^Waiting on you: Ivan 3/)
    expect(document.querySelector('a[href="#exp/d/content/x?lane=ivan"]')?.getAttribute('aria-current')).toBe('page')
    expect(document.querySelector('a[href="#exp/d/x"]')).toBeNull()
    // Ops' own number stays its own
    expect(document.querySelector('a[href="#exp/d/ops"] .d-nt')).toBeNull()
  })

  it('the phone tab bar has no X key; the Content badge carries X waiting', async () => {
    renderInFrame(<PhoneTabs />, { layout: 'phone', hash: '#exp/d/home' })
    await screen.findByRole('link', { name: 'Content, 3 posts to review' })
    expect(screen.queryByRole('link', { name: /^X\b/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Lanes/ })).toBeNull()
  })

  it('an X read that fails shows the review count alone, never a failed Content badge', async () => {
    api.fetchXReview.mockRejectedValue(new Error('x down'))
    renderInFrame(<PhoneTabs />, { layout: 'phone', hash: '#exp/d/home', readers: { content: async () => 2 } })
    await screen.findByRole('link', { name: 'Content, 8 posts to review' })
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('an X read still loading shows the review count alone', async () => {
    api.fetchXReview.mockReturnValue(new Promise(() => {}))
    renderInFrame(<PhoneTabs />, { layout: 'phone', hash: '#exp/d/home', readers: { content: async () => 2 } })
    await screen.findByRole('link', { name: 'Content, 8 posts to review' })
    expect(document.body.textContent).not.toContain('NaN')
  })
})
