import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
import { LeadMagnetsPanel, lmState } from './LeadMagnetsView'
import type { GatedPost, GatedRead, LeadMagnetsRead, LmRow } from '../../../lib/leadMagnets'

const NOW = Date.parse('2026-09-16T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86400e3).toISOString()
/** Nothing rendered may read as a hole. `–` is `num(null)`, which this surface never passes. */
const HOLES = /NaN|undefined|—|–/

const lm = (o: Partial<LmRow>): LmRow => ({
  slug: 'a-kit', title: 'The AI Kit', status: 'published', keyword: 'KIT',
  posts: 4, comments: 26, gate_dms: 14, cta_clicks: 9, calls: null,
  first_post: at(40), last_post: at(10), per_post_comments: 6.5, ...o,
})
const gp = (o: Partial<GatedPost>): GatedPost => ({
  post_ref: `ref-${Math.random()}`, author: 'Alex Vacca', author_url: 'https://example.com/a',
  posted_at: at(12), likes: 369, comments: 974, reposts: 9,
  follower_count: 73256, followers_source: 'unipile_seat', per_1k: 13.3,
  cta_kind: 'comment_gate', gate_keyword: 'GTM', offer: '12 Clay GTM Skills, free', confidence: 0.93, ...o,
})

const LMS: LmRow[] = [
  lm({}),
  lm({ slug: 'one-post', title: 'The Holdout Plan', keyword: 'HOLDOUT', status: 'draft', posts: 1, comments: 7, gate_dms: 2, cta_clicks: 0, first_post: at(9), last_post: at(9), per_post_comments: 7 }),
  lm({ slug: 'clicks-only', title: 'Return Rate Rescue', keyword: 'RETURNS', posts: 0, comments: 0, gate_dms: 0, cta_clicks: 15, first_post: null, last_post: null, per_post_comments: null }),
  lm({ slug: 'idle', title: 'Nothing Yet', keyword: null, posts: 0, comments: 0, gate_dms: 0, cta_clicks: 0, first_post: null, last_post: null, per_post_comments: null }),
]
const POSTS: GatedPost[] = [
  gp({ post_ref: 'ref-top', author: 'Alex Vacca', comments: 974, follower_count: 73256, per_1k: 13.3 }),
  gp({ post_ref: 'ref-mid', author: 'Matt Lakajev', comments: 816, follower_count: 117138, per_1k: 7, gate_keyword: 'KEEN' }),
  gp({ post_ref: 'ref-unsized', author: 'Lara Acosta', comments: 1133, follower_count: null, followers_source: null, per_1k: null, gate_keyword: null, cta_kind: 'link' }),
]

const READY: LeadMagnetsRead = {
  kind: 'ready', since: '2026-06-17T00:00:00Z', lms: LMS,
  calls_note: 'calls is null when no booking carries the lead magnet slug.', readAt: at(0),
}
const GATED: GatedRead = { kind: 'ready', since: '2026-06-17T00:00:00Z', judged: 58, gated: 35, posts: POSTS, readAt: at(0) }

const html = (p: Partial<Parameters<typeof LeadMagnetsPanel>[0]> = {}) =>
  renderToStaticMarkup(<LeadMagnetsPanel lm={READY} gated={GATED} layout="a" weeks={12} now={NOW} {...p} />)

describe('LeadMagnetsPanel', () => {
  it('layout A leads with the ledger and states every denominator', () => {
    const h = html()
    expect(h).toMatch(/data-lm-layout="a"/)
    expect(h).toMatch(/data-lm-state="ready"/)
    expect(h).toMatch(/data-lm-window="12"/)
    // two of the four catalog rows carry a post inside the window
    expect(h).toMatch(/Lead magnets posted/)
    expect(h).toMatch(/3 of 4 lead magnets show a post or a click since 17 Jun/)
    expect(h).toMatch(/of the 58 loudest roster posts judged/)
    expect(h).toMatch(/2 of 3 carry a follower count, of the 58 loudest roster posts judged\./)
    expect(h).toMatch(/13\.3/)
    expect(h).not.toMatch(HOLES)
  })

  it('names the floor in words on a one-post lead magnet and the rate with its denominator on a four-post one', () => {
    const h = html()
    expect(h).toMatch(/Comments per post 6\.5, 14 gate DMs, 9 CTA clicks over 4 posts/)
    expect(h).toMatch(/1 post, under the 2-post floor, so no rate yet/)
    expect(h).toMatch(/Calls not attributable/)
    expect(h).toMatch(/1 lead magnet carries clicks with no post, so it sits in no window\./)
  })

  it('ranks the roster by per 1k with the unsized post last', () => {
    const h = html()
    const order = ['ref-top', 'ref-mid', 'ref-unsized'].map(r => h.indexOf(r))
    expect(order[0]).toBeGreaterThan(-1)
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    expect(h).toMatch(/size unknown/)
    expect(h).toMatch(/no keyword/)
  })

  it('layout B leads with the roster and renders the lead magnets as cards', () => {
    const h = html({ layout: 'b' })
    expect(h).toMatch(/data-lm-layout="b"/)
    expect(h.indexOf('Gated posts on the roster')).toBeLessThan(h.indexOf('Your lead magnets'))
    expect(h).toMatch(/a-lm-cards/)
    expect(h).toMatch(/<details class="a-lm-d" data-lm-author="Alex Vacca"/)
    expect(h).toMatch(/judged 93% sure/)
    expect(h).toMatch(/No follower count on this author, so no rate\./)
    expect(h).not.toMatch(HOLES)
  })

  it('the 4-week window drops what fell outside it and says the window is what is empty', () => {
    const outside: LeadMagnetsRead = { ...READY, kind: 'ready', lms: [lm({ slug: 'old', first_post: at(70), last_post: at(60) })] }
    const h = renderToStaticMarkup(
      <LeadMagnetsPanel lm={outside} gated={{ ...GATED, kind: 'ready', posts: [gp({ post_ref: 'ref-old', posted_at: at(60) })] }} layout="a" weeks={4} now={NOW} />)
    expect(h).toMatch(/data-lm-window="4"/)
    expect(h).toMatch(/No lead magnet posted in the last 4 weeks\./)
    expect(h).toMatch(/No gated post judged on this roster yet\./)
    expect(h).toMatch(/1 posted before this window\./)
    expect(h).not.toMatch(HOLES)
  })

  it('keeps the same post inside the 12-week window', () => {
    const h = html({ weeks: 12 })
    expect(h).toMatch(/data-lm-window="12"/)
    expect(h).toMatch(/The AI Kit/)
  })

  it('reports a denied read as denied, inside the section, with the message', () => {
    const h = html({ lm: { kind: 'denied', message: 'permission denied for operator_lead_magnets' } })
    expect(h).toMatch(/data-lm-state="denied"/)
    expect(h).toMatch(/permission denied for operator_lead_magnets/)
    // the roster read still landed, so the roster still renders
    expect(h).toMatch(/Matt Lakajev/)
    expect(h).not.toMatch(HOLES)
  })

  it('reports a failed read as failed and keeps the other half of the surface', () => {
    const h = html({ gated: { kind: 'failed', message: 'the gated posts read timed out' } })
    expect(h).toMatch(/data-lm-state="failed"/)
    expect(h).toMatch(/the gated posts read timed out/)
    expect(h).toMatch(/The AI Kit/)
    expect(h).not.toMatch(HOLES)
  })

  it('says it is reading while either read is out', () => {
    const h = html({ gated: null })
    expect(h).toMatch(/data-lm-state="loading"/)
    expect(h).toMatch(/Reading this lane’s lead magnets…/)
  })

  it('lmState takes the worse of the two reads', () => {
    expect(lmState(null, GATED)).toBe('loading')
    expect(lmState(READY, { kind: 'denied', message: 'x' })).toBe('denied')
    expect(lmState({ kind: 'failed', message: 'x' }, GATED)).toBe('failed')
    expect(lmState({ kind: 'failed', message: 'x' }, { kind: 'denied', message: 'y' })).toBe('denied')
    expect(lmState(READY, GATED)).toBe('ready')
  })
})
