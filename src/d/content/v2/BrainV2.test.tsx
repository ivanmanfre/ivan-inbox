// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { ContentDraft } from '../../../lib/content'
import type { InputsOutlier } from '../../../lib/cb22'
import type { OutlierRow } from '../../../lib/outliers'
import type { PostAudienceRow } from '../../../lib/reach'

// Content Brain, rebuilt 2026-10-15 on Ivan's read of it ("Direction i cant even read it", "up next idk what
// is that", the ideas were famous X accounts, the seat tabs repeated the count). Every read is mocked.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const H = 3_600_000
const DAY = 24 * H
const iso = (ms: number) => new Date(NOW + ms).toISOString()

const lib = vi.hoisted(() => ({ top: [] as unknown[], pool: [] as unknown[], posts: [] as unknown[] }))
vi.mock('../../../lib/editorialDirection', () => ({
  readEditorialDirection: vi.fn((_client, lane) => Promise.resolve({ status: 'active', updated_at: '2026-09-28T11:00:00Z', direction: { weekly_policy: {
    status: lane === 'swishdm' ? 'planning_draft' : 'adopted', weekly_total: lane === 'swishdm' ? 5 : 4, objective: 'Grow relevant reach', allocation: { unit: 'count', values: { buyer: 1, reach: 2, consideration: 1 } } } } })),
}))
vi.mock('../../../lib/reach', async orig => ({ ...(await orig<typeof import('../../../lib/reach')>()),
  fetchPostAudience: vi.fn(() => Promise.resolve({ kind: 'ready', rows: lib.posts, followers: null, readAt: iso(0) })) }))
vi.mock('../../../lib/cb22', async orig => ({ ...(await orig<typeof import('../../../lib/cb22')>()),
  fetchInputs: vi.fn(() => Promise.resolve({ kind: 'ready', data: { client: 'ivan', week_start: '2026-10-12', top: lib.top, buyers: [], counts: { window: 9, recommended: 1, in_review: 0, judged: 1, outliers: 9, buyers: 0 }, last_run: null, rule: '' } })) }))
vi.mock('../../../lib/outliers', async orig => ({ ...(await orig<typeof import('../../../lib/outliers')>()),
  fetchOutliers: vi.fn(() => Promise.resolve({ kind: 'ready', data: { client: 'ivan', studies: { linkedin: null, x: null }, weeks: [], rows: lib.pool } })) }))
vi.mock('../../../lib/brainPage', async orig => ({ ...(await orig<typeof import('../../../lib/brainPage')>()),
  fetchDecisionHistory: vi.fn(() => Promise.resolve({ rulings: [], links: new Map() })), fetchDraftSources: vi.fn(() => Promise.resolve(new Map())) }))

import { BrainV2, brainHeadline } from './BrainV2'
import { bestPosts, capX, directionWords, nicheList, platformRanked, shortReason } from '../ContentBrain'
import { buildNow, reviewCounts } from '../weekModel'
import type { IdeaBanks } from '../Ideas'
import type { Lane } from '../model'
import type { PlanItem } from '../planModel'
import type { WeekRead } from '../useWeek'

const LONG = 'A long enough first line about client acquisition for agencies.\nSecond line here with more words in it.'
const out = (o: Partial<OutlierRow> & { post_id: string; platform: 'linkedin' | 'x'; lift: number }): OutlierRow => ({
  author: `author-${o.post_id}`, text: LONG, url: `https://example.test/${o.post_id}`, published_at: iso(-2 * DAY), week: '2026-10-12',
  baseline: 10, baseline_n: 20, likes: 100, reposts: 0, comments: 5, views: null, labels: null, personal: false, traits: [], traits_note: null, buyer: null, idea: null, ...o,
})
const pick = (o: Partial<InputsOutlier> & { post_id: string }): InputsOutlier => ({
  rank: 1, platform: 'linkedin', author: 'Noam', author_url: null, url: 'https://example.test/p', text: 'Sales and marketing should be one conversation.\nMore.',
  published_at: iso(-3 * DAY), lift: 6.2, likes: 80, comments: 4, views: null, is_5x: true, fit: 7, purpose: 'consideration', lane: 'service',
  reason: 'Fits agency founders who sell with content; reframe so the engine does the work.', state: 'recommended', idea: null, ...o,
})

afterEach(() => { cleanup(); localStorage.clear() })

describe('platform balance', () => {
  // 19 of the top 20 by raw lift were X, 18 of them famous X accounts (audit 2026-10-15).
  const xs = [335, 193, 97, 66, 48].map((l, i) => out({ post_id: `x${i}`, platform: 'x', lift: l }))
  const lis = [14, 8, 5].map((l, i) => out({ post_id: `l${i}`, platform: 'linkedin', lift: l }))
  it('ranks lift within each platform, so each platform’s best leads its share', () => {
    const r = platformRanked([...xs, ...lis])
    expect(r.slice(0, 2).map(x => x.post_id).sort()).toEqual(['l0', 'x0'])
    expect(r[0].post_id).toBe('l0')
  })
  it('never lets X take more than half of any prefix while a LinkedIn post is left', () => {
    const list = capX([], platformRanked([...xs, ...lis]), 12)
    for (let k = 1; k <= 6; k++) expect(list.slice(0, k).filter(x => x.platform === 'x').length).toBeLessThanOrEqual(Math.ceil(k / 2))
    expect(list.slice(0, 4).filter(x => x.platform === 'x')).toHaveLength(2)
    // once LinkedIn runs out X still fills the list
    expect(list).toHaveLength(8)
  })
  it('puts the fit-checked picks first, then the fill: one post per author, no saved idea, nothing older than 21 days', () => {
    const pool = [
      out({ post_id: 'p1', platform: 'linkedin', lift: 9 }),   // same post as the pick: shown once
      out({ post_id: 'old', platform: 'linkedin', lift: 40, published_at: iso(-30 * DAY) }),
      out({ post_id: 'idea', platform: 'linkedin', lift: 30, idea: { id: 'i' } }),
      out({ post_id: 'thin', platform: 'x', lift: 99, text: 'gm @someone https://t.co/x' }),
      out({ post_id: 'a1', platform: 'x', lift: 50, author: 'Famous' }),
      out({ post_id: 'a2', platform: 'x', lift: 40, author: 'Famous' }),
      out({ post_id: 'l9', platform: 'linkedin', lift: 4 }),
    ]
    const list = nicheList([pick({ post_id: 'p1' })], pool, NOW)
    expect(list.map(r => r.post_id)).toEqual(['p1', 'l9', 'a1'])
    expect(list[0]).toMatchObject({ picked: true, purpose: 'consideration', why: 'Fits agency founders who sell with content' })
    expect(list[1]).toMatchObject({ picked: false, why: null })
  })
  it('cuts a fit reason to one plain line', () => {
    expect(shortReason('Passes the gate for agency founders; reframe so the engine — not the founder — does it.')).toBe('Passes the gate for agency founders')
    expect(shortReason(null)).toBeNull()
  })
})

describe('direction words', () => {
  it('reads the weekly count first, with the app’s aim words', () => {
    const w = directionWords({ weekly_total: 4, objective: 'Increase relevant reach', allocation: { values: { buyer: 1, reach: 2, consideration: 1 } }, status: 'adopted' })
    expect(w).toEqual({ main: '4 posts a week: 2 for reach, 1 for trust, 1 for buyers', aim: 'Increase relevant reach.', weekly: 4 })
  })
  it('says a planning draft is not adopted yet', () => {
    expect(directionWords({ weekly_total: 5, objective: 'Reach buyers', allocation: { values: { reach: 5 } }, status: 'planning_draft' }).aim).toBe('Draft, not adopted yet. Reach buyers.')
    expect(directionWords(null).main).toBe('No weekly count set.')
  })
})

describe('best posts', () => {
  it('ranks by impressions, the tile’s measure, over the last 12 weeks', () => {
    const p = (id: string, days: number, impressions: number | null, comments = 0) => ({ activity_id: id, post_url: null, published_at: iso(-days * DAY), title: id, impressions, comments, in_pct: null, out_pct: null, members_reached: null }) as PostAudienceRow
    const rows = [p('talked', 5, 300, 40), p('seen', 10, 18000, 2), p('old', 120, 90000), p('mid', 20, 5000), p('none', 3, null, 9)]
    expect(bestPosts(rows, NOW).map(r => r.activity_id)).toEqual(['seen', 'mid', 'talked'])
  })
})

describe('the Content Brain page', () => {
  const row = (o: Partial<ContentDraft>): ContentDraft => ({
    id: 'x', client_id: null, status: 'review', type: 'text', title: 'A post', topic: null, post_body: 'Body.',
    scheduled_at: null, published_at: null, source_post_id: null, image_urls: null, taxonomy: null,
    created_at: iso(-H), updated_at: iso(-H), board_visible: null, ...o,
  } as ContentDraft)
  const ROWS = [
    row({ id: 'd1', title: 'First draft', created_at: iso(-1 * H), cb34_p2_member: true }),
    row({ id: 'd2', title: 'Second draft', created_at: iso(-2 * H), source_ref: 'outlier:x:1' }),
    row({ id: 'd5', title: 'Third draft', created_at: iso(-5 * H) }),
    // approved and waiting for a date: Review does not count it as to decide, so neither does the Brain
    row({ id: 'ok', title: 'Approved, no date', status: 'approved', created_at: iso(-6 * H) }),
  ]
  const read = { rows: ROWS, source: 'live', at: iso(0), loading: false, error: null, capped: null, settled: true, refresh: vi.fn() } as unknown as WeekRead
  const empty = () => new Map<string, PlanItem[]>()
  const items = { ivan: empty(), risedtc: empty(), arch: empty(), swishdm: empty() } as Record<Lane, Map<string, PlanItem[]>>
  const ideas = { ivan: { n: 95 }, risedtc: { n: 50 }, arch: { n: 26 }, swishdm: { n: 6 } } as unknown as IdeaBanks

  it('shows every number once: the drafts to decide sit in their tile only, and match Review', async () => {
    lib.top = [pick({ post_id: 'p1', published_at: iso(-2 * DAY) })]
    lib.pool = [out({ post_id: 'l1', platform: 'linkedin', lift: 14.6, published_at: iso(-2 * DAY) }), out({ post_id: 'x1', platform: 'x', lift: 193.7, published_at: iso(-2 * DAY) })]
    lib.posts = [{ activity_id: 'a', post_url: 'https://example.test/a', published_at: iso(-2 * DAY), title: '"Just send more invites" is the advice', impressions: 212, comments: 1, in_pct: null, out_pct: null, members_reached: null }]
    const total = buildNow(ROWS, { now: NOW })
    expect(reviewCounts(total).ivan).toBe(3)
    expect(total.perLane.ivan).toBe(4)
    const { container } = renderInFrame(<BrainV2 lane="ivan" setLane={vi.fn()} read={read} verdicts={new Map()} judged={new Map()} total={total} items={items} ideas={ideas} now={NOW} reading={false} />)
    await waitFor(() => expect(screen.getByText('4 posts a week: 2 for reach, 1 for trust, 1 for buyers')).toBeTruthy())
    await waitFor(() => expect(container.querySelectorAll('[data-niche-row]').length).toBe(3))
    // seat tabs: names only
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Ivan', 'Rise', 'Arch', 'SwishDM'])
    const drafts = container.querySelector('[data-verb="brain-tile-drafts"]') as HTMLElement
    expect(drafts.textContent).toContain('3')
    // every text node, spaced: the count is on the page once (it was on the tab, the headline, the tile and "Review all N")
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const words: string[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) words.push(n.textContent ?? '')
    expect(words.join(' ').match(/\b3\b/g)).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Open Review →' }).getAttribute('href')).toBe('#exp/d/content/now?lane=ivan')
    // the dated tile reads the direction's weekly count x 2, never a fixed 3
    expect(container.querySelector('[data-verb="brain-tile-dated"]')?.textContent).toContain('of 8 for two weeks')
    // drafts waiting for you: Review's first three, the source tag first
    const waiting = within(screen.getByRole('region', { name: 'Drafts waiting for you' })).getAllByRole('link').filter(a => a.getAttribute('data-verb') === 'brain-draft-waiting')
    expect(waiting.map(a => a.querySelector('b')?.textContent)).toEqual(['First draft', 'Second draft', 'Third draft'])
    expect(waiting[0].firstElementChild?.getAttribute('data-source')).toBe('brain')
    // the niche list is in place, with its fold; nothing jumps to the Outliers page
    expect(screen.getByText('For trust')).toBeTruthy()
    expect(screen.getByText('Fits agency founders who sell with content')).toBeTruthy()
    expect(screen.getAllByText('Fit not confirmed')).toHaveLength(2)
    expect(container.querySelector('[data-niche-fold] summary')?.textContent).toBe('Every niche post (2)')
    expect([...container.querySelectorAll('a')].some(a => (a.getAttribute('href') ?? '').includes('content/inputs'))).toBe(false)
  })

  it('says plainly when SwishDM has no niche posts tracked', async () => {
    const { container } = renderInFrame(<BrainV2 lane="swishdm" setLane={vi.fn()} read={read} verdicts={new Map()} judged={new Map()} total={buildNow([], { now: NOW })} items={items} ideas={ideas} now={NOW} reading={false} />)
    expect(screen.getByText('No niche posts tracked for SwishDM yet.')).toBeTruthy()
    expect(await screen.findByText(/Weekly cadence awaits confirmation/)).toBeTruthy()
    const dated = container.querySelector('[data-verb="brain-tile-dated"]')
    expect(dated?.textContent).toContain('no weekly target confirmed')
    expect(dated?.textContent).not.toContain('of 10 for two weeks')
    expect(document.body.textContent).not.toContain('Next week still needs 5 more posts')
  })
})

describe('the headline', () => {
  it('never carries the drafts count', () => {
    const s = brainHeadline({ live: true, reading: false, short: 2, decide: 23, lane: 'ivan' })
    expect(s).toBe('Next week still needs 2 more posts set to go out. Start with the drafts waiting for you.')
    expect(s).not.toContain('23')
    expect(brainHeadline({ live: true, reading: false, short: 0, decide: 0, lane: 'arch' })).toBe('Next week is set. Nothing waits for a decision on Arch.')
  })
})
