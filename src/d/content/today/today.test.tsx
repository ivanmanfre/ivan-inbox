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

// The day's post card (db/20261112_content_daily_card): the sliding toast, the card on Content, Home's peek and the
// landing rule. Every read and write is mocked. Post keeps the Review desk's one-tap hold and ends in ONE database
// call (content_card_post), so the client-side approve and schedule writes must never run for a card.
const lib = vi.hoisted(() => ({
  readTodayCard: vi.fn(), setCardState: vi.fn(), rebaseCard: vi.fn(), fetchIvanSlotRows: vi.fn(), postCard: vi.fn(),
  fetchIvanArmedDays: vi.fn(), approveReviewDraft: vi.fn(), saveDraftBody: vi.fn(), scheduleGuarded: vi.fn(), setVerdict: vi.fn(),
  answerCard: vi.fn(), weaveCard: vi.fn(),
}))
vi.mock('../../../lib/contentCard', async orig => ({ ...(await orig<typeof import('../../../lib/contentCard')>()), readTodayCard: lib.readTodayCard, setCardState: lib.setCardState, rebaseCard: lib.rebaseCard, fetchIvanSlotRows: lib.fetchIvanSlotRows, postCard: lib.postCard, answerCard: lib.answerCard, weaveCard: lib.weaveCard }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), fetchIvanArmedDays: lib.fetchIvanArmedDays, approveReviewDraft: lib.approveReviewDraft, saveDraftBody: lib.saveDraftBody }))
vi.mock('../writes', () => ({ scheduleGuarded: lib.scheduleGuarded, archiveStaleDraft: vi.fn() }))
vi.mock('../../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../../lib/verdicts')>()), setVerdict: lib.setVerdict }))

import CardToast, { CARD_TOAST_ID, resetSlidForTest } from './CardToast'
import { TodayCardView } from './TodayCard'
import { HomeCard } from './HomeCard'
import { postLabel, postWords } from './keys'
import { cardLanding, cardOnScreen, isContentLanding, refreshTodayCard, resetTodayCardForTest } from './store'
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
  lib.answerCard.mockResolvedValue(true)
  lib.weaveCard.mockRejectedValue(new Error('not mocked'))
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
    expect(lib.postCard).toHaveBeenCalledWith('2026-11-12', ID, await bodySha('Fixed first line.\n\nFixed second.'), expect.any(String), expect.any(Number))
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

describe('the card’s one question', () => {
  const Q = 'You told the client their expert posts only reach followers. What did they say back?'
  const SHA = 'a'.repeat(64)
  const withQ = (o: Partial<NonNullable<TodayCard['question']>> = {}) => card({ question: { text: Q, anchor: 'You charge for the result.', kind: 'own_words', sha: SHA, answer: null, ...o } })
  const ask = () => document.querySelector('[data-card-ask]') as HTMLElement | null
  const input = () => ask()!.querySelector('input') as HTMLInputElement
  const WOVEN = BODY.replace('You charge for the result.', 'You charge for the result. He said "so who do we write for then?"')
  const open = async (c: TodayCard, layout?: 'phone') => {
    lib.readTodayCard.mockResolvedValue(c)
    renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today', ...(layout ? { layout } : {}) })
    await waitFor(() => expect(document.querySelector('[data-today-card]')).toBeTruthy())
  }

  it('nothing extra renders when there is no question', async () => {
    await open(card())
    expect(ask()).toBeNull()
    expect(document.querySelector('[data-today-card] input')).toBeNull()
    expect(verb('card-ask-add')).toBeNull()
  })

  it('a live question: one line above the post, a plain one-line input and Add, nothing else', async () => {
    await open(withQ())
    const a = ask()!
    expect(a.textContent).toBe(Q + 'Add')
    expect(input().type).toBe('text')
    expect(input().placeholder).toBe('')
    expect(screen.getByLabelText(Q)).toBe(input())
    expect(verb('card-ask-add')!.textContent).toBe('Add')
    expect(verb('card-ask-add')!.disabled).toBe(true)
    // with the keys, in the side block: drawn above the post when narrow (order), beside it when wide (today.css)
    const side = document.querySelector('[data-today-card] .ct-side')!
    expect([...side.children]).toEqual([a, side.querySelector('.ct-keys')])
    expect(a.textContent).not.toContain('—')
  })

  it('Add keeps his answer, asks for the woven post, opens Fix on it; his save answers the question', async () => {
    lib.weaveCard.mockResolvedValue(WOVEN)
    lib.saveDraftBody.mockResolvedValue(undefined)
    await open(withQ())
    fireEvent.change(input(), { target: { value: '  he said so who do we write for then ' } })
    fireEvent.click(verb('card-ask-add')!)
    expect(lib.answerCard).toHaveBeenCalledWith('2026-11-12', ID, 'he said so who do we write for then')
    expect(lib.weaveCard).toHaveBeenCalledWith('2026-11-12', ID, SHA, 'he said so who do we write for then')
    const box = await screen.findByLabelText('Post text') as HTMLTextAreaElement
    expect(box.value).toBe(WOVEN)
    // nothing was written to the draft by the weave: only his save writes
    expect(lib.saveDraftBody).not.toHaveBeenCalled()
    lib.readTodayCard.mockResolvedValue(card({}, { post_body: WOVEN, updated_at: '2026-11-12T10:30:00Z' }))
    fireEvent.click(verb('grid-save')!)
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledWith(ID, WOVEN, null, BODY, '2026-11-10T09:00:00Z'))
    await waitFor(() => expect(lib.rebaseCard).toHaveBeenCalledWith('2026-11-12', ID, WOVEN))
    await waitFor(() => expect(lib.answerCard).toHaveBeenCalledWith('2026-11-12', ID, 'he said so who do we write for then', true))
    await waitFor(() => expect(ask()).toBeNull())
    expect(document.querySelector('[data-today-card]')!.textContent).toContain('so who do we write for then?')
  })

  it('a failed weave says one plain line and opens Fix on the unchanged text, his answer still in the input', async () => {
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
    await waitFor(() => expect(document.querySelector('[data-today-card]')!.textContent).toContain('Fixed on the phone.'))
    await act(async () => { finish(WOVEN) })
    expect(await screen.findByText('Could not add it. Edit the post yourself.')).toBeTruthy()
    expect(screen.queryByLabelText('Post text')).toBeNull()
    expect(document.querySelector('[data-today-card]')!.textContent).not.toContain('so who do we write for then?')
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

  it('Post and Skip work whether or not he answers', async () => {
    await open(withQ())
    await waitFor(() => expect(verb('card-post')?.disabled).toBe(false))
    fireEvent.click(verb('card-post')!)
    await act(() => flushDecisions())
    expect(lib.postCard).toHaveBeenCalledWith('2026-11-12', ID, await bodySha(BODY), expect.any(String), expect.any(Number))
    expect(lib.weaveCard).not.toHaveBeenCalled()
    expect(lib.answerCard).not.toHaveBeenCalled()
    cleanup(); resetTodayCardForTest(); resetDecisionsForTest()
    await open(withQ())
    fireEvent.click(verb('card-skip')!)
    await waitFor(() => expect(lib.setCardState).toHaveBeenCalledWith('2026-11-12', ID, 'skipped'))
    expect(lib.weaveCard).not.toHaveBeenCalled()
  })

  it('works on the phone layout too', async () => {
    lib.weaveCard.mockResolvedValue(WOVEN)
    await open(withQ(), 'phone')
    fireEvent.change(input(), { target: { value: 'He said so who do we write for' } })
    fireEvent.click(verb('card-ask-add')!)
    expect((await screen.findByLabelText('Post text') as HTMLTextAreaElement).value).toBe(WOVEN)
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

describe('the card’s keys in reach', () => {
  const css = readFileSync(resolve(__dirname, 'today.css'), 'utf8').replace(/\s+/g, ' ')
  const lay = () => document.querySelector('[data-today-card] .ct-lay')!

  it('the post first, then one side block holding the keys: pinned at the bottom when narrow, a column when wide', async () => {
    for (const layout of ['desktop', 'phone'] as const) {
      renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today', layout })
      await waitFor(() => expect(verb('card-post')?.disabled).toBe(false))
      expect([...lay().children].map(c => c.className)).toEqual(['ct-post', 'ct-side'])
      expect(lay().querySelector('.ct-side > .ct-keys')).toBe(verb('card-post')!.parentElement)
      expect(document.querySelector('[data-today-card]')!.hasAttribute('data-editing')).toBe(false)
      cleanup(); resetTodayCardForTest()
    }
    // narrow: the keys stick to the bottom over the post; on the phone above the dock and the safe area
    expect(css).toMatch(/\.ct-side\{display:contents\}/)
    expect(css).toMatch(/\.ct-ask\{order:-1\}/)
    expect(css).toMatch(/\.ct-keys\{[^}]*position:sticky;bottom:0/)
    expect(css).toMatch(/\.d-phone \.ct-keys\{[^}]*bottom:calc\(var\(--dock-h\) \+ var\(--dock-bottom\) \+ 8px\)/)
    expect(css).toMatch(/\.d-phone \.ct-keys\{bottom:calc\(var\(--po-tab-h\) \+ var\(--po-tab-bottom\) \+ 8px\)/)
    expect(css).toMatch(/\.d-phone \.ct-keys \.cv2-k\{min-height:44px\}/)
    // the dock's fade starts under the pinned keys instead of washing them out
    expect(css).toMatch(/\.d-phone:has\(\.ct-card:not\(\[data-editing\]\)\) \.po-fade\{height:calc\(var\(--po-tab-h\) \+ var\(--po-tab-bottom\) \+ 8px\)\}/)
    // wide: a sticky column right of the post
    expect(css).toMatch(/@container ctcard \(min-width:900px\)\{ \.ct-lay\{display:grid;grid-template-columns:minmax\(0,552px\) minmax\(240px,300px\)/)
    expect(css).toMatch(/\.ct-side\{display:flex;flex-direction:column;gap:16px;position:sticky;top:12px\}/)
  })

  it('while Fix is open the keys stop pinning (the editor’s own Save and Cancel are never under them)', async () => {
    renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today', layout: 'phone' })
    await waitFor(() => expect(verb('card-fix')).toBeTruthy())
    fireEvent.click(verb('card-fix')!)
    const el = document.querySelector('[data-today-card]')!
    expect(el.hasAttribute('data-editing')).toBe(true)
    expect([...lay().children].map(c => c.className)).toEqual(['cv2-gp cv2-gp-edit', 'ct-side'])
    expect(verb('grid-save')).toBeTruthy()
    expect(verb('card-post')!.disabled).toBe(true)
    expect(css).toMatch(/\.ct-card\[data-editing\] \.ct-keys\{position:static\}/)
    // the box itself shows: Review's skin hides .cv2-gp outside its grid at (0,3,0), the card's rule outranks it
    expect(css).toMatch(/\.ct-card\[data-today-card\] \.cv2-gp\.cv2-gp-edit\{display:flex/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(el.hasAttribute('data-editing')).toBe(false))
  })

  it('“Check N lines” takes Post’s place in the pinned keys', async () => {
    lib.readTodayCard.mockResolvedValue(card({}, { line_flags: { lines: [{ text: 'You charge for the result.', kind: 'personal', ask: 'Is this yours?' }] } }))
    renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today', layout: 'phone' })
    await waitFor(() => expect(verb('card-check')).toBeTruthy())
    expect(verb('card-post')).toBeNull()
    expect(verb('card-check')!.textContent).toBe('Check 1 line')
    expect(verb('card-check')!.parentElement!.className).toBe('ct-keys')
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

  it('the card, the toast and Home show the date when the calendar is full for weeks, with the full day and time as its name', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'))
    try {
      // Every 10:45 from today to Mon 30 Nov already taken: the next free slot is Tue 1 Dec 10:45.
      const times = Array.from({ length: 19 }, (_, i) => new Date(Date.UTC(2026, 10, 12 + i, 9, 45)).toISOString())
      lib.fetchIvanArmedDays.mockResolvedValue(Object.assign(new Set<string>(), { times }))
      const name = 'Post: approve and schedule Tue 1 Dec · 10:45'
      renderInFrame(<TodayCardView />, { hash: '#exp/d/content/today' })
      await waitFor(() => expect(verb('card-post')?.disabled).toBe(false))
      expect(verb('card-post')!.textContent).toBe('Post · Tue 1 Dec')
      expect(verb('card-post')!.getAttribute('aria-label')).toBe(name)
      cleanup(); resetTodayCardForTest()
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
