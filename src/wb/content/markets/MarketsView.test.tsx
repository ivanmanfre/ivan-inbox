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

  it('opens on one number with its sentence, then the ask ledger and the coverage line', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('88')
    expect(t).toContain('comments on the loudest offer from the accounts we follow for you')
    expect(t).toContain('Alex Vacca offered')
    expect(t).toContain('How the accounts we follow ask')
    expect(t).toContain('asked for a link in the post')
    expect(t).toContain('We read 314 of the 655 posts')
  })

  it('each section carries its own count in the heading', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('The loudest offers, one at a time 9 ranked of 16')
    expect(t).toContain('Ideas that came back 1 named')
    expect(t).toContain('Your own posts against that 54 posts')
    expect(t).toContain('What we would run first 1 test')
  })

  it('an offer block names who published it, the audience, the comments and what we would copy', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).toContain('Alex Vacca published it and asked for a word in the comments, by writing')
    expect(t).toContain('12,000 people followed the account when we read it')
    expect(t).toContain('What we would copy')
    expect(t).toContain('3.3 comments for every thousand followers, 1.5 times the median of 2.2')
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
    expect(t).toContain('What we would run first 0 tests')
    expect(t).toContain('We pick the first test once 5 offers')
    expect(t).not.toContain('Test 1')
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
    expect(t).toContain('What we would run first 0 tests')
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
    expect(t).toContain('What the posts say 0 readings')
    expect(t).toContain('No readings stored for this market yet.')
  })

  it('a stored reading renders its number, its base, its examples and the change', () => {
    const m = readout({
      insights: {
        run_id: 'r9',
        rows: [{
          section: 'hook_shape',
          reading: {
            headline: 'Posts opening on a number draw 2.1 times the comments',
            number: '2.1x', base: '142 posts',
            examples: [{ url: 'https://x/9', first_line: 'We spent 40,000 dollars to learn this', comments: 88 }],
            change: 'We open the next four posts on a number.',
          },
        }],
      },
    })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('What the posts say 1 reading')
    expect(t).toContain('Posts opening on a number draw 2.1 times the comments')
    expect(t).toContain('2.1x on a base of 142 posts')
    expect(t).toContain('We spent 40,000 dollars to learn this')
    expect(t).toContain('We open the next four posts on a number.')
  })

  it('a reading carrying only a section still renders, with no invented number', () => {
    const m = readout({ insights: { run_id: 'r9', rows: [{ section: 'post_length', reading: {} }] } })
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(m)} />))
    expect(t).toContain('Post length')
    expect(t).toContain('What the posts say 1 reading')
  })

  it('carries no em dash and no internal lane id on the rendered screen', () => {
    const t = text(renderToStaticMarkup(<MarketsPanel read={ready(readout())} />))
    expect(t).not.toMatch(/—/)
    expect(t).not.toMatch(/\brisedtc\b/)
    expect(t).not.toMatch(/your turn|needs you/i)
  })
})
