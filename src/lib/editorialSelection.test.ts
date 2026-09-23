import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeCollectorRow } from './editorialCollectorBridge'
import { selectSynthesisSources } from './editorialSelection'
import { buildSynthesisBriefs } from './editorialSynthesis'

const snapshot = JSON.parse(readFileSync(new URL(
  '../../../../content-brain-01-evidence-briefs-2026-09-20-out/research/snapshots/risedtc.json', import.meta.url), 'utf8'))

describe('measured study source preservation', () => {
  it('counts retained rows without readable bodies instead of crashing or selecting them', () => {
    const missing = { source_id: 'missing-body', source_kind: 'public_post', owner: 'Unknown', passage: null,
      captured_at: '2026-09-21T00:00:00Z' }
    const readable = { ...missing, source_id: 'readable-body', passage: 'A retained readable source passage.' }

    const result = selectSynthesisSources([missing, readable] as never)

    expect(result.selected.map(source => source.source_id)).toEqual(['readable-body'])
    expect(result.withoutUsableBody).toBe(1)
    expect(result.omitted).toBe(1)
  })

  it('links a captured RISE finding to its single original author and rejects coincidental metric values', async () => {
    const finding = snapshot.market.items.find((x: any) => x.kind === 'market' && x.source_posts?.length === 1)
    const post = finding.source_posts[0]
    const source = await normalizeCollectorRow('risedtc', 'client_research_study_posts', {
      ...post, client_id: 'risedtc', study_id: finding.study_id,
      observed_metrics: { likes: 5267, reposts: 186, comments: 344 }, population: 'market', inclusion: 'included',
    }, '2026-09-21T00:00:00Z', [{ study_id: finding.study_id, finding_id: finding.finding_id,
      source_ids: [post.canonical_source_id], kind: 'market', metric_id: finding.metric_id,
      observed_value: finding.observed_value, baseline_value: finding.baseline_value,
      baseline_n: finding.baseline_n, lift: finding.lift, formula: finding.formula,
      method_version: finding.method_version, age_comparability: finding.age_comparability,
      limitations: finding.limitations, validation_state: finding.validation_state,
      selection_method: finding.selection_method }])
    expect((source.candidate_fields?.linked_findings as any[])[0]).toMatchObject({
      observed_value: finding.observed_value, formula: finding.formula, baseline_n: finding.baseline_n })
    expect(source.retained_context).toContain(`linked_single_source_findings=`)
    const unrelated = await normalizeCollectorRow('risedtc', 'client_research_study_posts', {
      ...post, client_id: 'risedtc', study_id: 'other-study', observed_metrics: { likes: 5267 },
      population: 'market', inclusion: 'included',
    }, '2026-09-21T00:00:00Z', (source.candidate_fields?.linked_findings as never[]))
    expect(unrelated.candidate_fields?.linked_findings).toEqual([])
    const rows = [source, ...Array.from({ length: 8 }, (_, i) => ({ ...source,
      source_id: `short-${i}`, owner: `author-${i}`, passage: 'short',
      candidate_fields: { linked_findings: [{ lift: 999 }] } }))]
    const selected = selectSynthesisSources(rows as never, 5)
    expect(selected.selected[0].source_id).toBe(source.source_id)
    expect(selected.method).toContain('measured-distinct-author')
    const suggestion = { source_ids: [source.source_id], topic: 'Specific measured example',
      angle: 'Compare this author’s result with its baseline', hook: 'One author, one observed result',
      format: 'text', objective: 'Explain descriptive result', intended_audience: 'RISE operators',
      why_now: 'New linked market observation', structural_beats: ['Observation', 'Limit'],
      missing_material: [], tone: 'Measured', overlap_with_existing_content: 'One prior broad market claim',
      novelty_reason: 'Exact linked finding', claims: [{ source_id: source.source_id,
        supporting_quote: post.post_text.slice(0, 30), statement: 'The author wrote this original post.',
        allowed_phrasing: 'The original author wrote this post.', prohibited_inference: 'Do not claim format causality.',
        status: 'fact' }], measurements: [{ source_id: source.source_id, metric_name: finding.metric_id,
        observed_value: finding.observed_value, formula: finding.formula,
        denominator: `one original post; author baseline n=${finding.baseline_n}`,
        comparison_population: 'same author', observation_window: 'captured 2026-09-19',
        comparison_method_version: finding.method_version, unknowns: ['age matching'] }],
      resource: { asset_id: '', version: '', artifact_role: 'none', readiness: 'not_needed', access_route: '',
        permission_basis: '', required_missing_material: [], draft_state: 'not_needed', public_catalog_state: 'not_needed' },
      distribution: { channel: 'LinkedIn', cta: 'Inspect your own baseline.', route: 'ungated', fulfillment_requirements: [] },
      production: { structure: 'Result, denominator, limitation', required_materials: [], critical_constraints: [], effort_category: 'low' },
      evaluation: { primary_metric: 'replies', secondary_metrics: [], comparator: 'same-author baseline', window: '7 days',
        earliest_valid_observation: 'after 7 days', event_source_availability: 'own platform analytics',
        attribution_limitations: 'No causal assignment' },
    } as const
    const valid = await buildSynthesisBriefs({ clientId: 'risedtc', batchId: 'test-batch', directionVersion: '1',
      sourceCutoff: '2026-09-21T00:00:00Z', sources: [source as never], suggestions: [suggestion as never] })
    expect(valid[0].measurements[0].observed_value).toBe(finding.observed_value)
    // A call with unknown reuse rights stays selectable evidence and still forces the
    // internal-only hold, but B01 forbids it as the cited proof of a factual claim:
    // possession and an exact quote match are not a grant.
    const privateCall = { ...source, source_id: 'private-call', source_kind: 'call',
      owner: 'Private Buyer', permission_state: 'unknown' }
    const internal = await buildSynthesisBriefs({ clientId: 'risedtc', batchId: 'internal-test',
      directionVersion: '1', sourceCutoff: '2026-09-21T00:00:00Z',
      sources: [source as never, privateCall as never],
      suggestions: [{ ...suggestion, source_ids: [source.source_id, privateCall.source_id],
        measurements: [] } as never] })
    expect(internal[0].missing_material).not.toContain('Public use permission for the cited private call excerpt')
    expect(internal[0].production.critical_constraints.join(' ')).toContain('Internal copy only')
    await expect(buildSynthesisBriefs({ clientId: 'risedtc', batchId: 'internal-test',
      directionVersion: '1', sourceCutoff: '2026-09-21T00:00:00Z', sources: [privateCall as never],
      suggestions: [{ ...suggestion, source_ids: [privateCall.source_id], measurements: [],
        claims: [{ ...suggestion.claims[0], source_id: privateCall.source_id }] } as never] }))
      .rejects.toThrow(/reuse permission/)
    await expect(buildSynthesisBriefs({ clientId: 'risedtc', batchId: 'test-batch', directionVersion: '1',
      sourceCutoff: '2026-09-21T00:00:00Z', sources: [source as never], suggestions: [{ ...suggestion,
        measurements: [{ ...suggestion.measurements[0], observed_value: '5267' }] } as never] })).rejects.toThrow(/exact structured/)
  })
})

// B1 regression: the newest-only shortlist silently lost whole source families and
// never named what it dropped. Real populations are ivan 2446 / risedtc 4465 / arch 497.
describe('paginated, family-balanced bounded selection', () => {
  const row = (id: string, kind: string, owner: string, day: number, passage = 'A retained readable passage that is long enough to be adaptable into an original direction.') =>
    ({ source_id: id, source_kind: kind, owner, passage,
      source_published_at: `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`, captured_at: '2026-09-21T00:00:00Z' })

  const population = [
    ...Array.from({ length: 2000 }, (_, i) => row(`public-${i}`, 'public_post', `author-${i % 40}`, 20)),
    ...Array.from({ length: 300 }, (_, i) => row(`own-${i}`, 'own_post', 'client', 19)),
    ...Array.from({ length: 80 }, (_, i) => row(`study-${i}`, 'market_study', `study-author-${i}`, 18)),
    ...Array.from({ length: 40 }, (_, i) => row(`cand-${i}`, 'candidate', 'candidate-author', 17)),
    ...Array.from({ length: 12 }, (_, i) => row(`call-${i}`, 'call', 'buyer', 16)),
  ]

  it('reads every page of the allowed population instead of a newest-first prefix', () => {
    const result = selectSynthesisSources(population as never, 24, 500)

    expect(result.coverage.page_size).toBe(500)
    expect(result.coverage.pages_read).toBe(Math.ceil(population.length / 500))
    expect(result.coverage.population_total).toBe(population.length)
    expect(result.coverage.usable_population).toBe(population.length)
  })

  it('represents every present source family rather than spending the budget on the newest family', () => {
    const result = selectSynthesisSources(population as never, 24, 500)
    const families = new Set(result.selected.map(s => String(s.source_kind)))

    expect(result.selected.length).toBe(24)
    for (const family of ['own_post', 'public_post', 'market_study', 'candidate', 'call']) {
      expect(families.has(family)).toBe(true)
    }
  })

  it('offers X and Reddit evidence when both platforms exist in the public-source population', () => {
    const publicRow = (id: string, platform: string, owner: string) => ({
      ...row(id, 'public_post', owner, 20),
      candidate_fields: { source_identity: { platform, native_id: id } },
    })
    const result = selectSynthesisSources([
      ...Array.from({ length: 20 }, (_, i) => publicRow(`li-${i}`, 'linkedin', `li-owner-${i}`)),
      publicRow('x-1', 'x', 'x-owner'),
      publicRow('reddit-1', 'reddit', 'reddit-owner'),
      row('own-1', 'own_post', 'client', 19),
    ] as never, 6)

    const platforms = result.selected
      .filter(source => source.source_kind === 'public_post')
      .map(source => String((source.candidate_fields?.source_identity as Record<string, unknown>)?.platform))
    expect(platforms).toEqual(expect.arrayContaining(['x', 'reddit']))
    expect(result.coverage.selected_count_by_platform).toMatchObject({ x: 1, reddit: 1 })
  })

  it('prefers recent same-platform engagement without promoting a stale winner or comparing platforms', () => {
    const publicRow = (id: string, platform: string, published: string, metrics: Record<string, number>) => ({
      source_id: id, source_kind: 'public_post', owner: id, passage: 'A complete retained source passage suitable for an original direction.',
      source_published_at: published, captured_at: '2026-09-22T00:00:00Z',
      candidate_fields: { source_identity: { platform, native_id: id }, observed_metrics: metrics },
    })
    const result = selectSynthesisSources([
      publicRow('x-yesterday-zero', 'x', '2026-09-21T00:00:00Z', { likes: 0, replies: 0, reposts: 0, quotes: 0 }),
      publicRow('x-ten-days-100', 'x', '2026-09-12T00:00:00Z', { likes: 100, replies: 0, reposts: 0, quotes: 0 }),
      publicRow('x-stale-1000', 'x', '2026-07-01T00:00:00Z', { likes: 1000, replies: 0, reposts: 0, quotes: 0 }),
      publicRow('reddit-recent', 'reddit', '2026-09-20T00:00:00Z', { score: 2, comments: 1 }),
    ] as never, 2)

    expect(result.selected.map(source => source.source_id).sort()).toEqual(['reddit-recent', 'x-ten-days-100'])
  })

  it('names every omitted source id and the omitted count per family', () => {
    const result = selectSynthesisSources(population as never, 24, 500)
    const omitted = Object.values(result.coverage.omitted_source_ids_by_family).flat()

    expect(omitted.length).toBe(population.length - result.selected.length)
    expect(result.coverage.omitted_count).toBe(omitted.length)
    expect(new Set(omitted).size).toBe(omitted.length)
    expect(omitted.some(id => result.selected.some(s => s.source_id === id))).toBe(false)
    expect(result.coverage.omitted_count_by_family.call).toBe(12 - result.selected.filter(s => s.source_kind === 'call').length)
  })

  it('is deterministic and keeps the legacy omitted/withoutUsableBody contract', () => {
    const first = selectSynthesisSources(population as never, 24, 500)
    const second = selectSynthesisSources([...population].reverse() as never, 24, 500)

    expect(first.selected.map(s => s.source_id)).toEqual(second.selected.map(s => s.source_id))
    expect(first.omitted).toBe(population.length - first.selected.length)
    expect(first.withoutUsableBody).toBe(0)
  })
})
