import type { EditorialBrief, EditorialClientId } from './editorialTypes'
import { isEditorialClientId } from './editorialTypes'

export type GenerationRoute = 'text' | 'carousel' | 'video_script' | 'resource' | 'promotion' | 'regeneration'

export type GenerationEnvelope = {
  schema: 'editorial-generation-v1'
  route: GenerationRoute
  client_id: EditorialClientId
  brief_id: string
  brief_version: number
  brief_hash: string
  artifact_role: string
  request_id: string
  source_cutoff: string
  direction_version: string
  source_ids: string[]
  permitted_claim_ids: string[]
  brief: EditorialBrief
  prior_generation: unknown | null
  production_hold: string[]
  copy_only: boolean
}

export class GenerationBlocked extends Error {
  readonly reason: string
  constructor(reason: string) { super(reason); this.reason = reason }
}

const formatRoute: Record<EditorialBrief['editorial_direction']['format'], GenerationRoute> = {
  text: 'text', carousel: 'carousel', video: 'video_script',
  resource: 'resource', lm_promo: 'promotion',
}

/** Build once before the first model call. The same object must travel through
 * drafting, QA, regeneration and persistence; a later brief read is not safe. */
export function buildGenerationEnvelope(input: {
  brief: EditorialBrief
  clientId: string
  expectedHash: string
  artifactRole: string
  requestId: string
  route?: GenerationRoute
  priorGeneration?: unknown
}): GenerationEnvelope {
  const { brief, clientId, expectedHash, artifactRole, requestId } = input
  if (!isEditorialClientId(clientId) || brief.identity.client_id !== clientId) throw new GenerationBlocked('wrong_client')
  if (!requestId || !artifactRole || !brief.identity.brief_id || brief.identity.version < 1) throw new GenerationBlocked('invalid_identity')
  if (brief.identity.content_hash !== expectedHash) throw new GenerationBlocked('content_hash_mismatch')
  const route = input.route ?? formatRoute[brief.editorial_direction.format]
  if (route !== 'regeneration' && route !== formatRoute[brief.editorial_direction.format]) throw new GenerationBlocked('format_route_mismatch')
  const sourceIds = new Set(brief.evidence.filter(e => e.gap_state === null && e.passage &&
    (e.source_client_scope === 'public' || e.source_client_scope === clientId) &&
    (e.permission_state === undefined || e.permission_state === 'public_source' || e.permission_state === 'granted' ||
      (e.permission_state === 'unknown' && e.source_kind === 'call' && e.source_client_scope === clientId)))
    .map(e => e.source_id))
  if (!sourceIds.size) throw new GenerationBlocked('no_permitted_source')
  const permittedClaims = brief.claim_ledger.filter(c => c.supporting_refs.length > 0 &&
    c.supporting_refs.every(ref => brief.evidence.some(e => e.evidence_id === ref && sourceIds.has(e.source_id))))
  if (!permittedClaims.length) throw new GenerationBlocked('no_permitted_claim')
  const needsResource = route === 'promotion' || (route === 'regeneration' && brief.editorial_direction.format === 'lm_promo')
  if (needsResource && (brief.resource.readiness !== 'ready' || !brief.resource.asset_id ||
    !brief.resource.version || brief.resource.required_missing_material.length)) throw new GenerationBlocked('resource_not_ready')
  if (brief.readiness !== 'ready_to_draft' || brief.missing_material.length) {
    // Slide rendering and recording can remain production work; factual proof,
    // permission or a promised resource cannot be waived by a copy-only label.
    const carouselCopy = brief.editorial_direction.format === 'carousel' &&
      brief.missing_material.every(m => /render|visual|design|image|photo|pdf|go\/no-go|carousel.*format history/i.test(m))
    // A verified existing resource may support an internal ungated alternative
    // while the scheduled comment-gated post remains held. This is an internal
    // copy draft, never a decision to change a live delivery route.
    const heldPromoCopy = brief.editorial_direction.format === 'lm_promo' &&
      brief.resource.readiness === 'ready' && /ungated|direct/i.test(brief.resource.access_route) &&
      brief.missing_material.every(m => /cta|gate|canonical|record|final post|final copy|draft title|scheduled/i.test(m))
    const allowed = carouselCopy || heldPromoCopy
    if (!allowed) throw new GenerationBlocked('essential_material_missing')
  }
  const copyOnly = brief.editorial_direction.format === 'carousel' ||
    (brief.editorial_direction.format === 'lm_promo' && brief.missing_material.length > 0)
  const productionHold = brief.editorial_direction.format === 'carousel' ?
    ['rendered_deck_unverified', ...brief.missing_material] :
    brief.editorial_direction.format === 'video' ? ['recording_pending'] :
    brief.editorial_direction.format === 'lm_promo' ? [...brief.missing_material] : []
  if (brief.evidence.some(e => e.source_kind === 'call' && e.source_client_scope === clientId &&
      e.permission_state === 'unknown')) productionHold.push('call_public_use_permission_unresolved')
  return {
    schema: 'editorial-generation-v1', route, client_id: clientId,
    brief_id: brief.identity.brief_id, brief_version: brief.identity.version,
    brief_hash: expectedHash, artifact_role: artifactRole, request_id: requestId,
    source_cutoff: brief.identity.source_cutoff, direction_version: brief.purpose.direction_version,
    source_ids: [...sourceIds], permitted_claim_ids: permittedClaims.map(c => c.claim_id),
    brief, prior_generation: input.priorGeneration ?? null,
    production_hold: productionHold, copy_only: copyOnly,
  }
}

/** Existing workflows have rich lane-specific context. Add the immutable brief
 * without replacing any legacy fields, then assert its identity at each stage. */
export function attachEnvelope<T extends Record<string, unknown>>(legacy: T, envelope: GenerationEnvelope): T & { editorial_generation: GenerationEnvelope } {
  if ('editorial_generation' in legacy) throw new GenerationBlocked('duplicate_envelope')
  return { ...legacy, editorial_generation: envelope }
}

export function assertEnvelopeAtStage(value: unknown, expected: Pick<GenerationEnvelope,
  'client_id' | 'brief_id' | 'brief_version' | 'brief_hash' | 'request_id'>): GenerationEnvelope {
  const e = (value as { editorial_generation?: GenerationEnvelope } | null)?.editorial_generation
  if (!e || e.schema !== 'editorial-generation-v1' ||
    e.client_id !== expected.client_id || e.brief_id !== expected.brief_id ||
    e.brief_version !== expected.brief_version || e.brief_hash !== expected.brief_hash ||
    e.request_id !== expected.request_id) throw new GenerationBlocked('brief_lineage_lost')
  return e
}
