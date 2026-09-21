import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bridgeCollectedSources } from '../../supabase/functions/editorial-refresh/bridge'
import { normalizeCollectorRow } from './editorialCollectorBridge'

const rows: Record<string, Record<string, unknown>[]> = {
  own_posts: [{ id: 'captured-own-1', post_text: 'The captured original post body.',
    posted_at: '2026-09-18T10:00:00Z', num_comments: 5, num_impressions: 240 }],
  lm_idea_candidates: [{ id: 'unscoped-call', source: 'kyle_call', raw_context: 'private third-party transcript' }],
  client_research_study_posts: [], client_research_findings: [],
}

describe('collector bridge', () => {
  it('keeps a retained 500-character public metrics capture ambiguous and keyed to its native activity', async () => {
    const source = await normalizeCollectorRow('risedtc', 'client_post_metrics', {
      id: '6cdd1e61-9693-4b0a-9963-4696b7f6b7d0',
      client_id: 'risedtc', social_id: 'urn:li:activity:7505626612307038208',
      post_url: 'https://www.linkedin.com/posts/sanitized-7505626612307038208',
      published_at: '2026-09-15T14:00:32.173Z', captured_at: '2026-09-20T13:34:31.885Z',
      meta: { text: 'x'.repeat(500) }, impressions: 271, reactions: 9, comments: 5,
    }, '2026-09-20T13:34:31.885Z')

    expect(source.source_id).toBe('6cdd1e61-9693-4b0a-9963-4696b7f6b7d0')
    expect(source.candidate_fields).toMatchObject({
      body_state: 'unknown', metric_denominator: 'one exact own post',
      source_identity: { platform: 'linkedin', native_id: 'urn:li:activity:7505626612307038208', collector_row_id: '6cdd1e61-9693-4b0a-9963-4696b7f6b7d0' },
      observed_metrics: { impressions: 271, reactions: 9, comments: 5 },
      observation_window: { published_at: '2026-09-15T14:00:32.173Z', captured_at: '2026-09-20T13:34:31.885Z' },
    })
  })

  it('keeps a raw Ivan impressions zero without metrics_updated_at unknown for outcome use, while retaining a refreshed zero', async () => {
    const unknown = await normalizeCollectorRow('ivan', 'own_posts', { id:'unrefreshed', post_text:'body', posted_at:'2026-09-01T00:00:00Z', scraped_at:'2026-09-02T00:00:00Z', num_impressions:0 }, '2026-09-02T00:00:00Z')
    expect(unknown.candidate_fields?.observed_metrics).toMatchObject({ impressions:null })
    expect(unknown.candidate_fields?.raw_observed_metrics).toMatchObject({ impressions:0 })
    expect(unknown.candidate_fields?.metric_observation_state).toMatchObject({ impressions:'unknown_no_metrics_updated_at' })
    const refreshed = await normalizeCollectorRow('ivan', 'own_posts', { id:'refreshed', post_text:'body', posted_at:'2026-09-01T00:00:00Z', metrics_updated_at:'2026-09-02T00:00:00Z', num_impressions:0 }, '2026-09-02T00:00:00Z')
    expect(refreshed.candidate_fields?.observed_metrics).toMatchObject({ impressions:0 })
    expect(refreshed.candidate_fields?.metric_observation_state).toMatchObject({ impressions:'observed_metrics_updated_at' })
  })

  it('keeps duplicate collector rows for one platform activity on the legacy source identity', async () => {
    const original = rows.client_post_metrics
    rows.client_post_metrics = [
      { id: 'legacy-metric-row', client_id: 'risedtc', social_id: 'urn:li:activity:one-native-post',
        post_url: 'https://www.linkedin.com/posts/sanitized-one-native-post', full_text: 'The retained original.',
        published_at: '2026-09-18T10:00:00Z', captured_at: '2026-09-19T10:00:00Z', impressions: 12 },
      { id: 'newer-metric-row', client_id: 'risedtc', social_id: 'urn:li:activity:one-native-post',
        post_url: 'https://www.linkedin.com/posts/sanitized-one-native-post', full_text: 'The retained original.',
        published_at: '2026-09-18T10:00:00Z', captured_at: '2026-09-20T10:00:00Z', impressions: 12 },
    ]
    const latest = new Map<string, { seen_version: number; snapshot_hash: string }>()
    const inserted: Record<string, unknown>[] = []
    const db = {
      from(table: string) {
        const state = { from: 0, to: 0 }
        const chain = {
          select() { return chain }, order() { return chain }, eq() { return chain },
          range(from: number, to: number) { state.from = from; state.to = to; return chain },
          then(resolve: (value: unknown) => unknown) { const items = rows[table] ?? []
            return Promise.resolve(resolve({ data: items.slice(state.from, state.to + 1), count: items.length, error: null })) },
          async insert(batch: Record<string, unknown>[]) { inserted.push(...batch); for (const item of batch) latest.set(String(item.source_id), { seen_version: Number(item.seen_version), snapshot_hash: String(item.snapshot_hash) }); return { error: null } },
          async upsert() { return { error: null } },
        }
        return chain
      },
      async rpc(_name: string, args: { p_source_ids: string[] }) { return { data: args.p_source_ids.flatMap(id => latest.has(id) ? [{ source_id: id, ...latest.get(id)! }] : []), error: null } },
    }
    try {
      await bridgeCollectedSources(db, 'risedtc')
      const firstHash = String(inserted[0].snapshot_hash)
      await bridgeCollectedSources(db, 'risedtc')
      expect(inserted).toHaveLength(1)
      expect(inserted[0]).toMatchObject({ source_id: 'legacy-metric-row', seen_version: 1, independent: true })
      expect(latest.get('legacy-metric-row')?.snapshot_hash).toBe(firstHash)
    } finally {
      rows.client_post_metrics = original
    }
  })

  it('deduplicates one native activity across metrics and study collectors on the persisted legacy identity', async () => {
    const originalMetrics = rows.client_post_metrics
    const originalStudies = rows.client_research_study_posts
    rows.client_post_metrics = [{ id: 'legacy-metric-row', client_id: 'risedtc', social_id: 'urn:li:activity:cross-collector',
      post_url: 'https://www.linkedin.com/posts/sanitized-cross-collector', full_text: 'Captured post text.',
      published_at: '2026-09-18T10:00:00Z', captured_at: '2026-09-19T10:00:00Z', impressions: 12, reactions: 0 }]
    rows.client_research_study_posts = [{ client_id: 'risedtc', study_id: 'study-1',
      canonical_source_id: 'urn:li:activity:cross-collector', source_url: 'https://www.linkedin.com/posts/sanitized-cross-collector',
      post_text: 'Captured post text.', author_id: 'Public author', published_at: '2026-09-18T10:00:00Z',
      last_captured_at: '2026-09-20T10:00:00Z', observed_metrics: { reactions: 99 }, population: 'one exact public post' }]
    const latest = new Map<string, { seen_version: number; snapshot_hash: string }>([
      ['legacy-metric-row', { seen_version: 4, snapshot_hash: 'prior-legacy-version' }],
    ])
    const inserted: Record<string, unknown>[] = []
    const outcomes: Record<string, unknown>[] = []
    const db = {
      from(table: string) {
        const state = { from: 0, to: 0 }
        const chain = {
          select() { return chain }, order() { return chain }, eq() { return chain },
          range(from: number, to: number) { state.from = from; state.to = to; return chain },
          then(resolve: (value: unknown) => unknown) { const items = rows[table] ?? []
            return Promise.resolve(resolve({ data: items.slice(state.from, state.to + 1), count: items.length, error: null })) },
          async insert(batch: Record<string, unknown>[]) { inserted.push(...batch); for (const item of batch) latest.set(String(item.source_id), { seen_version: Number(item.seen_version), snapshot_hash: String(item.snapshot_hash) }); return { error: null } },
          async upsert(batch: Record<string, unknown>[]) { if (table === 'editorial_outcome_snapshots') outcomes.push(...batch); return { error: null } },
        }
        return chain
      },
      async rpc(_name: string, args: { p_source_ids: string[] }) { return { data: args.p_source_ids.flatMap(id => latest.has(id) ? [{ source_id: id, ...latest.get(id)! }] : []), error: null } },
    }
    try {
      await bridgeCollectedSources(db, 'risedtc')
      const firstHash = String(inserted[0].snapshot_hash)
      const metricOutcomes = outcomes.filter(row => row.scope === 'native client_post_metrics.id=legacy-metric-row')
      expect(metricOutcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ metric: 'impressions', observed_value: 12, denominator: 'one exact own post',
          window_start: '2026-09-18T10:00:00.000Z', window_end: '2026-09-19T10:00:00.000Z' }),
        expect.objectContaining({ metric: 'reactions', observed_value: 0, denominator: 'one exact own post',
          window_start: '2026-09-18T10:00:00.000Z', window_end: '2026-09-19T10:00:00.000Z' }),
      ]))
      expect(metricOutcomes).not.toContainEqual(expect.objectContaining({ metric: 'reactions', observed_value: 99 }))
      await bridgeCollectedSources(db, 'risedtc')
      expect(inserted).toHaveLength(1)
      expect(inserted[0]).toMatchObject({ source_id: 'legacy-metric-row', seen_version: 5, independent: true,
        candidate_fields: expect.objectContaining({ metric_observations: expect.arrayContaining([
          expect.objectContaining({ collector_row_id: 'legacy-metric-row', observed_metrics: expect.objectContaining({ impressions: 12, reactions: 0 }) }),
          expect.objectContaining({ collector_row_id: 'urn:li:activity:cross-collector', observed_metrics: { reactions: 99 } }),
        ]) }) })
      expect(latest.get('legacy-metric-row')?.snapshot_hash).toBe(firstHash)
    } finally {
      rows.client_post_metrics = originalMetrics
      rows.client_research_study_posts = originalStudies
    }
  })

  it('normalizes a captured legacy original once, retries unchanged despite a later read clock, and excludes unrelated private calls', async () => {
    const latest = new Map<string, { seen_version: number; snapshot_hash: string }>()
    const inserted: Record<string, unknown>[] = []
    const cursors: Record<string, unknown>[] = []
    const outcomes: Record<string, unknown>[] = []
    const db = {
      from(table: string) {
        const state = { table, from: 0, to: 0 }
        const chain = {
          select(_cols: string, _options?: unknown) { return chain },
          order(_column: string) { return chain },
          range(from: number, to: number) { state.from = from; state.to = to; return chain },
          eq(_key: string, _value: string) { return chain },
          then(resolve: (value: unknown) => unknown) {
            const items = rows[table] ?? []
            return Promise.resolve(resolve({ data: items.slice(state.from, state.to + 1), count: items.length, error: null }))
          },
          async insert(batch: Record<string, unknown>[]) {
            inserted.push(...batch)
            for (const item of batch) latest.set(String(item.source_id), {
              seen_version: Number(item.seen_version), snapshot_hash: String(item.snapshot_hash),
            })
            return { error: null }
          },
          async upsert(cursor: Record<string, unknown> | Record<string, unknown>[]) {
            if (table === 'editorial_collector_cursors') cursors.push(cursor as Record<string, unknown>)
            if (table === 'editorial_outcome_snapshots') outcomes.push(...cursor as Record<string, unknown>[])
            return { error: null }
          },
        }
        return chain
      },
      async rpc(_name: string, args: { p_source_ids: string[] }) {
        return { data: args.p_source_ids.flatMap(id => latest.has(id)
          ? [{ source_id: id, ...latest.get(id)! }] : []), error: null }
      },
    }
    const first = await bridgeCollectedSources(db, 'ivan')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ source_id: 'captured-own-1', seen_version: 1,
      passage: 'The captured original post body.' })
    expect(first.coverageGaps.join(' ')).toContain('unrelated ownership or unverified original passage')
    expect(outcomes).toContainEqual(expect.objectContaining({ brief_id: 'unattributed-own-post:captured-own-1',
      metric: 'comments', observed_value: 5, attribution: 'unknown' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    await bridgeCollectedSources(db, 'ivan')
    expect(inserted).toHaveLength(1)
    expect(cursors).toHaveLength(8)
    expect(outcomes.filter(x => x.metric === 'comments').map(x => x.snapshot_id)).toEqual([
      outcomes.find(x => x.metric === 'comments')!.snapshot_id,
      outcomes.find(x => x.metric === 'comments')!.snapshot_id,
    ])
    rows.own_posts[0].num_comments = 6
    await bridgeCollectedSources(db, 'ivan')
    expect(inserted).toHaveLength(2)
    expect(inserted[1]).toMatchObject({ source_id: 'captured-own-1', seen_version: 2 })
  })
})

const r1Ivan = JSON.parse(readFileSync('../../../content-brain-01-evidence-briefs-2026-09-20-out/research/snapshots/ivan.json', 'utf8'))

describe('Run 1 curated candidate preservation', () => {
  it('keeps unchanged verified 225-send source and gaps that exact source when native evidence changes', async () => {
    const native = structuredClone(r1Ivan.candidates.items.find((x: any) =>
      x.id === '5e82f6a8-c838-4fe0-8edc-1c963a22eca2'))
    const seed = JSON.parse(readFileSync('../../../content-brain-01-evidence-briefs-2026-09-20-out/INITIAL-BATCH-IMPORT.json', 'utf8'))
      .plan[0].records.find((x: any) => x.source_id === native.id)
    const current = new Map([[native.id, { seen_version: 1, snapshot_hash: seed.snapshot_hash ?? 'seed-verified' }]])
    const inserted: Record<string, unknown>[] = []
    const data: Record<string, Record<string, unknown>[]> = {
      own_posts: [], lm_idea_candidates: [native], client_research_findings: [], client_research_study_posts: [],
    }
    const db = {
      from(table: string) {
        let offset = 0; let end = 499
        const q = { select() { return q }, order() { return q }, eq() { return q },
          range(a: number, b: number) { offset = a; end = b; return q },
          then(resolve: (x: unknown) => unknown) {
            const rows = data[table] ?? []
            return Promise.resolve(resolve({ data: rows.slice(offset, end + 1), count: rows.length, error: null }))
          },
          async insert(rows: Record<string, unknown>[]) {
            inserted.push(...rows)
            for (const row of rows) current.set(String(row.source_id), {
              seen_version: Number(row.seen_version), snapshot_hash: String(row.snapshot_hash) })
            return { error: null }
          },
          async upsert() { return { error: null } },
        }
        return q
      },
      async rpc(name: string, args: { p_source_ids?: string[] }) {
        if (name === 'editorial_linked_call_passages') return { data: [], error: null }
        return { data: (args.p_source_ids ?? []).flatMap(id => current.has(id)
          ? [{ source_id: id, ...current.get(id)! }] : []), error: null }
      },
    }
    await bridgeCollectedSources(db, 'ivan')
    expect(inserted.some(x => x.source_id === native.id)).toBe(false)
    native.raw_context = `${native.raw_context} Changed after R1 verification.`
    await bridgeCollectedSources(db, 'ivan')
    expect(inserted).toContainEqual(expect.objectContaining({ source_id: native.id,
      seen_version: 2, passage: null, body_sha256: null,
      gap_state: expect.objectContaining({ reason: 'partial' }) }))
  })
})
