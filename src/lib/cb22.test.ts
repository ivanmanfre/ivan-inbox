import { describe, expect, it } from 'vitest'
import { outlierSource, parseInputs } from './cb22'

describe('outlierSource (the Content brain · Outlier badge)', () => {
  it('badges a Use this idea from its evidence', () => {
    const s = outlierSource('outlier:x:123', { evidence: [{ author: 'Justin Welsh', lift: 27.5, url: 'https://x.com/j/status/123' }] })
    expect(s).toMatchObject({ kind: 'use_this', platform: 'x', author: 'Justin Welsh', lift: 27.5, url: 'https://x.com/j/status/123' })
  })
  it('marks a weekly promotion (same outlier: ref, promoted_by cb22)', () => {
    expect(outlierSource('outlier:linkedin:7', { breakdown: { source_author: 'A', lift: 9, promoted_by: 'cb22' } })?.kind).toBe('promoted')
  })
  it('builds the post link when the row has none', () => {
    expect(outlierSource('outlier:linkedin:77', {})?.url).toBe('https://www.linkedin.com/feed/update/urn:li:activity:77/')
  })
  it('never badges another source', () => {
    for (const ref of ['ffc-1', 'x-viral-2', 'https://x.com/a', null, 'outlier:tiktok:1', 'outlier:x:abc']) expect(outlierSource(ref, {})).toBeNull()
  })
})

describe('parseInputs', () => {
  it('refuses an unknown shape', () => { expect(parseInputs({ ok: false }).kind).toBe('failed') })
  it('keeps at most what the RPC sent and drops malformed rows', () => {
    const r = parseInputs({ ok: true, client: 'arch', top: [{ platform: 'x', post_id: '1', lift: 5, author: 'A', text: 't', rank: 1 }, { platform: 'fb', post_id: '2', lift: 1 }], buyers: [{ name: 'B', icp: 8 }], counts: { window: 3 } })
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') { expect(r.data.top).toHaveLength(1); expect(r.data.buyers[0].icp).toBe(8) }
  })
})
