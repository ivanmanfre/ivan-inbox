// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { ZERO_READERS } from '../../test-utils'
import { FrameCountsProvider } from '../../counts/useFrameCounts'
import { FrameCtx, type Frame } from '../../shell/frame'
import { ToastProvider } from '../../ui/toast'
import { DConfirmProvider } from '../../ui/confirm'
import { parseDHash } from '../../route'
import type { TodayCard } from '../../../lib/contentCard'
import type { ContentDraft } from '../../../lib/content'
import type { NextPost } from '../../../lib/contentNext'

// Content's landing while an upcoming post will not go out (index.tsx): Review, Ivan's seat, the remembered seat left
// as it was. With nothing held it lands on Plan as before; today's waiting card keeps its own landing. The page's reads
// are stubbed (the same stubs as today/landing.test.tsx); the Review desk is a stub that shows the seat it was given.
const lib = vi.hoisted(() => ({ readTodayCard: vi.fn(), readNextPosts: vi.fn() }))
vi.mock('../../../lib/contentCard', async orig => ({ ...(await orig<typeof import('../../../lib/contentCard')>()), readTodayCard: lib.readTodayCard }))
vi.mock('../../../lib/contentNext', async orig => ({ ...(await orig<typeof import('../../../lib/contentNext')>()), readNextPosts: lib.readNextPosts }))
const ID = '00000000-0000-4000-8000-000000000001'
vi.mock('../useContentData', () => {
  const seat = { rows: [] as ContentDraft[], loading: false, error: null, loadedAt: '2026-11-13T10:00:00Z', refresh: () => {} }
  const v = { seats: { ivan: seat, risedtc: seat, arch: seat, swishdm: seat }, armed: new Set(), armedFailed: false, verdict: null, blocks: new Map(), queueRows: [], failed: 0, refreshAll: () => {} }
  return { useContentData: () => v }
})
vi.mock('../useWeek', () => {
  const read = { rows: [], source: 'live', at: null, loading: false, error: null, capped: null, settled: true, refresh: () => {} }
  return { useWeekRead: () => read }
})
vi.mock('../useVerdicts', () => { const v = { map: new Map(), error: null, loaded: true }; return { useVerdicts: () => v } })
vi.mock('../useMagnetCounts', () => { const m = { ivan: 0, risedtc: 0, arch: 0, swishdm: 0 }; return { useMagnetCounts: () => m } })
vi.mock('../../../hooks/useLanes', () => { const l = { lanes: [] }; return { useLanes: () => l } })
vi.mock('../../../lib/clientBoardState', async orig => ({ ...(await orig<typeof import('../../../lib/clientBoardState')>()), useClientBoardState: () => 0 }))
vi.mock('../v2/flags', () => { const f = { frame: true, brain: true, calendar: true, ideas: true, review: true, lms: true, plan: true }; return { useContentFlags: () => f } })
vi.mock('../plan/PlanV2', () => ({ PlanV2: () => <div data-plan /> }))
vi.mock('../Ideas', () => {
  const bank = { loading: false, items: [], error: null }
  const banks = { ivan: bank, risedtc: bank, arch: bank, swishdm: bank }
  return { Ideas: () => null, useIdeaBanks: () => banks }
})
vi.mock('../v2/ReviewDesk', async orig => ({
  ...(await orig<typeof import('../v2/ReviewDesk')>()),
  ReviewDesk: ({ show, today }: { show: string; today: TodayCard | null }) => <div data-desk data-show={show} data-today={today?.draft?.id ?? ''} />,
}))

import ContentPage from '../index'
import { resetTodayCardForTest } from '../today/store'
import { resetNextPostsForTest } from './store'

const SHOW_KEY = 'd-content-review-show'
const post = (o: Partial<NextPost> = {}): NextPost => ({
  queue_id: 'q1', draft_id: 'd1', slot_at: '2026-11-16T13:00:00+00:00', state: 'ready', origin: 'own', kept: false, fails: [],
  post_text: 'Hook.', post_format: 'text', in_sync: true, urls: [], media_urls: [], ...o,
})
const card = (): TodayCard => ({
  day: '2026-11-13', state: 'shown', live: 'ok', why: 'newest', picked_at: '2026-11-13T10:00:00Z',
  draft: { id: ID, client_id: null, status: 'review', type: 'text', title: 'Kraków', post_body: 'Kraków.', image_urls: null, video_url: null, taxonomy: null,
    scheduled_at: null, published_at: null, created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z', cb34_p2_member: false, qa_verdict: 'PASS', line_flags: null },
})
const desk = () => document.querySelector('[data-desk]') as HTMLElement | null
const page = (hash: string, navigate = vi.fn()) => {
  const ui = (h: string) => {
    const frame: Frame = { layout: 'desktop', route: parseDHash(h), navigate, bellOpen: false, setBellOpen: () => {}, claudeOpen: false, setClaudeOpen: () => {}, openPalette: () => {}, titleSlot: null, toolsSlot: null }
    return <FrameCountsProvider readers={ZERO_READERS}><FrameCtx.Provider value={frame}><div className="d-app d-desktop"><ToastProvider><DConfirmProvider>
      <ContentPage layout="desktop" route={frame.route} navigate={navigate} />
    </DConfirmProvider></ToastProvider></div></FrameCtx.Provider></FrameCountsProvider>
  }
  const r = render(ui(hash))
  return { ...r, navigate, go: (h: string) => r.rerender(ui(h)) }
}

beforeEach(() => {
  lib.readTodayCard.mockReset(); lib.readNextPosts.mockReset()
  lib.readTodayCard.mockResolvedValue(null)
  resetTodayCardForTest(); resetNextPostsForTest()
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

describe('Content’s landing and the posts going out next', () => {
  it('a held post: Content lands on Review, Ivan’s seat, the remembered seat kept', async () => {
    localStorage.setItem(SHOW_KEY, 'risedtc')
    lib.readNextPosts.mockResolvedValue([post(), post({ queue_id: 'q2', slot_at: '2026-11-20T17:30:00+00:00', state: 'held', origin: 'autopilot' })])
    const p = page('#exp/d/content')
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith('#exp/d/content/now?next=1'))
    expect(p.navigate).toHaveBeenCalledTimes(1)
    // never a flash of Plan on the way
    expect(document.querySelector('[data-plan]')).toBeNull()
    p.go('#exp/d/content/now?next=1')
    await waitFor(() => expect(desk()).toBeTruthy())
    await act(async () => { await Promise.resolve() })
    expect(desk()!.dataset.show).toBe('ivan')
    expect(localStorage.getItem(SHOW_KEY)).toBe('risedtc')
  })
  it('nothing held: Content lands on Plan as before', async () => {
    lib.readNextPosts.mockResolvedValue([post(), post({ queue_id: 'q2', state: 'checking', origin: 'autopilot' })])
    const p = page('#exp/d/content')
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith('#exp/d/content/plan'))
    expect(p.navigate).toHaveBeenCalledTimes(1)
  })
  it('a failed read of the next posts never blocks the landing', async () => {
    lib.readNextPosts.mockRejectedValue(new Error('function content_next_posts does not exist'))
    const p = page('#exp/d/content')
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith('#exp/d/content/plan'))
  })
  it('today’s waiting card keeps its own landing, held post or not', async () => {
    lib.readTodayCard.mockResolvedValue(card())
    lib.readNextPosts.mockResolvedValue([post({ state: 'held', origin: 'autopilot' })])
    const p = page('#exp/d/content')
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`))
    expect(p.navigate).toHaveBeenCalledTimes(1)
  })
  it('Review opened by hand keeps the remembered seat', async () => {
    localStorage.setItem(SHOW_KEY, 'risedtc')
    lib.readNextPosts.mockResolvedValue([post({ state: 'held', origin: 'autopilot' })])
    const p = page('#exp/d/content/now')
    await waitFor(() => expect(lib.readNextPosts).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(desk()!.dataset.show).toBe('risedtc')
    expect(p.navigate).not.toHaveBeenCalled()
  })
})
