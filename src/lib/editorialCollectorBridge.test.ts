import { describe, expect, it } from 'vitest'
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
          async upsert(cursor: Record<string, unknown>) { cursors.push(cursor); return { error: null } },
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
    expect(first.coverageGaps.join(' ')).toContain('private-call candidates')
    await new Promise(resolve => setTimeout(resolve, 10))
    await bridgeCollectedSources(db, 'ivan')
    expect(inserted).toHaveLength(1)
    expect(cursors).toHaveLength(8)
    rows.own_posts[0].num_comments = 6
    await bridgeCollectedSources(db, 'ivan')
    expect(inserted).toHaveLength(2)
    expect(inserted[1]).toMatchObject({ source_id: 'captured-own-1', seen_version: 2 })
  })
})
