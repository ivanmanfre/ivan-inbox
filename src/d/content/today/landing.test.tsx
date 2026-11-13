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

// Content's landing while today's post card waits (index.tsx): Review, Ivan's seat, focused on the card's draft, the
// remembered seat left as it was. With no card it lands on Plan as before. The page's reads are stubbed; the Review
// desk is a stub that shows what the page hands it.
const lib = vi.hoisted(() => ({ readTodayCard: vi.fn() }))
vi.mock('../../../lib/contentCard', async orig => ({ ...(await orig<typeof import('../../../lib/contentCard')>()), readTodayCard: lib.readTodayCard }))
const ID = '00000000-0000-4000-8000-000000000001'
const ROWS = vi.hoisted(() => ({ rows: [] as ContentDraft[] }))
vi.mock('../useContentData', () => {
  const seat = (rows: ContentDraft[]) => ({ rows, loading: false, error: null, loadedAt: '2026-11-13T10:00:00Z', refresh: () => {} })
  // One object per test's rows (the page keys its models on it), built when the page first reads it.
  let data: { rows: ContentDraft[]; v: unknown } | null = null
  const of = () => {
    if (data?.rows !== ROWS.rows) data = { rows: ROWS.rows, v: { seats: { ivan: seat(ROWS.rows), risedtc: seat([]), arch: seat([]), swishdm: seat([]) }, armed: new Set(), armedFailed: false, verdict: null, blocks: new Map(), queueRows: [], refreshAll: () => {}, failed: 0 } }
    return data.v
  }
  return { useContentData: of }
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
  ReviewDesk: ({ show, focusId, today }: { show: string; focusId: string | null; today: TodayCard | null }) =>
    <div data-desk data-show={show} data-focus={focusId ?? ''} data-today={today?.draft?.id ?? ''} />,
}))

import ContentPage from '../index'
import { resetTodayCardForTest } from './store'

const SHOW_KEY = 'd-content-review-show'
const card = (o: Partial<TodayCard> = {}): TodayCard => ({
  day: '2026-11-13', state: 'shown', live: 'ok', why: 'newest', picked_at: '2026-11-13T10:00:00Z',
  draft: { id: ID, client_id: null, status: 'review', type: 'text', title: 'Kraków', post_body: 'Kraków.\n\nBody.', image_urls: null, video_url: null, taxonomy: null,
    scheduled_at: null, published_at: null, created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z', cb34_p2_member: false, qa_verdict: 'PASS', line_flags: null },
  ...o,
})
const desk = () => document.querySelector('[data-desk]') as HTMLElement | null
/** The page in the frame's providers; `go` moves the route with the page kept mounted, as the Shell does. */
const page = (hash: string, navigate = vi.fn(), layout: 'desktop' | 'phone' = 'desktop') => {
  const ui = (h: string) => {
    const frame: Frame = { layout, route: parseDHash(h), navigate, bellOpen: false, setBellOpen: () => {}, claudeOpen: false, setClaudeOpen: () => {}, openPalette: () => {}, titleSlot: null, toolsSlot: null }
    return <FrameCountsProvider readers={ZERO_READERS}><FrameCtx.Provider value={frame}><div className={`d-app d-${layout}`}><ToastProvider><DConfirmProvider>
      <ContentPage layout={layout} route={frame.route} navigate={navigate} />
    </DConfirmProvider></ToastProvider></div></FrameCtx.Provider></FrameCountsProvider>
  }
  const r = render(ui(hash))
  return { ...r, navigate, go: (h: string) => r.rerender(ui(h)) }
}

beforeEach(() => {
  lib.readTodayCard.mockReset()
  resetTodayCardForTest()
  ROWS.rows = [{ id: ID, client_id: null, status: 'review', type: 'text', title: 'Kraków', post_body: 'Kraków.\n\nBody.', created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z', scheduled_at: null, published_at: null, board_visible: null } as ContentDraft]
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

describe('Content’s landing and today’s card', () => {
  it.each(['desktop', 'phone'] as const)('card waiting (%s): Content lands on Review focused on the pick, Ivan’s seat, the remembered seat kept', async layout => {
    localStorage.setItem(SHOW_KEY, 'risedtc')
    lib.readTodayCard.mockResolvedValue(card())
    const p = page('#exp/d/content', vi.fn(), layout)
    // the landing waits for the card's read, then goes to the pick
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`))
    expect(p.navigate).toHaveBeenCalledTimes(1)
    p.go(`#exp/d/content/now?focus=${ID}`)
    await waitFor(() => expect(desk()).toBeTruthy())
    expect(desk()!.dataset.show).toBe('ivan')
    expect(desk()!.dataset.focus).toBe(ID)
    expect(desk()!.dataset.today).toBe(ID)
    await act(async () => { await Promise.resolve() })
    expect(desk()!.dataset.show).toBe('ivan')
    expect(localStorage.getItem(SHOW_KEY)).toBe('risedtc')
    expect(document.querySelector('[data-today-card]')).toBeNull()
  })

  it('content/today (the push, old links) goes to the same place while the card waits', async () => {
    lib.readTodayCard.mockResolvedValue(card())
    const p = page('#exp/d/content/today')
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`))
    expect(document.querySelector('[data-plan]')).toBeNull()
  })

  it('no card: Content lands on Plan exactly as before; content/today keeps the Plan', async () => {
    lib.readTodayCard.mockResolvedValue(null)
    const p = page('#exp/d/content')
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith('#exp/d/content/plan'))
    expect(p.navigate).toHaveBeenCalledTimes(1)
    cleanup(); resetTodayCardForTest()
    const t = page('#exp/d/content/today')
    await waitFor(() => expect(document.querySelector('[data-plan]')).toBeTruthy())
    expect(t.navigate).not.toHaveBeenCalled()
  })

  it('a card no longer waiting: content/today shows its done line over the Plan, no redirect', async () => {
    lib.readTodayCard.mockResolvedValue(card({ state: 'skipped' }))
    const p = page('#exp/d/content/today')
    await waitFor(() => expect(document.querySelector('[data-plan]')).toBeTruthy())
    expect(document.querySelector('.ct-done')!.textContent).toBe('Skipped for today. It stays in Review. Review →')
    expect(p.navigate).not.toHaveBeenCalled()
  })

  it('Review without the pick in its address keeps the remembered seat; the pick rides only on Ivan’s seat', async () => {
    localStorage.setItem(SHOW_KEY, 'risedtc')
    lib.readTodayCard.mockResolvedValue(card())
    page('#exp/d/content/now')
    await waitFor(() => expect(lib.readTodayCard).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(desk()!.dataset.show).toBe('risedtc')
    expect(desk()!.dataset.today).toBe('')
    cleanup(); resetTodayCardForTest(); localStorage.clear()
    page('#exp/d/content/now')
    await waitFor(() => expect(desk()?.dataset.today).toBe(ID))
    expect(desk()!.dataset.show).toBe('ivan')
  })
})
