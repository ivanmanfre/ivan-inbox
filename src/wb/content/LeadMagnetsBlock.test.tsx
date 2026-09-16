import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { LeadMagnetsView } from './LeadMagnetsBlock'
import type { GatedPost, GatedRead, LeadMagnetsRead, LmRow } from '../../lib/leadMagnets'

const NOW = Date.parse('2026-09-16T12:00:00Z')
const SINCE = '2026-06-17T18:20:02.677561+00:00'

const lm = (o: Partial<LmRow>): LmRow => ({
  slug: 'a-guide', title: 'A Guide', status: 'published', keyword: null,
  posts: 0, comments: 0, gate_dms: 0, cta_clicks: 0, calls: null,
  first_post: null, last_post: null, per_post_comments: null, ...o,
})
const gp = (o: Partial<GatedPost>): GatedPost => ({
  post_ref: `https://www.linkedin.com/posts/x-${Math.random()}`, author: 'Some One',
  author_url: 'https://www.linkedin.com/in/someone', posted_at: '2026-08-12T13:33:01.132+00:00',
  likes: 10, comments: 20, reposts: 1, follower_count: null, followers_source: null, per_1k: null,
  cta_kind: 'link', gate_keyword: '', offer: 'a thing', confidence: 0.9, ...o,
})
const ready = (lms: LmRow[], calls_note = 'A null here means not attributable, it does not mean zero calls.'): LeadMagnetsRead =>
  ({ kind: 'ready', since: SINCE, lms, calls_note, readAt: SINCE })
const gready = (posts: GatedPost[], judged = 58): GatedRead =>
  ({ kind: 'ready', since: SINCE, judged, gated: posts.length, posts, readAt: SINCE })

const NOISE = /NaN|undefined|—/

describe('LeadMagnetsView', () => {
  it('renders both blocks with denominators, the floor sentence and the rank order', () => {
    const lms = [
      lm({ slug: 'kit', title: 'The Rise DTC AI Kit', status: 'draft', keyword: 'KIT', posts: 4, comments: 26, gate_dms: 1, cta_clicks: 5, per_post_comments: 6.5, first_post: '2026-07-23T13:40:25.572+00:00', last_post: '2026-08-12T16:00:29.431+00:00' }),
      lm({ slug: 'thin', title: 'Return Rate Rescue', status: 'retired', posts: 1, comments: 3, cta_clicks: 15, first_post: '2026-08-09T20:02:08.392+00:00', last_post: '2026-08-09T20:02:08.392+00:00', per_post_comments: 3 }),
      lm({ slug: 'idle', title: 'Never Posted' }),
    ]
    const posts = [
      gp({ author: 'Quiet Giant', comments: 100, follower_count: 100000, per_1k: 1, offer: 'a report' }),
      gp({ author: 'Loud Small', comments: 90, follower_count: 9000, per_1k: 10, cta_kind: 'comment_gate', gate_keyword: 'VAULT', offer: 'a doc of 50+ DM scripts' }),
      gp({ author: 'No Size', comments: 200, offer: 'a newsletter' }),
    ]
    const html = renderToStaticMarkup(<LeadMagnetsView lm={ready(lms)} gated={gready(posts)} now={NOW} />)

    expect(html).toMatch(/data-reach-lm="ready"/)
    expect(html).toMatch(/data-lm-own="2"/)          // the never-posted row has no activity at all
    expect(html).toMatch(/data-lm-gated="3"/)
    expect(html).not.toMatch(/Never Posted/)

    // 1. own rows: the sub line, the rate with its denominator, the floor sentence
    expect(html).toMatch(/2 of 3 lead magnets show a post or a click since 17 Jun\./)
    expect(html).toMatch(/Comments per post 6\.5 · 1 gate DMs?, 5 CTA clicks over 4 posts/)
    expect(html).toMatch(/23 Jul to 12 Aug/)
    expect(html).toMatch(/1 post since 17 Jun, under the 2-post floor, so no rate yet · posted 9 Aug/)
    expect(html).toMatch(/4 posts, 26 comments, 1 gate DM, 5 CTA clicks, calls not attributable\./)
    expect(html).toMatch(/comment KIT/)
    expect(html).toMatch(/not attributable, it does not mean zero calls/)

    // 2. roster: sub line names the sized share, lines carry their own denominator, rank is per 1k
    expect(html).toMatch(/3 gated of the 58 loudest roster posts judged since 17 Jun\./)
    expect(html).toMatch(/2 of 3 carry a follower count/)
    expect(html).toMatch(/90 comments of 9,000 followers · 10 per 1k followers/)
    expect(html).toMatch(/200 comments, size unknown, so no rate/)
    expect(html).toMatch(/comment &quot;VAULT&quot; for a doc of 50\+ DM scripts/)
    expect(html.indexOf('Loud Small')).toBeLessThan(html.indexOf('Quiet Giant'))
    expect(html.indexOf('Quiet Giant')).toBeLessThan(html.indexOf('No Size'))
    expect(html).toMatch(/target="_blank" rel="noopener noreferrer"/)
    expect(html).toMatch(/Comments per 1,000 followers puts a small account/)
    expect(html).not.toMatch(NOISE)
  })

  it('states the em dash out of a catalog title rather than printing one', () => {
    const lms = [lm({ slug: 'score', title: 'The Agency Efficiency Score — How Much Profit Are You Leaving on the Table?', cta_clicks: 19, status: 'retired' })]
    const html = renderToStaticMarkup(<LeadMagnetsView lm={ready(lms)} gated={gready([])} now={NOW} />)
    expect(html).toMatch(/The Agency Efficiency Score, How Much Profit/)
    expect(html).toMatch(/no post in the window, 0 gate DMs, 19 CTA clicks, calls not attributable\./)
    expect(html).toMatch(/0 posts since 17 Jun, under the 2-post floor, so no rate yet/)
    expect(html).not.toMatch(NOISE)
  })

  it('renders the roster when the catalog is empty, and says so in words', () => {
    const html = renderToStaticMarkup(<LeadMagnetsView lm={ready([lm({})])} gated={gready([gp({ author: 'Only One', comments: 18, follower_count: 25332, per_1k: 0.711 })], 58)} now={NOW} />)
    expect(html).toMatch(/data-lm-own="0"/)
    expect(html).toMatch(/No post or click on the 1 lead magnet in this lane&#x27;s catalog since 17 Jun\./)
    expect(html).toMatch(/1 gated of the 58 loudest roster posts judged/)
    expect(html).toMatch(/18 comments of 25,332 followers · 0\.7 per 1k followers/)
    expect(html).not.toMatch(NOISE)
  })

  it('says no gated offer was found when the roster read is empty', () => {
    const html = renderToStaticMarkup(<LeadMagnetsView lm={ready([lm({ cta_clicks: 2 })])} gated={gready([], 58)} now={NOW} />)
    expect(html).toMatch(/No gated offer in the 58 loudest roster posts judged since 17 Jun\./)
    expect(html).not.toMatch(NOISE)
  })

  it('folds the roster past the top eight and names how many are hidden', () => {
    const posts = Array.from({ length: 11 }, (_, i) => gp({ author: `Author ${i}`, comments: 100 - i }))
    const html = renderToStaticMarkup(<LeadMagnetsView lm={ready([])} gated={gready(posts)} now={NOW} />)
    expect(html.match(/data-lm-gate=/g) ?? []).toHaveLength(8)
    expect(html).toMatch(/Show 3 more/)
    expect(html).not.toMatch(NOISE)
  })

  it('keeps the roster when the catalog read fails, and the catalog when the roster read fails', () => {
    const one = renderToStaticMarkup(<LeadMagnetsView lm={{ kind: 'failed', message: 'lm boom' }} gated={gready([gp({ author: 'Still Here', comments: 18 })])} now={NOW} onRetryLm={() => {}} onRetryGated={() => {}} />)
    expect(one).toMatch(/data-reach-lm="ready"/)
    expect(one).not.toMatch(/data-lm-own=/)        // an unread half never claims a count of zero
    expect(one).toMatch(/data-lm-gated="1"/)
    expect(one).toMatch(/The lead magnets read didn.t load/)
    expect(one).toMatch(/lm boom/)
    expect(one).toMatch(/Still Here/)

    const two = renderToStaticMarkup(<LeadMagnetsView lm={ready([lm({ slug: 'kit', title: 'The Kit', cta_clicks: 5 })])} gated={{ kind: 'failed', message: 'gated boom' }} now={NOW} onRetryLm={() => {}} onRetryGated={() => {}} />)
    expect(two).toMatch(/data-reach-lm="ready"/)
    expect(two).toMatch(/The gated posts read didn.t load/)
    expect(two).toMatch(/The Kit/)
    expect(two).not.toMatch(NOISE)
  })

  it('shows the denied copy and attribute when both RPCs report unauthorized', () => {
    const html = renderToStaticMarkup(<LeadMagnetsView lm={{ kind: 'denied', message: 'unauthorized: not your seat' }} gated={{ kind: 'denied', message: 'unauthorized: not your seat' }} now={NOW} onRetryLm={() => {}} />)
    expect(html).toMatch(/data-reach-lm="denied"/)
    expect(html).toMatch(/The lead magnets read didn.t load/)
    expect(html).toMatch(/unauthorized: not your seat/)
  })

  it('shows the loading state until both reads land', () => {
    const html = renderToStaticMarkup(<LeadMagnetsView lm={null} gated={gready([])} now={NOW} />)
    expect(html).toMatch(/data-reach-lm="loading"/)
    expect(html).toMatch(/Lead magnets/)
  })
})
