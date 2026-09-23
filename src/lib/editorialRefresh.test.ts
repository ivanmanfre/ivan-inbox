import { describe, expect, it } from 'vitest'
import { assertRefreshHasSources, directionQuoteOptions, refreshTraceValidation } from './editorialRefresh'

describe('Refresh direction contract', () => {
  const direction = {
    source: 'Run 4 reviewed direction', status: 'active', client_id: 'arch',
    active_version: 'fdb1bf1a52915deddb8693ad0d5ab96b0800bd3feb640edaae59f880a830b762',
    audience: 'UA leads weighing whether a modest budget can support a creator test.',
    direction: { status: 'provisional', a2_scoped_direction: {
      purpose: 'Retain the reviewed creator-campaign direction for source comparison.',
      boundaries: ['Do not infer buyer approval from generic games discussion.'],
    } },
  }

  it('gives the model exact human direction passages without source labels, hashes or status metadata', () => {
    expect(directionQuoteOptions(direction)).toEqual([
      'UA leads weighing whether a modest budget can support a creator test.',
      'Retain the reviewed creator-campaign direction for source comparison.',
      'Do not infer buyer approval from generic games discussion.',
    ])
  })
})

describe('Refresh failure trace', () => {
  it('retains offered source identities and selection coverage when validation fails', () => {
    expect(refreshTraceValidation({
      error: 'direction quote rejected', defects: ['direction quote rejected'],
      selectedSourceIds: ['x-1', 'reddit-1'], selectionMethod: 'balanced',
      selectionCoverage: { selected_count: 2 }, contextCoverage: { sources_supplied: 2 },
    })).toEqual({
      error: 'direction quote rejected', defects: ['direction quote rejected'],
      context_coverage: { sources_supplied: 2 }, selection_method: 'balanced',
      selection_coverage: { selected_count: 2 }, selected_source_ids: ['x-1', 'reddit-1'],
    })
  })

  it('refuses an empty offered-source population instead of completing an empty batch', () => {
    expect(() => assertRefreshHasSources([], 12)).toThrow(/no eligible sources were offered.*12 frozen refs/i)
    expect(() => assertRefreshHasSources(['x-1'], 12)).not.toThrow()
  })
})
