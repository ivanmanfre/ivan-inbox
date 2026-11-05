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
})
