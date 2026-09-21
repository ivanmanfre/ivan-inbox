import { normalizeCollectorRow } from '../../../src/lib/editorialCollectorBridge.ts'
import type { EditorialClientId } from '../../../src/lib/editorialTypes.ts'

type Db = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): PromiseLike<any> }
const LIMIT = 10000
const PAGE = 500
const collections: Record<EditorialClientId, Array<{ table: string; order: string; scoped: boolean }>> = {
  ivan: [
    { table: 'own_posts', order: 'id', scoped: false },
    { table: 'lm_idea_candidates', order: 'id', scoped: false },
    { table: 'client_research_study_posts', order: 'canonical_source_id', scoped: true },
    { table: 'client_research_findings', order: 'finding_id', scoped: true },
  ],
  risedtc: [
    { table: 'client_post_metrics', order: 'id', scoped: true },
    { table: 'client_ideas', order: 'id', scoped: true },
    { table: 'client_research_study_posts', order: 'canonical_source_id', scoped: true },
    { table: 'client_research_findings', order: 'finding_id', scoped: true },
  ],
  arch: [
    { table: 'client_post_metrics', order: 'id', scoped: true },
    { table: 'client_ideas', order: 'id', scoped: true },
    { table: 'client_research_study_posts', order: 'canonical_source_id', scoped: true },
    { table: 'client_research_findings', order: 'finding_id', scoped: true },
  ],
}

async function scan(db: Db, table: string, order: string, clientId: EditorialClientId, scoped: boolean) {
  const rows: Record<string, unknown>[] = []
  let total: number | null = null
  for (let offset = 0; offset <= LIMIT; offset += PAGE) {
    let q = db.from(table).select('*', { count: 'exact' }).order(order).range(offset, offset + PAGE - 1)
    if (scoped) q = q.eq('client_id', clientId)
    const result = await q
    if (result.error) throw new Error(`collector ${table} unreadable: ${result.error.message}`)
    if (total === null) total = result.count
    if (total === null) throw new Error(`collector ${table} gave no exact count`)
    rows.push(...(result.data ?? []))
    if (rows.length >= total) break
    if (rows.length >= LIMIT) throw new Error(`collector ${table} exceeded bounded ${LIMIT}-row read; no refresh was started`)
  }
  if (rows.length !== total) throw new Error(`collector ${table} page count ${rows.length} differs from exact ${total}`)
  return rows
}

/** Read-only to every existing collector. It only appends immutable editorial
 * source versions and records the exact scan cursor before begin_refresh. */
export async function bridgeCollectedSources(db: Db, clientId: EditorialClientId) {
  const observedAt = new Date().toISOString()
  const coverageGaps: string[] = ['Unlinked private transcripts are excluded: no exact registry client link is available.']
  for (const spec of collections[clientId]) {
    const rows = await scan(db, spec.table, spec.order, clientId, spec.scoped)
    const eligible = spec.table === 'lm_idea_candidates'
      ? rows.filter(row => !['kyle_call', 'calls'].includes(String(row.source ?? '').toLowerCase()))
      : rows
    const excludedPrivate = rows.length - eligible.length
    if (excludedPrivate) coverageGaps.push(`${spec.table}: ${excludedPrivate} private-call candidates have no exact Ivan ownership and were excluded`)
    const allNormalized = await Promise.all(eligible.map(row => normalizeCollectorRow(clientId,
      spec.table as Parameters<typeof normalizeCollectorRow>[1], row, observedAt)))
    // One canonical identity may occur in multiple studies. Keep its latest
    // capture; repetitions do not become independent corroboration.
    const byId = new Map<string, typeof allNormalized[number]>()
    for (const source of allNormalized) {
      const prior = byId.get(source.source_id)
      if (!prior || source.captured_at > prior.captured_at) byId.set(source.source_id, source)
    }
    const normalized = [...byId.values()]
    const existing = new Map<string, { seen_version: number; snapshot_hash: string }>()
    for (let i = 0; i < normalized.length; i += 500) {
      const ids = normalized.slice(i, i + 500).map(x => x.source_id)
      const lookup = await db.rpc('editorial_latest_source_versions', {
        p_gate: 'clientops', p_client_id: clientId, p_source_ids: ids,
      })
      if (lookup.error) throw new Error(`editorial source version read failed: ${lookup.error.message}`)
      for (const item of lookup.data ?? []) existing.set(item.source_id, item)
    }
    const changed = normalized.filter(source => existing.get(source.source_id)?.snapshot_hash !== source.snapshot_hash)
      .map(source => ({ ...source, seen_version: Number(existing.get(source.source_id)?.seen_version ?? 0) + 1 }))
    for (let i = 0; i < changed.length; i += 100) {
      const { error } = await db.from('editorial_sources').insert(changed.slice(i, i + 100))
      if (error) throw new Error(`editorial source snapshot insert failed: ${error.message}`)
    }
    const partial = normalized.filter(x => x.gap_state).length
    if (partial) coverageGaps.push(`${spec.table}: ${partial} rows lack verified original body or permission`)
    const cursor = `${rows.length}:${normalized.map(x => x.snapshot_hash).sort().join(':')}`
    const bytes = new TextEncoder().encode(cursor)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const cursorHash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
    const { error: cursorError } = await db.from('editorial_collector_cursors').upsert({
      client_id: clientId, collector: spec.table, cursor: cursorHash, row_count: rows.length,
      coverage_gap: partial ? `${partial} partial rows` : null, observed_at: observedAt,
    })
    if (cursorError) throw new Error(`collector cursor write failed: ${cursorError.message}`)
  }
  return { coverageGaps, observedAt }
}
