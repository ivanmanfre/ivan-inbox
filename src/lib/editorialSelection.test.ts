import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeCollectorRow } from './editorialCollectorBridge'
import { selectSynthesisSources } from './editorialSelection'
import { buildSynthesisBriefs } from './editorialSynthesis'

const snapshot = JSON.parse(readFileSync('../../../content-brain-01-evidence-briefs-2026-09-20-out/research/snapshots/risedtc.json', 'utf8'))

describe('measured study source preservation', () => {
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
    const privateCall = { ...source, source_kind: 'call', owner: 'Private Buyer',
      permission_state: 'unknown' }
    const internal = await buildSynthesisBriefs({ clientId: 'risedtc', batchId: 'internal-test',
      directionVersion: '1', sourceCutoff: '2026-09-21T00:00:00Z', sources: [privateCall as never],
      suggestions: [{ ...suggestion, measurements: [] } as never] })
    expect(internal[0].missing_material).not.toContain('Public use permission for the cited private call excerpt')
    expect(internal[0].production.critical_constraints.join(' ')).toContain('Internal copy only')
    await expect(buildSynthesisBriefs({ clientId: 'risedtc', batchId: 'test-batch', directionVersion: '1',
      sourceCutoff: '2026-09-21T00:00:00Z', sources: [source as never], suggestions: [{ ...suggestion,
        measurements: [{ ...suggestion.measurements[0], observed_value: '5267' }] } as never] })).rejects.toThrow(/exact structured/)
  })
})
