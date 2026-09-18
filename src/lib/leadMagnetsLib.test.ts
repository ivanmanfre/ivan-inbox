import { describe, it, expect, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import {
  activeLms, perThousand, rankGated, sizeLabel, lmRate, inWindow, layoutFromLocation,
  fetchLeadMagnets, fetchGatedPosts,
  bestGateLine, bestOwnLine, coverageLine, verdictLines,
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
  it('takes the singular on a count of one and the plural above it', () => {
    expect(lmRate(lm({ posts: 2, per_post_comments: 1, gate_dms: 1, cta_clicks: 1 }))?.note)
      .toBe('1 gate DM, 1 CTA click over 2 posts')
    expect(lmRate(lm({ posts: 2, per_post_comments: 1, gate_dms: 2, cta_clicks: 2 }))?.note)
      .toBe('2 gate DMs, 2 CTA clicks over 2 posts')
  })
  it('reads every count through num(), so a four-figure one carries its separator', () => {
    expect(lmRate(lm({ posts: 1200, per_post_comments: 1, gate_dms: 1400, cta_clicks: 2500 }))?.note)
      .toBe('1,400 gate DMs, 2,500 CTA clicks over 1,200 posts')
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
  it('carries unjudged and best when the RPC sends them, including an explicit null best', async () => {
    const best = gated({ post_ref: 'loud' })
    rpc.mockResolvedValueOnce({ data: { since: '2026-06-17T18:11:01.898Z', judged: 58, gated: 35, posts: [], unjudged: 12, best }, error: null })
    const r1 = await fetchGatedPosts('ivan')
    expect(r1.kind === 'ready' ? r1.unjudged : null).toBe(12)
    expect(r1.kind === 'ready' ? r1.best : undefined).toEqual(best)

    rpc.mockResolvedValueOnce({ data: { since: '2026-06-17T18:11:01.898Z', judged: 58, gated: 35, posts: [], unjudged: 0, best: null }, error: null })
    const r2 = await fetchGatedPosts('ivan')
    expect(r2.kind === 'ready' ? r2.unjudged : null).toBe(0)
    expect(r2.kind === 'ready' ? r2.best : undefined).toBeNull()
  })
  it('leaves unjudged and best off the read when an older RPC sends neither', async () => {
    rpc.mockResolvedValueOnce({ data: { since: '2026-06-17T18:11:01.898Z', judged: 58, gated: 35, posts: [] }, error: null })
    const r = await fetchGatedPosts('ivan')
    expect(r.kind === 'ready' && 'unjudged' in r).toBe(false)
    expect(r.kind === 'ready' && 'best' in r).toBe(false)
  })
})

describe('fetchLeadMagnets best_own', () => {
  it('carries best_own when the RPC sends it, including an explicit null', async () => {
    const own = lm({ slug: 'kit' })
    rpc.mockResolvedValueOnce({ data: { since: '2026-06-17T18:11:01.898Z', lms: [], best_own: own }, error: null })
    const r1 = await fetchLeadMagnets('ivan')
    expect(r1.kind === 'ready' ? r1.best_own : undefined).toEqual(own)

    rpc.mockResolvedValueOnce({ data: { since: '2026-06-17T18:11:01.898Z', lms: [], best_own: null }, error: null })
    const r2 = await fetchLeadMagnets('ivan')
    expect(r2.kind === 'ready' ? r2.best_own : undefined).toBeNull()
  })
  it('leaves best_own off the read when an older RPC sends none', async () => {
    rpc.mockResolvedValueOnce({ data: { since: '2026-06-17T18:11:01.898Z', lms: [] }, error: null })
    const r = await fetchLeadMagnets('ivan')
    expect(r.kind === 'ready' && 'best_own' in r).toBe(false)
  })
})

describe('bestGateLine', () => {
  it('is null when best is null or absent', () => {
    expect(bestGateLine(null)).toBeNull()
    expect(bestGateLine(undefined)).toBeNull()
  })
  // Opus review FU-2: an unvalidated row would throw on `plain(best.author)` (no error boundary
  // exists in this tree) or print num()'s en-dash placeholder for a missing count. A row that
  // fails validation must yield no line, never either of those.
  it('never throws and never prints a dash on a malformed best row', () => {
    expect(bestGateLine({} as unknown as GatedPost)).toBeNull()
    expect(() => bestGateLine({ author: 'X' } as unknown as GatedPost)).not.toThrow()
    expect(bestGateLine({ author: 'X' } as unknown as GatedPost)).toBeNull()
    expect(bestGateLine({ comments: 5 } as unknown as GatedPost)).toBeNull()
  })
  it('states the keyword, the comment count and the rate when sized', () => {
    const best = gated({ author: 'Alex Vacca', comments: 974, follower_count: 73256, gate_keyword: 'GTM', per_1k: 13.3 })
    expect(bestGateLine(best)).toBe('Loudest gate by comments per 1k followers: Alex Vacca, comment "GTM", 974 comments, 13.3 per 1k followers.')
  })
  it('falls back to the CTA kind when there is no keyword, and to size unknown when unsized', () => {
    const best = gated({ author: 'No Keyword', comments: 5, gate_keyword: '', cta_kind: 'dm_gate', follower_count: null })
    expect(bestGateLine(best)).toBe("Loudest gate by comments, no follower count on this lane's gated authors: No Keyword, a DM gate, 5 comments.")
  })
  // db/083: gate_keyword is JSON null (not '') on every `link`-kind row by rubric design — the
  // whole risedtc roster today. A null must fall back exactly like an empty string does.
  it('falls back the same way on a null gate_keyword as on an empty one', () => {
    const best = gated({ author: 'Luis Camacho', comments: 107, gate_keyword: null, cta_kind: 'link', follower_count: null })
    expect(bestGateLine(best)).toBe("Loudest gate by comments, no follower count on this lane's gated authors: Luis Camacho, a link, 107 comments.")
  })
  it('takes the em dash out of the author name', () => {
    const best = gated({ author: 'A — B', comments: 1, gate_keyword: '' })
    expect(bestGateLine(best)?.startsWith("Loudest gate by comments, no follower count on this lane's gated authors: A, B,")).toBe(true)
  })
})

describe('bestGateLine with a null cta_kind', () => {
  it('prints no line and never throws', () => {
    expect(bestGateLine({ author: 'A', comments: 3, cta_kind: null, gate_keyword: null } as never)).toBeNull()
  })
})

describe('bestOwnLine', () => {
  it('names the RPC window when the read carries one, and no window when it does not', () => {
    const row = lm({ title: 'The Kit', cta_clicks: 6, gate_dms: 0, posts: 0 })
    const year = new Date().getUTCFullYear()
    expect(bestOwnLine(row, `${year}-06-19T00:00:00Z`)?.startsWith('Your best lead magnet since 19 Jun: The Kit,')).toBe(true)
    expect(bestOwnLine(row, 'not a date')?.startsWith('Your best lead magnet: The Kit,')).toBe(true)
    expect(bestOwnLine(row)?.startsWith('Your best lead magnet: The Kit,')).toBe(true)
  })
  it('is null when the row is null or absent', () => {
    expect(bestOwnLine(null)).toBeNull()
    expect(bestOwnLine(undefined)).toBeNull()
  })
  it('names the title, the status, the clicks, the gate DMs and the posts', () => {
    const row = lm({ title: 'The Rise DTC AI Kit', status: 'published', cta_clicks: 5, gate_dms: 1, posts: 4 })
    expect(bestOwnLine(row)).toBe('Your best lead magnet: The Rise DTC AI Kit, published, 5 CTA clicks, 1 gate DM, 4 posts.')
  })
  // db/083's own live example: Ivan's best lead magnet by clicks is a RETIRED one (activeLms
  // picks by activity, not by status), so the strip must say so rather than imply it is live.
  it('states a retired or draft pick as such, never silent about it', () => {
    const row = lm({ title: 'Workflow Audit Checklist for Service Businesses', status: 'retired', keyword: 'AUDIT', posts: 0, comments: 0, gate_dms: 0, cta_clicks: 29 })
    expect(bestOwnLine(row)).toBe('Your best lead magnet: Workflow Audit Checklist for Service Businesses, retired, 29 CTA clicks, 0 gate DMs, 0 posts.')
  })
  it('falls back to the keyword, then the slug, when there is no title', () => {
    expect(bestOwnLine(lm({ title: '', keyword: 'KIT', slug: 'kit-slug' }))?.startsWith('Your best lead magnet: KIT,')).toBe(true)
    expect(bestOwnLine(lm({ title: '', keyword: null, slug: 'kit-slug' }))?.startsWith('Your best lead magnet: kit-slug,')).toBe(true)
  })
})

describe('coverageLine', () => {
  it('is null when unjudged is missing (an older RPC) or exactly 0 (every post judged)', () => {
    expect(coverageLine(58, undefined)).toBeNull()
    expect(coverageLine(58, null)).toBeNull()
    expect(coverageLine(58, 0)).toBeNull()
  })
  it('states judged of the total, and the upper-bound caveat', () => {
    expect(coverageLine(174, 1212)).toBe('174 of 1,386 roster posts judged, so treat the gate share as an upper bound.')
  })
})

describe('verdictLines', () => {
  it('returns all three lines when both reads are ready and both picks are present', () => {
    const g = { kind: 'ready' as const, since: '2026-06-17T00:00:00Z', judged: 58, gated: 35, posts: [], unjudged: 1212, best: gated({ author: 'Alex Vacca', comments: 974, follower_count: 73256, gate_keyword: 'GTM', per_1k: 13.3 }), readAt: '' }
    const l = { kind: 'ready' as const, since: '2026-06-17T00:00:00Z', lms: [], best_own: lm({ title: 'The Kit', cta_clicks: 5, gate_dms: 1, posts: 4 }), readAt: '' }
    expect(verdictLines(g, l)).toHaveLength(3)
  })
  it('drops to two lines when one pick is null, and to one when only one read is ready', () => {
    const g = { kind: 'ready' as const, since: '2026-06-17T00:00:00Z', judged: 58, gated: 0, posts: [], unjudged: 0, best: null, readAt: '' }
    const l = { kind: 'ready' as const, since: '2026-06-17T00:00:00Z', lms: [], best_own: lm({ title: 'The Kit', cta_clicks: 5, gate_dms: 1, posts: 4 }), readAt: '' }
    expect(verdictLines(g, l)).toHaveLength(1)
    expect(verdictLines(g, null)).toHaveLength(0)
  })
  it('returns nothing for a loading or fully failed pair', () => {
    expect(verdictLines(null, null)).toEqual([])
    expect(verdictLines({ kind: 'failed', message: 'x' }, { kind: 'denied', message: 'y' })).toEqual([])
  })
})
