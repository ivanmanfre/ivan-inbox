// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { XReviewList } from '../../../lib/xReview'
import { parseDHash } from '../../route'
import { renderInFrame } from '../../test-utils'

const api = vi.hoisted(() => ({
  fetchXReview: vi.fn(), saveXArticle: vi.fn(), decideXArticle: vi.fn(), saveXQuote: vi.fn(), decideXQuote: vi.fn(), saveXQuick: vi.fn(), decideXQuick: vi.fn(), fetchXQuickPhotos: vi.fn(), setXQuickPhoto: vi.fn(),
}))
vi.mock('../../../lib/xReview', async (orig) => ({ ...(await orig<typeof import('../../../lib/xReview')>()), ...api }))

import XReviewPage from './XReview'
import { __resetXForTests } from './useXReview'
import { __resetPhotoSavesForTests } from './photoSaves'

const ID = '040bf74b-6ee0-4558-8fd3-e4e1c604f091'
const LIST: XReviewList = {
  articles: [{
    id: ID, status: 'review', title: 'The checks to run', body_md: '**Lead.**\n\n## Check 1\n\nSee [docs](https://a.example).\n\n{{IMAGE:1}}',
    cover_url: 'https://cdn/cover.jpg', images: [{ slot: 1, url: 'https://cdn/1.jpg', alt: 'one' }],
    qa: { lint: [], remaining_risks: ['Check the 7/10 score'], words: 6 }, sources: [{ url: 'https://a.example/x', supports: 'docs' }],
    x_url: null, error: null, lm_slug: null, lm_topic: null, account: 'theivanpill', created_at: '2026-10-10T21:00:00Z', updated_at: '2026-10-10T21:25:00Z',
  }],
  quotes: [],
  quicks: [],
}

function page(layout: 'phone' | 'desktop' = 'phone') {
  const hash = `#exp/d/ops/x?id=${ID}`
  return renderInFrame(<XReviewPage layout={layout} route={parseDHash(hash)} navigate={() => {}} />, { layout, hash })
}

beforeEach(() => {
  __resetXForTests()
  __resetPhotoSavesForTests()
  localStorage.clear()
  api.fetchXReview.mockResolvedValue(LIST)
  api.saveXArticle.mockResolvedValue(undefined)
  api.decideXArticle.mockResolvedValue(undefined)
  api.saveXQuick.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('X review page', () => {
  it('paints a loading state, then the X article preview (hooks stay in order across the switch)', async () => {
    page()
    expect(screen.getByRole('status', { name: 'Reading the X review' })).toBeTruthy()
    await screen.findByRole('heading', { level: 1, name: 'The checks to run' })
    const body = document.querySelector('[data-x-preview=article] .xs-body')!
    expect(body.querySelector('strong')?.textContent).toBe('Lead.')
    expect(body.querySelector('h2')?.textContent).toBe('Check 1')
    expect(body.querySelector('a')?.getAttribute('href')).toBe('https://a.example')
    expect(body.querySelector('figure img')?.getAttribute('src')).toBe('https://cdn/1.jpg')
  })

  it('saves the edited title on blur and never sends the decision without a confirm', async () => {
    page()
    await screen.findByRole('heading', { level: 1, name: 'The checks to run' })
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }))
    const title = document.querySelector<HTMLTextAreaElement>('[data-x-title]')!
    fireEvent.change(title, { target: { value: 'New title' } })
    fireEvent.blur(title)
    await waitFor(() => expect(api.saveXArticle).toHaveBeenCalledWith(ID, 'New title', LIST.articles[0].body_md))

    fireEvent.click(document.querySelector('[data-verb=x-publish]')!)
    await screen.findByRole('alertdialog')
    fireEvent.click(document.querySelector('[data-verb=cancel]')!)
    expect(api.decideXArticle).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector('[data-verb=x-publish]')!)
    await screen.findByRole('alertdialog')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-publish-confirm]')!) })
    await waitFor(() => expect(api.decideXArticle).toHaveBeenCalledWith(ID, 'publish'))
    await screen.findByText(/Publishing on X/)
  })

  it('keeps the typing and says so when the save fails', async () => {
    api.saveXArticle.mockRejectedValue(new Error('article is no longer in review'))
    page()
    await screen.findByRole('heading', { level: 1, name: 'The checks to run' })
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }))
    const title = document.querySelector<HTMLTextAreaElement>('[data-x-title]')!
    fireEvent.change(title, { target: { value: 'Kept text' } })
    fireEvent.blur(title)
    await screen.findByText(/Not saved: article is no longer in review/)
    expect(title.value).toBe('Kept text')
    expect(localStorage.getItem(`x-review-draft:${ID}`)).toContain('Kept text')
  })
})

describe('quick X post review', () => {
  const QID = '7b0c4b52-1d1e-4f43-9a55-3f3f0a3e6c11'
  const QLIST: XReviewList = {
    articles: [], quotes: [],
    quicks: [{
      id: QID, status: 'draft', text: '27 follow-up drafts showed up today\n\nfixed it', options: ['another version\n\nline two'], kind: 'funny',
      source_label: 'Today’s work: discarded follow-ups', source_excerpt: '27 follow-up drafts appeared today', posted_url: null, error: null,
      account: 'theivanpill', created_at: '2026-11-03T08:00:00Z', updated_at: null, expires_at: '2026-11-04T04:00:00Z',
    }],
  }

  it('shows the post on X, swaps a version, saves it, and posts only after the confirm', async () => {
    api.fetchXReview.mockResolvedValue(QLIST)
    const hash = `#exp/d/ops/x?id=${QID}`
    renderInFrame(<XReviewPage layout="phone" route={parseDHash(hash)} navigate={() => {}} />, { layout: 'phone', hash })
    await screen.findByText('Quick post')
    const text = document.querySelector('[data-x-preview=post] .xs-text')!
    expect(text.textContent).toContain('27 follow-up drafts showed up today')
    expect(document.querySelectorAll('[data-verb=x-quick-option]').length).toBe(2)
    fireEvent.click(document.querySelectorAll('[data-verb=x-quick-option]')[1])
    expect(document.querySelector<HTMLTextAreaElement>('[data-x-quick]')!.value).toBe('another version\n\nline two')
    expect(document.querySelector('[data-x-source]')?.textContent).toContain('discarded follow-ups')
  })

  it('posts the exact text he confirmed and locks the editor while it goes out', async () => {
    api.fetchXReview.mockResolvedValue(QLIST)
    api.saveXQuick.mockResolvedValue(undefined)
    let release: () => void = () => {}
    api.decideXQuick.mockImplementation(() => new Promise<void>(r => { release = r }))
    const hash = `#exp/d/ops/x?id=${QID}`
    renderInFrame(<XReviewPage layout="phone" route={parseDHash(hash)} navigate={() => {}} />, { layout: 'phone', hash })
    await screen.findByText('Quick post')
    const box = document.querySelector<HTMLTextAreaElement>('[data-x-quick]')!
    fireEvent.change(box, { target: { value: 'edited B' } })
    fireEvent.click(document.querySelector('[data-verb=x-post]')!)
    await screen.findByRole('alertdialog')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-post-confirm]')!) })
    await waitFor(() => expect(api.decideXQuick).toHaveBeenCalledWith(QID, 'post', 'edited B', null))
    expect(api.saveXQuick).toHaveBeenCalledWith(QID, 'edited B')
    expect(document.querySelector<HTMLTextAreaElement>('[data-x-quick]')!.readOnly).toBe(true)
    await act(async () => { release() })
  })

  const PHOTO = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/post-stills/ivan-photos/warsaw-castle-square.jpg'
  const OTHER = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/post-stills/ivan-photos/poland-train-laptop.jpg'
  const withPhoto = (): XReviewList => ({ ...QLIST, quicks: [{ ...QLIST.quicks[0], media_url: PHOTO, media_photo_id: 'p1', media_source: 'auto', media_reason: 'a Warsaw post', media_place: 'Warsaw, Poland' }] })
  const open = async (list: XReviewList) => {
    api.fetchXReview.mockResolvedValue(list)
    const hash = `#exp/d/ops/x?id=${QID}`
    renderInFrame(<XReviewPage layout="phone" route={parseDHash(hash)} navigate={() => {}} />, { layout: 'phone', hash })
    await screen.findByText('Quick post')
  }
  const post = async () => {
    fireEvent.click(document.querySelector('[data-verb=x-post]')!)
    const dlg = await screen.findByRole('alertdialog')
    const said = dlg.textContent
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-post-confirm]')!) })
    return said
  }

  it('shows the photo on the X preview and binds Post to text AND photo', async () => {
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withPhoto())
    expect(document.querySelector('[data-x-preview=post] [data-x-photo] img')?.getAttribute('src')).toBe(PHOTO)
    expect(document.querySelector('[data-x-photo-panel]')?.textContent).toContain('Warsaw, Poland')
    const said = await post()
    expect(said).toContain('the text and the photo')
    await waitFor(() => expect(api.decideXQuick).toHaveBeenCalledWith(QID, 'post', QLIST.quicks[0].text, PHOTO))
  })

  it('removes the photo: preview goes text only and Post confirms text only', async () => {
    api.setXQuickPhoto.mockResolvedValue(null)
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withPhoto())
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-photo-remove]')!) })
    expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, null)
    await waitFor(() => expect(document.querySelector('[data-x-photo]')).toBeNull())
    expect(document.querySelector('[data-x-photo-panel]')?.textContent).toContain('text only')
    const said = await post()
    expect(said).toContain('text only, no photo')
    await waitFor(() => expect(api.decideXQuick).toHaveBeenCalledWith(QID, 'post', QLIST.quicks[0].text, null))
  })

  it('swaps the photo from his gallery and posts the new one', async () => {
    api.fetchXQuickPhotos.mockResolvedValue([
      { id: 'p1', url: PHOTO, place: 'Warsaw, Poland', scene: 'city', mood: 'sunny', description: 'Castle Square', has_ivan: false, recent: false },
      { id: 'p2', url: OTHER, place: 'Fałków, Poland', scene: 'work', mood: 'focused', description: 'Laptop on a train', has_ivan: false, recent: true },
    ])
    api.setXQuickPhoto.mockResolvedValue(OTHER)
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withPhoto())
    fireEvent.click(document.querySelector('[data-verb=x-photo-change]')!)
    await waitFor(() => expect(document.querySelectorAll('[data-verb=x-photo-pick]').length).toBe(2))
    expect(document.querySelector<HTMLButtonElement>('[data-photo-id=p1]')!.disabled).toBe(true)
    expect(document.querySelector('[data-photo-id=p2]')?.textContent).toContain('used')
    await act(async () => { fireEvent.click(document.querySelector('[data-photo-id=p2]')!) })
    expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2')
    await waitFor(() => expect(document.querySelector('[data-x-preview=post] [data-x-photo] img')?.getAttribute('src')).toBe(OTHER))
    await post()
    await waitFor(() => expect(api.decideXQuick).toHaveBeenCalledWith(QID, 'post', QLIST.quicks[0].text, OTHER))
  })

  it('a failed swap keeps the old photo and says so', async () => {
    api.fetchXQuickPhotos.mockResolvedValue([{ id: 'p2', url: OTHER, place: 'Fałków, Poland', scene: 'work', mood: '', description: '', has_ivan: false, recent: false }])
    api.setXQuickPhoto.mockRejectedValue(new Error('post is no longer a draft'))
    await open(withPhoto())
    fireEvent.click(document.querySelector('[data-verb=x-photo-change]')!)
    await waitFor(() => expect(document.querySelector('[data-photo-id=p2]')).toBeTruthy())
    await act(async () => { fireEvent.click(document.querySelector('[data-photo-id=p2]')!) })
    await screen.findByText(/Photo not changed: post is no longer a draft/)
    expect(document.querySelector('[data-x-preview=post] [data-x-photo] img')?.getAttribute('src')).toBe(PHOTO)
  })

  // ---- swipe through the ranked photos (Ivan 2026-11-05) ----
  const THIRD = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/post-stills/ivan-photos/gdansk-pier.jpg'
  const RING = [{ id: 'p1', url: PHOTO, place: 'Warsaw, Poland' }, { id: 'p2', url: OTHER, place: 'Fałków, Poland' }, { id: 'p3', url: THIRD, place: 'Gdańsk, Poland' }]
  const withRing = (over: Partial<XReviewList['quicks'][number]> = {}): XReviewList => ({ ...QLIST, quicks: [{ ...withPhoto().quicks[0], media_ring: RING, ...over }] })
  const shown = () => document.querySelector('[data-x-preview=post] [data-x-photo] img')?.getAttribute('src')
  const dot = () => [...document.querySelectorAll('[data-x-photo-dots] [data-dot]')].findIndex(d => d.getAttribute('aria-current') === 'true')
  const swipe = (dx: number) => {
    const el = document.querySelector('[data-x-photo]')!
    fireEvent.pointerDown(el, { clientX: 200, clientY: 100, pointerId: 1, isPrimary: true })
    fireEvent.pointerMove(el, { clientX: 200 + dx / 2, clientY: 102, pointerId: 1, isPrimary: true })
    fireEvent.pointerUp(el, { clientX: 200 + dx, clientY: 104, pointerId: 1, isPrimary: true })
  }
  const deferred = () => { let res: (v: string | null) => void = () => {}; let rej: (e: Error) => void = () => {}; const p = new Promise<string | null>((a, b) => { res = a; rej = b }); return { p, res, rej } }

  it('no other fitting photos = no swipe UI', async () => {
    await open(withPhoto())
    expect(document.querySelector('[data-x-photo-dots]')).toBeNull()
    expect(document.querySelector('[data-verb=x-photo-next]')).toBeNull()
    cleanup(); __resetXForTests(); __resetPhotoSavesForTests()
    await open(withRing({ media_ring: [RING[0]] }))
    expect(document.querySelector('[data-x-photo-dots]')).toBeNull()
  })

  it('a locked post (not a draft) shows its photo without the swipe UI', async () => {
    await open(withRing({ status: 'approved' }))
    expect(shown()).toBe(PHOTO)
    expect(document.querySelector('[data-x-photo-dots]')).toBeNull()
  })

  it('swiping left shows the next photo at once and saves it once he settles', async () => {
    api.setXQuickPhoto.mockResolvedValue(OTHER)
    await open(withRing())
    expect(dot()).toBe(0)
    expect(document.querySelectorAll('[data-x-photo-dots] [data-dot]').length).toBe(3)
    swipe(-120)
    expect(shown()).toBe(OTHER)
    expect(dot()).toBe(1)
    expect(document.querySelector('[data-x-photo-panel]')?.textContent).toContain('Fałków, Poland')
    expect(api.setXQuickPhoto).not.toHaveBeenCalled()
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'), { timeout: 2000 })
    expect(api.setXQuickPhoto).toHaveBeenCalledTimes(1)
    swipe(90)
    expect(shown()).toBe(PHOTO)
    swipe(90) // already first: stays
    expect(shown()).toBe(PHOTO)
  })

  it('a small or mostly vertical drag is not a swipe', async () => {
    await open(withRing())
    swipe(-20)
    expect(shown()).toBe(PHOTO)
    const el = document.querySelector('[data-x-photo]')!
    fireEvent.pointerDown(el, { clientX: 200, clientY: 100, pointerId: 1, isPrimary: true })
    fireEvent.pointerUp(el, { clientX: 140, clientY: 260, pointerId: 1, isPrimary: true })
    expect(shown()).toBe(PHOTO)
  })

  it('a fast swipe through several photos saves only the last one', async () => {
    api.setXQuickPhoto.mockResolvedValue(THIRD)
    await open(withRing())
    swipe(-120); swipe(-120); swipe(-120)
    expect(shown()).toBe(THIRD)
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalled(), { timeout: 2000 })
    await new Promise(r => setTimeout(r, 900))
    expect(api.setXQuickPhoto).toHaveBeenCalledTimes(1)
    expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p3')
  })

  it('arrows step through the photos; prev is off at the first', async () => {
    api.setXQuickPhoto.mockResolvedValue(OTHER)
    await open(withRing())
    expect(document.querySelector<HTMLButtonElement>('[data-verb=x-photo-prev]')!.disabled).toBe(true)
    fireEvent.click(document.querySelector('[data-verb=x-photo-next]')!)
    expect(shown()).toBe(OTHER)
    fireEvent.click(document.querySelector('[data-verb=x-photo-next]')!)
    expect(shown()).toBe(THIRD)
    expect(document.querySelector<HTMLButtonElement>('[data-verb=x-photo-next]')!.disabled).toBe(true)
  })

  it('saves stay in order: a swipe during a save waits for it, and the last photo wins', async () => {
    const a = deferred(), b = deferred()
    api.setXQuickPhoto.mockReturnValueOnce(a.p).mockReturnValueOnce(b.p)
    await open(withRing())
    swipe(-120)
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'), { timeout: 2000 })
    swipe(-120)
    await new Promise(r => setTimeout(r, 900))
    expect(api.setXQuickPhoto).toHaveBeenCalledTimes(1) // still waiting on the first save
    expect(shown()).toBe(THIRD)
    await act(async () => { a.res(OTHER) })
    expect(shown()).toBe(THIRD) // the first save landing never pulls the preview back
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledTimes(2))
    expect(api.setXQuickPhoto.mock.calls.map(c => c[1])).toEqual(['p2', 'p3'])
    await act(async () => { b.res(THIRD) })
    expect(shown()).toBe(THIRD)
  })

  it('Post right after a swipe saves the shown photo first, then binds Post to it', async () => {
    api.setXQuickPhoto.mockResolvedValue(OTHER)
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withRing())
    swipe(-120)
    const said = await post()
    expect(said).toContain('the text and the photo')
    await waitFor(() => expect(api.decideXQuick).toHaveBeenCalledWith(QID, 'post', QLIST.quicks[0].text, OTHER))
    expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2')
    expect(api.setXQuickPhoto.mock.invocationCallOrder[0]).toBeLessThan(api.decideXQuick.mock.invocationCallOrder[0])
  })

  it('a failed swipe save goes back to the saved photo, says so, and Post sends nothing', async () => {
    api.setXQuickPhoto.mockRejectedValue(new Error('post is no longer a draft'))
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withRing())
    swipe(-120)
    await post()
    await screen.findByText(/Photo not changed: post is no longer a draft/)
    expect(shown()).toBe(PHOTO)
    expect(api.decideXQuick).not.toHaveBeenCalled()
  })

  it('a photo picked from the gallery that is not ranked joins the swipe as the current one', async () => {
    await open(withRing({ media_url: 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/post-stills/ivan-photos/own.jpg', media_photo_id: 'p9', media_source: 'ivan' }))
    expect(document.querySelectorAll('[data-x-photo-dots] [data-dot]').length).toBe(4)
    expect(dot()).toBe(0)
  })

  it('Sol r1: a save whose answer fails while the Post dialog is open sends nothing (the photo on screen changed)', async () => {
    const a = deferred()
    api.setXQuickPhoto.mockReturnValueOnce(a.p)
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withRing())
    swipe(-120)
    fireEvent.click(document.querySelector('[data-verb=x-post]')!)
    await screen.findByRole('alertdialog')
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'), { timeout: 2000 })
    await act(async () => { a.rej(new Error('network down')) })
    expect(shown()).toBe(PHOTO)
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-post-confirm]')!) })
    await screen.findByText(/The photo changed while you confirmed, so nothing went out/)
    expect(api.decideXQuick).not.toHaveBeenCalled()
  })

  it('Sol r1: leaving and reopening the card mid-save never lets an older swipe land after a newer one', async () => {
    const a = deferred()
    api.setXQuickPhoto.mockReturnValueOnce(a.p).mockResolvedValue(OTHER)
    await open(withRing())
    swipe(-120)
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'), { timeout: 2000 })
    swipe(-120) // wants p3 while p2 saves
    cleanup()
    await open(withRing())
    expect(shown()).toBe(THIRD) // the wanted photo carries over
    fireEvent.click(document.querySelector('[data-verb=x-photo-prev]')!) // now wants p2
    await new Promise(r => setTimeout(r, 900))
    await act(async () => { a.res(OTHER) })
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 100))
    expect(api.setXQuickPhoto.mock.calls.map(c => c[1])).toEqual(['p2', 'p2'])
    expect(shown()).toBe(OTHER)
  })

  it('Sol r1: a swipe during a gallery save queues behind it and the later choice wins', async () => {
    const a = deferred()
    api.fetchXQuickPhotos.mockResolvedValue([{ id: 'p3', url: THIRD, place: 'Gdańsk, Poland', scene: '', mood: '', description: '', has_ivan: false, recent: false }])
    api.setXQuickPhoto.mockReturnValueOnce(a.p).mockResolvedValue(OTHER)
    await open(withRing())
    fireEvent.click(document.querySelector('[data-verb=x-photo-change]')!)
    await waitFor(() => expect(document.querySelector('[data-photo-id=p3]')).toBeTruthy())
    fireEvent.click(document.querySelector('[data-photo-id=p3]')!)
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p3'))
    expect(shown()).toBe(THIRD)
    swipe(120) // back to p2 while p3 saves
    expect(shown()).toBe(OTHER)
    await new Promise(r => setTimeout(r, 900))
    expect(api.setXQuickPhoto).toHaveBeenCalledTimes(1)
    await act(async () => { a.res(THIRD) })
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledTimes(2))
    expect(api.setXQuickPhoto.mock.calls.map(c => c[1])).toEqual(['p3', 'p2'])
    await waitFor(() => expect(shown()).toBe(OTHER))
  })

  it('Sol r2: a refresh during a slow text save cannot swap the photo back before the check', async () => {
    const photoSave = deferred()
    let textDone: () => void = () => {}
    api.setXQuickPhoto.mockReturnValueOnce(photoSave.p)
    api.saveXQuick.mockImplementation(() => new Promise<void>(r => { textDone = r }))
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withRing())
    fireEvent.change(document.querySelector<HTMLTextAreaElement>('[data-x-quick]')!, { target: { value: 'edited' } })
    swipe(-120)
    fireEvent.click(document.querySelector('[data-verb=x-post]')!)
    await screen.findByRole('alertdialog')
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'), { timeout: 2000 })
    // the server committed B but the answer failed: the screen falls back to A, and the recovery read returns B
    let readDone: () => void = () => {}
    api.fetchXReview.mockReturnValue(new Promise<XReviewList>(r => { readDone = () => r(withRing({ media_url: OTHER, media_photo_id: 'p2', media_source: 'ivan' })) }))
    await act(async () => { photoSave.rej(new Error('network down')) })
    expect(shown()).toBe(PHOTO)
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-post-confirm]')!) })
    await act(async () => { readDone() }) // the recovery read lands while the text save is still out
    await act(async () => { textDone() })
    await screen.findByText(/The photo changed while you confirmed, so nothing went out/)
    expect(api.decideXQuick).not.toHaveBeenCalled()
  })
})
