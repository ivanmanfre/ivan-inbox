import type { EditorialClientId } from './editorialTypes.ts'
import { resolveEvidenceCompleteness } from './editorialEvidenceCompleteness.ts'

export type CollectorName = 'own_posts' | 'client_post_metrics' | 'lm_idea_candidates' |
  'client_ideas' | 'client_research_study_posts' | 'client_research_findings'
export type CollectorRow = Record<string, unknown>
export type LinkedFinding = {
  study_id: string; finding_id: string; source_ids: string[]; kind: string; metric_id: string
  observed_value: number | string | null; baseline_value: number | string | null; baseline_n: number | null
  lift: number | string | null; formula: string; method_version: string; age_comparability: string
  limitations: string[]; validation_state: string; selection_method: string | null
}
export type VerifiedCallPassage = {
  candidate_id: string; transcript_id: string; transcript_date: string; transcript_sha256: string
  excerpt: string; permission_state: 'granted' | 'unknown'; participants: string[] | null
  transcript_source: string
}
export type NormalizedSnapshot = {
  client_id: EditorialClientId; source_id: string; seen_version: number; source_kind: string
  source_client_scope: string; source_url: string | null; excerpt_pointer: string | null
  owner: string; source_published_at: string | null; published_date_state: 'known' | 'unknown'
  captured_at: string; body_sha256: string | null; passage: string | null
  retained_context: string; limitation: string; independent: boolean; derived_from: string | null
  permission_state: 'granted' | 'public_source' | 'unknown'; gap_state: { reason: 'partial' | 'unavailable'; detail: string } | null
  candidate_fields: Record<string, unknown> | null; snapshot_hash: string
}

const val = (x: unknown) => x == null ? '' : String(x)
const date = (x: unknown) => {
  const n = Date.parse(val(x))
  return Number.isFinite(n) ? new Date(n).toISOString() : null
}
const hash = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(x => x.toString(16).padStart(2, '0')).join('')
const canonical = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null'
  : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
    : `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`

function bodyProvenance(collector: CollectorName, row: CollectorRow, body: string | null) {
  if (!body) return null
  if (typeof row.body_provenance === 'string' && row.body_provenance.trim()) return row.body_provenance
  if (collector === 'own_posts' && typeof row.post_text === 'string') return 'own_posts.post_text'
  if (collector === 'client_post_metrics' && typeof row.full_text === 'string') return 'client_post_metrics.full_text'
  if (collector === 'client_research_study_posts' && typeof row.post_text === 'string') return 'client_research_study_posts.post_text'
  return null
}

function nativeRecovery(row: CollectorRow) {
  const raw = row.native_body_recovery
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  return typeof value.source_id === 'string' && typeof value.native_id === 'string' &&
    typeof value.body_chars === 'number' && typeof value.body_sha256 === 'string' &&
    typeof value.exact_prefix_match === 'boolean' && typeof value.exact_body_match === 'boolean'
    ? value as Parameters<typeof resolveEvidenceCompleteness>[0]['native']
    : null
}

export async function nativeCandidateHash(collector: 'lm_idea_candidates' | 'client_ideas', row: CollectorRow) {
  const fields = collector === 'lm_idea_candidates'
    ? { evidence: row.evidence ?? null, raw_context: row.raw_context ?? null, source_ref: row.source_ref ?? null }
    : { idea: row.idea ?? null, score_breakdown: row.score_breakdown ?? null,
      source_ref: row.source_ref ?? null, meta: row.meta ?? null }
  return hash(canonical(fields))
}

/** A collector row is evidence only when the retained original text exists. Candidate
 * summaries and findings remain visible Research records with explicit partial gaps. */
export async function normalizeCollectorRow(clientId: EditorialClientId, collector: CollectorName,
  row: CollectorRow, observedAt: string, linkedFindings: LinkedFinding[] = []): Promise<NormalizedSnapshot> {
  let id = '', kind = '', url: string | null = null, pointer: string | null = null
  let owner = '', published: string | null = null, captured: string | null = null
  let body: string | null = null, context = '', limitation = '', permission: NormalizedSnapshot['permission_state'] = 'unknown'
  let gap: NormalizedSnapshot['gap_state'] = null, fields: Record<string, unknown> | null = null
  if (collector === 'own_posts') {
    if (clientId !== 'ivan') throw new Error('own_posts is explicitly scoped to the Ivan lane')
    id = val(row.id); kind = 'own_post'; url = val(row.linkedin_url) || null
    pointer = url ? null : `own_posts.id=${id}`; owner = 'Ivan Manfredi'
    const metricsUpdated = date(row.metrics_updated_at)
    published = date(row.posted_at); captured = metricsUpdated ?? date(row.scraped_at)
    body = val(row.post_text) || null; permission = 'granted'
    const rawMetrics = { likes: row.num_likes ?? null, comments: row.num_comments ?? null,
      shares: row.num_shares ?? null, impressions: row.num_impressions ?? null,
      profile_views: row.profile_views_from_post ?? null,
      followers_gained: row.followers_gained_from_post ?? null }
    const observedMetrics = Object.fromEntries(Object.entries(rawMetrics)
      .map(([metric, value]) => [metric, metricsUpdated ? value : null]))
    const metricState = Object.fromEntries(Object.entries(rawMetrics).map(([metric, value]) => [metric,
      !metricsUpdated ? 'unknown_no_metrics_updated_at'
        : value == null ? 'unknown_not_retained' : 'observed_metrics_updated_at']))
    context = `Observed own post; likes=${val(observedMetrics.likes) || 'unknown'}, comments=${val(observedMetrics.comments) || 'unknown'}, shares=${val(observedMetrics.shares) || 'unknown'}, impressions=${val(observedMetrics.impressions) || 'unknown'}.`
    limitation = 'Own outcome counts need a stated denominator and observation window before use as a claim.'
    fields = { observed_metrics: observedMetrics, raw_observed_metrics: rawMetrics,
      metric_observation_state: metricState, observation_window: { published_at: published,
      captured_at: captured, metrics_updated_at: metricsUpdated }, metric_source: 'own_posts', metric_denominator: 'one exact own post',
      source_identity: { platform: 'linkedin', native_id: val(row.social_id) || id, collector_row_id: id } }
  } else if (collector === 'client_post_metrics') {
    if (row.client_id !== clientId) throw new Error('client_post_metrics tenant mismatch')
    const meta = row.meta && typeof row.meta === 'object' ? row.meta as Record<string, unknown> : {}
    const collectorRowId = val(row.id)
    id = collectorRowId; kind = 'own_post'; url = val(row.post_url) || null
    pointer = url ? null : `client_post_metrics.id=${id}`
    owner = clientId === 'risedtc' ? 'Mattan Danino / RISE DTC' : 'Davorin Smit / ARCH'
    published = date(row.published_at); captured = date(row.captured_at)
    body = val(row.full_text ?? meta.text) || null; permission = 'granted'
    context = `Observed own post; impressions=${val(row.impressions) || 'unknown'}, reactions=${val(row.reactions) || 'unknown'}, comments=${val(row.comments) || 'unknown'}.`
    limitation = 'Own outcome counts need an observation window and cannot establish causality.'
    fields = { observed_metrics: { impressions: row.impressions ?? null, reactions: row.reactions ?? null,
      comments: row.comments ?? null, shares: row.shares ?? null,
      profile_views: row.profile_views_from_post ?? null,
      followers_gained: row.followers_gained_from_post ?? null,
      inbound_dms: row.inbound_dms ?? null }, observation_window: {
        published_at: published, captured_at: captured }, metric_source: 'client_post_metrics',
      metric_denominator: 'one exact own post',
      source_identity: { platform: 'linkedin', native_id: val(row.social_id ?? meta.social_id ?? meta.id) || id, collector_row_id: collectorRowId } }
  } else if (collector === 'client_research_study_posts') {
    if (row.client_id !== clientId) throw new Error('study post tenant mismatch')
    id = val(row.canonical_source_id); kind = 'public_post'; url = val(row.source_url) || null
    pointer = url ? null : `client_research_study_posts:${val(row.study_id)}:${id}`
    owner = val(row.author_id) || 'unknown author'; published = date(row.published_at)
    captured = date(row.last_captured_at) ?? date(row.first_captured_at)
    body = val(row.post_text) || null; permission = url ? 'public_source' : 'unknown'
    const observations = row.observed_metrics && typeof row.observed_metrics === 'object' ? row.observed_metrics : {}
    const exactFindings = linkedFindings.filter(f => f.study_id === val(row.study_id) &&
      f.source_ids.length === 1 && f.source_ids[0] === id &&
      ['computed', 'validated'].includes(f.validation_state))
    context = `Study ${val(row.study_id)}; population=${val(row.population)}; inclusion=${val(row.inclusion)}; ` +
      `author=${owner}; observed_metrics=${canonical(observations)}; linked_single_source_findings=${canonical(exactFindings)}.`
    limitation = 'Market performance belongs to the original author; source age and study selection limit transfer.'
    fields = { observed_metrics: observations, linked_findings: exactFindings,
      age_comparability: row.age_comparability ?? 'unknown', population: row.population ?? 'unknown',
      inclusion: row.inclusion ?? 'unknown', study_id: row.study_id,
      metric_source: 'client_research_study_posts', metric_denominator: row.population ?? null,
      observation_window: { published_at: published, captured_at: captured },
      source_identity: { platform: 'linkedin', native_id: id, collector_row_id: id } }
  } else if (collector === 'lm_idea_candidates') {
    if (clientId !== 'ivan') throw new Error('lm_idea_candidates is explicitly scoped to the Ivan lane')
    id = val(row.id); kind = 'candidate'; pointer = `lm_idea_candidates.id=${id}`
    owner = 'Ivan editorial candidate'; captured = date(row.ingested_at) ?? date(row.created_at)
    context = val(row.raw_context); limitation = 'Candidate summary is derived; original source body and publication date are not verified here.'
    gap = { reason: 'partial', detail: 'Original post or call passage must be retrieved before this candidate can support a factual claim.' }
    fields = { evidence: row.evidence ?? '', raw_context: row.raw_context ?? '',
      editorial_assessment: row.editorial_assessment ?? '', editorial_strength: row.editorial_strength ?? '',
      angle_options: row.angle_options ?? [] }
  } else if (collector === 'client_ideas') {
    if (row.client_id !== clientId) throw new Error('client_ideas tenant mismatch')
    id = val(row.id); kind = 'candidate'; pointer = `client_ideas.id=${id}`
    owner = `${clientId} editorial candidate`; captured = date(row.created_at)
    context = val(row.idea); limitation = 'Idea is derived; source passage and permission need separate verification.'
    gap = { reason: 'partial', detail: 'Original source body was not retained in this idea row.' }
    fields = { evidence: row.idea ?? '', raw_context: row.meta ?? {},
      editorial_assessment: row.score_breakdown ?? {}, editorial_strength: row.icp_score ?? 'unknown',
      angle_options: row.taxonomy ?? [] }
  } else {
    if (row.client_id !== clientId) throw new Error('research finding tenant mismatch')
    id = `finding:${val(row.study_id)}:${val(row.finding_id)}`; kind = 'market_study'
    pointer = `client_research_findings:${val(row.study_id)}:${val(row.finding_id)}`
    owner = 'Study authors as recorded in linked source posts'; captured = date(row.created_at)
    context = `Finding ${val(row.metric_id)}: observed=${val(row.observed_value) || 'unknown'}, baseline=${val(row.baseline_value) || 'unknown'}; method=${val(row.method_version)}.`
    limitation = 'Aggregate finding must be traced to its original study posts and denominator before claim use.'
    gap = { reason: 'partial', detail: 'Aggregate finding is not the original post body.' }
  }
  if (!id) throw new Error(`${collector} row lacks a native identity`)
  if (!body && !gap) gap = { reason: 'unavailable', detail: 'Original body is absent from the collector row.' }
  const provenance = bodyProvenance(collector, row, body)
  const completeness = resolveEvidenceCompleteness({
    body,
    declaredState: row.body_state ?? (provenance ? 'full' : undefined),
    collectionProvenance: provenance,
    fetchFailed: gap?.reason === 'unavailable',
    native: nativeRecovery(row),
  })
  fields = { ...(fields ?? {}), body_state: completeness.bodyState,
    body_provenance: provenance,
    capture_provenance: captured ? 'collector' : 'bridge_observed' }
  const hasNativeCapture = Boolean(captured)
  const source = {
    client_id: clientId, source_id: id, seen_version: 1, source_kind: kind,
    source_client_scope: kind === 'public_post' ? 'public' : clientId,
    source_url: url, excerpt_pointer: pointer, owner, source_published_at: published,
    published_date_state: published ? 'known' as const : 'unknown' as const,
    captured_at: captured ?? observedAt, body_sha256: body ? await hash(body) : null,
    passage: body, retained_context: context, limitation, independent: kind !== 'candidate',
    derived_from: kind === 'candidate' ? `${collector}:${id}` : null,
    permission_state: permission, gap_state: gap, candidate_fields: fields,
  }
  const identity = { ...source, seen_version: undefined,
    captured_at: hasNativeCapture ? source.captured_at : undefined }
  return { ...source, snapshot_hash: await hash(canonical(identity)) }
}

/** One original transcript remains one independent source even when several
 * candidate rows quote it. The server verifies each quote against the original. */
export async function normalizeVerifiedCall(clientId: EditorialClientId,
  passages: VerifiedCallPassage[]): Promise<NormalizedSnapshot> {
  if (!passages.length || passages.some(p => p.transcript_id !== passages[0].transcript_id)) {
    throw new Error('verified call needs one exact transcript identity')
  }
  const id = passages[0].transcript_id
  const quotes = [...new Set(passages.map(p => p.excerpt.trim()).filter(Boolean))]
  if (!quotes.length) throw new Error('verified call lacks exact excerpt')
  const body = quotes.join('\n\n[Verified separate passage from the same call]\n\n')
  const captured = date(passages[0].transcript_date)
  if (!captured) throw new Error('verified call lacks native date')
  const privateNames = [...new Set(passages.flatMap(p => p.participants ?? []))]
  const source = {
    client_id: clientId, source_id: id, seen_version: 1, source_kind: 'call',
    source_client_scope: clientId, source_url: null,
    excerpt_pointer: `transcripts.id=${id}; verified-candidates=${passages.map(p => p.candidate_id).sort().join(',')}`,
    owner: `${clientId} private call`, source_published_at: captured,
    published_date_state: 'known' as const, captured_at: captured, body_sha256: await hash(body),
    passage: body,
    retained_context: 'Exact quoted passages verified inside one original transcript; participant identities withheld from model context.',
    limitation: 'Internal evidence only. Public identities, quotes and consent require separate review.',
    independent: true, derived_from: null,
    permission_state: passages.every(p => p.permission_state === 'granted') ? 'granted' as const : 'unknown' as const,
    gap_state: null,
    candidate_fields: { transcript_sha256: passages[0].transcript_sha256,
      candidate_ids: passages.map(p => p.candidate_id).sort(), private_names: privateNames,
      transcript_source: passages[0].transcript_source, body_state: 'full',
      body_provenance: 'verified_transcript_passage', capture_provenance: 'collector',
      source_identity: { platform: 'transcript', native_id: id, collector_row_id: id } },
  }
  return { ...source, snapshot_hash: await hash(canonical({ ...source, seen_version: undefined })) }
}
