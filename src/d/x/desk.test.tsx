// @vitest-environment jsdom
// The X desk (X desk plan P3, Ivan 2026-11-03): its own place and number, the old Ops address
// redirects, Ops no longer reads or shows X.
import { cleanup, screen, waitFor } from '@testing-library/react'
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
const { fetchOpsWaiting } = await import('../counts/ops')
const { navLines } = await import('../shell/navModel')
const { Side } = await import('../shell/Side')
const { PhoneTabs } = await import('../shell/Phone')
const { renderInFrame } = await import('../test-utils')
const { __resetXForTests } = await import('./useXReview')

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
  it('is a registered place, in the main nav and on the dock, after Content', () => {
    expect(PLACE_IDS).toContain('x')
    expect(PLACES.x).toMatchObject({ label: 'X', nav: 'main', dock: true })
    expect(PLACE_ORDER.indexOf('x')).toBe(PLACE_ORDER.indexOf('content') + 1)
    // the dock stays six places: X took Lanes' key, Lanes stays in the panel
    expect(PLACE_ORDER.filter(id => PLACES[id].dock)).toEqual(['home', 'dms', 'content', 'x', 'ops', 'sales'])
    expect(PLACES.lanes.nav).toBe('main')
  })

  it('redirects the old Ops address for good, query kept (runner links, delivered pushes)', () => {
    expect(canonicalHash('#exp/d/ops/x?id=abc')).toBe('#exp/d/x?id=abc')
    expect(canonicalHash('#exp/d/ops/x')).toBe('#exp/d/x')
    expect(canonicalHash('#exp/d/ops/X?id=abc&y=1')).toBe('#exp/d/x?id=abc&y=1')
    const r = parseDHash('#exp/d/ops/x?id=abc')
    expect(r.place).toBe('x')
    expect(r.sub).toBeNull()
    expect(r.query.get('id')).toBe('abc')
    expect(dHash('x', null, { id: 'abc' })).toBe('#exp/d/x?id=abc')
  })

  it('leaves every other Ops address alone', () => {
    for (const h of ['#exp/d/ops', '#exp/d/ops?card=1', '#exp/d/ops/xyz', '#exp/d/opsx', '#exp/d/x?id=1']) expect(movedXHash(h)).toBe(h)
    expect(parseDHash('#exp/d/ops?card=1').place).toBe('ops')
    expect(parseDHash('#exp/d/ops/xyz')).toMatchObject({ place: 'ops', sub: 'xyz' })
  })
})

describe('X desk count', () => {
  it('Ops no longer reads X or adds it to its number', async () => {
    expect(await fetchOpsWaiting()).toEqual({ ivan: 0, risedtc: 0, arch: 0, swishdm: 0, anna: 0 })
    expect(api.fetchXReview).not.toHaveBeenCalled()
  })

  it('the X line is Ivan-only and says when the read failed', () => {
    const sl = { value: null, failed: false, at: null }
    const seats = { ivan: sl, risedtc: sl, arch: sl, swishdm: sl, anna: sl }
    const c = { ops: sl, dms: seats, content: seats, nextCall: sl } as unknown as Parameters<typeof navLines>[0]
    expect(navLines(c, { n: 3, failed: false }).x?.line).toMatchObject({ kind: 'seats', numbers: { ivan: 3, risedtc: 0, arch: 0 } })
    expect(navLines(c, { n: null, failed: true }).x).toMatchObject({ failed: 1, line: { failed: { ivan: true, risedtc: false } } })
  })

  it('the left panel shows X with its own number off the X store (3 waiting: article + 2 drafts)', async () => {
    renderInFrame(<Side />, { layout: 'desktop', hash: '#exp/d/x' })
    const link = await waitFor(() => { const a = document.querySelector<HTMLAnchorElement>('a[href="#exp/d/x"]'); expect(a?.textContent).toContain('3'); return a! })
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(link.querySelector('.d-nt')?.getAttribute('aria-label')).toMatch(/^To review on X: Ivan 3/)
    // Ops' own number stays its own
    expect(document.querySelector('a[href="#exp/d/ops"] .d-nt')).toBeNull()
  })

  it('the phone tab bar badges X with the same number', async () => {
    renderInFrame(<PhoneTabs />, { layout: 'phone', hash: '#exp/d/home' })
    await screen.findByRole('link', { name: 'X, 3 to review on X' })
    expect(screen.queryByRole('link', { name: /^Lanes/ })).toBeNull()
  })
})
