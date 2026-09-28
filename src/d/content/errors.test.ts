import { describe, expect, it } from 'vitest'
import type { ContentDraft } from '../../lib/content'
import { errorRowsWithBlocks, errorsLanding, generatingOf } from './model'
import { magnetTrio } from './useMagnetCounts'
import { readStrategyDeepLink, dStrategySub } from '../../wb/content/strategy/deepLink'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const row = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'x', client_id: null, status: 'review', type: 'text', title: 't', topic: null, post_body: '', scheduled_at: null, published_at: null,
  created_at: '2026-09-26T10:00:00Z', updated_at: '2026-09-26T10:00:00Z', image_urls: null, taxonomy: null, board_visible: null, ...o,
} as ContentDraft)

describe('Errors parity', () => {
  it('counts publisher-stopped posts (Ivan), never a published one, never twice', () => {
    const rows = [row({ id: 'a', status: 'scheduled', scheduled_at: '2026-09-29T08:00:00Z' }), row({ id: 'b', status: 'error' }), row({ id: 'c', status: 'published', published_at: '2026-09-20T08:00:00Z' })]
    const blocks = new Map([['a', 'no media'], ['b', 'x'], ['c', 'y']])
    expect(errorRowsWithBlocks(rows, 'ivan', NOW, blocks).map(r => r.id).sort()).toEqual(['a', 'b'])
    expect(errorRowsWithBlocks(rows, 'ivan', NOW, null).map(r => r.id)).toEqual(['b'])
  })
  it('lands every lane on the tab that holds its errors', () => {
    expect(errorsLanding([row({ status: 'error' })], 'ivan', NOW)).toBe('error')
    expect(errorsLanding([row({ client_id: 'risedtc', status: 'error', board_visible: true })], 'risedtc', NOW)).toBe('board_error')
    expect(errorsLanding([row({ client_id: 'arch', status: 'error' })], 'arch', NOW)).toBe('internal_error')
    expect(errorsLanding([], 'arch', NOW, null, 'generating')).toBe('internal_generating')
    expect(errorsLanding([], 'ivan', NOW, null, 'generating')).toBe('generating')
  })
  it('generating counts stalled runs past 20 minutes', () => {
    const g = generatingOf([row({ status: 'generating', updated_at: '2026-09-27T11:00:00Z' }), row({ id: 'y', status: 'generating', updated_at: '2026-09-27T11:55:00Z' })], 'ivan', NOW)
    expect(g.n).toBe(2)
    expect(g.stalled).toBeGreaterThanOrEqual(1)
  })
  it('magnets review badge per seat (rise = Rise, NULL = Ivan)', () => {
    expect(magnetTrio([{ client_id: null }, { client_id: 'rise' }, { client_id: 'risedtc' }, { client_id: 'arch' }])).toEqual({ ivan: 1, risedtc: 2, arch: 1 })
  })
  it('Strategy reads its tab and exact brief from a D address; sources means Research', () => {
    expect(readStrategyDeepLink('#exp/d/content/results')).toEqual({ section: 'results' })
    expect(readStrategyDeepLink('#exp/d/content/strategy?sources=1').section).toBe('research')
    expect(readStrategyDeepLink('#exp/d/content/strategy?lane=arch&section=this-week&brief_id=b1&brief_version=2')).toEqual({ lane: 'arch', section: 'this-week', briefId: 'b1', briefVersion: 2 })
    expect(dStrategySub('outliers')).toBe('strategy')
    expect(dStrategySub('direction')).toBe('strategy')
  })
})
