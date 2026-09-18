// @vitest-environment jsdom
//
// THE RETRY-BLANK REGRESSION, MOUNTED. `LeadMagnetsBlock.test.tsx` and
// `leadmagnets/LeadMagnetsView.test.tsx` both render with `renderToStaticMarkup`,
// which never runs an effect, so neither can see what a real retry does: the
// prior run shipped `setLm`/`setGated` each carrying its own tick and its own
// "keep `prev` when the lane hasn't changed" guard specifically so a retry on
// one half cannot blank the other, or blank itself back to the unread state
// while the new fetch is in flight. This file is the one test in the suite
// that actually runs those effects (via `createRoot` + `act` in jsdom, the
// only place in the repo that needs a live DOM) and clicks the real button.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const harness = vi.hoisted(() => ({ fetchLeadMagnets: vi.fn(), fetchGatedPosts: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/leadMagnets', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/leadMagnets')>()),
  fetchLeadMagnets: harness.fetchLeadMagnets,
  fetchGatedPosts: harness.fetchGatedPosts,
}))

import { LeadMagnetsSection } from './LeadMagnetsBlock'
import { LeadMagnetsView as DedicatedLeadMagnetsView } from './leadmagnets'
import type { GatedRead, LeadMagnetsRead } from '../../lib/leadMagnets'

const SINCE = '2026-06-17T18:20:02.677561+00:00'
const NOW = Date.parse(SINCE)

const readyLm: LeadMagnetsRead = {
  kind: 'ready', since: SINCE, readAt: SINCE,
  lms: [{ slug: 'kit', title: 'The Rise DTC AI Kit', status: 'published', keyword: null, posts: 4, comments: 26, gate_dms: 1, cta_clicks: 5, calls: null, first_post: null, last_post: null, per_post_comments: 6.5 }],
}
const readyGated = (author: string): GatedRead => ({
  kind: 'ready', since: SINCE, judged: 58, gated: 1, readAt: SINCE,
  posts: [{ post_ref: 'https://www.linkedin.com/posts/x', author, author_url: 'https://www.linkedin.com/in/x', posted_at: '2026-08-12T00:00:00Z', likes: 1, comments: 9, reposts: 0, follower_count: null, followers_source: null, per_1k: null, cta_kind: 'link', gate_keyword: '', offer: 'a doc', confidence: 0.9 }],
})

/** Two ticks of the microtask queue: one for the mocked promise to settle, one
    for the `.then`/`.catch` callback that calls `setState` to flush. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('Retry-blank regression (mounted)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    harness.fetchLeadMagnets.mockReset()
    harness.fetchGatedPosts.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  it('LeadMagnetsSection (Results): the ready half stays up while the failed half retries, then recovers', async () => {
    harness.fetchLeadMagnets.mockResolvedValue(readyLm)
    let gatedCalls = 0
    harness.fetchGatedPosts.mockImplementation(() =>
      (gatedCalls++ === 0) ? Promise.reject(new Error('gated boom')) : Promise.resolve(readyGated('Recovered Author')))

    await act(async () => { root.render(<LeadMagnetsSection lane="ivan" now={NOW} />) })
    await flush()

    expect(container.textContent).toContain('The Rise DTC AI Kit')   // the ready half loaded
    expect(container.textContent).toContain('gated boom')            // the other half failed
    const retryBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Try again')
    expect(retryBtn, 'expected a Try again button on the failed half').toBeTruthy()
    expect(harness.fetchGatedPosts).toHaveBeenCalledTimes(1)

    act(() => { retryBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // Mid-retry, before the second fetchGatedPosts call resolves: the ready
    // half must still be on screen untouched, and the failed half must keep
    // showing its LAST message (the effect's guard returns the same `prev`
    // object when the lane hasn't changed, so React bails out of re-rendering
    // it) rather than blanking to a bare loading state.
    expect(container.textContent).toContain('The Rise DTC AI Kit')
    expect(container.textContent).toContain('gated boom')
    expect(harness.fetchLeadMagnets).toHaveBeenCalledTimes(1)   // the retry re-ran only its own effect

    await flush()

    expect(harness.fetchGatedPosts).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Recovered Author')      // the failed half recovered
    expect(container.textContent).toContain('The Rise DTC AI Kit')   // the ready half never moved
    expect(container.textContent).not.toContain('gated boom')
  })

  it('leadmagnets/LeadMagnetsView (dedicated view): the same guarantee holds on the other surface', async () => {
    harness.fetchGatedPosts.mockResolvedValue(readyGated('Roster Author'))
    let lmCalls = 0
    harness.fetchLeadMagnets.mockImplementation(() =>
      (lmCalls++ === 0) ? Promise.reject(new Error('lm boom')) : Promise.resolve(readyLm))

    await act(async () => { root.render(<DedicatedLeadMagnetsView lane="ivan" />) })
    await flush()

    expect(container.textContent).toContain('Roster Author')
    expect(container.textContent).toContain('lm boom')
    const retryBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Try again')
    expect(retryBtn, 'expected a Try again button on the failed half').toBeTruthy()

    act(() => { retryBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('Roster Author')
    expect(harness.fetchGatedPosts).toHaveBeenCalledTimes(1)

    await flush()
    expect(container.textContent).toContain('The Rise DTC AI Kit')
    expect(container.textContent).toContain('Roster Author')
    expect(container.textContent).not.toContain('lm boom')
  })
})
