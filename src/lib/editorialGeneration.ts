import type { EditorialBrief, EditorialClientId } from './editorialTypes.ts'
import { isEditorialClientId } from './editorialTypes.ts'

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

export type FinalQaAssessment = {
  assessment_id: string
  verdict: 'accepted' | 'needs_regenerate' | 'rejected'
  reviewed_copy_sha256: string
  reviewer_response_id: string
  reviewer_provenance: 'provider_response'
  proposed_copy?: string
}

const browserSha256 = async (value: string) => [...new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(value),
))].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** Fail-closed acceptance check for the persistence boundary. The reviewer
 * response id and provenance must come from transport metadata outside the
 * model-authored JSON; the model's own claim that it was reviewed is not proof. */
export async function validateFinalQaAcceptance(input: {
  finalCopy: string
  assessment: FinalQaAssessment
  sha256Hex?: (value: string) => Promise<string> | string
}): Promise<FinalQaAssessment & { final_copy_sha256: string }> {
  const { assessment } = input
  if (assessment.verdict !== 'accepted') throw new GenerationBlocked('qa_not_accepted')
  if (assessment.reviewer_provenance !== 'provider_response')
    throw new GenerationBlocked('untrusted_reviewer_provenance')
  if (!assessment.reviewer_response_id?.trim()) throw new GenerationBlocked('missing_reviewer_response_id')
  if (!assessment.assessment_id?.trim()) throw new GenerationBlocked('missing_assessment_id')
  const finalCopySha256 = await (input.sha256Hex ?? browserSha256)(input.finalCopy)
  if (!/^[a-f0-9]{64}$/.test(assessment.reviewed_copy_sha256) ||
    assessment.reviewed_copy_sha256 !== finalCopySha256) throw new GenerationBlocked('qa_copy_hash_mismatch')
  return { ...assessment, final_copy_sha256: finalCopySha256 }
}

export async function buildTransportQaAssessment(input: {
  candidateCopy: string
  providerResponseId: string
  assessmentId: string
  reviewerResult: { decision: 'pass' | 'revised' | 'fail'; final_copy?: string }
  sha256Hex?: (value: string) => Promise<string> | string
}): Promise<FinalQaAssessment> {
  if (!input.providerResponseId.trim()) throw new GenerationBlocked('missing_reviewer_response_id')
  if (!input.assessmentId.trim()) throw new GenerationBlocked('missing_assessment_id')
  const reviewedCopySha256 = await (input.sha256Hex ?? browserSha256)(input.candidateCopy)
  const sameCopy = input.reviewerResult.final_copy === input.candidateCopy
  const verdict = input.reviewerResult.decision === 'pass' && sameCopy ? 'accepted' :
    input.reviewerResult.decision === 'fail' ? 'rejected' : 'needs_regenerate'
  return {
    assessment_id: input.assessmentId,
    verdict,
    reviewed_copy_sha256: reviewedCopySha256,
    reviewer_response_id: input.providerResponseId,
    reviewer_provenance: 'provider_response',
    ...(sameCopy || !input.reviewerResult.final_copy ? {} : { proposed_copy: input.reviewerResult.final_copy }),
  }
}

type FinalCopyInput =
  | { format: 'text' | 'single_image' | 'lm_promo'; copy: string }
  | { format: 'carousel'; caption: string; slides: Array<{ number: number; copy: string; visual_direction: string }> }
  | { format: 'video'; script: string; segments: string[] }
  | { format: 'resource'; material: string }

export function serializeFinalCopy(input: FinalCopyInput): string {
  if (input.format === 'carousel') {
    if (!input.caption.trim() || !input.slides.length || input.slides.some((slide, index) =>
      slide.number !== index + 1 || !slide.copy.trim() || !slide.visual_direction.trim()))
      throw new GenerationBlocked('incomplete_carousel_copy')
    return JSON.stringify(input)
  }
  if (input.format === 'video') {
    if (!input.script.trim() || !input.segments.length || input.segments.some(segment => !segment.trim()))
      throw new GenerationBlocked('incomplete_video_script')
    return JSON.stringify(input)
  }
  if (input.format === 'resource') {
    if (!input.material.trim()) throw new GenerationBlocked('resource_material_missing')
    return input.material
  }
  if (!input.copy.trim()) throw new GenerationBlocked('final_copy_missing')
  return input.copy
}

export type NativeCompletionIdentity = {
  client_id: EditorialClientId
  artifact_id: string
  native_draft_id: string
  request_id: string
  brief_id: string
  brief_version: number
  brief_hash: string
  assessment_id: string
  final_copy_sha256: string
}

export function assertNativeCompletionReadback(value: unknown, expected: NativeCompletionIdentity): NativeCompletionIdentity {
  const row = value as (NativeCompletionIdentity & { dispatch_state?: string; persisted?: boolean }) | null
  if (!row || row.dispatch_state !== 'complete' || row.persisted !== true ||
    Object.entries(expected).some(([key, expectedValue]) => row[key as keyof NativeCompletionIdentity] !== expectedValue))
    throw new GenerationBlocked('native_completion_identity_mismatch')
  return row
}

export type ProviderCallStage = { stage: string; worst_case_calls: number }

export function assessProviderCallBudget(route: GenerationRoute, stages: ProviderCallStage[]) {
  if (!stages.length || stages.some(stage => !stage.stage || !Number.isInteger(stage.worst_case_calls) || stage.worst_case_calls < 0))
    throw new GenerationBlocked('invalid_provider_call_budget')
  const worstCaseCalls = stages.reduce((sum, stage) => sum + stage.worst_case_calls, 0)
  return { route, stages, worst_case_calls: worstCaseCalls, eligible: worstCaseCalls <= 12,
    blocked_reason: worstCaseCalls > 12 ? 'provider_call_ceiling_exceeded' : null }
}

const formatRoute: Record<EditorialBrief['editorial_direction']['format'], GenerationRoute> = {
  text: 'text', single_image: 'text', carousel: 'carousel', video: 'video_script',
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
  const copyOnly = brief.editorial_direction.format === 'carousel' || brief.editorial_direction.format === 'single_image' ||
    (brief.editorial_direction.format === 'lm_promo' && brief.missing_material.length > 0)
  const productionHold = brief.editorial_direction.format === 'single_image' ?
    ['image_asset_pending', ...brief.production.required_materials] :
    brief.editorial_direction.format === 'carousel' ?
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

export type HistoryRow = {
  native_id: string
  qa_failed?: boolean
  is_test?: boolean
  published_at?: string | null
}

export type HistoryRole = 'excluded' | 'negative_only' | 'duplicate_only' | 'positive_precedent'

/** Decides what one past native object may do for the row being generated now.
 * The object under generation can never be its own precedent; a QA-failed or
 * release-test row is a negative example only; an unpublished draft is a
 * duplication check, never evidence that a shape was published and worked. */
export function classifyHistoryRole(row: HistoryRow, currentNativeId: string): { role: HistoryRole; reason: string } {
  if (row.native_id === currentNativeId)
    return { role: 'excluded', reason: 'this is the native object being generated, not its history' }
  if (row.qa_failed || row.is_test)
    return { role: 'negative_only', reason: 'QA-failed or release-test row; usable only as a negative example' }
  if (row.published_at === null || row.published_at === undefined)
    return { role: 'duplicate_only', reason: 'unpublished draft; a duplication check, not published precedent' }
  return { role: 'positive_precedent', reason: 'published row with no QA failure and no test marker' }
}

/** Projects a writer's intended columns onto the destination table's ACTUAL
 * schema, in schema order, and names what it dropped. A column the destination
 * does not have is reported, never silently written. */
export function projectNativeColumns(intended: string[], actualSchemaColumns: string[]):
  { projected: string[]; unknown: string[] } {
  const wanted = new Set(intended)
  return {
    projected: actualSchemaColumns.filter(c => wanted.has(c)),
    unknown: intended.filter(c => !actualSchemaColumns.includes(c)),
  }
}

export type RegisterFloor = {
  id: 'contractions' | 'long_sentences'
  rule: string
  direction: 'minimum'
  minimum: number
  measured: number
  satisfied: boolean
  penalty_if_unmet: string
}

export type RegisterFloorReport = {
  contractions: number
  long_sentences: number
  floors: RegisterFloor[]
  unmet: RegisterFloor[]
  satisfied: boolean
}

// A possessive 's is spelled the same as the contraction, so only the forms that
// cannot be possessive count, plus "it's", which a possessive never takes.
const CONTRACTION = /\b(?:it['’]s|[A-Za-z]+n['’]t|[A-Za-z]+['’](?:re|ve|ll|d|m))\b/gi

/** Applies arch-qa v12's REGISTER FLOORS exactly as the canonical rubric writes
 * them. They are ABSENCE penalties: "zero contractions -> VOICE <= 5" and
 * "no sentence of 17+ words -> RHYTHM <= 5". Each is therefore a MINIMUM of one.
 * Reading either as a cap inverts the rubric and edits copy toward the very
 * violation it penalises, so `direction` is carried in the data and every floor
 * is satisfied by meeting or exceeding its minimum. More is never worse. */
export function evaluateRegisterFloors(copy: string): RegisterFloorReport {
  const text = String(copy ?? '')
  const contractions = (text.match(CONTRACTION) ?? []).length
  const sentences = text.split(/(?<=[.!?])[\s\n]+|\n+/).map(s => s.trim()).filter(Boolean)
  const longSentences = sentences.filter(s => s.split(/\s+/).filter(Boolean).length >= 17).length
  const floors: RegisterFloor[] = [
    { id: 'contractions', direction: 'minimum', minimum: 1, measured: contractions,
      satisfied: contractions >= 1,
      rule: 'arch-qa v12 REGISTER FLOORS: zero contractions -> VOICE <= 5',
      penalty_if_unmet: 'VOICE is capped at 5 when the copy contains no contraction at all' },
    { id: 'long_sentences', direction: 'minimum', minimum: 1, measured: longSentences,
      satisfied: longSentences >= 1,
      rule: 'arch-qa v12 REGISTER FLOORS: no sentence of 17+ words -> RHYTHM <= 5',
      penalty_if_unmet: 'RHYTHM is capped at 5 when no sentence reaches seventeen words' },
  ]
  const unmet = floors.filter(f => !f.satisfied)
  return { contractions, long_sentences: longSentences, floors, unmet, satisfied: unmet.length === 0 }
}
