import { describe, it, expect } from 'vitest'
import { prepareSynthesisContext } from './editorialSynthesisContext'
const source = { source_id: 's', source_kind: 'own_post', owner: 'A', passage: 'p'.repeat(9000), captured_at: '2026-09-20', retained_context: 'c'.repeat(7000), candidate_fields: { raw_context: 'x'.repeat(300000), observed_metrics: { comments: 0 }, private_names: ['Private Person'], metric_source: 'client_post_metrics', metric_denominator: 'one exact own post', observation_window: { published_at: '2026-09-15', captured_at: '2026-09-20' }, metric_observations: [{ collector_row_id: 'row-1', observed_metrics: { comments: 0 } }, { collector_row_id: 'study-row', observed_metrics: { comments: 9 } }], body_state: 'excerpt', source_identity: { platform: 'linkedin', native_id: 'urn:li:activity:source', collector_row_id: 'row-1' } } }
describe('whole synthesis context budget', () => {
  it('bounds serialized fields, preserves zero/latest exact identity and reports omissions', () => {
    const outcomes = [{ snapshot_id: 'old', artifact_id: 's', metric: 'comments', observed_value: 9, captured_at: '2026-09-19' }, { snapshot_id: 'new', artifact_id: 's', metric: 'comments', observed_value: 0, captured_at: '2026-09-20' }, ...Array.from({length: 1600}, (_,i) => ({snapshot_id:String(i),artifact_id:'other',metric:'comments',observed_value:4}))]
    const result = prepareSynthesisContext({ sources: [source], outcomes,
      render: parts => [{ role: 'user', content: 'v'.repeat(166000) + JSON.stringify(parts) + 'BINDING DECISION' }] })
    expect(JSON.stringify(result.messages).length).toBeLessThanOrEqual(176000)
    expect(result.outcomes).toEqual([outcomes[1]])
    expect(result.coverage.outcomes_omitted).toBe(1601)
    expect(result.selected[0].candidate_fields?.private_names).toEqual(['Private Person'])
    expect(result.selected[0].candidate_fields?.observed_metrics).toEqual({ comments: 0 })
    expect(result.selected[0].candidate_fields).toMatchObject({ metric_source: 'client_post_metrics',
      metric_denominator: 'one exact own post', observation_window: { captured_at: '2026-09-20' },
      metric_observations: [{ collector_row_id: 'row-1', observed_metrics: { comments: 0 } }, { collector_row_id: 'study-row', observed_metrics: { comments: 9 } }],
      body_state: 'excerpt', source_identity: { native_id: 'urn:li:activity:source' } })
    expect(result.selected[0].candidate_fields?.raw_context).toBeUndefined()
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
    expect(() => prepareSynthesisContext({ sources: [source], outcomes: [], render: () => [{role:'user',content:'x'.repeat(176001)}] })).toThrow('Mandatory canonical')
  })
})
