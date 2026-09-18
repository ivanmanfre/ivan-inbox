import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
import { LeadMagnetsPanel, armedLayout, lmState } from './LeadMagnetsView'
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
  // The live read returns a null `gate_keyword` on 23 of Ivan's 35 gated posts
  // though `GatedPost` types it as a string, so the fixture forces the real
  // shape rather than the declared one.
  gp({ post_ref: 'ref-unsized', author: 'Lara Acosta', comments: 1133, follower_count: null, followers_source: null, per_1k: null, gate_keyword: null as unknown as string, cta_kind: 'link' }),
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
    expect(h).toMatch(/from the 58 loudest roster posts judged/)
    expect(h).toMatch(/2 of 3 carry a follower count, so sized lines rank by comments per 1k followers and unsized lines follow by comments\./)
    expect(h).toMatch(/13\.3/)
    expect(h).not.toMatch(HOLES)
  })

  it('names the floor in words on a one-post lead magnet and the rate with its denominator on a four-post one', () => {
    const h = html()
    expect(h).toMatch(/Comments per post 6\.5, 14 gate DMs, 9 CTA clicks over 4 posts/)
    expect(h).toMatch(/1 post, under the 2-post floor, so no rate yet/)
  })

  it('says the missing call ledger once, under the list, and never on a row', () => {
    const h = html()
    expect(h).toMatch(/Why calls read as not attributable/)
    expect(h).not.toMatch(/Calls not attributable/)
    // A lane with nothing to list has no list to explain, so no disclosure either.
    const bare = html({ lm: { kind: 'ready', since: '2026-06-17T00:00:00Z', lms: [], readAt: at(0), calls_note: 'no ledger' } })
    expect(bare).not.toMatch(/Why calls read as not attributable/)
    expect(bare).toMatch(/No lead magnet shows a post or a click since 17 Jun\./)
  })

  it('keeps a lead magnet with clicks and no post, and states the window instead of hiding the row', () => {
    const h = html()
    // 29 CTA clicks, no post at all: the row the first build dropped.
    expect(h).toMatch(/Return Rate Rescue/)
    expect(h).toMatch(/15 CTA clicks/)
    expect(h).toMatch(/No post carries this keyword yet\./)
    // The ledger answers "which CTAs perform" on the first screenful.
    expect(h).toMatch(/CTA clicks/)
    expect(h).toMatch(/over 3 lead magnets since 17 Jun/)
    expect(h).toMatch(/3 of 4 lead magnets show a post or a click since 17 Jun, 2 posted in the last 12 weeks\./)
    // The sentence that used to explain the hiding is gone.
    expect(h).not.toMatch(/sits in no window|sit in no window/)
    expect(h).not.toMatch(HOLES)
  })

  it('states an em dash out of a catalog title and an offer rather than printing one', () => {
    const dashed: LeadMagnetsRead = { ...READY, kind: 'ready', lms: [lm({ slug: 'score', title: 'The Agency Efficiency Score — How Much Profit Are You Leaving on the Table?' })] }
    const h = renderToStaticMarkup(
      <LeadMagnetsPanel lm={dashed} gated={{ ...GATED, kind: 'ready', posts: [gp({ offer: 'the kit — free' })] }} layout="a" weeks={12} now={NOW} />)
    expect(h).toMatch(/The Agency Efficiency Score, How Much Profit/)
    expect(h).toMatch(/the kit, free/)
    expect(h).not.toMatch(HOLES)
  })

  it('folds the own list at the top eight and names what the control hides', () => {
    const many: LmRow[] = Array.from({ length: 11 }, (_, i) =>
      lm({ slug: `lm-${i}`, title: `Magnet ${i}`, posts: 0, comments: 0, gate_dms: 0, cta_clicks: 11 - i, first_post: null, last_post: null, per_post_comments: null }))
    const read: LeadMagnetsRead = { ...READY, kind: 'ready', lms: many }
    for (const layout of ['a', 'b'] as const) {
      const h = html({ lm: read, layout })
      expect(h).toMatch(/Show 3 more lead magnets/)
      expect(h).toMatch(/aria-expanded="false"/)
      expect(h).toMatch(/Magnet 7/)      // the eighth row still shows
      expect(h).not.toMatch(/Magnet 8/)  // the ninth is behind the fold
      expect(h).not.toMatch(HOLES)
    }
  })

  it('states the window count, the whole read and the judged set in one line', () => {
    const h = html()
    // 3 of the 3 fixture posts fall in the 12-week window, which opens on the ISO Monday.
    expect(h).toMatch(/3 gated posts since 29 Jun, 3 posts over 92 days, from the 58 loudest roster posts judged\./)
  })

  it('names what the roster ranked by, and changes the sentence when nothing carries a size', () => {
    const unsized = POSTS.map(p => ({ ...p, follower_count: null, per_1k: null }))
    const h = html({ gated: { ...GATED, kind: 'ready', posts: unsized } })
    expect(h).toMatch(/No line carries a follower count, so the rank is by comments alone\./)
    const sized = POSTS.filter(p => p.follower_count)
    const h2 = html({ gated: { ...GATED, kind: 'ready', posts: sized } })
    expect(h2).toMatch(/2 of 2 carry a follower count, so the rank is by comments per 1k followers\./)
    // The mixed case is asserted in the layout A test above.
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
    // The row stays, its counts stay, and the note says the window is what is empty.
    expect(h).toMatch(/The AI Kit/)
    expect(h).toMatch(/No post in the last 4 weeks\./)
    expect(h).toMatch(/1 of 1 lead magnet shows a post or a click since 17 Jun, 0 posted in the last 4 weeks\./)
    expect(h).toMatch(/No gated post judged on this roster yet\./)
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

  it('never arms on a query key that merely ends in lm', () => {
    const mem = () => { const box: Record<string, string> = {}; return { getItem: (k: string) => box[k] ?? null, setItem: (k: string, v: string) => { box[k] = v } } }
    expect(armedLayout({ hash: '', search: '?film=b' }, mem())).toBe('a')
    expect(armedLayout({ hash: '#exp/brain-b/strategy?film=b', search: '' }, mem())).toBe('a')
    expect(armedLayout({ hash: '', search: '?lm=b' }, mem())).toBe('b')
    expect(armedLayout({ hash: '', search: '?tab=x&lm=b' }, mem())).toBe('b')
    expect(armedLayout({ hash: '', search: '?lm=bb' }, mem())).toBe('a')
  })

  it('retries one half without blanking the other', () => {
    let lmRetries = 0, gatedRetries = 0
    const h = renderToStaticMarkup(
      <LeadMagnetsPanel lm={{ kind: 'failed', message: 'lm read broke' }} gated={GATED} layout="a" weeks={12} now={NOW}
        onRetryLm={() => { lmRetries += 1 }} onRetryGated={() => { gatedRetries += 1 }} />)
    // The roster half is untouched by the other half's failure.
    expect(h).toMatch(/lm read broke/)
    expect(h).toMatch(/Matt Lakajev/)
    expect(h).toMatch(/Try again/)
    expect(lmRetries + gatedRetries).toBe(0)
  })

  it('says one line carries a follower count in the singular', () => {
    const one = [POSTS[0], { ...POSTS[2], post_ref: 'ref-b' }, { ...POSTS[2], post_ref: 'ref-c' }]
    const h = html({ gated: { ...GATED, kind: 'ready', posts: one } })
    expect(h).toMatch(/1 of 3 carries a follower count, so sized lines rank by comments per 1k followers/)
    const solo = html({ gated: { ...GATED, kind: 'ready', posts: [POSTS[0]] } })
    expect(solo).toMatch(/1 of 1 carries a follower count, so the rank is by comments per 1k followers\./)
  })

  it('arms the layout from the search, from the hash, or from what a first arm stored', () => {
    const mem = () => {
      const box: Record<string, string> = {}
      return { box, getItem: (k: string) => box[k] ?? null, setItem: (k: string, v: string) => { box[k] = v } }
    }
    // The Shell strips the hash query at boot, so the search is the form that
    // survives a cold load; the hash form still works when it reaches this far.
    const s1 = mem()
    expect(armedLayout({ hash: '#exp/brain-b/strategy', search: '?lm=b' }, s1)).toBe('b')
    // Armed once, the tab keeps it: the rewritten hash carries nothing.
    expect(armedLayout({ hash: '#exp/brain-b/strategy', search: '' }, s1)).toBe('b')
    const s2 = mem()
    expect(armedLayout({ hash: '#exp/brain-b/strategy?lm=b', search: '' }, s2)).toBe('b')
    expect(armedLayout({ hash: '#exp/brain-b/strategy?lm=a', search: '' }, s2)).toBe('a')
    // Nothing asked for and nothing stored: the default arm.
    expect(armedLayout({ hash: '#exp/brain-b/strategy', search: '' }, mem())).toBe('a')
    expect(armedLayout({ hash: '', search: '' })).toBe('a')
    // A store that throws (private window) never breaks the read.
    const dead = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(armedLayout({ hash: '', search: '?lm=b' }, dead)).toBe('b')
    expect(armedLayout({ hash: '', search: '' }, dead)).toBe('a')
  })

  // BLOCKER fix (Opus review B1): this surface HAS the 4/12-week control, so the strip must name
  // whatever the windowed list actually shows, never the RPC's own unwindowed `best`.
  it('names the windowed top row, not the RPC-wide best that has dropped out of the window', () => {
    const posts: GatedPost[] = [
      // Highest per_1k overall, but posted 50 days ago: outside a 4-week window today.
      gp({ post_ref: 'ref-old-best', author: 'Old Champion', comments: 500, follower_count: 10000, per_1k: 50, posted_at: at(50) }),
      // Inside the 4-week window, lower per_1k: this is what a 4-week reader actually sees on top.
      gp({ post_ref: 'ref-recent', author: 'Recent Author', comments: 200, follower_count: 20000, per_1k: 10, posted_at: at(5) }),
    ]
    const gated: GatedRead = { ...GATED, posts }
    const at12 = html({ gated, weeks: 12 })
    const at4 = html({ gated, weeks: 4 })
    // At 12 weeks both posts are in range, so the RPC-wide best (highest per_1k) is also the
    // windowed top: agreement is not the interesting case, it is the floor.
    expect(at12).toMatch(/Loudest gate by comments per 1k followers: Old Champion,/)
    // At 4 weeks "Old Champion" has fallen out of the visible roster entirely; the strip must
    // follow the list, not keep repeating a row that is no longer anywhere on the screen.
    expect(at4).not.toMatch(/Old Champion/)
    expect(at4).toMatch(/Loudest gate by comments per 1k followers: Recent Author,/)
    expect(at4).not.toMatch(HOLES)
  })

  it('lmState takes the worse of the two reads', () => {
    expect(lmState(null, GATED)).toBe('loading')
    expect(lmState(READY, { kind: 'denied', message: 'x' })).toBe('denied')
    expect(lmState({ kind: 'failed', message: 'x' }, GATED)).toBe('failed')
    expect(lmState({ kind: 'failed', message: 'x' }, { kind: 'denied', message: 'y' })).toBe('denied')
    expect(lmState(READY, GATED)).toBe('ready')
  })
})
