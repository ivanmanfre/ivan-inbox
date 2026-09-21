import { nativeCandidateHash, normalizeCollectorRow, normalizeVerifiedCall } from '../../../src/lib/editorialCollectorBridge.ts'
import type { LinkedFinding, VerifiedCallPassage } from '../../../src/lib/editorialCollectorBridge.ts'
import { editorialSeedBaselines } from '../../../src/lib/editorialSeedBaselines.ts'
import type { EditorialClientId } from '../../../src/lib/editorialTypes.ts'

type Db = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): PromiseLike<any> }
const LIMIT = 10000
const PAGE = 500
const collections: Record<EditorialClientId, Array<{ table: string; order: string; scoped: boolean }>> = {
  ivan: [
    { table: 'own_posts', order: 'id', scoped: false },
    { table: 'lm_idea_candidates', order: 'id', scoped: false },
    { table: 'client_research_findings', order: 'finding_id', scoped: true },
    { table: 'client_research_study_posts', order: 'canonical_source_id', scoped: true },
  ],
  risedtc: [
    { table: 'client_post_metrics', order: 'id', scoped: true },
    { table: 'client_ideas', order: 'id', scoped: true },
    { table: 'client_research_findings', order: 'finding_id', scoped: true },
    { table: 'client_research_study_posts', order: 'canonical_source_id', scoped: true },
  ],
  arch: [
    { table: 'client_post_metrics', order: 'id', scoped: true },
    { table: 'client_ideas', order: 'id', scoped: true },
    { table: 'client_research_findings', order: 'finding_id', scoped: true },
    { table: 'client_research_study_posts', order: 'canonical_source_id', scoped: true },
  ],
}

async function scan(db: Db, table: string, order: string, clientId: EditorialClientId, scoped: boolean) {
  const rows: Record<string, unknown>[] = []
  let total: number | null = null
  for (let offset = 0; offset <= LIMIT; offset += PAGE) {
    let q = db.from(table).select('*', { count: 'exact' })
    if (table === 'client_research_study_posts') q = q.order('study_id')
    q = q.order(order).range(offset, offset + PAGE - 1)
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
  const coverageGaps: string[] = ['Private call candidates without exact client-scoped transcript and passage verification remain excluded.']
  let findings: LinkedFinding[] = []
  for (const spec of collections[clientId]) {
    const rows = await scan(db, spec.table, spec.order, clientId, spec.scoped)
    const isCandidateCollector = spec.table === 'lm_idea_candidates' || spec.table === 'client_ideas'
    const callCandidates = isCandidateCollector ? rows.filter(row =>
      spec.table === 'lm_idea_candidates'
        ? ['ivan_call', 'calls'].includes(String(row.source ?? ''))
        : ['From your sales calls', 'From your calls'].includes(String(row.source_label ?? ''))) : []
    const verified: VerifiedCallPassage[] = []
    for (let i = 0; i < callCandidates.length; i += 500) {
      const { data, error } = await db.rpc('editorial_linked_call_passages', {
        p_gate: 'clientops', p_client_id: clientId,
        p_candidate_ids: callCandidates.slice(i, i + 500).map(x => String(x.id)),
      })
      if (error) throw new Error(`exact call linkage failed: ${error.message}`)
      verified.push(...(data ?? []))
    }
    const linkedIds = new Set(verified.map(x => x.candidate_id))
    if (callCandidates.length > linkedIds.size) coverageGaps.push(`${spec.table}: ${callCandidates.length - linkedIds.size} call candidates lacked exact client-scoped transcript and quote verification`)
    if (spec.table === 'client_research_findings') {
      findings = rows.map(row => ({ study_id: String(row.study_id), finding_id: String(row.finding_id),
        source_ids: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
        kind: String(row.kind ?? ''), metric_id: String(row.metric_id ?? ''),
        observed_value: row.observed_value as number | string | null,
        baseline_value: row.baseline_value as number | string | null,
        baseline_n: row.baseline_n == null ? null : Number(row.baseline_n),
        lift: row.lift as number | string | null, formula: String(row.formula ?? ''),
        method_version: String(row.method_version ?? ''), age_comparability: String(row.age_comparability ?? 'unknown'),
        limitations: Array.isArray(row.limitations) ? row.limitations.map(String) : [],
        validation_state: String(row.validation_state ?? ''), selection_method: row.selection_method == null ? null : String(row.selection_method),
      }))
    }
    const eligible = spec.table === 'lm_idea_candidates'
      ? rows.filter(row => !['kyle_call'].includes(String(row.source ?? '').toLowerCase()) &&
        (!['ivan_call', 'calls'].includes(String(row.source ?? '').toLowerCase()) || linkedIds.has(String(row.id))))
      : rows
    const excludedPrivate = rows.length - eligible.length
    if (excludedPrivate) coverageGaps.push(`${spec.table}: ${excludedPrivate} candidate rows were excluded for unrelated ownership or unverified original passage`)
    const maybeNormalized = await Promise.all(eligible.map(async row => {
      const source = await normalizeCollectorRow(clientId,
        spec.table as Parameters<typeof normalizeCollectorRow>[1], row, observedAt, findings)
      if (!isCandidateCollector) return source
      const baseline = editorialSeedBaselines.find(x => x.client_id === clientId &&
        x.collector === spec.table && x.native_id === String(row.id))
      if (baseline) {
        const nativeHash = await nativeCandidateHash(spec.table as 'lm_idea_candidates' | 'client_ideas', row)
        if (nativeHash === baseline.native_hash) return null // Keep verified R1 source at its immutable ID/version.
        return { ...source, source_id: baseline.source_id, passage: null, body_sha256: null,
          gap_state: { reason: 'partial' as const,
            detail: 'Native candidate changed after the independently verified R1 excerpt; original passage needs re-verification.' },
          snapshot_hash: nativeHash }
      }
      return { ...source, source_id: `candidate-summary:${spec.table}:${row.id}` }
    }))
    const allNormalized = maybeNormalized.filter(x => x !== null)
    if (verified.length) {
      const byTranscript = new Map<string, VerifiedCallPassage[]>()
      for (const passage of verified) byTranscript.set(passage.transcript_id,
        [...(byTranscript.get(passage.transcript_id) ?? []), passage])
      for (const group of byTranscript.values()) allNormalized.push(await normalizeVerifiedCall(clientId, group))
    }
    // One canonical identity may occur in multiple studies. Keep its latest
    // capture; repetitions do not become independent corroboration.
    const byId = new Map<string, typeof allNormalized[number]>()
    const repeatedHashes = new Map<string, string[]>()
    for (const source of allNormalized) {
      const prior = byId.get(source.source_id)
      if (!prior) { byId.set(source.source_id, source); continue }
      repeatedHashes.set(source.source_id, [...(repeatedHashes.get(source.source_id) ?? [prior.snapshot_hash]),
        source.snapshot_hash])
      const newest = source.captured_at > prior.captured_at ? source : prior
      const earlier = newest === source ? prior : source
      const merged = [...(Array.isArray(newest.candidate_fields?.linked_findings)
        ? newest.candidate_fields.linked_findings : []),
      ...(Array.isArray(earlier.candidate_fields?.linked_findings)
        ? earlier.candidate_fields.linked_findings : [])]
      const unique = [...new Map(merged.map(f => [`${f.study_id}:${f.finding_id}`, f])).values()]
      // Repeat captures remain one original author/source. Their distinct
      // study findings survive as context, never as independent sources.
      byId.set(source.source_id, { ...newest,
        candidate_fields: { ...(newest.candidate_fields ?? {}), linked_findings: unique },
        retained_context: `${newest.retained_context}\nEarlier study findings: ${JSON.stringify(unique)}`,
      })
    }
    for (const [id, hashes] of repeatedHashes) {
      const item = byId.get(id)!
      const payload = `${hashes.sort().join(':')}|${JSON.stringify(item.candidate_fields?.linked_findings ?? [])}`
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
      item.snapshot_hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
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
    if (spec.table === 'own_posts' || spec.table === 'client_post_metrics') {
      const outcomeRows = await Promise.all(rows.flatMap(row => {
        const id = String(row.id ?? '')
        const source = normalized.find(s => s.source_id === id)
        if (!source) return []
        const metrics = source.candidate_fields?.observed_metrics as Record<string, unknown> | undefined
        if (!metrics) return []
        return Object.entries(metrics).flatMap(async ([metric, raw]) => {
          const observed = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
          const nativeCapture = spec.table === 'own_posts'
            ? row.metrics_updated_at ? String(row.metrics_updated_at) : row.scraped_at ? String(row.scraped_at) : null
            : row.captured_at ? String(row.captured_at) : null
          const stable = `${clientId}|${spec.table}|${id}|${metric}|${String(raw)}|${nativeCapture ?? 'unknown'}`
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable))
          const suffix = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
          return { client_id: clientId, snapshot_id: `collector-${suffix}`, brief_id: `unattributed-own-post:${id}`,
            brief_version: null, artifact_id: id, artifact_role: 'own_post', metric,
            observed_value: observed, unknown_reason: observed === null ? 'Collector did not retain a valid count' : null,
            denominator: observed === null ? null : 'one exact own post',
            scope: `native ${spec.table}.id=${id}`, window_start: source.source_published_at,
            window_end: nativeCapture, captured_at: nativeCapture ?? observedAt,
            event_definition: `${metric} count captured by ${spec.table}`, attribution: 'unknown',
            limitation: 'Own post observation only; no brief attribution, buyer identity, or commercial conversion inferred.',
            publication_id: String(row.social_id ?? row.linkedin_url ?? '') || null }
        })
      }))
      for (let i = 0; i < outcomeRows.length; i += 100) {
        const { error } = await db.from('editorial_outcome_snapshots').upsert(outcomeRows.slice(i, i + 100),
          { onConflict: 'client_id,snapshot_id', ignoreDuplicates: true })
        if (error) throw new Error(`own outcome snapshot insert failed: ${error.message}`)
      }
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
