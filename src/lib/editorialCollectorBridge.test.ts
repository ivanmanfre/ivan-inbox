import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bridgeCollectedSources } from '../../supabase/functions/editorial-refresh/bridge'

const rows: Record<string, Record<string, unknown>[]> = {
  own_posts: [{ id: 'captured-own-1', post_text: 'The captured original post body.',
    posted_at: '2026-09-18T10:00:00Z', num_comments: 5, num_impressions: 240 }],
  lm_idea_candidates: [{ id: 'unscoped-call', source: 'kyle_call', raw_context: 'private third-party transcript' }],
  client_research_study_posts: [], client_research_findings: [],
}

describe('collector bridge', () => {
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
