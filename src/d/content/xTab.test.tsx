// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ZERO_READERS } from '../test-utils'
import { FrameCountsProvider } from '../counts/useFrameCounts'
import { FrameCtx, type Frame } from '../shell/frame'
import { ToastProvider } from '../ui/toast'
import { DConfirmProvider } from '../ui/confirm'
import { canonicalHash, parseDHash } from '../route'
import type { ContentDraft } from '../../lib/content'
import type { PlaceProps } from '../places'

// X is a Content tab (daily-brief-trim Task 6.1). A push or runner link to the X desk's old address lands on
// `#exp/d/content/x?id=<id>`, and the tab hands that id to the X review, which opens the post. The X review is a
// stub that shows the route it was given; the page's own reads are stubbed as in next/landing.test.tsx.
const lib = vi.hoisted(() => ({ readTodayCard: vi.fn(), readNextPosts: vi.fn(), fetchXReview: vi.fn() }))
vi.mock('../../lib/contentCard', async orig => ({ ...(await orig<typeof import('../../lib/contentCard')>()), readTodayCard: lib.readTodayCard }))
vi.mock('../../lib/contentNext', async orig => ({ ...(await orig<typeof import('../../lib/contentNext')>()), readNextPosts: lib.readNextPosts }))
vi.mock('../../lib/xReview', async orig => ({ ...(await orig<typeof import('../../lib/xReview')>()), fetchXReview: lib.fetchXReview }))
vi.mock('./useContentData', () => {
  const seat = { rows: [] as ContentDraft[], loading: false, error: null, loadedAt: '2026-11-13T10:00:00Z', refresh: () => {} }
  const v = { seats: { ivan: seat, risedtc: seat, arch: seat, swishdm: seat }, armed: new Set(), armedFailed: false, verdict: null, blocks: new Map(), queueRows: [], failed: 0, refreshAll: () => {} }
  return { useContentData: () => v }
})
vi.mock('./useWeek', () => {
  const read = { rows: [], source: 'live', at: null, loading: false, error: null, capped: null, settled: true, refresh: () => {} }
  return { useWeekRead: () => read }
})
vi.mock('./useVerdicts', () => { const v = { map: new Map(), error: null, loaded: true }; return { useVerdicts: () => v } })
vi.mock('./useMagnetCounts', () => { const m = { ivan: 0, risedtc: 0, arch: 0, swishdm: 0 }; return { useMagnetCounts: () => m } })
vi.mock('../../hooks/useLanes', () => { const l = { lanes: [] }; return { useLanes: () => l } })
vi.mock('../../lib/clientBoardState', async orig => ({ ...(await orig<typeof import('../../lib/clientBoardState')>()), useClientBoardState: () => 0 }))
vi.mock('./v2/flags', () => { const f = { frame: true, brain: true, calendar: true, ideas: true, review: true, lms: true, plan: true }; return { useContentFlags: () => f } })
vi.mock('./plan/PlanV2', () => ({ PlanV2: () => <div data-plan /> }))
vi.mock('./Ideas', () => {
  const bank = { loading: false, items: [], error: null }
  const banks = { ivan: bank, risedtc: bank, arch: bank, swishdm: bank }
  return { Ideas: () => null, useIdeaBanks: () => banks }
})
vi.mock('../x/XReview', () => ({
  default: ({ route, layout, embedded }: PlaceProps & { embedded?: boolean }) => <div data-x-review data-id={route.query.get('id') ?? ''} data-layout={layout} data-embedded={embedded ? 'yes' : 'no'} />,
}))

import ContentPage from './index'
import { resetTodayCardForTest } from './today/store'
import { resetNextPostsForTest } from './next/store'
import { __resetXForTests } from '../x/useXReview'

const page = (hash: string, navigate = vi.fn()) => {
  const frame: Frame = { layout: 'desktop', route: parseDHash(hash), navigate, bellOpen: false, setBellOpen: () => {}, claudeOpen: false, setClaudeOpen: () => {}, openPalette: () => {}, titleSlot: null, toolsSlot: null }
  render(<FrameCountsProvider readers={ZERO_READERS}><FrameCtx.Provider value={frame}><div className="d-app d-desktop"><ToastProvider><DConfirmProvider>
    <ContentPage layout="desktop" route={frame.route} navigate={navigate} />
  </DConfirmProvider></ToastProvider></div></FrameCtx.Provider></FrameCountsProvider>)
  return { navigate }
}
const review = () => document.querySelector<HTMLElement>('[data-x-review]')

beforeEach(() => {
  lib.readTodayCard.mockReset(); lib.readNextPosts.mockReset(); lib.fetchXReview.mockReset()
  lib.readTodayCard.mockResolvedValue(null)
  lib.readNextPosts.mockResolvedValue([])
  lib.fetchXReview.mockResolvedValue({ articles: [], quotes: [], quicks: [] })
  resetTodayCardForTest(); resetNextPostsForTest(); __resetXForTests()
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

describe('the X tab inside Content', () => {
  it('opens the post a link names: #exp/d/content/x?id=abc hands id abc to the X review', async () => {
    const p = page('#exp/d/content/x?id=abc')
    await waitFor(() => expect(review()?.dataset.id).toBe('abc'))
    expect(review()?.dataset.layout).toBe('desktop')
    // the tab is open, and the page never redirects away from it
    expect(document.querySelector('a[data-sub="x"]')?.getAttribute('aria-current')).toBe('page')
    expect(p.navigate).not.toHaveBeenCalled()
    expect(document.querySelector('[data-plan]')).toBeNull()
  })

  it('an old push address reaches the same post through the redirect', async () => {
    for (const old of ['#exp/d/x?id=abc', '#exp/d/ops/x?id=abc']) {
      page(canonicalHash(old))
      await waitFor(() => expect(review()?.dataset.id).toBe('abc'))
      cleanup()
    }
  })

  it('the bare tab lists what waits (no id)', async () => {
    page('#exp/d/content/x')
    await waitFor(() => expect(review()).not.toBeNull())
    expect(review()?.dataset.id).toBe('')
  })

  it('the X tab counts what waits on X', async () => {
    lib.fetchXReview.mockResolvedValue({ articles: [{ id: 'a1', status: 'review', title: 'A', created_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-07T10:00:00Z' }], quotes: [], quicks: [] })
    page('#exp/d/content/x')
    await screen.findByLabelText('1 waiting')
  })

  it('the X review is told it sits inside Content, so it does not repeat the page title', async () => {
    page('#exp/d/content/x')
    await waitFor(() => expect(review()?.dataset.embedded).toBe('yes'))
  })

  it('a failed X read puts a ! on the X tab only; Content and the other tabs stay as they were', async () => {
    lib.fetchXReview.mockRejectedValue(new Error('x down'))
    page('#exp/d/content/x')
    const mark = await screen.findByLabelText('X count could not be read')
    expect(mark.textContent).toBe('!')
    expect(document.querySelector('a[data-sub="x"]')?.contains(mark)).toBe(true)
    expect(document.querySelector('a[data-sub="x"] [aria-label$="waiting"]')).toBeNull()
    expect(document.querySelectorAll('[aria-label="X count could not be read"]')).toHaveLength(1)
  })

  it('a loading X read shows neither a number nor the failure mark on the X tab', async () => {
    lib.fetchXReview.mockReturnValue(new Promise(() => {}))
    page('#exp/d/content/x')
    await waitFor(() => expect(review()).not.toBeNull())
    const tab = document.querySelector('a[data-sub="x"]')!
    expect(tab.querySelector('[aria-label$="waiting"]')).toBeNull()
    expect(screen.queryByLabelText('X count could not be read')).toBeNull()
  })
})
