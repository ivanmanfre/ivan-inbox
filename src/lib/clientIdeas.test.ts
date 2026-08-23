import { describe, it, expect } from 'vitest'
import { ideaWhy, quoteLabel, sourceHues, type ClientIdea } from './clientIdeas'

const base: ClientIdea = {
  id: 'i1', title: 'Sell The Pain Point, Not The Product',
  hook: 'Nobody wants to switch condom brands, but plenty of guys want to last longer in bed.',
  source_label: 'From your sales calls', source_ref: 'fc-0d7c3903',
  pillar: 'authority', format: 'post', status: 'staged',
  created_at: '2026-08-23T14:05:40Z', icp_score: 82,
  funnel_stage: 'trust', funnel_source: 'declared',
  score_breakdown: { why: 'we tried that and it did nothing', voice: 'buyer' },
}
const idea = (o: Partial<ClientIdea>): ClientIdea => ({ ...base, ...o })

describe('quoteLabel — a quote is only ever called a quote when it is one', () => {
  // `score_breakdown.why` holds the ingestor's `evidence_quote` on a CALL row
  // (n8n ED3KvNsjKwANZsuf), and the extractor canon defines that field as
  // "copied VERBATIM, character-for-character, from a SINGLE transcript line".
  // The X trend ingestor writes a real rationale under the same key. One field,
  // two meanings, and the source is the only thing that separates them.
  it('attributes a call row by the ingestor’s own voice tag', () => {
    expect(quoteLabel(idea({ score_breakdown: { voice: 'buyer' } }))).toBe('the founder, on the call')
    expect(quoteLabel(idea({ score_breakdown: { voice: 'seller' } }))).toBe('Mattan, on the call')
    expect(quoteLabel(idea({ score_breakdown: { voice: 'neutral' } }))).toBe('on the call')
  })

  it('prints the doubt when the transcript could not be attributed', () => {
    // `unclear` is what the diarization guard forces when the speaker labels
    // collapsed. Smoothing it into a name would fabricate an attribution on
    // exactly the rows where attribution failed.
    expect(quoteLabel(idea({ score_breakdown: { voice: 'unclear' } })))
      .toBe('on the call — speaker not attributable')
    expect(quoteLabel(idea({ score_breakdown: {} }))).toBe('on the call')
  })

  it('refuses to call a non-call row’s rationale a quote', () => {
    for (const src of ['From competitor feeds', 'From r/shopify founder threads', 'Hand-picked', null]) {
      expect(quoteLabel(idea({ source_label: src }))).toBeNull()
    }
    // Both live call labels — Mattan's and Davorin's lanes spell it differently.
    expect(quoteLabel(idea({ source_label: 'From your sales calls' }))).not.toBeNull()
    expect(quoteLabel(idea({ source_label: 'From your calls' }))).not.toBeNull()
  })
})

describe('ideaWhy', () => {
  it('reads whichever key this row’s writer used, and never stringifies an object', () => {
    expect(ideaWhy({ why: 'a line' })).toBe('a line')
    expect(ideaWhy({ rationale: 'a reason' })).toBe('a reason')
    expect(ideaWhy({ why: '   ' })).toBeNull()
    expect(ideaWhy({ why: { nested: true } })).toBeNull()
    expect(ideaWhy(null)).toBeNull()
  })
})

describe('sourceHues — the ask was DISTINCT, not just deterministic', () => {
  // The nine sources live on Mattan's staged bank, 2026-08-23.
  const live = [
    'From your sales calls', 'From competitor feeds', 'From r/shopify founder threads',
    'Hand-picked', 'Winner repurpose', 'From r/PPC founder threads',
    'From r/ecommerce founder threads', 'From r/FacebookAds founder threads',
    'From X ecom threads',
  ]

  it('spaces every source on screen as far apart as n colours can be', () => {
    // This is the test that killed the first implementation: FNV-1a mod 360 is
    // stable and uniform, and on this exact list two sources landed 3 apart.
    const hues = [...sourceHues(live).values()].sort((a, b) => a - b)
    expect(hues.length).toBe(live.length)
    const gaps = hues.slice(1).map((h, i) => h - hues[i])
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(Math.floor(360 / live.length) - 1)
  })

  it('is stable for a set, and ignores the order the rows arrived in', () => {
    const a = sourceHues(live)
    const b = sourceHues([...live].reverse())
    for (const l of live) expect(a.get(l)).toBe(b.get(l))
  })

  it('drops nulls and dedups rather than dealing a slot to nothing', () => {
    const m = sourceHues(['A', null, 'A', 'B', null])
    expect([...m.keys()].sort()).toEqual(['A', 'B'])
    expect(m.get('A')).not.toBe(m.get('B'))
  })

  it('always deals a legal hue, including for one source and for none', () => {
    expect([...sourceHues([]).keys()]).toEqual([])
    for (const h of sourceHues(live).values()) {
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
      expect(Number.isInteger(h)).toBe(true)
    }
    expect(sourceHues(['only one']).get('only one')).toBeLessThan(360)
  })
})
