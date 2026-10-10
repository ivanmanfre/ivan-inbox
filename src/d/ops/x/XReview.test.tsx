// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { XReviewList } from '../../../lib/xReview'
import { parseDHash } from '../../route'
import { renderInFrame } from '../../test-utils'

const api = vi.hoisted(() => ({
  fetchXReview: vi.fn(), saveXArticle: vi.fn(), decideXArticle: vi.fn(), saveXQuote: vi.fn(), decideXQuote: vi.fn(),
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
