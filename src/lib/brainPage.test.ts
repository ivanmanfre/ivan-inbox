import { describe, expect, it } from 'vitest'
import { learnedFrom, resultLine, sourceOf, type DraftSourceRead } from './brainPage'

// Shapes copied from live rows read 2026-10-05 (cb51_draft_sources + carousel_drafts), trimmed.
const read = (o: Partial<DraftSourceRead>): DraftSourceRead => ({ draft_id: 'd', member_state: null, slot: null, source_ref: null, source_text: null, detail: null, x: null, linkedin: null, ...o })
const draft = (taxonomy: unknown, source_label: string | null = null) => ({ taxonomy, source_ref: null, cb34_p2_member: null, source_label } as never)

describe('sourceOf', () => {
  it('an X outlier shows the stored passage, the author and its lift over the author’s usual', () => {
    const v = sourceOf(draft({ source: 'content-brain', brain_brief: { slot: 'outlier', source_author: 'Justin Welsh', source_url: 'https://x.com/thejustinwelsh/status/2102021807339352413', why_this_post: 'The outlier ran at 14.24x lift.', shape: 'Open with one blunt line.' } }),
      read({ slot: 'outlier', source_ref: 'outlier:x:2102021807339352413', source_text: 'Owning 100% of your time is so rare…', x: { author: 'Justin Welsh', likes: 5915, ratio: 14.2397, baseline: 538, baseline_n: 60, published_at: '2026-09-21T13:07:07+00:00', url: 'https://x.com/thejustinwelsh/status/2102021807339352413' } }))
    expect(v.kind).toBe('Industry post on X')
    expect(v.example).toBe(false)
    expect(v.author).toBe('Justin Welsh')
    expect(v.date).toBe('2026-09-21')
    expect(v.text).toMatch(/^Owning 100%/)
    expect(v.result).toBe('5,915 likes · 14.2x their usual (usual 538, 60 posts)')
    expect(v.borrowed).toBe('Open with one blunt line.')
  })
  it('a pattern-led idea labels its text as an example, never as the adapted post', () => {
    const v = sourceOf(draft({ source: 'content-brain', brain_brief: { slot: 'pattern', source_author: 'ruben-hassid', pattern: { dimension: 'proof_type', value: 'screenshot_visual', n: 26 }, why_this_post: 'Screenshot posts break out.' } }),
      read({ slot: 'pattern', source_ref: 'pattern:proof_type=screenshot_visual', source_text: 'So AI went from this (left) to this (right) in 3 months.' }))
    expect(v.kind).toBe('Pattern-led idea')
    expect(v.example).toBe(true)
    expect(v.result).toBe('Pattern proof_type: screenshot_visual · n=26')
  })
  it('a tracked X post reads likes against the author’s median from the draft’s own record', () => {
    const v = sourceOf(draft({ source: 'x_tracked_outlier' }, 'X outlier by @thekevinjon'), read({ detail: { kind: 'x_tracked_outlier', author_name: 'Kevin Jon', likes: 63, author_median: { n: 40, likes: 4.5 }, original_text: 'Germany’s biggest business paper…', url: 'https://x.com/thekevinjon/status/2104904581444772095', created_at: 'Tue Sep 29 12:02:14 +0000 2026' } }))
    expect(v.author).toBe('Kevin Jon')
    expect(v.result).toBe('63 likes · 14x their usual (usual 4.5, 40 posts)')
    expect(v.text).toMatch(/^Germany/)
  })
  it('a call shows the quote as said, and never names the colleague', () => {
    const v = sourceOf(draft(null), read({ detail: { kind: 'call', speaker: 'colleague', call_date: '2026-09-30', quote: 'campaigns for some creators were put under the September', explanation: 'Davorin was asked…' } }))
    expect(v.kind).toBe('From a call')
    expect(v.author).toBe('A colleague on the call')
    expect(v.text).toMatch(/September/)
  })
  it('an editorial-brief draft shows the brief’s first evidence passage with its owner', () => {
    const v = sourceOf(draft(null), read({ detail: { brief_id: 'brief-arch-11', brief_version: 2 }, brief: { evidence: { owner: 'PocketGamer.biz, guest analysis by Leonid Malysh', passage: 'Revenue-based LTV can make unprofitable UA campaigns look profitable at scale.', source_kind: 'public_post', source_ref: { url: 'https://www.pocketgamer.biz/why-most-mobile-games-get-ltv-wrong-at-ua-scale/' }, source_published_date: '2026-09-16' }, objective: 'Give UA leads a concrete warning.', structure: 'Single text post.' } }))
    expect(v.kind).toBe('Industry source')
    expect(v.author).toMatch(/^PocketGamer/)
    expect(v.date).toBe('2026-09-16')
    expect(v.text).toMatch(/^Revenue-based LTV/)
    expect(v.url).toMatch(/pocketgamer/)
    expect(v.borrowed).toBe('Single text post.')
  })
  it('a draft with no recorded source says so instead of inventing one', () => {
    const v = sourceOf(draft(null), undefined)
    expect(v.kind).toBe('Source not recorded')
    expect(v.text).toBeNull()
    expect(v.result).toBeNull()
  })
})

describe('resultLine', () => {
  it('stays empty when nothing was measured', () => {
    expect(resultLine(null)).toBeNull()
    expect(resultLine({})).toBeNull()
  })
})

// Actual selected-post provenance from the 2026-10-06 learning picker replay.
const decision = { id: 'win:de9336b6-17dd-4722-8ad3-75b34fdffeb7', origin: 'chosen_post', action: 'published' }
const learning = { version: 'cb52-a', client: 'ivan', applied: [{ decision_id: decision.id, effect: 'prefer_win', decision }], learned_from: { id: decision.id, text: 'published: 3-month minimum' } }
const learnedDraft = (value: unknown) => draft({ brain_brief: { brief_v3: { learning: value } } })
describe('learnedFrom', () => {
  it('shows the recorded choice that shaped this account’s new draft', () => {
    expect(learnedFrom(learnedDraft(learning), 'ivan')).toBe('published: 3-month minimum')
    expect(learnedFrom(draft(JSON.stringify({ brain_brief: { brief_v3: { learning } } })), 'ivan')).toBe('published: 3-month minimum')
  })
  it('does not disclose another account’s decision or imply learning on old drafts', () => {
    expect(learnedFrom(learnedDraft(learning), 'arch')).toBeNull()
    expect(learnedFrom(draft({ source: 'content-brain' }), 'ivan')).toBeNull()
    expect(learnedFrom(draft('bad json'), 'ivan')).toBeNull()
  })
  it('requires a referenced decision record before presenting the claim', () => {
    expect(learnedFrom(learnedDraft({ ...learning, applied: [] }), 'ivan')).toBeNull()
    expect(learnedFrom(learnedDraft({ ...learning, learned_from: { id: 'unrecorded', text: 'Claim' } }), 'ivan')).toBeNull()
    expect(learnedFrom(learnedDraft({ ...learning, applied: [{ decision_id: decision.id }] }), 'ivan')).toBeNull()
    expect(learnedFrom(learnedDraft({ ...learning, applied: [{}], learned_from: { text: 'Claim' } }), 'ivan')).toBeNull()
  })
})
