import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VerdictStrip } from './parts'
import type { GatedPost, GatedRead, LeadMagnetsRead, LmRow } from '../../lib/leadMagnets'

// THE ANSWER ON TOP, pinned as markup rather than as the pure line-builder
// (already covered in `lib/leadMagnetsLib.test.ts`): this file exists so a
// change to either surface's wiring cannot silently drop the strip, its
// `data-lm-verdict` hook, or its line count without a test noticing.

const SINCE = '2026-06-17T18:20:02.677561+00:00'
const NOISE = /NaN|undefined|—|–/

const lm = (o: Partial<LmRow>): LmRow => ({
  slug: 'kit', title: 'The Kit', status: 'published', keyword: null,
  posts: 4, comments: 26, gate_dms: 1, cta_clicks: 5, calls: null,
  first_post: null, last_post: null, per_post_comments: 6.5, ...o,
})
const gp = (o: Partial<GatedPost>): GatedPost => ({
  post_ref: 'https://www.linkedin.com/posts/x', author: 'Alex Vacca',
  author_url: 'https://www.linkedin.com/in/alex', posted_at: '2026-08-12T13:33:01.132+00:00',
  likes: 10, comments: 974, reposts: 1, follower_count: 73256, followers_source: 'seat read',
  per_1k: 13.3, cta_kind: 'comment_gate', gate_keyword: 'GTM', offer: 'a template', confidence: 0.9, ...o,
})
const gready = (o: Partial<Extract<GatedRead, { kind: 'ready' }>> = {}): GatedRead =>
  ({ kind: 'ready', since: SINCE, judged: 58, gated: 35, posts: [], readAt: SINCE, ...o })
const lready = (o: Partial<Extract<LeadMagnetsRead, { kind: 'ready' }>> = {}): LeadMagnetsRead =>
  ({ kind: 'ready', since: SINCE, lms: [], readAt: SINCE, ...o })

const linesOf = (html: string) => [...html.matchAll(/<p class="a-lm-verdict-l">(.*?)<\/p>/g)].map(m => m[1])

describe('VerdictStrip', () => {
  it('renders three lines when both picks are present and unjudged is over zero', () => {
    const html = renderToStaticMarkup(
      <VerdictStrip
        gated={gready({ unjudged: 1212, judged: 174, best: gp({}) })}
        lm={lready({ best_own: lm({}) })}
      />,
    )
    expect(html).toMatch(/data-lm-verdict="true"/)
    expect(linesOf(html)).toHaveLength(3)
    expect(html).toMatch(/Best gate on the roster: Alex Vacca, comment &quot;GTM&quot;, 974 comments, 13\.3 per 1k followers\./)
    expect(html).toMatch(/Your best lead magnet: The Kit, published, 5 CTA clicks, 1 gate DM, 4 posts\./)
    expect(html).toMatch(/174 of 1,386 roster posts judged, so treat the gate share as an upper bound\./)
    expect(html).not.toMatch(NOISE)
  })

  // db/083's own live shape: a `link` gate carries no keyword and often no follower row
  // (risedtc's whole lane today), and the lane's best performer by clicks is routinely retired.
  it('matches the RPC\'s real shape: a null-keyword link gate with no follower row, a retired best_own', () => {
    const html = renderToStaticMarkup(
      <VerdictStrip
        gated={gready({ unjudged: 597, judged: 58, best: gp({ author: 'Luis Camacho', comments: 107, follower_count: null, per_1k: null, cta_kind: 'link', gate_keyword: null }) })}
        lm={lready({ best_own: lm({ title: 'Workflow Audit Checklist for Service Businesses', status: 'retired', cta_clicks: 29, gate_dms: 0, posts: 0 }) })}
      />,
    )
    expect(html).toMatch(/Best gate on the roster: Luis Camacho, a link, 107 comments, size unknown\./)
    expect(html).toMatch(/Your best lead magnet: Workflow Audit Checklist for Service Businesses, retired, 29 CTA clicks, 0 gate DMs, 0 posts\./)
    expect(html).not.toMatch(NOISE)
  })

  it('renders two lines when the coverage line drops out at unjudged 0', () => {
    const html = renderToStaticMarkup(
      <VerdictStrip
        gated={gready({ unjudged: 0, best: gp({}) })}
        lm={lready({ best_own: lm({}) })}
      />,
    )
    expect(linesOf(html)).toHaveLength(2)
    expect(html).not.toMatch(/treat the gate share as an upper bound/)
    expect(html).not.toMatch(NOISE)
  })

  it('renders one line when only one read carries a pick', () => {
    const html = renderToStaticMarkup(
      <VerdictStrip gated={gready({ unjudged: 0, best: null })} lm={lready({ best_own: lm({}) })} />,
    )
    expect(linesOf(html)).toHaveLength(1)
    expect(html).toMatch(/Your best lead magnet/)
    expect(html).not.toMatch(NOISE)
  })

  it('renders nothing, not even the wrapper, when there is no line to show', () => {
    const html = renderToStaticMarkup(<VerdictStrip gated={gready({ best: null })} lm={lready({ best_own: null })} />)
    expect(html).toBe('')
  })

  it('renders nothing on an old-RPC payload that carries none of the three keys', () => {
    const html = renderToStaticMarkup(<VerdictStrip gated={gready()} lm={lready()} />)
    expect(html).toBe('')
  })

  it('renders nothing while loading or fully failed, and never throws', () => {
    expect(renderToStaticMarkup(<VerdictStrip gated={null} lm={null} />)).toBe('')
    expect(renderToStaticMarkup(<VerdictStrip gated={{ kind: 'failed', message: 'x' }} lm={{ kind: 'denied', message: 'y' }} />)).toBe('')
  })
})
