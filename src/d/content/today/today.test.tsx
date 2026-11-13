// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderInFrame, ZERO_READERS } from '../../test-utils'
import { FrameCountsProvider } from '../../counts/useFrameCounts'
import { FrameCtx, type Frame } from '../../shell/frame'
import { canonicalHash, parseDHash, toDHash } from '../../route'
import { routableHash } from '../../../lib/turns'
import { ToastProvider } from '../../ui/toast'
import { DConfirmProvider } from '../../ui/confirm'
import { CardRefused, type TodayCard } from '../../../lib/contentCard'
import { bodySha } from '../../../lib/lineFlags'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The day's post card (db/20261112_content_daily_card): the sliding toast, the pick as the first row of Ivan's Review
// list, Home's peek and the landing rule. Every read and write is mocked. Post keeps the Review desk's one-tap hold and ends in ONE database
// call (content_card_post), so the client-side approve and schedule writes must never run for a card.
const lib = vi.hoisted(() => ({
  readTodayCard: vi.fn(), setCardState: vi.fn(), rebaseCard: vi.fn(), fetchIvanSlotRows: vi.fn(), postCard: vi.fn(),
  fetchIvanArmedDays: vi.fn(), approveReviewDraft: vi.fn(), saveDraftBody: vi.fn(), scheduleGuarded: vi.fn(), setVerdict: vi.fn(),
  answerCard: vi.fn(), weaveCard: vi.fn(), readSwapPlan: vi.fn(), postCardSwap: vi.fn(),
}))
vi.mock('../../../lib/contentCard', async orig => ({ ...(await orig<typeof import('../../../lib/contentCard')>()), readTodayCard: lib.readTodayCard, setCardState: lib.setCardState, rebaseCard: lib.rebaseCard, fetchIvanSlotRows: lib.fetchIvanSlotRows, postCard: lib.postCard, answerCard: lib.answerCard, weaveCard: lib.weaveCard, readSwapPlan: lib.readSwapPlan, postCardSwap: lib.postCardSwap }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), fetchIvanArmedDays: lib.fetchIvanArmedDays, approveReviewDraft: lib.approveReviewDraft, saveDraftBody: lib.saveDraftBody }))
vi.mock('../writes', () => ({ scheduleGuarded: lib.scheduleGuarded, archiveStaleDraft: vi.fn() }))
vi.mock('../../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../../lib/verdicts')>()), setVerdict: lib.setVerdict }))
vi.mock('../../../lib/brainPage', async orig => ({ ...(await orig<typeof import('../../../lib/brainPage')>()), fetchDraftSources: vi.fn(() => Promise.resolve(new Map())) }))
vi.mock('../useEarlyReads', () => ({ useEarlyReads: () => new Map() }))

import CardToast, { CARD_TOAST_ID, resetSlidForTest } from './CardToast'
import { HomeCard } from './HomeCard'
import { postLabel, postWords } from './keys'
import { cardLanding, cardRoute, isContentLanding, isWaiting, refreshTodayCard, resetTodayCardForTest, useTodayCard } from './store'
import { contentRedirect, subOf } from '../SubNav'
import { flushDecisions, resetDecisionsForTest, usePendingDecisions } from '../decisions'
import { resetReservedForTest } from '../weekVerbs'
import { ReviewDesk, deskModel } from '../v2/ReviewDesk'
import { buildNow } from '../weekModel'
import { resetVerdictsForTest, useJudged } from '../verdictStore'
import type { Lane } from '../model'
import type { ContentDraft } from '../../../lib/content'

const ID = '00000000-0000-4000-8000-000000000001'
const BODY = 'Kraków taught me one thing about pricing.\n\nYou charge for the result.\nA third line stays off the toast.'
const card = (o: Partial<TodayCard> = {}, d: Partial<NonNullable<TodayCard['draft']>> = {}): TodayCard => ({
  day: '2026-11-12', state: 'shown', live: 'ok', why: 'newest', picked_at: '2026-11-12T10:00:00Z',
  draft: { id: ID, client_id: null, status: 'review', type: 'text', title: 'Kraków', post_body: BODY, image_urls: null, video_url: null, taxonomy: null,
    scheduled_at: null, published_at: null, created_at: '2026-11-10T09:00:00Z', updated_at: '2026-11-10T09:00:00Z', cb34_p2_member: false, qa_verdict: 'PASS', line_flags: null, ...d },
  ...o,
})
const verb = (v: string, root: ParentNode = document) => root.querySelector(`[data-verb="${v}"]`) as HTMLButtonElement | null
const toastEl = () => document.querySelector(`[data-toast="${CARD_TOAST_ID}"]`) as HTMLElement | null

/** The frame with a route that can change between renders (the Shell keeps the toast mounted across routes). */
function Frame({ hash, children, layout = 'desktop' }: { hash: string; children: ReactNode; layout?: 'desktop' | 'phone' }) {
  const frame: Frame = { layout, route: parseDHash(hash), navigate: nav, bellOpen: false, setBellOpen: () => {}, claudeOpen: false, setClaudeOpen: () => {}, openPalette: () => {}, titleSlot: null, toolsSlot: null }
  return <FrameCountsProvider readers={ZERO_READERS}><FrameCtx.Provider value={frame}><div className={`d-app d-${layout}`}><ToastProvider><DConfirmProvider>{children}</DConfirmProvider></ToastProvider></div></FrameCtx.Provider></FrameCountsProvider>
}
const nav = vi.fn()

beforeEach(() => {
  for (const f of Object.values(lib)) f.mockReset()
  nav.mockReset()
  lib.readTodayCard.mockResolvedValue(card())
  lib.setCardState.mockResolvedValue(true)
  lib.rebaseCard.mockResolvedValue(true)
  lib.fetchIvanSlotRows.mockResolvedValue([])
  lib.fetchIvanArmedDays.mockResolvedValue(Object.assign(new Set<string>(), { times: [] }))
  lib.approveReviewDraft.mockResolvedValue(undefined)
  lib.scheduleGuarded.mockImplementation((_id: string, at: string) => Promise.resolve(at))
  lib.postCard.mockImplementation((_d: string, _i: string, _s: string, at: string) => Promise.resolve(at))
  lib.answerCard.mockResolvedValue(true)
  lib.weaveCard.mockRejectedValue(new Error('not mocked'))
  lib.readSwapPlan.mockResolvedValue(null)
  lib.postCardSwap.mockImplementation((_d: string, _i: string, _s: string, plan: { slotAt: string }) => Promise.resolve(plan.slotAt))
  resetTodayCardForTest(); resetSlidForTest(); resetDecisionsForTest(); resetReservedForTest()
})
afterEach(() => { cleanup(); resetDecisionsForTest() })

describe('the sliding post card', () => {
  it('slides in on any screen with the post’s first two lines, Post · <day HH:MM> and Open, in the polite live region', async () => {
    render(<Frame hash="#exp/d/home"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
    const t = toastEl()!
    expect(t.getAttribute('role')).toBe('status')
    expect(t.closest('[aria-live="polite"]')).toBeTruthy()
    expect(t.textContent).toContain('Kraków taught me one thing about pricing.')
    expect(t.textContent).toContain('You charge for the result.')
    expect(t.textContent).not.toContain('A third line')
    expect(verb('card-post', t)!.textContent).toMatch(/^Post · (Mon|Tue|Wed|Thu|Fri) \d\d:\d\d$/)
    expect(verb('card-open', t)!.textContent).toBe('Open')
    expect(t.textContent).not.toContain('—')
  })

  const noClientWrites = () => {
    expect(lib.approveReviewDraft).not.toHaveBeenCalled()
    expect(lib.scheduleGuarded).not.toHaveBeenCalled()
    expect(lib.setVerdict).not.toHaveBeenCalled()
    expect(lib.setCardState).not.toHaveBeenCalled()
  }
  const tapPost = async (hash = '#exp/d/lanes') => {
    render(<Frame hash={hash}><CardToast /></Frame>)
    await waitFor(() => expect(verb('card-post', toastEl()!)?.disabled).toBe(false))
    fireEvent.click(verb('card-post', toastEl()!)!)
  }

  it('Post holds for the 8 s Undo, then posts in ONE database call with the hash of the text it showed', async () => {
    await tapPost()
    expect(toastEl()).toBeNull()
    // the 8 s Undo receipt names the time; nothing is written yet
    expect(screen.getByText(/^Approved\. Posts /)).toBeTruthy()
    expect(lib.postCard).not.toHaveBeenCalled()
    await act(() => flushDecisions())
    expect(lib.postCard).toHaveBeenCalledWith('2026-11-12', ID, await bodySha(BODY), expect.stringMatching(/^20\d\d-/), expect.any(Number))
    noClientWrites()
    expect(await screen.findByText(/^Armed for /)).toBeTruthy()
  })

  it('the database decides the approve path: the client sends no brain flag', async () => {
    lib.readTodayCard.mockResolvedValue(card({}, { cb34_p2_member: true }))
    await tapPost()
    await act(() => flushDecisions())
    expect(lib.postCard.mock.calls[0]).toHaveLength(5)
    expect(lib.postCard.mock.calls[0].slice(4)).toEqual([expect.any(Number)])
  })

  it('a busy row is refused with a line to try again, and the card comes back', async () => {
    lib.postCard.mockRejectedValueOnce(new CardRefused('Not posted: it is being changed right now. Try again.', false))
    await tapPost()
    await act(() => flushDecisions())
    expect(await screen.findByText('Not posted: it is being changed right now. Try again.')).toBeTruthy()
    expect(nav).not.toHaveBeenCalled()
    noClientWrites()
  })

  it('refuses a card whose text changed since it slid in: nothing is written', async () => {
    await tapPost()
    lib.readTodayCard.mockResolvedValue(card({ live: 'changed' }))
    await act(() => flushDecisions())
    expect(lib.postCard).not.toHaveBeenCalled()
    noClientWrites()
    expect(await screen.findByText('Not posted: the text changed.')).toBeTruthy()
  })

  it('refuses when another device fixed the text during the hold (the card is still "ok", but not the text shown here)', async () => {
    await tapPost()
    lib.readTodayCard.mockResolvedValue(card({}, { post_body: 'Fixed on the phone.', updated_at: '2026-11-12T10:40:00Z' }))
    await act(() => flushDecisions())
    expect(lib.postCard).not.toHaveBeenCalled()
    noClientWrites()
    expect(await screen.findByText('Not posted: the text changed.')).toBeTruthy()
  })

  it('lines flagged during the hold refuse the card and send him to Review', async () => {
    await tapPost()
    lib.readTodayCard.mockResolvedValue(card({}, { line_flags: { lines: [{ text: 'You charge for the result.', kind: 'personal', ask: 'Is this yours?' }] } }))
    await act(() => flushDecisions())
    expect(lib.postCard).not.toHaveBeenCalled()
    expect(nav).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`)
    expect(await screen.findByText('Not posted: it has lines to check in Review.')).toBeTruthy()
  })

  it('the database refusing for QA or release sends him to Review; "already used" does not', async () => {
    lib.postCard.mockRejectedValueOnce(new CardRefused('Not posted: it needs a look in Review.', true))
    await tapPost()
    await act(() => flushDecisions())
    expect(nav).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`)
    expect(await screen.findByText('Not posted: it needs a look in Review.')).toBeTruthy()
    cleanup(); nav.mockReset(); resetTodayCardForTest(); resetSlidForTest()
    lib.postCard.mockRejectedValueOnce(new CardRefused('Not posted: the card was already used.', false))
    await tapPost()
    await act(() => flushDecisions())
    expect(nav).not.toHaveBeenCalled()
    expect(await screen.findByText('Not posted: the card was already used.')).toBeTruthy()
  })

  it('closing it writes nothing (the card is not skipped) and it does not slide in again on a route change', async () => {
    const { rerender } = render(<Frame hash="#exp/d/home"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
    fireEvent.click(verb('toast-close')!)
    expect(toastEl()).toBeNull()
    rerender(<Frame hash="#exp/d/dms"><CardToast /></Frame>)
    rerender(<Frame hash="#exp/d/content/today"><CardToast /></Frame>)
    rerender(<Frame hash="#exp/d/lanes"><CardToast /></Frame>)
    await act(async () => { await Promise.resolve() })
    expect(toastEl()).toBeNull()
    expect(lib.setCardState).not.toHaveBeenCalled()
    expect(lib.approveReviewDraft).not.toHaveBeenCalled()
  })

  it('a sideways swipe closes it too, without a write', async () => {
    render(<Frame hash="#exp/d/home" layout="phone"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
    fireEvent.touchStart(toastEl()!, { touches: [{ clientX: 200, clientY: 300 }] })
    fireEvent.touchEnd(toastEl()!, { changedTouches: [{ clientX: 40, clientY: 305 }] })
    expect(toastEl()).toBeNull()
    expect(lib.setCardState).not.toHaveBeenCalled()
  })

  it('Open goes to Review on the pick; it never slides in on a route that lands on the pick; no card, no toast', async () => {
    const a = render(<Frame hash="#exp/d/home"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
    fireEvent.click(verb('card-open', toastEl()!)!)
    expect(nav).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`)
    expect(toastEl()).toBeNull()
    a.unmount()

    for (const hash of ['#exp/d/content/today', '#exp/d/content', `#exp/d/content/now?focus=${ID}`]) {
      resetTodayCardForTest(); resetSlidForTest()
      const b = render(<Frame hash={hash}><CardToast /></Frame>)
      await waitFor(() => expect(lib.fetchIvanArmedDays).toHaveBeenCalled())
      await act(async () => { await new Promise(r => setTimeout(r, 20)) })
      expect(toastEl()).toBeNull()
      b.unmount()
    }

    for (const c of [null, card({ state: 'skipped' }), card({ state: 'posted' }), card({ live: 'decided' })]) {
      resetTodayCardForTest(); resetSlidForTest()
      lib.readTodayCard.mockResolvedValue(c)
      const r = render(<Frame hash="#exp/d/home"><CardToast /></Frame>)
      await waitFor(() => expect(lib.readTodayCard).toHaveBeenCalled())
      await act(async () => { await Promise.resolve() })
      expect(toastEl()).toBeNull()
      r.unmount()
    }
  })

  it('a draft with flagged lines to check sends him to Review, where Approve asks once', async () => {
    lib.readTodayCard.mockResolvedValue(card({}, { line_flags: { lines: [{ text: 'You charge for the result.', kind: 'personal', ask: 'Is this yours?' }] } }))
    render(<Frame hash="#exp/d/home"><CardToast /></Frame>)
    await waitFor(() => expect(verb('card-check', toastEl() ?? document.body)).toBeTruthy())
    expect(verb('card-post')).toBeNull()
    expect(verb('card-check')!.textContent).toBe('Check 1 line')
    fireEvent.click(verb('card-check')!)
    expect(nav).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`)
  })
})

describe('Home and the landing', () => {
  it('Home shows the card at the top while it waits, with the same keys', async () => {
    renderInFrame(<HomeCard />, { hash: '#exp/d/home', frame: { navigate: nav } })
    await waitFor(() => expect(document.querySelector('.ct-home')).toBeTruthy())
    expect(document.querySelector('.ct-home')!.textContent).toContain('Kraków taught me one thing about pricing.')
    fireEvent.click(verb('card-open')!)
    expect(nav).toHaveBeenCalledWith(`#exp/d/content/now?focus=${ID}`)
  })

  it('opening Content or content/today lands on Review while the card waits, else where it always did; every other tab stays as it is', () => {
    const r = (h: string) => parseDHash(h)
    expect(isContentLanding(r('#exp/d/content'))).toBe(true)
    for (const h of ['#exp/d/content', '#exp/d/content/today']) {
      expect(cardLanding(r(h), false, false)).toBe('wait')
      expect(cardLanding(r(h), true, true)).toBe('card')
      expect(cardLanding(r(h), true, false)).toBeNull()
    }
    expect(contentRedirect(null, new URLSearchParams())).toBe('#exp/d/content/plan')
    for (const h of ['#exp/d/content/plan', '#exp/d/content/now', `#exp/d/content/now?focus=${ID}`, '#exp/d/content/calendar', '#exp/d/content?lane=ivan', '#exp/d/content?draft=x', '#exp/d/home'])
      expect(cardLanding(r(h), true, true)).toBeNull()
    // the routes that land on the pick (the toast stays out of them)
    for (const h of ['#exp/d/content', '#exp/d/content/today', `#exp/d/content/now?focus=${ID}`]) expect(cardRoute(r(h), ID)).toBe(true)
    for (const h of ['#exp/d/content/now', '#exp/d/content/now?focus=other', '#exp/d/content/plan', '#exp/d/home']) expect(cardRoute(r(h), ID)).toBe(false)
    // the notification's url (db: './#exp/d/content/today') opens the card from the push and from the bell
    expect(toDHash(routableHash('./#exp/d/content/today') ?? '')).toBe('#exp/d/content/today')
    expect(canonicalHash('#exp/d/content/today')).toBe('#exp/d/content/today')
    // with no card waiting, the card's own address keeps the Plan under the done line and is never redirected
    expect(subOf('today')).toBe('plan')
    expect(contentRedirect('today', new URLSearchParams())).toBeNull()
  })
})

// Ivan's Review list as index.tsx draws it: the seat's week, and today's card while it waits (Ivan's seat only).
const NOWMS = Date.now()
const HR = 3_600_000
const draftRow = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'x', client_id: null, status: 'review', type: 'text', title: 'A post', topic: null, post_body: 'Body.',
  scheduled_at: null, published_at: null, source_post_id: null, image_urls: null, taxonomy: null,
  created_at: new Date(NOWMS - HR).toISOString(), updated_at: new Date(NOWMS - HR).toISOString(), board_visible: null, ...o,
} as ContentDraft)
const PICK = (o: Partial<ContentDraft> = {}) => draftRow({ id: ID, title: 'Kraków', post_body: BODY, created_at: new Date(NOWMS - 30 * HR).toISOString(), updated_at: '2026-11-10T09:00:00Z', ...o })
const OTHERS = [draftRow({ id: 'newer', title: 'Newer draft', post_body: 'Newer draft\n\nIts body.' }), draftRow({ id: 'older', title: 'Older draft', post_body: 'Older draft\n\nIts body.', created_at: new Date(NOWMS - 40 * HR).toISOString() })]
function Desk({ rows = [PICK(), ...OTHERS], show = 'ivan', focusId = ID, onEdit = vi.fn(), onOpen = vi.fn() }: { rows?: ContentDraft[]; show?: Lane; focusId?: string | null; onEdit?: () => void; onOpen?: () => void }) {
  const judged = useJudged()
  const pending = usePendingDecisions()
  const t = useTodayCard()
  const week = buildNow(rows, { now: NOWMS, judged, pending, show, includeBoard: true })
  const total = buildNow(rows, { now: NOWMS, judged, pending, includeBoard: true })
  return <ReviewDesk week={week} total={total} read={{ rows, source: 'live', at: null, loading: false, error: null, capped: null, settled: true, refresh: vi.fn() }} show={show} setShow={vi.fn()}
    now={NOWMS} openId={null} focusId={focusId} onOpen={onOpen} onEdit={onEdit} onChanged={vi.fn()} firstDay="2026-11-13" seatRows={() => rows} rows={rows}
    armed={new Set()} armedFailed={false} today={show === 'ivan' && isWaiting(t.card) ? t.card : null} />
}
const rowEl = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null
const listIds = () => [...document.querySelectorAll('[aria-label="Drafts to decide"] > [data-card-id]')].map(e => e.getAttribute('data-card-id'))
const openDesk = async (c: TodayCard | null, o: Parameters<typeof Desk>[0] = {}, layout?: 'phone') => {
  lib.readTodayCard.mockResolvedValue(c)
  const r = renderInFrame(<Desk {...o} />, { hash: `#exp/d/content/now?focus=${ID}`, ...(layout ? { layout } : {}) })
  await waitFor(() => expect(lib.readTodayCard).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  return r
}

describe('the pick as the first row of Ivan’s Review list', () => {
  beforeEach(() => {
    resetVerdictsForTest()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  })
  afterEach(() => { resetVerdictsForTest(); vi.unstubAllGlobals() })

  it('sorts first in the to-decide list with one Today tag, its preview open; the others keep their order and look', async () => {
    await openDesk(card())
    await waitFor(() => expect(listIds()[0]).toBe(ID))
    expect(listIds()).toEqual([ID, 'newer', 'older'])
    const pick = rowEl(ID)!
    expect(pick.querySelector('.cv2-tag-today')!.textContent).toBe('Today')
    expect(document.querySelectorAll('.cv2-tag-today')).toHaveLength(1)
    expect(pick.hasAttribute('data-today')).toBe(true)
    // the whole post reads without a tap
    expect(pick.classList.contains('cv2-row-x')).toBe(true)
    expect(pick.querySelector('.cv2-row-more')!.textContent).toContain('A third line stays off the toast.')
    for (const id of ['newer', 'older']) {
      expect(rowEl(id)!.hasAttribute('data-today')).toBe(false)
      expect(rowEl(id)!.classList.contains('cv2-row-x')).toBe(false)
      expect(rowEl(id)!.querySelector('[data-card-ask]')).toBeNull()
    }
    expect(pick.getAttribute('aria-current')).toBe('true')
    // j walks the drawn order from the pick
    act(() => { fireEvent.keyDown(window, { key: 'j' }) })
    expect(rowEl('newer')!.getAttribute('aria-current')).toBe('true')
  })

  it('with no card the list is exactly as before', async () => {
    await openDesk(null)
    expect(listIds()).toEqual(['newer', ID, 'older'])
    expect(document.querySelector('.cv2-tag-today')).toBeNull()
    expect(document.querySelector('[data-today]')).toBeNull()
    expect(document.querySelector('.cv2-row-x')).toBeNull()
  })

  it('the model: the pick leads the to-decide list and its queue (the open post walks it), out of the stale fold too', () => {
    const rows = [PICK({ created_at: new Date(NOWMS - 20 * 24 * HR).toISOString() }), ...OTHERS, draftRow({ id: 'dated', scheduled_at: new Date(NOWMS + 24 * HR).toISOString() })]
    const week = buildNow(rows, { now: NOWMS, show: 'ivan', includeBoard: true })
    const plain = deskModel(week, NOWMS)
    expect(plain.stale.map(c => c.r.id)).toEqual([ID])
    expect(plain.queue).toEqual(['dated', 'newer', 'older'])
    const withPick = deskModel(week, NOWMS, ID)
    expect(withPick.stale).toEqual([])
    expect(withPick.decide.map(c => c.r.id)).toEqual([ID, 'dated', 'newer', 'older'])
    expect(withPick.queue).toEqual([ID, 'dated', 'newer', 'older'])
  })

  it('its keys are the row’s own: Approve + schedule is the desk’s one-tap key, never the card’s post call', async () => {
    await openDesk(card())
    await waitFor(() => expect(verb('card-approve-schedule', rowEl(ID)!)?.disabled).toBe(false))
    expect(verb('card-skip', rowEl(ID)!)).toBeTruthy()
    expect(verb('card-edit', rowEl(ID)!)).toBeTruthy()
    fireEvent.click(verb('card-approve-schedule', rowEl(ID)!)!)
    await act(() => flushDecisions())
    expect(lib.approveReviewDraft).toHaveBeenCalledWith(ID)
    expect(lib.postCard).not.toHaveBeenCalled()
  })

  it('a manual edit of the pick in place moves the card to the saved text; it answers nothing', async () => {
    lib.saveDraftBody.mockResolvedValue(undefined)
    const onEdit = vi.fn()
    await openDesk(card(), { onEdit })
    await waitFor(() => expect(rowEl(ID)!.classList.contains('cv2-row-x')).toBe(true))
    fireEvent.click(verb('card-edit', rowEl(ID)!)!)
    expect(onEdit).not.toHaveBeenCalled()
    const box = screen.getByLabelText('Post text') as HTMLTextAreaElement
    expect(rowEl(ID)!.contains(box)).toBe(true)
    expect(box.value).toBe(BODY)
    fireEvent.change(box, { target: { value: 'Fixed first line.\n\nFixed second.' } })
    fireEvent.click(verb('grid-save', rowEl(ID)!)!)
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledWith(ID, 'Fixed first line.\n\nFixed second.', null, BODY, '2026-11-10T09:00:00Z'))
    await waitFor(() => expect(lib.rebaseCard).toHaveBeenCalledWith('2026-11-12', ID, 'Fixed first line.\n\nFixed second.'))
    expect(lib.answerCard).not.toHaveBeenCalled()
    await waitFor(() => expect(lib.readTodayCard.mock.calls.length).toBeGreaterThan(1))
    expect(rowEl(ID)!.querySelector('.cv2-row-more')!.textContent).toContain('Fixed first line.')
  })

  it('every other row edits and saves as before: no card write', async () => {
    lib.saveDraftBody.mockResolvedValue(undefined)
    const onEdit = vi.fn()
    await openDesk(card(), { onEdit })
    await waitFor(() => expect(listIds()[0]).toBe(ID))
    // its preview is closed, so Edit is the grid's in-place edit, exactly as before
    fireEvent.click(verb('card-edit', rowEl('newer')!)!)
    const box = rowEl('newer')!.querySelector('textarea')!
    fireEvent.change(box, { target: { value: 'Newer, fixed.' } })
    fireEvent.click(verb('grid-save', rowEl('newer')!)!)
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledWith('newer', 'Newer, fixed.', null, 'Newer draft\n\nIts body.', expect.any(String)))
    await act(async () => { await Promise.resolve() })
    expect(lib.rebaseCard).not.toHaveBeenCalled()
  })

  it('other seats are untouched: no pick, no tag, no question, no card writes', async () => {
    const rise = [draftRow({ id: 'r1', client_id: 'risedtc', title: 'Rise one' }), draftRow({ id: 'r2', client_id: 'risedtc', title: 'Rise two', created_at: new Date(NOWMS - 2 * HR).toISOString() })]
    for (const show of ['risedtc', 'arch', 'swishdm'] as const) {
      const rows = show === 'risedtc' ? rise : rise.map(r => ({ ...r, client_id: show }))
      await openDesk(card({ question: { text: 'Q?', anchor: 'A', kind: null, sha: 'a'.repeat(64), answer: null } }), { show, rows, focusId: null })
      expect(listIds()).toEqual(['r1', 'r2'])
      expect(document.querySelector('.cv2-tag-today')).toBeNull()
      expect(document.querySelector('[data-today]')).toBeNull()
      expect(document.querySelector('[data-card-ask]')).toBeNull()
      expect(document.querySelector('.cv2-row-x')).toBeNull()
      cleanup(); resetTodayCardForTest()
    }
    expect(lib.rebaseCard).not.toHaveBeenCalled()
  })

  it('the toast does not slide in over Review while the pick’s row is there; on another seat it does', async () => {
    lib.readTodayCard.mockResolvedValue(card())
    render(<Frame hash="#exp/d/content/now"><Desk focusId={null} /><CardToast /></Frame>)
    await waitFor(() => expect(rowEl(ID)?.hasAttribute('data-today')).toBe(true))
    await waitFor(() => expect(lib.fetchIvanSlotRows).toHaveBeenCalled())
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(toastEl()).toBeNull()
    cleanup(); resetTodayCardForTest(); resetSlidForTest()

    render(<Frame hash="#exp/d/content/now?lane=risedtc"><Desk show="risedtc" rows={[draftRow({ id: 'r1', client_id: 'risedtc' })]} focusId={null} /><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
  })
})

describe('the card’s one question, in the pick’s row', () => {
  const Q = 'You told the client their expert posts only reach followers. What did they say back?'
  const SHA = 'a'.repeat(64)
  const withQ = (o: Partial<NonNullable<TodayCard['question']>> = {}) => card({ question: { text: Q, anchor: 'You charge for the result.', kind: 'own_words', sha: SHA, answer: null, ...o } })
  const ask = () => document.querySelector('[data-card-ask]') as HTMLElement | null
  const input = () => ask()!.querySelector('input') as HTMLInputElement
  const WOVEN = BODY.replace('You charge for the result.', 'You charge for the result. He said "so who do we write for then?"')
  const open = async (c: TodayCard, layout?: 'phone') => {
    await openDesk(c, {}, layout)
    await waitFor(() => expect(rowEl(ID)?.hasAttribute('data-today')).toBe(true))
  }
  beforeEach(() => {
    resetVerdictsForTest()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  })
  afterEach(() => { resetVerdictsForTest(); vi.unstubAllGlobals() })

  it('nothing extra renders when there is no question', async () => {
    await open(card())
    expect(ask()).toBeNull()
    expect(rowEl(ID)!.querySelector('input[type="text"]')).toBeNull()
    expect(verb('card-ask-add')).toBeNull()
  })

  it('a live question: in the pick’s row above the post, a plain one-line input and Add, nothing else', async () => {
    await open(withQ())
    const a = ask()!
    expect(rowEl(ID)!.contains(a)).toBe(true)
    expect(a.textContent).toBe(Q + 'Add')
    expect(input().type).toBe('text')
    expect(input().placeholder).toBe('')
    expect(screen.getByLabelText(Q)).toBe(input())
    expect(verb('card-ask-add')!.textContent).toBe('Add')
    expect(verb('card-ask-add')!.disabled).toBe(true)
    // above the post: before the preview in the row's order
    expect(a.compareDocumentPosition(rowEl(ID)!.querySelector('.cv2-row-more')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(a.textContent).not.toContain('—')
    // typing in it never fires the list's keys
    fireEvent.keyDown(input(), { key: 'j' })
    expect(rowEl(ID)!.getAttribute('aria-current')).toBe('true')
  })

  it('hidden while the row shows other text than the card (stale)', async () => {
    lib.readTodayCard.mockResolvedValue(withQ())
    renderInFrame(<Desk rows={[PICK({ post_body: 'Edited elsewhere.' }), ...OTHERS]} />, { hash: `#exp/d/content/now?focus=${ID}` })
    await waitFor(() => expect(rowEl(ID)?.hasAttribute('data-today')).toBe(true))
    expect(ask()).toBeNull()
  })

  it('Add keeps his answer, asks for the woven post, opens the row’s edit on it; his save answers the question', async () => {
    lib.weaveCard.mockResolvedValue(WOVEN)
    lib.saveDraftBody.mockResolvedValue(undefined)
    await open(withQ())
    fireEvent.change(input(), { target: { value: '  he said so who do we write for then ' } })
    fireEvent.click(verb('card-ask-add')!)
    expect(lib.answerCard).toHaveBeenCalledWith('2026-11-12', ID, 'he said so who do we write for then')
    expect(lib.weaveCard).toHaveBeenCalledWith('2026-11-12', ID, SHA, 'he said so who do we write for then')
    const box = await screen.findByLabelText('Post text') as HTMLTextAreaElement
    expect(rowEl(ID)!.contains(box)).toBe(true)
    expect(box.value).toBe(WOVEN)
    // the edit is unsaved: the row's keys wait for it
    expect(verb('card-approve-schedule', rowEl(ID)!)?.disabled ?? true).toBe(true)
    // nothing was written to the draft by the weave: only his save writes
    expect(lib.saveDraftBody).not.toHaveBeenCalled()
    lib.readTodayCard.mockResolvedValue(card({}, { post_body: WOVEN, updated_at: '2026-11-12T10:30:00Z' }))
    fireEvent.click(verb('grid-save')!)
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledWith(ID, WOVEN, null, BODY, '2026-11-10T09:00:00Z'))
    await waitFor(() => expect(lib.rebaseCard).toHaveBeenCalledWith('2026-11-12', ID, WOVEN))
    await waitFor(() => expect(lib.answerCard).toHaveBeenCalledWith('2026-11-12', ID, 'he said so who do we write for then', true))
    await waitFor(() => expect(ask()).toBeNull())
    expect(rowEl(ID)!.textContent).toContain('so who do we write for then?')
  })

  it('a failed weave says one plain line and opens the edit on the unchanged text, his answer still in the input', async () => {
    lib.weaveCard.mockRejectedValue(new Error('touched_far_paragraph'))
    await open(withQ())
    fireEvent.change(input(), { target: { value: 'He laughed' } })
    fireEvent.submit(ask()!)
    expect(await screen.findByText('Could not add it. Edit the post yourself.')).toBeTruthy()
    const box = await screen.findByLabelText('Post text') as HTMLTextAreaElement
    expect(box.value).toBe(BODY)
    expect(input().value).toBe('He laughed')
    expect(lib.answerCard).toHaveBeenCalledWith('2026-11-12', ID, 'He laughed')
    // cancelling the edit leaves the answer kept and the question up; it is not marked answered
    fireEvent.click(verb('grid-cancel')!)
    expect(ask()).toBeTruthy()
    expect(lib.answerCard).not.toHaveBeenCalledWith('2026-11-12', ID, 'He laughed', true)
  })

  it('a weave that answers after the card moved on (another device fixed the text) is dropped, never opened', async () => {
    let finish: (t: string) => void = () => {}
    lib.weaveCard.mockImplementation(() => new Promise<string>(ok => { finish = ok }))
    await open(withQ())
    fireEvent.change(input(), { target: { value: 'He laughed' } })
    fireEvent.click(verb('card-ask-add')!)
    await waitFor(() => expect(lib.weaveCard).toHaveBeenCalled())
    // the phone fixed the text meanwhile: the card follows it and the question was about the old text
    lib.readTodayCard.mockResolvedValue(card({}, { post_body: 'Fixed on the phone.', updated_at: '2026-11-12T10:40:00Z' }))
    await act(() => refreshTodayCard())
    await act(async () => { finish(WOVEN) })
    expect(await screen.findByText('Could not add it. Edit the post yourself.')).toBeTruthy()
    expect(screen.queryByLabelText('Post text')).toBeNull()
    expect(rowEl(ID)!.textContent).not.toContain('so who do we write for then?')
  })

  it('a weave whose question changed under it is dropped too, his answer stays in the input', async () => {
    let finish: (t: string) => void = () => {}
    lib.weaveCard.mockImplementation(() => new Promise<string>(ok => { finish = ok }))
    await open(withQ())
    fireEvent.change(input(), { target: { value: 'He laughed' } })
    fireEvent.click(verb('card-ask-add')!)
    await waitFor(() => expect(lib.weaveCard).toHaveBeenCalled())
    lib.readTodayCard.mockResolvedValue(withQ({ sha: 'b'.repeat(64), answer: 'He laughed' }))
    await act(() => refreshTodayCard())
    await act(async () => { finish(WOVEN) })
    expect(await screen.findByText('Could not add it. Edit the post yourself.')).toBeTruthy()
    expect(screen.queryByLabelText('Post text')).toBeNull()
    expect(input().value).toBe('He laughed')
  })

  it('an answer he gave earlier is back in the input', async () => {
    await open(withQ({ answer: 'He laughed' }))
    expect(input().value).toBe('He laughed')
    expect(verb('card-ask-add')!.disabled).toBe(false)
  })

  it('works on the phone layout too: the edit opens in the row', async () => {
    lib.weaveCard.mockResolvedValue(WOVEN)
    await open(withQ(), 'phone')
    fireEvent.change(input(), { target: { value: 'He said so who do we write for' } })
    fireEvent.click(verb('card-ask-add')!)
    const box = await screen.findByLabelText('Post text') as HTMLTextAreaElement
    expect(box.value).toBe(WOVEN)
    expect(rowEl(ID)!.contains(box)).toBe(true)
  })

  it('the row’s edit shows on the phone and inside the preview (the list hides the grid’s post there)', () => {
    const css = readFileSync(resolve(__dirname, 'today.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toMatch(/\.cv2-row\[data-today\] \.cv2-gp\.cv2-gp-edit\{display:flex/)
    expect(css).toMatch(/\.cv2-row-meta \.cv2-tag\.cv2-tag-today\{display:inline-flex/)
  })

  it('the toast and Home peek stay two lines, Post and Open', async () => {
    lib.readTodayCard.mockResolvedValue(withQ())
    render(<Frame hash="#exp/d/home"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
    expect(toastEl()!.querySelector('input')).toBeNull()
    expect(toastEl()!.textContent).not.toContain(Q)
    cleanup()
    renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
    await waitFor(() => expect(document.querySelector('.ct-home')).toBeTruthy())
    expect(document.querySelector('.ct-home input')).toBeNull()
    expect(document.querySelector('.ct-home')!.textContent).not.toContain(Q)
  })
})

describe('the Post key names the real day', () => {
  // Thursday 12 Nov 2026, 22:40 Warsaw.
  const NOW = Date.parse('2026-11-12T21:40:00Z')
  it('inside the coming week the weekday and time; a week or more out the weekday and date', () => {
    expect(postWords(new Date('2026-11-13T09:45:00Z'), NOW)).toBe('Post · Fri 10:45')
    expect(postWords(new Date('2026-11-12T22:30:00Z'), NOW)).toBe('Post · Thu 23:30')
    // 6 Warsaw days out
    expect(postWords(new Date('2026-11-18T09:45:00Z'), NOW)).toBe('Post · Wed 10:45')
    // 7 Warsaw days out: the same weekday as today, so the date
    expect(postWords(new Date('2026-11-19T09:45:00Z'), NOW)).toBe('Post · Thu 19 Nov')
    // the live case: Tue 1 Dec, 19 days out
    expect(postWords(new Date('2026-12-01T09:45:00Z'), NOW)).toBe('Post · Tue 1 Dec')
    // Warsaw days, not UTC: 23:30 UTC on the 18th is already the 19th in Warsaw
    expect(postWords(new Date('2026-11-18T23:30:00Z'), NOW)).toBe('Post · Thu 19 Nov')
  })

  it('the accessible name always says the full day and time', () => {
    expect(postLabel(new Date('2026-11-13T09:45:00Z'))).toBe('Post: approve and schedule Fri 13 Nov · 10:45')
    expect(postLabel(new Date('2026-12-01T09:45:00Z'))).toBe('Post: approve and schedule Tue 1 Dec · 10:45')
  })

  it('the toast and Home show the date when the calendar is full for weeks, with the full day and time as its name', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'))
    try {
      // Every 10:45 from today to Mon 30 Nov already taken: the next free slot is Tue 1 Dec 10:45.
      const times = Array.from({ length: 19 }, (_, i) => new Date(Date.UTC(2026, 10, 12 + i, 9, 45)).toISOString())
      lib.fetchIvanArmedDays.mockResolvedValue(Object.assign(new Set<string>(), { times }))
      const name = 'Post: approve and schedule Tue 1 Dec · 10:45'
      render(<Frame hash="#exp/d/dms"><CardToast /></Frame>)
      await waitFor(() => expect(toastEl()).toBeTruthy())
      expect(verb('card-post', toastEl()!)!.textContent).toBe('Post · Tue 1 Dec')
      expect(verb('card-post', toastEl()!)!.getAttribute('aria-label')).toBe(name)
      cleanup(); resetTodayCardForTest()
      renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
      await waitFor(() => expect(verb('card-post')?.textContent).toBe('Post · Tue 1 Dec'))
      expect(verb('card-post')!.getAttribute('aria-label')).toBe(name)
    } finally { vi.useRealTimers() }
  })
})

describe('the toast and Home’s card block', () => {
  it('never slides in on Home while Home shows the card block; still slides in elsewhere', async () => {
    render(<Frame hash="#exp/d/home"><HomeCard /><CardToast /></Frame>)
    await waitFor(() => expect(document.querySelector('.ct-home')).toBeTruthy())
    await waitFor(() => expect(verb('card-post', document.querySelector('.ct-home')!)?.disabled).toBe(false))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(toastEl()).toBeNull()
    cleanup(); resetTodayCardForTest(); resetSlidForTest()

    render(<Frame hash="#exp/d/dms"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
  })

  it('a toast already in when he goes Home leaves once the card block is there', async () => {
    const { rerender } = render(<Frame hash="#exp/d/dms"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
    rerender(<Frame hash="#exp/d/home"><HomeCard /><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeNull())
    expect(document.querySelector('.ct-home')).toBeTruthy()
    expect(lib.setCardState).not.toHaveBeenCalled()
  })
})

// A Poland pick in a week short on Poland (db/20261114b_content_card_poland_swap): Post takes a slot of this week and
// the business post that held it moves to the next free slot.
describe('the Poland swap', () => {
  const PLAN = { day: '2026-11-12', draftId: ID, incumbent: '00000000-0000-4000-8000-0000000000aa', slotAt: '2026-11-17T17:30:00.000Z', autopilot: true,
    title: 'Before I automate an outreach campaign, I want it to have worked by hand at least a few times first' }
  const full = () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'))
    // Every 10:45 from today to Mon 30 Nov already taken: the next free slot is Tue 1 Dec 10:45.
    const times = Array.from({ length: 19 }, (_, i) => new Date(Date.UTC(2026, 10, 12 + i, 9, 45)).toISOString())
    lib.fetchIvanArmedDays.mockResolvedValue(Object.assign(new Set<string>(), { times }))
  }

  it('Post names this week’s slot, says which post moves and where, and writes the swap in one call', async () => {
    full()
    try {
      lib.readTodayCard.mockResolvedValue(card({ why: 'poland' }))
      lib.readSwapPlan.mockResolvedValue(PLAN)
      renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
      await waitFor(() => expect(verb('card-post')?.textContent).toBe('Post · Tue 18:30'))
      const line = document.querySelector('[data-card-moves]')!.textContent!
      expect(line).toMatch(/^Takes this week’s slot\. “Before I automate an outreach campaign, I want it…” moves to Tue 1 Dec\.$/)
      expect(line).not.toContain('—')
      fireEvent.click(verb('card-post')!)
      expect(lib.postCardSwap).not.toHaveBeenCalled()
      await act(() => flushDecisions())
      expect(lib.postCardSwap).toHaveBeenCalledWith('2026-11-12', ID, await bodySha(BODY), PLAN, '2026-12-01T09:45:00.000Z', expect.any(Number))
      expect(lib.postCard).not.toHaveBeenCalled()
      expect(lib.approveReviewDraft).not.toHaveBeenCalled()
      expect(lib.scheduleGuarded).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('a business pick never asks for a swap', async () => {
    full()
    try {
      lib.readSwapPlan.mockResolvedValue(PLAN)
      renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
      await waitFor(() => expect(verb('card-post')?.textContent).toBe('Post · Tue 1 Dec'))
      expect(lib.readSwapPlan).not.toHaveBeenCalled()
      expect(document.querySelector('[data-card-moves]')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('no plan, a failed plan read, or a plan for another draft: Post takes the next free slot as before', async () => {
    full()
    try {
      lib.readTodayCard.mockResolvedValue(card({ why: 'poland' }))
      for (const plan of [() => Promise.resolve(null), () => Promise.reject(new Error('down')), () => Promise.resolve({ ...PLAN, draftId: 'other' })]) {
        lib.readSwapPlan.mockImplementation(plan)
        renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
        await waitFor(() => expect(verb('card-post')?.textContent).toBe('Post · Tue 1 Dec'))
        await waitFor(() => expect(lib.readSwapPlan).toHaveBeenCalled())
        expect(document.querySelector('[data-card-moves]')).toBeNull()
        cleanup(); resetTodayCardForTest(); lib.readSwapPlan.mockReset()
      }
      lib.readSwapPlan.mockResolvedValue(null)
      renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
      await waitFor(() => expect(verb('card-post')?.disabled).toBe(false))
      fireEvent.click(verb('card-post')!)
      await act(() => flushDecisions())
      expect(lib.postCard).toHaveBeenCalledWith('2026-11-12', ID, await bodySha(BODY), '2026-12-01T09:45:00.000Z', expect.any(Number))
      expect(lib.postCardSwap).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('a plan whose slot is not earlier than the next free slot is ignored', async () => {
    lib.readTodayCard.mockResolvedValue(card({ why: 'poland' }))
    lib.readSwapPlan.mockResolvedValue({ ...PLAN, slotAt: '2099-01-01T10:00:00.000Z' })
    renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
    await waitFor(() => expect(lib.readSwapPlan).toHaveBeenCalled())
    await waitFor(() => expect(verb('card-post')?.disabled).toBe(false))
    expect(document.querySelector('[data-card-moves]')).toBeNull()
  })
})
