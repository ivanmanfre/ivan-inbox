import { describe, expect, it } from 'vitest'
import { sourceTag } from './sourceTag'

// Shapes taken from the live review rows on 2026-10-15 (taxonomy.source, brain_brief.slot, source_detail.kind,
// source_label, source_ref), one per source the desk tags.
const r = (o: Record<string, unknown>) => ({ taxonomy: null, source_label: null, source_ref: null, ...o }) as Parameters<typeof sourceTag>[0]

describe('sourceTag', () => {
  it.each([
    [r({ taxonomy: { source: 'content-brain', brain_brief: { slot: 'winner' } }, source_label: 'Content brain' }), 'brain', 'Brain · Winner'],
    [r({ cb34_p2_member: true }), 'brain', 'Brain'],
    [r({ source_kind: 'call', source_label: 'ARCH team call: Content team sync · 30 Sep' }), 'call', 'Call'],
    [r({ taxonomy: { source: 'Kyle call' } }), 'call', 'Call'],
    [r({ source_label: 'From your sales calls', taxonomy: { source: 'client-risedtc' } }), 'call', 'Call'],
    [r({ taxonomy: { source: 'x_tracked_outlier' }, source_label: 'X outlier by @denisyurchak (tracked account)' }), 'outlier', 'X outlier'],
    [r({ taxonomy: { source: 'Competitor' } }), 'industry', 'Industry post'],
    [r({ source_kind: 'competitor_adaptation', source_label: 'Barry Hott · Proven winner' }), 'industry', 'Industry post'],
    [r({ source_label: 'Original ARCH resource · lead magnet' }), 'lm', 'Lead magnet'],
    [r({ source_label: 'Newsjack' }), 'news', 'Newsjack'],
    [r({ source_kind: 'editorial', source_label: 'Davorin’s written feedback · 25 Aug 2026' }), 'client', 'From Davorin'],
    [r({ source_kind: 'case_study', source_label: 'From RISE DTC’s portfolio' }), 'portfolio', 'Portfolio'],
    [r({ source_kind: 'idea', source_label: 'Google Play, acquisition and retention' }), 'idea', 'Idea'],
    [r({ source_kind: 'parity_scratch', source_label: 'parity-harness definitive-client-layer-2' }), 'test', 'Test'],
    [r({ taxonomy: { source: 'manual' } }), 'manual', 'Manual'],
    [r({ source_label: 'Winner replica of @lawrenceaiseo reel (animated radial branch map)' }), 'industry', 'Industry post'],
    [r({ source_label: "SwishDM carousel style sample: WATCH-ACCOUNTS 'Ecommerce SEO is six jobs'" }), 'industry', 'Style sample'],
    [r({}), 'other', 'No source'],
  ])('%# → %s', (row, key, label) => {
    const owner = (row.source_label ?? '').includes('Davorin') ? 'Davorin' : ''
    const t = sourceTag(row, owner)
    expect(t.key).toBe(key)
    expect(t.label).toBe(label)
  })
  it('a style sample gets a plain title, not the planner key', () => {
    expect(sourceTag(r({ source_label: "SwishDM carousel style sample: WATCH-ACCOUNTS 'Getting cited is the easy part'" })).title).toBe('Written in the style of an account we watch')
  })
  it('the full recorded label rides in the title', () => {
    expect(sourceTag(r({ source_label: 'Call with Marianna Grollo (almedia.co) · 3 Oct' })).title).toBe('Call with Marianna Grollo (almedia.co) · 3 Oct')
  })
})
