import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarketsPanel } from './MarketsView'
import type { MarketOffer, MarketRead, MarketReadout } from '../../../lib/markets'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, ' ').replace(/\s+/g, ' ').trim()

function offer(over: Partial<MarketOffer> = {}): MarketOffer {
  return {
    post_ref: 'https://www.linkedin.com/posts/a_one-activity-1', author: 'Alex Vacca',
    author_url: 'https://www.linkedin.com/in/alex', posted_at: '2026-09-01T10:00:00Z',
    likes: 100, comments: 40, reposts: 2, follower_count: 12000, followers_source: 'unipile_seat',
    per_1k: 3.3, cta_kind: 'comment_gate', gate_keyword: 'GTM', offer: 'a go to market checklist',
    confidence: 0.9, vs_median: 1.5, why_followers: null, why_comments: null, ...over,
  }
}

function readout(over: Partial<MarketReadout> = {}): MarketReadout {
  const ranked = [offer(), offer({ post_ref: 'p2', author: 'Dara Denney', per_1k: 2.2, comments: 30, vs_median: 1 })]
  return {
    since: '2026-06-19T00:00:00Z', window_days: 91, client_id: 'risedtc', display_name: 'Mattan Danino',
    floor: { comments: 10, followers: 1000 }, min_test_base: 5,
    populations: {
      roster_size: 20, roster_authors: 19, roster_posts: 328, roster_median_comments: 7,
      roster_max_post_comments: 210, wider_posts: 327, wider_authors: 33,
    },
    offers: {
      roster_offers: 16, wider_offers: 23, ranked_count: 9, below_count: 1,
      roster_max_comments: 88, roster_offer_median: 12,
      cta: { link: 14, comment_gate: 2, dm_gate: 0 }, with_keyword: 3,
      rank: { median_per1k: 2.2, max_per1k: 3.3, min_per1k: 0.3 },
      ranked,
      below: [offer({ post_ref: 'p3', author: 'Small Account', per_1k: null, comments: 4, follower_count: null, vs_median: null, why_followers: 'missing', why_comments: true })],
      wider: [offer({ post_ref: 'p4', author: 'Someone Unvetted', per_1k: null, follower_count: null, vs_median: null })],
      top_by_comments: ranked[0], top_leads_ranking: true, roster_judged: 182,
    },
    themes: {
      run_id: 'r1', total: 1,
      rows: [{ theme: 'AI quietly automating creative work', posts: 5, authors: 4, med: 29, ex_author: 'A', ex_url: 'https://x/t', ex_text: 'The agency model is breaking\nsecond line' }],
    },
    own: {
      posts: 54, median_comments: 2.5, best_comments: 22,
      best: { url: 'https://x/1', title: 'A post of mine', comments: 22, at: '2026-09-02T00:00:00Z' },
      unmeasured: 2, measured: 52, median_measured: 2.5, best_measured: 22,
      attributed: 3, unattributed: 51, lm_catalog: 18, lm_used: 3,
    },
    tests: [{ kind: 'shape', base: 9, n: { top: offer(), median_per1k: 2.2, ranked: 9 } }],
    coverage: { judged: 314, unjudged: 341, total: 655 },
    insights: { run_id: null, rows: [] },
    ...over,
  }
}

const ready = (m: MarketReadout): MarketRead => ({ kind: 'ready', data: m, readAt: '2026-09-18T12:00:00Z' })

describe('the Markets screen', () => {
  it('says it is reading before anything has arrived', () => {
    const html = renderToStaticMarkup(<MarketsPanel read={null} />)
    expect(html).toContain('data-mk-state="loading"')
    expect(text(html)).toContain('Reading this market')
  })

  it('a denied read states the reason and offers the read again', () => {
    const html = renderToStaticMarkup(<MarketsPanel read={{ kind: 'denied', message: 'unknown seat' }} onRetry={() => {}} />)
    expect(html).toContain('data-mk-state="denied"')
    expect(text(html)).toContain('unknown seat')
    expect(text(html)).toContain('Read it again')
  })

  it('opens on one number and one sentence, and nothing else', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('88')
    expect(t).toContain('comments on the loudest offer from the accounts we follow for you')
    expect(t).toContain('Alex Vacca')
    // Everything that explained itself on the first build moved into The working.
    expect(t).toContain('The working')
    expect(t).toContain('How the accounts we follow ask')
    expect(t).toContain('We read 314 of the 655 posts')
    const firstScreen = t.slice(0, t.indexOf('The working'))
    expect(firstScreen).not.toContain('How the accounts we follow ask')
    expect(firstScreen).not.toContain('We read 314 of the 655 posts')
    expect(firstScreen).not.toContain('We also stored 327 posts')
    expect(firstScreen).not.toContain('We rank by comments')
  })

  it('shows three cards, from the market readings only', () => {
    const m = readout({
      insights: {
        run_id: 'r1',
        rows: [
          { section: 'reading-8', reading: { headline: 'Your own posts: you post less', base: '72 posts' } },
          { section: 'reading-10', reading: { headline: 'Outreach: the engager lane replies more', base: '900 prospects' } },
          { section: 'cross-client-1', reading: { headline: 'Every market rewards length', base: '1,700 posts' } },
          { section: 'reading-1', reading: { headline: 'Comments by format: text leads, video trails', number: '33 median on 215 text posts against 12 on 67 video posts', base: '678 posts, 91 days', change: 'so we change: we write text first' } },
          { section: 'reading-3', reading: { headline: 'Comments by length: the long band doubles the rest', number: '59.5 against 26.0 in the band below', base: '655 posts' } },
          { section: 'reading-6', reading: { headline: 'Day and hour: mornings carry the top quartile', number: '42.7 percent against 7.7', base: '600 posts' } },
        ] as never,
      },
    })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('What pulls comments here')
    expect(t).toContain('Text leads, video trails')
    expect(t).toContain('The long band doubles the rest')
    expect(t).toContain('Mornings carry the top quartile')
    expect(t).toContain('33 median on 215 text posts against 12 on 67 video posts')
    expect(t).toContain('we do: We write text first')
    // A reading about us is not a reading about the market.
    expect(t).not.toContain('you post less')
    expect(t).not.toContain('engager lane')
    expect(t).not.toContain('Every market rewards length')
  })

  it('shows three offers as lines, with the rest behind one disclosure', () => {
    const base = readout()
    const ranked = [
      base.offers.ranked[0],
      { ...base.offers.ranked[1], post_ref: 'p2' },
      { ...base.offers.ranked[0], post_ref: 'p3', author: 'Third Author' },
      { ...base.offers.ranked[0], post_ref: 'p4', author: 'Fourth Author' },
    ]
    const m = readout({ offers: { ...base.offers, ranked, ranked_count: 4 } })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('Alex Vacca \u00B7')
    expect(t).toContain('Third Author')
    // 1 ranked past the top three plus 1 below the floor.
    expect(t).toContain('2 more')
  })

  it('shows one test, never three', () => {
    const base = readout()
    const m = readout({
      tests: [
        { kind: 'shape', base: 9, n: { top: base.offers.ranked[0], median_per1k: 2.2 } },
        { kind: 'ask', base: 16, n: { roster_offers: 16, link: 14, comment_gate: 2, dm_gate: 0 } },
      ],
    })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('First test')
    expect(t).toContain('Run one offer in the shape of the loudest one')
    const firstScreen = t.slice(0, t.indexOf('The working'))
    expect(firstScreen).not.toContain('Ask the way this market already asks')
    expect(t).toContain('The other tests')
  })

  it('each section carries its own count in the heading', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('Loudest offers 9 ranked of 16')
    expect(t).toContain('Ideas that came back 1 named')
    expect(t).toContain('Your own posts against that 54 posts')
  })

  it('an offer line carries the author, the offer, the rate and the comments, and no prose', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('Alex Vacca \u00B7 \u201Ca go to market checklist\u201D \u00B7 3.3 per 1,000 \u00B7 40 comments')
    const firstScreen = t.slice(0, t.indexOf('The working'))
    expect(firstScreen).not.toContain('published it and asked for')
  })

  it('the wider feed is named as unvetted and stays closed', () => {
    const html = renderToStaticMarkup(<MarketsPanel read={ready(readout())} />)
    const t = text(html)
    expect(t).toContain('Also loud around your topics, from accounts we have not vetted')
    expect(t).toContain('stay out of the ranking, the medians and the plan')
    // Closed by default: the unvetted author is behind the control, not on the screen.
    expect(t).not.toContain('Someone Unvetted')
  })

  it('ARCH today: one rankable offer of four writes a sentence instead of a test', () => {
    const base = readout()
    const m = readout({
      client_id: 'arch', display_name: 'Davorin Smit',
      offers: { ...base.offers, roster_offers: 4, ranked_count: 1, below_count: 3, ranked: [offer()] },
      tests: [],
    })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('First test')
    expect(t).toContain('We pick the first test once 5 offers')
  })

  it("Ivan today: 18 unmeasured of 72 keeps the median and names the 18 on the screen", () => {
    const base = readout()
    const m = readout({
      client_id: 'ivan', display_name: 'Ivan',
      own: { ...base.own, posts: 72, unmeasured: 18, measured: 54, median_comments: 0, median_measured: 0, best_comments: 26, best_measured: 26 },
    })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('we have measured 54 of them, at a median of 0 comments')
    expect(t).toContain('18 carry no reading we can trust')
    expect(t).toContain('Median comments on your posts')
    expect(t).toContain('Across the 54 posts we measured of the 72 you published')
    expect(t).not.toContain('withhold the comparison')
  })

  it('a lane over half unmeasured withholds the comparison and prints no median row', () => {
    const base = readout()
    const m = readout({
      own: { ...base.own, posts: 40, unmeasured: 24, measured: 16, median_comments: 0, median_measured: 1, best_measured: 9 },
      tests: [{ kind: 'own_median', base: 16, n: { own_posts: 40, measured: 16, unmeasured: 24, own_median: 1, roster_median: 7, roster_posts: 328 } }],
    })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('24 carry no reading we can trust')
    expect(t).toContain('withhold the comparison against the market median')
    expect(t).toContain('Across the 16 we did measure')
    expect(t).not.toContain('Median comments on your posts')
    // And the plan may not argue from the median this screen just refused to print.
    expect(t).not.toContain('Close the gap on the median')
  })

  it('a measured lane draws its median against the market', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('Median comments on your posts')
    expect(t).toContain('Median comments across the accounts we follow for you')
    expect(t).not.toContain('withhold the comparison')
  })

  it('an empty insights key is an empty state, never an empty market', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('What pulls comments here')
    expect(t).toContain('No readings stored for this market yet.')
  })

  it('carries no em dash and no internal lane id on the rendered screen', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).not.toMatch(/—/)
    expect(t).not.toMatch(/\brisedtc\b/)
    expect(t).not.toMatch(/your turn|needs you/i)
  })
})
