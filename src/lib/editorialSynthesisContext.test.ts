import { describe, it, expect } from 'vitest'
import { prepareSynthesisContext, renderCanonicalPromptBodies, selectSynthesisAssets } from './editorialSynthesisContext'
const source = { source_id: 's', source_kind: 'own_post', owner: 'A', passage: 'p'.repeat(9000),
  body_sha256: 'a'.repeat(64), captured_at: '2026-09-20', retained_context: 'c'.repeat(7000),
  candidate_fields: { raw_context: 'x'.repeat(300000), observed_metrics: { comments: 0 }, private_names: ['Private Person'], metric_source: 'client_post_metrics', metric_denominator: 'one exact own post', observation_window: { published_at: '2026-09-15', captured_at: '2026-09-20' }, metric_observations: [{ collector_row_id: 'row-1', observed_metrics: { comments: 0 } }, { collector_row_id: 'study-row', observed_metrics: { comments: 9 } }], body_state: 'full', body_provenance: 'retained_native_recovery:original', source_identity: { platform: 'linkedin', native_id: 'urn:li:activity:source', collector_row_id: 'row-1' } } }
describe('whole synthesis context budget', () => {
  it('keeps canonical prompt bodies byte-for-byte without JSON-stringifying them into the prompt', () => {
    const prompts = [{ id: 'p-1', slug: 'author-voice', version: 4, body: 'Line one\n"quoted"\\literal\nLine three' },
      { id: 'p-2', slug: 'forbidden-language', version: 2, body: 'Never claim a result without evidence.' }]
    const rendered = renderCanonicalPromptBodies(prompts)

    for (const prompt of prompts) expect(rendered).toContain(prompt.body)
    expect(rendered).not.toContain(JSON.stringify(prompts[0].body))
    expect(rendered).toContain('"prompt_id":"p-1"')
  })

  it('bounds assets by catalog relevance and records every omitted identity', () => {
    const assets = [
      { id: 'retired', version: '1', access_route: '/retired', permission_basis: 'client-owned catalog', status: 'needs_material', catalog_state: 'retired', slug: 'retired' },
      { id: 'draft-b', version: '1', access_route: '/draft-b', permission_basis: 'client-owned catalog', status: 'needs_material', catalog_state: 'draft', slug: 'draft-b' },
      { id: 'published', version: '3', access_route: '/published', permission_basis: 'client-owned catalog', status: 'needs_material', catalog_state: 'published', slug: 'published' },
      { id: 'ready', version: '2', access_route: '/ready', permission_basis: 'client-owned catalog', status: 'ready', catalog_state: 'published', slug: 'ready' },
      { id: 'draft-a', version: '1', access_route: '/draft-a', permission_basis: 'client-owned catalog', status: 'needs_material', catalog_state: 'draft', slug: 'draft-a' },
    ]

    const result = selectSynthesisAssets(assets, 3)

    expect(result.selected.map(asset => asset.id)).toEqual(['ready', 'published', 'draft-a'])
    expect(result.coverage).toMatchObject({ assets_considered: 5, assets_supplied: 3, assets_omitted: 2 })
    expect(result.coverage.omitted_asset_ids_by_catalog_state).toEqual({ draft: ['draft-b'], retired: ['retired'] })
    const reconstructed = Object.entries(result.coverage.omitted_asset_ids_by_catalog_state as Record<string, string[]>)
      .flatMap(([catalog_state, ids]) => ids.map(id => ({ id, catalog_state })))
    expect(reconstructed).toEqual(expect.arrayContaining([
      { id: 'draft-b', catalog_state: 'draft' }, { id: 'retired', catalog_state: 'retired' },
    ]))
    expect(new Set([...result.selected.map(asset => asset.id), ...reconstructed.map(asset => asset.id)]).size).toBe(assets.length)
  })

  it('bounds serialized fields, preserves zero/latest exact identity and reports omissions', () => {
    const outcomes = [{ snapshot_id: 'old', artifact_id: 's', metric: 'comments', observed_value: 9, captured_at: '2026-09-19' }, { snapshot_id: 'new', artifact_id: 's', metric: 'comments', observed_value: 0, captured_at: '2026-09-20' }, ...Array.from({length: 1600}, (_,i) => ({snapshot_id:String(i),artifact_id:'other',metric:'comments',observed_value:4}))]
    const result = prepareSynthesisContext({ sources: [source], outcomes, coverage: { asset_catalog: { assets_omitted: 4 } },
      render: parts => [{ role: 'user', content: 'v'.repeat(166000) + JSON.stringify(parts) + 'BINDING DECISION' }] })
    expect(JSON.stringify(result.messages).length).toBeLessThanOrEqual(184000)
    expect(result.coverage.correction_reserve_chars).toBe(16000)
    expect(result.outcomes).toEqual([outcomes[1]])
    expect(result.coverage.outcomes_omitted).toBe(1601)
    expect(result.selected[0].candidate_fields?.private_names).toEqual(['Private Person'])
    expect(result.selected[0].candidate_fields?.observed_metrics).toEqual({ comments: 0 })
    expect(result.selected[0].candidate_fields).toMatchObject({ metric_source: 'client_post_metrics',
      metric_denominator: 'one exact own post', observation_window: { captured_at: '2026-09-20' },
      metric_observations: [{ collector_row_id: 'row-1', observed_metrics: { comments: 0 } }, { collector_row_id: 'study-row', observed_metrics: { comments: 9 } }],
      body_state: 'excerpt', source_identity: { native_id: 'urn:li:activity:source' } })
    expect(result.selected[0].candidate_fields?.model_projection).toEqual({
      source_body_state: 'full', source_body_provenance: 'retained_native_recovery:original',
      source_content_hash: 'a'.repeat(64), source_passage_chars: 9000,
      supplied_passage_chars: String(result.selected[0].passage ?? '').length, passage_clipped: true,
      source_retained_context_chars: 7000, supplied_retained_context_chars: result.selected[0].retained_context?.length,
      retained_context_clipped: true,
    })
    expect(result.selected[0].candidate_fields?.raw_context).toBeUndefined()
    expect(result.coverage.asset_catalog).toEqual({ assets_omitted: 4 })
    expect(result.messages[0].content).toContain('BINDING DECISION')
    expect(source.passage.length).toBe(9000)
  })
  it('keeps metric and body provenance in the actual rendered model request', () => {
    const result = prepareSynthesisContext({ sources: [source], outcomes: [],
      render: parts => [{ role: 'user', content: JSON.stringify(parts) }] })
    const rendered = JSON.parse(result.messages[0].content) as { selected: typeof result.selected }

    expect(rendered.selected[0].candidate_fields).toMatchObject({ observed_metrics: { comments: 0 },
      metric_source: 'client_post_metrics', metric_denominator: 'one exact own post',
      observation_window: { published_at: '2026-09-15', captured_at: '2026-09-20' },
      metric_observations: [{ collector_row_id: 'row-1', observed_metrics: { comments: 0 } }, { collector_row_id: 'study-row', observed_metrics: { comments: 9 } }],
      body_state: 'excerpt', source_identity: { platform: 'linkedin', native_id: 'urn:li:activity:source' } })
    expect(rendered.selected[0].candidate_fields?.model_projection).toMatchObject({
      source_body_state: 'full', source_content_hash: 'a'.repeat(64), passage_clipped: true,
      retained_context_clipped: true,
    })
  })
  it('retains an observed own post, including zero, ahead of an unobserved planned post under a tight budget', () => {
    const planned = { ...source, source_id: 'planned', passage: 'planned' }
    const other = { ...source, source_id: 'public', source_kind: 'public_post' }
    const result = prepareSynthesisContext({ sources: [planned, source, other], outcomes: [{snapshot_id:'zero',artifact_id:'s',metric:'comments',observed_value:0}],
      render: parts => [{role:'user',content:'v'.repeat(170000) + JSON.stringify(parts)}] })
    expect(result.selected.some(s => s.source_id === 's')).toBe(true)
    expect(result.outcomes[0].observed_value).toBe(0)
  })
  it('refuses oversized mandatory instructions instead of dropping decisions or canon', () => {
    expect(() => prepareSynthesisContext({ sources: [source], outcomes: [], render: () => [{role:'user',content:'x'.repeat(184001)}] })).toThrow('Mandatory canonical')
  })
  it('admits a complete initial request above 176k when it fits the reviewed 184k preparation ceiling', () => {
    const result = prepareSynthesisContext({ sources: [source], outcomes: [],
      render: parts => [{ role:'user', content:'x'.repeat(176500) + JSON.stringify(parts) }] })
    const size = JSON.stringify(result.messages).length
    expect(size).toBeGreaterThan(176000)
    expect(size).toBeLessThanOrEqual(184000)
    expect(result.coverage.correction_reserve_chars).toBe(16000)
  })
})

// B1/A04 carried-in watch item: the coverage rendered INTO the model input reported the
// post-selector shortlist (24) as `sources_considered`, so the model could not see that
// ivan 2446 / risedtc 4465 / arch 497 usable rows existed behind it.
describe('population disclosure inside the actual model input', () => {
  const population = { usable_population: 4465, shortlist_size: 24, without_usable_body: 562,
    selection_policy: 'paginated-family-balanced-measured-distinct-author-round-robin-v3',
    omitted_count_by_family: { own_post: 291, public_post: 4001, market_study: 74, call: 9, candidate: 36 } }

  it('states the usable population, selected count, policy and omitted-by-family inside the input', () => {
    const result = prepareSynthesisContext({ sources: [source], outcomes: [], population,
      render: parts => [{ role: 'user', content: `COVERAGE: ${JSON.stringify(parts.coverage)}` }] })
    const input = result.messages[0].content

    expect(result.coverage.sources_usable_population).toBe(4465)
    expect(result.coverage.sources_shortlisted).toBe(24)
    expect(result.coverage.sources_considered).toBe(4465)
    expect(result.coverage.selection_policy).toBe('paginated-family-balanced-measured-distinct-author-round-robin-v3')
    expect(result.coverage.omitted_count_by_source_family).toEqual(population.omitted_count_by_family)
    expect(result.coverage.sources_omitted_total).toBe(4465 - result.selected.length)
    expect(input).toContain('"sources_usable_population":4465')
    expect(input).toContain('"sources_shortlisted":24')
    expect(input).toContain('"omitted_count_by_source_family"')
  })

  it('keeps the legacy shortlist denominator when no population is supplied', () => {
    const result = prepareSynthesisContext({ sources: [source], outcomes: [],
      render: parts => [{ role: 'user', content: JSON.stringify(parts.coverage) }] })

    expect(result.coverage.sources_considered).toBe(1)
    expect(result.coverage.sources_usable_population).toBe(1)
  })

  it('carries an explicit gap_reason on every non-full projected source so clipping cannot hide', () => {
    const result = prepareSynthesisContext({ sources: [source], outcomes: [],
      render: parts => [{ role: 'user', content: JSON.stringify(parts.selected) }] })
    const projected = result.selected[0] as Record<string, unknown>

    expect(typeof projected.gap_reason).toBe('string')
    expect(String(projected.gap_reason)).toContain('passage clipped')
    expect(result.messages[0].content).toContain(String(projected.gap_reason))
  })

  it('reports no gap for a source supplied whole', () => {
    const whole = { ...source, passage: 'short passage', retained_context: 'short context',
      candidate_fields: { ...source.candidate_fields, raw_context: undefined } }
    const result = prepareSynthesisContext({ sources: [whole], outcomes: [],
      render: parts => [{ role: 'user', content: JSON.stringify(parts.selected) }] })

    expect((result.selected[0] as Record<string, unknown>).gap_reason).toBe(null)
  })
})
