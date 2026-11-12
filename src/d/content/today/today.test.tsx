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

// The day's post card (db/20261112_content_daily_card): the sliding toast, the card on Content, Home's peek and the
// landing rule. Every read and write is mocked. Post keeps the Review desk's one-tap hold and ends in ONE database
// call (content_card_post), so the client-side approve and schedule writes must never run for a card.
const lib = vi.hoisted(() => ({
  readTodayCard: vi.fn(), setCardState: vi.fn(), rebaseCard: vi.fn(), fetchIvanSlotRows: vi.fn(), postCard: vi.fn(),
  fetchIvanArmedDays: vi.fn(), approveReviewDraft: vi.fn(), saveDraftBody: vi.fn(), scheduleGuarded: vi.fn(), setVerdict: vi.fn(),
}))
vi.mock('../../../lib/contentCard', async orig => ({ ...(await orig<typeof import('../../../lib/contentCard')>()), readTodayCard: lib.readTodayCard, setCardState: lib.setCardState, rebaseCard: lib.rebaseCard, fetchIvanSlotRows: lib.fetchIvanSlotRows, postCard: lib.postCard }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), fetchIvanArmedDays: lib.fetchIvanArmedDays, approveReviewDraft: lib.approveReviewDraft, saveDraftBody: lib.saveDraftBody }))
vi.mock('../writes', () => ({ scheduleGuarded: lib.scheduleGuarded, archiveStaleDraft: vi.fn() }))
vi.mock('../../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../../lib/verdicts')>()), setVerdict: lib.setVerdict }))

import CardToast, { CARD_TOAST_ID, resetSlidForTest } from './CardToast'
import { TodayCardView } from './TodayCard'
import { HomeCard } from './HomeCard'
import { cardLanding, cardOnScreen, isContentLanding, resetTodayCardForTest } from './store'
import { contentRedirect, subOf } from '../SubNav'
import { flushDecisions, resetDecisionsForTest } from '../decisions'
import { resetReservedForTest } from '../weekVerbs'

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
    expect(lib.postCard).toHaveBeenCalledWith('2026-11-12', ID, await bodySha(BODY), expect.stringMatching(/^20\d\d-/), false, expect.any(Number))
    noClientWrites()
    expect(await screen.findByText(/^Armed for /)).toBeTruthy()
  })

  it('a brain draft asks the database for the cb39 keep verdict, as the Review desk does', async () => {
    lib.readTodayCard.mockResolvedValue(card({}, { cb34_p2_member: true }))
    await tapPost()
    await act(() => flushDecisions())
    expect(lib.postCard.mock.calls[0][4]).toBe(true)
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

  it('Open goes to the card; it never slides in over the card itself; no card, no toast', async () => {
    const a = render(<Frame hash="#exp/d/home"><CardToast /></Frame>)
    await waitFor(() => expect(toastEl()).toBeTruthy())
    fireEvent.click(verb('card-open', toastEl()!)!)
    expect(nav).toHaveBeenCalledWith('#exp/d/content/today')
    expect(toastEl()).toBeNull()
    a.unmount()

    resetTodayCardForTest(); resetSlidForTest()
    const b = render(<Frame hash="#exp/d/content/today"><CardToast /></Frame>)
    await waitFor(() => expect(lib.fetchIvanArmedDays).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(toastEl()).toBeNull()
    b.unmount()

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

describe('the card on Content', () => {
  it('shows the whole post with Post, Skip and Fix', async () => {
    renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today' })
    await waitFor(() => expect(document.querySelector('[data-today-card]')).toBeTruthy())
    const el = document.querySelector('[data-today-card]')!
    expect(el.textContent).toContain('Kraków taught me one thing about pricing.')
    expect(el.textContent).toContain('A third line stays off the toast.')
    expect(el.textContent).not.toContain('see more')
    await waitFor(() => expect(verb('card-post', el)?.disabled).toBe(false))
    expect(verb('card-post', el)!.textContent).toMatch(/^Post · /)
    expect(verb('card-skip', el)).toBeTruthy()
    expect(verb('card-fix', el)).toBeTruthy()
  })

  it('Skip asks nothing, marks the card skipped and leaves the draft alone; Undo brings it back', async () => {
    renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today' })
    await waitFor(() => expect(verb('card-skip')).toBeTruthy())
    fireEvent.click(verb('card-skip')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(document.querySelector('[data-today-card]')).toBeNull()
    await waitFor(() => expect(lib.setCardState).toHaveBeenCalledWith('2026-11-12', ID, 'skipped'))
    expect(lib.approveReviewDraft).not.toHaveBeenCalled()
    expect(lib.saveDraftBody).not.toHaveBeenCalled()
    expect(lib.setVerdict).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(lib.setCardState).toHaveBeenCalledWith('2026-11-12', ID, 'shown'))
  })

  it('Fix is the Review grid’s in-place edit (compare-and-swap save); the card follows the fixed text and Post posts it', async () => {
    lib.saveDraftBody.mockResolvedValue(undefined)
    renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today' })
    await waitFor(() => expect(verb('card-fix')).toBeTruthy())
    fireEvent.click(verb('card-fix')!)
    const box = screen.getByLabelText('Post text') as HTMLTextAreaElement
    expect(box.value).toBe(BODY)
    expect(verb('card-post')!.disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'Fixed first line.\n\nFixed second.' } })
    lib.readTodayCard.mockResolvedValue(card({}, { post_body: 'Fixed first line.\n\nFixed second.', updated_at: '2026-11-12T10:30:00Z' }))
    fireEvent.click(verb('grid-save')!)
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledWith(ID, 'Fixed first line.\n\nFixed second.', null, BODY, '2026-11-10T09:00:00Z'))
    await waitFor(() => expect(lib.rebaseCard).toHaveBeenCalledWith('2026-11-12', ID, 'Fixed first line.\n\nFixed second.'))
    await waitFor(() => expect(document.querySelector('[data-today-card]')!.textContent).toContain('Fixed first line.'))
    await waitFor(() => expect(verb('card-post')?.disabled).toBe(false))
    fireEvent.click(verb('card-post')!)
    await act(() => flushDecisions())
    expect(lib.postCard).toHaveBeenCalledWith('2026-11-12', ID, await bodySha('Fixed first line.\n\nFixed second.'), expect.any(String), false, expect.any(Number))
    expect(lib.approveReviewDraft).not.toHaveBeenCalled()
  })
})

describe('Home and the landing', () => {
  it('Home shows the card at the top while it waits, with the same keys', async () => {
    renderInFrame(<HomeCard />, { hash: '#exp/d/home' })
    await waitFor(() => expect(document.querySelector('.ct-home')).toBeTruthy())
    expect(document.querySelector('.ct-home')!.textContent).toContain('Kraków taught me one thing about pricing.')
    expect(verb('card-open')).toBeTruthy()
  })

  it('opening Content lands on the card while it waits, else where it always did; every other tab stays as it is', () => {
    const r = (h: string) => parseDHash(h)
    expect(isContentLanding(r('#exp/d/content'))).toBe(true)
    expect(cardLanding(r('#exp/d/content'), false, false)).toBe('wait')
    expect(cardLanding(r('#exp/d/content'), true, true)).toBe('card')
    expect(cardLanding(r('#exp/d/content'), true, false)).toBeNull()
    expect(contentRedirect(null, new URLSearchParams())).toBe('#exp/d/content/plan')
    for (const h of ['#exp/d/content/plan', '#exp/d/content/now', '#exp/d/content/calendar', '#exp/d/content?lane=ivan', '#exp/d/content?draft=x', '#exp/d/home'])
      expect(cardLanding(r(h), true, true)).toBeNull()
    expect(cardOnScreen(r('#exp/d/content/today'), true)).toBe(true)
    expect(cardOnScreen(r('#exp/d/content/today'), false)).toBe(false)
    expect(cardOnScreen(r('#exp/d/content/plan'), true)).toBe(false)
    // the notification's url (db: './#exp/d/content/today') opens the card from the push and from the bell
    expect(toDHash(routableHash('./#exp/d/content/today') ?? '')).toBe('#exp/d/content/today')
    expect(canonicalHash('#exp/d/content/today')).toBe('#exp/d/content/today')
    // the card's own address keeps the Plan under it and is never redirected
    expect(subOf('today')).toBe('plan')
    expect(contentRedirect('today', new URLSearchParams())).toBeNull()
  })
})
