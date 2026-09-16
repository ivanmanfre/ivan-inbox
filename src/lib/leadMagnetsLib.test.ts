import { describe, it, expect, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import {
  activeLms, perThousand, rankGated, sizeLabel, lmRate, inWindow, layoutFromLocation,
  fetchLeadMagnets, fetchGatedPosts,
  LM_FLOOR_POSTS, LM_DEFAULT_LAYOUT,
  type LmRow, type GatedPost,
} from './leadMagnets'

const NOW = Date.parse('2026-09-16T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86400e3).toISOString()

const lm = (o: Partial<LmRow>): LmRow => ({
  slug: 's', title: 'T', status: 'published', keyword: null, posts: 0, comments: 0, gate_dms: 0,
  cta_clicks: 0, calls: null, first_post: null, last_post: null, per_post_comments: null, ...o,
})

const gated = (o: Partial<GatedPost>): GatedPost => ({
  post_ref: 'https://linkedin.com/x', author: 'A', author_url: 'https://linkedin.com/in/a', posted_at: at(1),
  likes: 1, comments: 1, reposts: 0, follower_count: null, followers_source: null, per_1k: null,
  cta_kind: 'comment_gate', gate_keyword: 'KW', offer: 'offer', confidence: 0.9, ...o,
})

describe('activeLms', () => {
  it('drops rows with no activity and orders posts desc, then comments desc, then cta_clicks desc', () => {
    const rows = [
      lm({ slug: 'dead', posts: 0, cta_clicks: 0, gate_dms: 0, calls: null }),
      lm({ slug: 'low-posts-high-comments', posts: 1, comments: 20 }),
      lm({ slug: 'high-posts', posts: 3, comments: 5 }),
      lm({ slug: 'tie-posts-more-comments', posts: 1, comments: 8 }),
      lm({ slug: 'cta-only', posts: 0, cta_clicks: 4 }),
      lm({ slug: 'calls-only', posts: 0, calls: 2 }),
    ]
    const result = activeLms(rows)
    expect(result.map(r => r.slug)).toEqual(['high-posts', 'low-posts-high-comments', 'tie-posts-more-comments', 'cta-only', 'calls-only'])
  })
  it('breaks a posts-and-comments tie on cta_clicks desc', () => {
    const rows = [
      lm({ slug: 'a', posts: 2, comments: 3, cta_clicks: 1 }),
      lm({ slug: 'b', posts: 2, comments: 3, cta_clicks: 5 }),
    ]
    expect(activeLms(rows).map(r => r.slug)).toEqual(['b', 'a'])
  })
})

describe('perThousand', () => {
  it('is null when followers is null or zero', () => {
    expect(perThousand(10, null)).toBeNull()
    expect(perThousand(10, 0)).toBeNull()
  })
  it('rounds to one decimal', () => {
    expect(perThousand(974, 73256)).toBe(13.3)
    expect(perThousand(5, 1000)).toBe(5)
  })
})

describe('rankGated', () => {
  it('orders per_1k desc, puts nulls last, then breaks ties on comments desc', () => {
    const posts = [
      gated({ post_ref: 'low', per_1k: 2, comments: 100 }),
      gated({ post_ref: 'no-size-more-comments', per_1k: null, comments: 50 }),
      gated({ post_ref: 'high', per_1k: 9, comments: 10 }),
      gated({ post_ref: 'no-size-fewer-comments', per_1k: null, comments: 5 }),
      gated({ post_ref: 'tie-high-more-comments', per_1k: 9, comments: 40 }),
    ]
    expect(rankGated(posts).map(p => p.post_ref)).toEqual([
      'tie-high-more-comments', 'high', 'low', 'no-size-more-comments', 'no-size-fewer-comments',
    ])
  })
  it('does not mutate the input array', () => {
    const posts = [gated({ post_ref: 'a', per_1k: 1 }), gated({ post_ref: 'b', per_1k: 2 })]
    const ranked = rankGated(posts)
    expect(ranked).not.toBe(posts)
    expect(posts.map(p => p.post_ref)).toEqual(['a', 'b'])
  })
})

describe('sizeLabel', () => {
  it('formats a known follower count', () => {
    expect(sizeLabel({ follower_count: 73256 })).toBe('73,256 followers')
  })
  it('reports size unknown when null or zero', () => {
    expect(sizeLabel({ follower_count: null })).toBe('size unknown')
    expect(sizeLabel({ follower_count: 0 })).toBe('size unknown')
  })
})

describe('lmRate', () => {
  it('is null under LM_FLOOR_POSTS (1 post)', () => {
    expect(LM_FLOOR_POSTS).toBe(2)
    expect(lmRate(lm({ posts: 1, per_post_comments: 6 }))).toBeNull()
  })
  it('is non-null at exactly LM_FLOOR_POSTS (2 posts)', () => {
    const r = lmRate(lm({ posts: 2, per_post_comments: 6.5 }))
    expect(r).toEqual({ text: 'Comments per post 6.5', note: 'over 2 posts' })
  })
  it('appends gate DMs and CTA clicks with their own denominator when either is present', () => {
    const r = lmRate(lm({ posts: 4, per_post_comments: 6.5, gate_dms: 14, cta_clicks: 9 }))
    expect(r).toEqual({ text: 'Comments per post 6.5', note: '14 gate DMs, 9 CTA clicks over 4 posts' })
  })
  it('appends only gate DMs when CTA clicks is zero', () => {
    const r = lmRate(lm({ posts: 4, per_post_comments: 1, gate_dms: 3, cta_clicks: 0 }))
    expect(r).toEqual({ text: 'Comments per post 1.0', note: '3 gate DMs over 4 posts' })
  })
})

describe('inWindow', () => {
  it('includes a date inside the window and excludes one before it', () => {
    expect(inWindow(at(10), 4, NOW)).toBe(true)
    expect(inWindow(at(40), 4, NOW)).toBe(false)
  })
  it('is false for null or unparseable dates, and false for a future date', () => {
    expect(inWindow(null, 4, NOW)).toBe(false)
    expect(inWindow('not-a-date', 4, NOW)).toBe(false)
    expect(inWindow(new Date(NOW + 86400e3).toISOString(), 4, NOW)).toBe(false)
  })
})

describe('layoutFromLocation', () => {
  it('reads lm from the hash query string', () => {
    expect(layoutFromLocation({ hash: '#/inbox?lm=b', search: '' })).toBe('b')
  })
  it('reads lm from location.search when the hash carries none', () => {
    expect(layoutFromLocation({ hash: '#/inbox', search: '?lm=b' })).toBe('b')
  })
  it('prefers the hash query over search when both are present', () => {
    expect(layoutFromLocation({ hash: '#/inbox?lm=a', search: '?lm=b' })).toBe('a')
  })
  it('defaults to LM_DEFAULT_LAYOUT when neither carries a recognised value', () => {
    expect(LM_DEFAULT_LAYOUT).toBe('a')
    expect(layoutFromLocation({ hash: '', search: '' })).toBe('a')
    expect(layoutFromLocation({ hash: '#/inbox?lm=z', search: '' })).toBe('a')
  })
})

describe('fetchLeadMagnets', () => {
  it('reads the lms and stamps the RPC with the ops gate and the lane', async () => {
    const data = { since: '2026-06-17T18:11:01.898Z', lms: [lm({ slug: 'x' })], calls_note: 'calls read null today' }
    rpc.mockResolvedValueOnce({ data, error: null })
    const result = await fetchLeadMagnets('ivan')
    expect(result.kind).toBe('ready')
    expect(result.kind === 'ready' ? result.lms : null).toEqual(data.lms)
    expect(result.kind === 'ready' ? result.calls_note : null).toBe('calls read null today')
    expect(rpc).toHaveBeenCalledWith('operator_lead_magnets', { p_gate: 'clientops', p_client_id: 'ivan' })
  })
  it('reports denied when the error message says permission or unauthorized', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied for function operator_lead_magnets' } })
    expect(await fetchLeadMagnets('ivan')).toEqual({ kind: 'denied', message: 'permission denied for function operator_lead_magnets' })
  })
  it('reports failed for any other error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } })
    expect(await fetchLeadMagnets('ivan')).toEqual({ kind: 'failed', message: 'connection reset' })
  })
  it('reports failed when the data has no usable lms array', async () => {
    rpc.mockResolvedValueOnce({ data: { nope: true }, error: null })
    expect((await fetchLeadMagnets('ivan')).kind).toBe('failed')
  })
})

describe('fetchGatedPosts', () => {
  it('reads judged, gated and posts, and stamps the RPC with the ops gate and the lane', async () => {
    const data = { since: '2026-06-17T18:11:01.898Z', judged: 35, gated: 35, posts: [gated({ post_ref: 'x' })] }
    rpc.mockResolvedValueOnce({ data, error: null })
    const result = await fetchGatedPosts('arch')
    expect(result).toEqual({ kind: 'ready', ...data, readAt: expect.any(String) })
    expect(rpc).toHaveBeenCalledWith('operator_gated_posts', { p_gate: 'clientops', p_client_id: 'arch' })
  })
  it('reports denied when the error message says unauthorized', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'unauthorized: not your seat' } })
    expect(await fetchGatedPosts('arch')).toEqual({ kind: 'denied', message: 'unauthorized: not your seat' })
  })
  it('reports failed when required fields are missing', async () => {
    rpc.mockResolvedValueOnce({ data: { posts: [] }, error: null })
    expect((await fetchGatedPosts('arch')).kind).toBe('failed')
  })
})
