import crypto from 'node:crypto'

export const REVIEWED_SOURCES = new Set([
  'n8n:F7JHoCI925eSTYar:unipile_post_snapshots',
  'n8n:WdeAmCTQ0ZH65mGs:unipile_post_tracker',
  'n8n:XMuGMZJlcF9pB3Db:own_post_performance_tracker',
  'n8n:rrprmLeoU0pjpEmq:unipile_performance_sync',
])

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function mapAudnObservation(row, conflicts = new Set()) {
  const resolved = ['exact', 'resolved_activity'].includes(row.resolution_status) && row.canonical_post_id
  let unknownReason = null
  if (!resolved) unknownReason = row.unresolved_reason || 'unresolved_publication_identity'
  else if (!REVIEWED_SOURCES.has(row.source)) unknownReason = 'unreviewed_source_scope'
  else if (row.coverage?.impressions !== true) unknownReason = 'impressions_not_retained_by_source'
  else if (row.impressions == null) unknownReason = 'impressions_missing'
  const veto = conflicts.has(`${row.client_id}:${row.id}`) ? 'conflicting_source_replay' : null
  return {
    client_id: row.client_id,
    snapshot_id: `audn:${row.id}:impressions:v1`,
    brief_id: `retrospective:${row.canonical_post_id || row.post_social_id}`,
    artifact_role: 'own_post', metric: 'impressions',
    observed_value: unknownReason ? null : row.impressions,
    unknown_reason: unknownReason, denominator: unknownReason ? null : 'linkedin_impressions',
    scope: `audn:${row.source}`, window_start: row.published_at, window_end: row.captured_at,
    captured_at: row.captured_at, event_definition: 'linkedin_impressions_at_captured_time_v1',
    attribution: 'direct', publication_id: row.canonical_post_id || row.post_social_id,
    source_snapshot_id: row.id, source_payload_hash: hash(row),
    projected_at: null, eligibility_veto_reason: veto,
  }
}

export function mapAudnRows(rows, conflictKeys = []) {
  const conflicts = new Set(conflictKeys)
  return rows.map(row => mapAudnObservation(row, conflicts))
}
