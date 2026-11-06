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
    await screen.findByText(/^Quick post/)
    const text = document.querySelector('[data-x-preview=post] .xs-text')!
    expect(text.textContent).toContain('27 follow-up drafts showed up today')
    // the version in the editor is not repeated; only the other one is offered
    expect(document.querySelectorAll('[data-verb=x-quick-option]').length).toBe(1)
    fireEvent.click(document.querySelectorAll('[data-verb=x-quick-option]')[0])
    expect(document.querySelector<HTMLTextAreaElement>('[data-x-quick]')!.value).toBe('another version\n\nline two')
    // the swapped-out version moves into the list
    expect(document.querySelector('[data-verb=x-quick-option]')?.textContent).toContain('27 follow-up drafts showed up today')
    expect(document.querySelector('[data-x-source]')?.textContent).toContain('discarded follow-ups')
  })

  it('posts the exact text he confirmed and locks the editor while it goes out', async () => {
    api.fetchXReview.mockResolvedValue(QLIST)
    api.saveXQuick.mockResolvedValue(undefined)
    let release: () => void = () => {}
    api.decideXQuick.mockImplementation(() => new Promise<void>(r => { release = r }))
    const hash = `#exp/d/ops/x?id=${QID}`
    renderInFrame(<XReviewPage layout="phone" route={parseDHash(hash)} navigate={() => {}} />, { layout: 'phone', hash })
    await screen.findByText(/^Quick post/)
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
    await screen.findByText(/^Quick post/)
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
    expect(document.querySelector<HTMLButtonElement>('[data-verb=x-photo-pick][data-photo-id=p1]')!.disabled).toBe(true)
    expect(document.querySelector('[data-verb=x-photo-pick][data-photo-id=p2]')?.textContent).toContain('used')
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-photo-pick][data-photo-id=p2]')!) })
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
    await waitFor(() => expect(document.querySelector('[data-verb=x-photo-pick][data-photo-id=p2]')).toBeTruthy())
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-photo-pick][data-photo-id=p2]')!) })
    await screen.findByText(/Photo not changed: post is no longer a draft/)
    expect(document.querySelector('[data-x-preview=post] [data-x-photo] img')?.getAttribute('src')).toBe(PHOTO)
  })

  // ---- one photo, picked from a row of ranked options (Ivan 2026-11-06: "why does it show 5 pictures and
  // when i remove one its removing others") ----
  const THIRD = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/post-stills/ivan-photos/gdansk-pier.jpg'
  const RING = [{ id: 'p1', url: PHOTO, place: 'Warsaw, Poland' }, { id: 'p2', url: OTHER, place: 'Fałków, Poland' }, { id: 'p3', url: THIRD, place: 'Gdańsk, Poland' }]
  const withRing = (over: Partial<XReviewList['quicks'][number]> = {}): XReviewList => ({ ...QLIST, quicks: [{ ...withPhoto().quicks[0], media_ring: RING, ...over }] })
  const shown = () => document.querySelector('[data-x-preview=post] [data-x-photo] img')?.getAttribute('src')
  const opts = () => [...document.querySelectorAll<HTMLButtonElement>('[data-verb=x-photo-option]')]
  const checked = () => opts().findIndex(b => b.getAttribute('aria-checked') === 'true')
  const tap = (id: string) => fireEvent.click(document.querySelector(`[data-verb=x-photo-option][data-photo-id=${id}]`)!)
  const deferred = () => { let res: (v: string | null) => void = () => {}; let rej: (e: Error) => void = () => {}; const p = new Promise<string | null>((a, b) => { res = a; rej = b }); return { p, res, rej } }

  it('the preview carries exactly one photo; the options sit under the post, never as a carousel', async () => {
    await open(withRing())
    expect(document.querySelectorAll('[data-x-preview=post] [data-x-photo] img').length).toBe(1)
    expect(document.querySelector('[data-x-photo-dots]')).toBeNull()
    expect(document.querySelector('[data-verb=x-photo-next]')).toBeNull()
    expect(opts().length).toBe(3)
    expect(checked()).toBe(0)
    expect(document.querySelector('[data-x-photo-panel]')?.textContent).toContain('1 photo')
  })

  it('a locked post (not a draft) shows its photo without the option row', async () => {
    await open(withRing({ status: 'approved' }))
    expect(shown()).toBe(PHOTO)
    expect(opts().length).toBe(0)
  })

  it('tapping an option puts it on the post at once and saves it', async () => {
    api.setXQuickPhoto.mockResolvedValue(OTHER)
    await open(withRing())
    await act(async () => { tap('p2') })
    expect(shown()).toBe(OTHER)
    expect(checked()).toBe(1)
    expect(document.querySelectorAll('[data-x-preview=post] [data-x-photo] img').length).toBe(1)
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'))
    expect(api.setXQuickPhoto).toHaveBeenCalledTimes(1)
  })

  it('No photo keeps every option on screen, and one tap puts a photo back', async () => {
    api.setXQuickPhoto.mockResolvedValueOnce(null).mockResolvedValueOnce(THIRD)
    await open(withRing())
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-photo-remove]')!) })
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, null))
    expect(document.querySelector('[data-x-photo]')).toBeNull()
    expect(opts().length).toBe(3)
    expect(checked()).toBe(-1)
    expect(document.querySelector('[data-verb=x-photo-remove]')?.getAttribute('aria-checked')).toBe('true')
    await act(async () => { tap('p3') })
    expect(shown()).toBe(THIRD)
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenLastCalledWith(QID, 'p3'))
  })

  it('saves stay in order: a tap during a save waits for it, and the last photo wins', async () => {
    const a = deferred(), b = deferred()
    api.setXQuickPhoto.mockReturnValueOnce(a.p).mockReturnValueOnce(b.p)
    await open(withRing())
    await act(async () => { tap('p2') })
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'))
    await act(async () => { tap('p3') })
    expect(api.setXQuickPhoto).toHaveBeenCalledTimes(1) // still waiting on the first save
    expect(shown()).toBe(THIRD)
    await act(async () => { a.res(OTHER) })
    expect(shown()).toBe(THIRD) // the first save landing never pulls the preview back
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledTimes(2))
    expect(api.setXQuickPhoto.mock.calls.map(c => c[1])).toEqual(['p2', 'p3'])
    await act(async () => { b.res(THIRD) })
    expect(shown()).toBe(THIRD)
  })

  it('Post right after a tap saves the shown photo first, then binds Post to it', async () => {
    api.setXQuickPhoto.mockResolvedValue(OTHER)
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withRing())
    await act(async () => { tap('p2') })
    const said = await post()
    expect(said).toContain('the text and the photo')
    await waitFor(() => expect(api.decideXQuick).toHaveBeenCalledWith(QID, 'post', QLIST.quicks[0].text, OTHER))
    expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2')
    expect(api.setXQuickPhoto.mock.invocationCallOrder[0]).toBeLessThan(api.decideXQuick.mock.invocationCallOrder[0])
  })

  it('a failed save goes back to the saved photo, says so, and Post sends nothing', async () => {
    api.setXQuickPhoto.mockRejectedValue(new Error('post is no longer a draft'))
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withRing())
    await act(async () => { tap('p2') })
    await screen.findByText(/Photo not changed: post is no longer a draft/)
    expect(shown()).toBe(PHOTO)
    expect(api.decideXQuick).not.toHaveBeenCalled()
  })

  it('a photo picked from the gallery that is not ranked leads the options as the current one', async () => {
    await open(withRing({ media_url: 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/post-stills/ivan-photos/own.jpg', media_photo_id: 'p9', media_source: 'ivan' }))
    expect(opts().length).toBe(4)
    expect(checked()).toBe(0)
  })

  it('Sol r1: a save whose answer fails while the Post dialog is open sends nothing (the photo on screen changed)', async () => {
    const a = deferred()
    api.setXQuickPhoto.mockReturnValueOnce(a.p)
    api.decideXQuick.mockResolvedValue(undefined)
    await open(withRing())
    await act(async () => { tap('p2') })
    fireEvent.click(document.querySelector('[data-verb=x-post]')!)
    await screen.findByRole('alertdialog')
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'))
    await act(async () => { a.rej(new Error('network down')) })
    expect(shown()).toBe(PHOTO)
    await act(async () => { fireEvent.click(document.querySelector('[data-verb=x-post-confirm]')!) })
    await screen.findByText(/The photo changed while you confirmed, so nothing went out/)
    expect(api.decideXQuick).not.toHaveBeenCalled()
  })

  it('Sol r1: leaving and reopening the card mid-save never lets an older pick land after a newer one', async () => {
    const a = deferred()
    api.setXQuickPhoto.mockReturnValueOnce(a.p).mockResolvedValue(OTHER)
    await open(withRing())
    await act(async () => { tap('p2') })
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'))
    await act(async () => { tap('p3') }) // wants p3 while p2 saves
    cleanup()
    await open(withRing())
    expect(shown()).toBe(THIRD) // the wanted photo carries over
    await act(async () => { tap('p2') }) // now wants p2
    await act(async () => { a.res(OTHER) })
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 100))
    expect(api.setXQuickPhoto.mock.calls.map(c => c[1])).toEqual(['p2', 'p2'])
    expect(shown()).toBe(OTHER)
  })

  it('Sol r1: an option tap during a gallery save queues behind it and the later choice wins', async () => {
    const a = deferred()
    api.fetchXQuickPhotos.mockResolvedValue([{ id: 'p3', url: THIRD, place: 'Gdańsk, Poland', scene: '', mood: '', description: '', has_ivan: false, recent: false }])
    api.setXQuickPhoto.mockReturnValueOnce(a.p).mockResolvedValue(OTHER)
    await open(withRing())
    fireEvent.click(document.querySelector('[data-verb=x-photo-change]')!)
    await waitFor(() => expect(document.querySelector('[data-verb=x-photo-pick][data-photo-id=p3]')).toBeTruthy())
    fireEvent.click(document.querySelector('[data-verb=x-photo-pick][data-photo-id=p3]')!)
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p3'))
    expect(shown()).toBe(THIRD)
    await act(async () => { tap('p2') }) // back to p2 while p3 saves
    expect(shown()).toBe(OTHER)
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
    await act(async () => { tap('p2') })
    fireEvent.click(document.querySelector('[data-verb=x-post]')!)
    await screen.findByRole('alertdialog')
    await waitFor(() => expect(api.setXQuickPhoto).toHaveBeenCalledWith(QID, 'p2'))
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
