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

type LatestSource = { seen_version: number; snapshot_hash: string }
type StagedCollection = { spec: { table: string; order: string; scoped: boolean }; rows: Record<string, unknown>[]; normalized: Awaited<ReturnType<typeof normalizeCollectorRow>>[] }

function nativeKey(source: Awaited<ReturnType<typeof normalizeCollectorRow>>) {
  const identity = source.candidate_fields?.source_identity
  if (identity && typeof identity === 'object') {
    const value = identity as Record<string, unknown>
    if (typeof value.platform === 'string' && typeof value.native_id === 'string') return `${value.platform}:${value.native_id}`
  }
  return source.source_id
}

function sourceMetricObservations(source: Awaited<ReturnType<typeof normalizeCollectorRow>>) {
  const fields = source.candidate_fields ?? {}
  if (Array.isArray(fields.metric_observations)) return fields.metric_observations
  const metrics = fields.observed_metrics
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return []
  const identity = fields.source_identity && typeof fields.source_identity === 'object'
    ? fields.source_identity as Record<string, unknown> : {}
  return [{ collector_row_id: typeof identity.collector_row_id === 'string' ? identity.collector_row_id : source.source_id,
    metric_source: fields.metric_source ?? null, metric_denominator: fields.metric_denominator ?? null,
    observation_window: fields.observation_window ?? null, observed_metrics: metrics,
    raw_observed_metrics: fields.raw_observed_metrics ?? null,
    metric_observation_state: fields.metric_observation_state ?? null }]
}

const stableJson = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) ?? 'null'
  : Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
    : `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`

async function rekeySnapshot(source: Awaited<ReturnType<typeof normalizeCollectorRow>>, sourceId: string,
  candidateFields: Record<string, unknown>) {
  const { snapshot_hash: _oldHash, ...raw } = source
  const rekeyed = { ...raw, source_id: sourceId, candidate_fields: candidateFields }
  const identity = { ...rekeyed, seen_version: undefined,
    captured_at: candidateFields.capture_provenance === 'collector' ? rekeyed.captured_at : undefined }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(identity)))
  const snapshot_hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
  return { ...rekeyed, snapshot_hash }
}

/** Canonicalize after every collector is read. The persisted legacy source id
 * wins when present; otherwise the lexical id makes first import scan-order independent. */
async function canonicalizeClientSources(sources: Awaited<ReturnType<typeof normalizeCollectorRow>>[], existing: Map<string, LatestSource>) {
  const groups = new Map<string, Awaited<ReturnType<typeof normalizeCollectorRow>>[]>()
  for (const source of sources) groups.set(nativeKey(source), [...(groups.get(nativeKey(source)) ?? []), source])
  const canonicalized: Awaited<ReturnType<typeof normalizeCollectorRow>>[] = []
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.source_id.localeCompare(b.source_id))
    const legacy = ordered.find(source => existing.has(source.source_id)) ?? ordered[0]
    const newest = [...ordered].sort((a, b) => b.captured_at.localeCompare(a.captured_at) || a.source_id.localeCompare(b.source_id))[0]
    const linked = ordered.flatMap(source => Array.isArray(source.candidate_fields?.linked_findings)
      ? source.candidate_fields!.linked_findings : [])
    const uniqueLinked = [...new Map(linked.map(f => {
      const value = f as Record<string, unknown>
      return [`${String(value.study_id ?? '')}:${String(value.finding_id ?? '')}`, f]
    })).values()]
    const observations = ordered.flatMap(sourceMetricObservations)
    const uniqueObservations = [...new Map(observations.map(item => [JSON.stringify(item), item])).values()]
    const fields = { ...(newest.candidate_fields ?? {}), linked_findings: uniqueLinked,
      metric_observations: uniqueObservations }
    canonicalized.push(await rekeySnapshot(newest, legacy.source_id, fields))
  }
  return canonicalized
}

/** Read-only to every existing collector. It only appends immutable editorial
 * source versions and records the exact scan cursor before begin_refresh. */
export async function bridgeCollectedSources(db: Db, clientId: EditorialClientId) {
  const observedAt = new Date().toISOString()
  const coverageGaps: string[] = ['Private call candidates without exact client-scoped transcript and passage verification remain excluded.']
  let findings: LinkedFinding[] = []
  const staged: StagedCollection[] = []
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
    const allNormalized = maybeNormalized.filter((x): x is NonNullable<typeof x> => x !== null)
    if (verified.length) {
      const byTranscript = new Map<string, VerifiedCallPassage[]>()
      for (const passage of verified) byTranscript.set(passage.transcript_id,
        [...(byTranscript.get(passage.transcript_id) ?? []), passage])
      for (const group of byTranscript.values()) allNormalized.push(await normalizeVerifiedCall(clientId, group))
    }
    staged.push({ spec, rows, normalized: allNormalized })
  }
  const rawSources = staged.flatMap(stage => stage.normalized)
  const existing = new Map<string, LatestSource>()
  for (let i = 0; i < rawSources.length; i += 500) {
    const lookup = await db.rpc('editorial_latest_source_versions', {
      p_gate: 'clientops', p_client_id: clientId, p_source_ids: rawSources.slice(i, i + 500).map(x => x.source_id),
    })
    if (lookup.error) throw new Error(`editorial source version read failed: ${lookup.error.message}`)
    for (const item of lookup.data ?? []) existing.set(item.source_id, item)
  }
  const normalized = await canonicalizeClientSources(rawSources, existing)
  const changed = normalized.filter(source => existing.get(source.source_id)?.snapshot_hash !== source.snapshot_hash)
    .map(source => ({ ...source, seen_version: Number(existing.get(source.source_id)?.seen_version ?? 0) + 1 }))
  for (let i = 0; i < changed.length; i += 100) {
    const { error } = await db.from('editorial_sources').insert(changed.slice(i, i + 100))
    if (error) throw new Error(`editorial source snapshot insert failed: ${error.message}`)
  }
  for (const { spec, rows, normalized: collectorSources } of staged) {
    if (spec.table === 'own_posts' || spec.table === 'client_post_metrics') {
      const outcomeRows = await Promise.all(rows.flatMap(row => {
        const id = String(row.id ?? '')
        const match = normalized.map(source => ({ source, observation: sourceMetricObservations(source).find(observation =>
          observation && typeof observation === 'object' &&
          (observation as Record<string, unknown>).collector_row_id === id &&
          (observation as Record<string, unknown>).metric_source === spec.table) })).find(item => item.observation)
        if (!match || !match.observation || typeof match.observation !== 'object') return []
        const observation = match.observation as Record<string, unknown>
        const metrics = observation.observed_metrics
        const metricStates = observation.metric_observation_state
        const window = observation.observation_window
        if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics) || !window || typeof window !== 'object') return []
        const dates = window as Record<string, unknown>
        const publishedAt = typeof dates.published_at === 'string' ? dates.published_at : null
        const nativeCapture = typeof dates.captured_at === 'string' ? dates.captured_at : null
        const denominator = typeof observation.metric_denominator === 'string' && observation.metric_denominator.trim()
          ? observation.metric_denominator : null
        if (!publishedAt || !denominator) return []
        return Object.entries(metrics).flatMap(async ([metric, raw]) => {
          const observed = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
          const state = metricStates && typeof metricStates === 'object' && !Array.isArray(metricStates)
            ? (metricStates as Record<string, unknown>)[metric] : null
          const unknownReason = observed === null
            ? state === 'unknown_no_metrics_updated_at'
              ? 'No metrics_updated_at receipt; retained raw value is evaluation-ineligible'
              : 'Collector did not retain a valid count'
            : null
          const stable = `${clientId}|${spec.table}|${id}|${metric}|${String(raw)}|${nativeCapture ?? 'unknown'}`
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable))
          const suffix = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
          return { client_id: clientId, snapshot_id: `collector-${suffix}`, brief_id: `unattributed-own-post:${match.source.source_id}`,
            brief_version: null, artifact_id: match.source.source_id, artifact_role: 'own_post', metric,
            observed_value: observed, unknown_reason: unknownReason,
            denominator: observed === null ? null : denominator,
            scope: `native ${spec.table}.id=${id}`, window_start: publishedAt,
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
    const partial = collectorSources.filter(x => x.gap_state).length
    if (partial) coverageGaps.push(`${spec.table}: ${partial} rows lack verified original body or permission`)
    const cursor = `${rows.length}:${collectorSources.map(x => x.snapshot_hash).sort().join(':')}`
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
