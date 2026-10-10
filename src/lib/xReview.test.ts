import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }))
import { xFlagItems, xWaitingCount, type XArticle, type XQuote, type XReviewList } from './xReview'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const art = (id: string, status: XArticle['status'], updated: string, extra: Partial<XArticle> = {}): XArticle => ({
  id, status, title: `A ${id}`, body_md: '', cover_url: null, images: [], qa: null, sources: [], x_url: null, error: null,
  lm_slug: null, lm_topic: null, account: 'theivanpill', created_at: updated, updated_at: updated, ...extra,
})
const quo = (id: string, status: XQuote['status'], created: string, extra: Partial<XQuote> = {}): XQuote => ({
  id, status, hook: `Q ${id}`, media_url: null, quoted_url: null, dry_run_shot_url: null, posted_url: null, error: null, account: 'theivanpill',
  hook_options: null, giphy_url: null, article_title: null, article_cover: null, article_body_md: null, created_at: created, ...extra,
})

describe('x review flag', () => {
  const list: XReviewList = {
    articles: [
      art('a1', 'review', '2026-10-10T21:00:00Z'),
      art('a2', 'published', '2026-10-11T08:00:00Z', { x_url: 'https://x.com/i/a2' }),
      art('a3', 'published', '2026-10-09T08:00:00Z'),
      art('a4', 'publishing', '2026-10-01T08:00:00Z'),
      art('a5', 'failed', '2026-10-10T08:00:00Z', { error: 'zernio 500' }),
    ],
    quotes: [quo('q1', 'draft', '2026-10-11T10:00:00Z'), quo('q2', 'posted', '2026-10-01T10:00:00Z'), quo('q3', 'failed', '2026-10-01T10:00:00Z')],
  }
  it('counts only what waits on Ivan', () => {
    expect(xWaitingCount(list)).toBe(2)
    expect(xWaitingCount(null)).toBe(0)
  })
  it('lists waiting first, then moving, failed, live; old live/failed drop off', () => {
    const items = xFlagItems(list, NOW)
    expect(items.map(i => `${i.id}:${i.state}`)).toEqual(['q1:waiting', 'a1:waiting', 'a4:moving', 'a5:failed', 'a2:live'])
    expect(items.find(i => i.id === 'a2')?.url).toBe('https://x.com/i/a2')
    expect(items.find(i => i.id === 'a5')?.error).toBe('zernio 500')
    expect(items.find(i => i.id === 'q1')?.title).toBe('Q q1')
  })
})
