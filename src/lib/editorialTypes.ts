/* ==========================================================================
   src/lib/editorialTypes.ts — the SHARED, frozen vocabulary of the editorial
   brief contract (content-brain-01, Run 1).

   Two adapters import from here and nothing else shares their types:
     · editorialBriefs.ts   (brief side:  readBriefs / readBrief /
                             recordEditorialDecision / readBriefOutcomes)
     · editorialSources.ts  (source side: readResearch)

   WHY A SEPARATE TYPES MODULE. The two adapters are written by two different
   seats in parallel, and they must agree on SourcePage, EditorialBrief,
   DecisionReceipt, OutcomeRead, Batch, InputManifest, RefreshReceipt and
   RefreshState byte-for-byte, because CONTRACT.json freezes those eight
   schemas for Run 2. One module, imported by both, is the only way that
   agreement survives an edit on either side.

   TENANCY, STATED ONCE.
   `client_id` in this contract is ALWAYS the non-null lane id that
   `client_registry` carries — 'ivan', 'risedtc', 'arch'. Ivan is 'ivan' here.
   The `client_id IS NULL` convention that means Ivan elsewhere in this system
   belongs to the OUTREACH tables (outreach_prospects / campaigns) and is
   deliberately NOT mirrored into the editorial contract: a nullable tenant key
   cannot lead a primary key, cannot be compared by a row-level policy without
   a three-valued-logic hole, and would make `where client_id = p_client_id`
   silently match nothing for the one lane that matters most. The editorial
   tables therefore declare `client_id text not null` and this module refuses
   any caller-supplied id that is not in the explicit registry below.

   UNKNOWN IS A VALUE. Where a date or a number is genuinely not known, the
   string 'unknown' is carried and the reason travels in the sibling
   `limitation` / `unknowns[]` field. Never 0, never null-as-a-date, never an
   ingest timestamp standing in for a publication date.

   NOTHING HERE TALKS TO THE NETWORK. This module is types, frozen constants
   and pure helpers only. Every read/write goes through an injected
   supabase-like client passed to the adapters — see `EditorialClient`.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Registry and identity
   ------------------------------------------------------------------------- */

/** The explicit client registry for this contract. Scope comes from this list
    and from `client_registry` server-side — never from a path substring, a cwd
    or a session id. A caller-supplied id outside this set is rejected BEFORE
    any query is issued (contract-tests T02). */
export const EDITORIAL_CLIENTS = ['ivan', 'risedtc', 'arch'] as const
export type EditorialClientId = (typeof EDITORIAL_CLIENTS)[number]

export function isEditorialClientId(v: unknown): v is EditorialClientId {
  return typeof v === 'string' && (EDITORIAL_CLIENTS as readonly string[]).includes(v)
}

/** The literal a field carries when the fact is genuinely unknown. */
export const UNKNOWN = 'unknown'
export type Unknown = typeof UNKNOWN

/** A date that may honestly be unknown: an ISO-8601 string or the literal
    'unknown'. Never `null`, never `0`, never a guessed date. */
export type MaybeDate = string | Unknown

export function isUnknown(v: unknown): v is Unknown {
  return v === UNKNOWN
}

/* -------------------------------------------------------------------------
   Frozen enumerations. These exact strings are the database check-constraint
   values in db/105_editorial_brief_contract.sql — change one and the other
   must change with it.
   ------------------------------------------------------------------------- */

export const EVIDENCE_RELATIONS = [
  'supports_buyer_concern',
  'supports_claim',
  'observed_own_performance',
  'observed_market_performance',
  'supplies_format_inspiration',
  'supplies_asset_proof',
  'contradicts_claim',
] as const
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number]

export const SOURCE_KINDS = [
  'candidate', 'market_study', 'call', 'own_post', 'asset', 'public_post',
] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const BRIEF_KINDS = ['post', 'resource', 'promotion', 'video_script'] as const
export type BriefKind = (typeof BRIEF_KINDS)[number]

export const BRIEF_STATUSES = ['proposed', 'shortlisted', 'deferred', 'rejected'] as const
export type BriefStatus = (typeof BRIEF_STATUSES)[number]

export const DECISION_ACTIONS = [
  'shortlist', 'defer', 'reject', 'edit', 'pin', 'dismiss', 'restore', 'accept_direction',
] as const
export type DecisionAction = (typeof DECISION_ACTIONS)[number]

/** The scope a decision binds. A rejection scoped to `angle` does not ban the
    topic; a skipped card produces no decision row at all. */
export const DECISION_SCOPES = [
  'candidate', 'angle', 'format', 'source', 'client_direction',
] as const
export type DecisionScope = (typeof DECISION_SCOPES)[number]

export const DECISION_TARGET_KINDS = ['brief', 'source', 'client_direction'] as const
export type DecisionTargetKind = (typeof DECISION_TARGET_KINDS)[number]

/** unseen → seen / pinned / dismissed. Kept deliberately SEPARATE from the
    legacy `lm_idea_candidates.status` / `client_ideas.status` vocabulary: no
    value here can ever satisfy a generator's pickup predicate. */
export const CURATION_STATES = ['unseen', 'seen', 'pinned', 'dismissed'] as const
export type CurationState = (typeof CURATION_STATES)[number]

export const BATCH_STATUSES = [
  'queued', 'running', 'complete', 'partial', 'empty', 'failed',
] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

/** Only these two may be promoted to the current-suggestion pointer. An empty
    or failed refresh keeps the last usable batch. */
export const PROMOTABLE_BATCH_STATUSES: readonly BatchStatus[] = ['complete', 'partial']

export const CURRENCY_STATES = ['current', 'historical', 'unknown'] as const
export type CurrencyState = (typeof CURRENCY_STATES)[number]

export const GAP_REASONS = [
  'permission_denied', 'unavailable', 'expired', 'partial',
] as const
export type GapReason = (typeof GAP_REASONS)[number]

export const PERMISSION_STATES = [
  'public_source', 'granted', 'denied', 'unknown', 'withheld',
] as const
export type PermissionState = (typeof PERMISSION_STATES)[number]

export const READINESS_STATES = ['ready_to_draft', 'needs_material'] as const
export type BriefReadiness = (typeof READINESS_STATES)[number]

export const RESOURCE_READINESS = ['ready', 'needs_material', 'not_needed'] as const
export type ResourceReadiness = (typeof RESOURCE_READINESS)[number]

/** The read state of a page. `empty` is a CONFIRMED empty population; `failed`
    is an unread surface. They are never collapsed into each other — same rule
    contentEvidence.ts states for its four view reads. */
export const PAGE_STATES = ['ready', 'partial', 'empty', 'stale', 'failed'] as const
export type PageState = (typeof PAGE_STATES)[number]

/** Evidence older than this many days may not call itself `current`. Mirrors
    the verifier's STALE_DAYS so a brief that passes here passes the gate. */
export const STALE_DAYS = 120

/* -------------------------------------------------------------------------
   Typed errors. Every refusal names the missing part; nothing is defaulted.
   ------------------------------------------------------------------------- */

export const EDITORIAL_ERROR_CODES = [
  'unknown_client',            // caller-supplied client id is not in the registry
  'wrong_client',              // the row exists, but not for this tenant → not-found
  'not_found',                 // no such brief / version / batch
  'invalid_argument',          // a required argument is missing or malformed
  'invalid_measurement',       // T08: no denominator, no resolvable source ref, wrong family
  'content_hash_mismatch',     // the payload does not hash to its stored content_hash
  'permission_gap',            // T09: permission absent/denied — pointer kept, body withheld
  'truncated_passage',         // T04: a supporting passage was cut, which is an error
  'stale_expected_version',    // T11: optimistic concurrency lost
  'not_implemented_in_run_1',  // requestDraft / refresh: specified, implemented in Run 2
  'read_failed',               // the transport failed — an unread surface, never an empty one
] as const
export type EditorialErrorCode = (typeof EDITORIAL_ERROR_CODES)[number]

/** Carries the code AND the exact part that was missing, so a caller never has
    to parse a sentence. `erasableSyntaxOnly` is on in this repo, so no
    parameter properties: the fields are assigned in the body. */
export class EditorialContractError extends Error {
  code: EditorialErrorCode
  detail: string | null
  constructor(code: EditorialErrorCode, message: string, detail: string | null = null) {
    super(message)
    this.name = 'EditorialContractError'
    this.code = code
    this.detail = detail
  }
}

/** Thrown by every Run-2 function body. Its presence is the contract: the
    types and the documented shape are frozen now; the implementation lands in
    Run 2 against this exact signature. */
export class NotImplementedInRun1 extends EditorialContractError {
  fnName: string
  specRef: string
  constructor(fnName: string, specRef: string) {
    super(
      'not_implemented_in_run_1',
      `${fnName} is specified for Run 2 and has no Run 1 implementation. ` +
      `Its frozen shape is ${specRef}.`,
      specRef,
    )
    this.name = 'NotImplementedInRun1'
    this.fnName = fnName
    this.specRef = specRef
  }
}

/* -------------------------------------------------------------------------
   The injected client. Both adapters take one of these; neither imports
   `./supabase` directly, so every function in them is testable with a stub and
   a test can never reach a network.
   ------------------------------------------------------------------------- */

export type EditorialRpcResult = { data: unknown; error: { message: string } | null }

export type EditorialClient = {
  rpc(fn: string, params: Record<string, unknown>): Promise<EditorialRpcResult>
  functions?: {
    invoke(name: string, options: { body: Record<string, unknown> }): Promise<EditorialRpcResult>
  }
}

/* -------------------------------------------------------------------------
   Physical names. One place, imported by both adapters and copied verbatim
   into CONTRACT.json#/physical_names.
   ------------------------------------------------------------------------- */

export const EDITORIAL_TABLES = {
  brief_version: 'editorial_brief_versions',
  brief_source: 'editorial_brief_sources',
  decision: 'editorial_decisions',
  brief_artifact: 'editorial_brief_artifacts',
  batch: 'editorial_batches',
  input_manifest: 'editorial_input_manifests',
  refresh_request: 'editorial_refresh_requests',
  current_batch: 'editorial_current_batch',
  source_curation: 'editorial_source_curation',
  outcome_snapshot: 'editorial_outcome_snapshots',
} as const

export const EDITORIAL_RPCS = {
  readResearch: 'editorial_read_research',
  readBriefs: 'editorial_read_briefs',
  readBrief: 'editorial_read_brief',
  recordEditorialDecision: 'editorial_record_decision',
  readBriefOutcomes: 'editorial_read_brief_outcomes',
  setSourceCuration: 'editorial_set_source_curation',
  linkArtifact: 'editorial_link_artifact',
  promoteBatch: 'editorial_promote_batch',
} as const

/* -------------------------------------------------------------------------
   SourcePage — the research side (editorialSources.ts, owned by another seat)
   ------------------------------------------------------------------------- */

export type SourceGapState = { reason: GapReason; detail: string }

/** Metadata carried in the persisted candidate_fields JSON payload. Candidate
    records require all five named fields; non-candidate records use the same
    payload for metrics, body completeness and native identity. */
export type CandidateFields = Record<string, unknown> & {
  evidence?: unknown
  raw_context?: unknown
  editorial_assessment?: unknown
  editorial_strength?: unknown
  angle_options?: unknown
}

export type EvidenceBodyState = 'full' | 'excerpt' | 'unavailable' | 'unknown'
export type SourceIdentity = {
  platform: string
  native_id: string
  collector_row_id: string | null
}
export type MetricProvenance = {
  source: string | null
  denominator: string | null
  observation_window: Record<string, unknown> | null
}

export const CANDIDATE_SOURCE_FACT_FIELDS = ['evidence', 'raw_context'] as const
export const CANDIDATE_DERIVED_FIELDS = [
  'editorial_assessment', 'editorial_strength', 'angle_options',
] as const

export type SourceRef = { url: string } | { excerpt_pointer: string }

export type SourceSnapshot = {
  /** Stable native identity — `urn:linkedin:activity:…`, a call id, an asset id.
      Deduplication key together with `source_ref`: a repost under a new row id
      but the same native id/url is the SAME source (T05). */
  source_id: string
  source_kind: SourceKind
  /** 'public' or the owning client id. A non-public scope that is not the
      reading tenant is never returned (T02). */
  source_client_scope: 'public' | EditorialClientId
  source_ref: SourceRef
  /** When the AUTHOR published. 'unknown' when the record has none — never the
      ingest timestamp, never the capture date (T03). */
  source_published_date: MaybeDate
  /** When WE observed it. Never substitutes for the publication date. */
  captured_date: MaybeDate
  owner: string
  /** sha256 of the retained body. null ONLY with a gap_state. */
  source_content_hash: string | null
  /** Bounded verbatim excerpt. null ONLY with a gap_state. A silent shortening
      is an error, not a shortening (T04 → 'truncated_passage'). */
  passage: string | null
  /** Collection-established body state. It is independent of any display cap. */
  body_state: EvidenceBodyState
  /** The platform/native identity behind this immutable snapshot. */
  source_identity: SourceIdentity
  /** Structured observations copied from the collector JSON payload. */
  observed_metrics: Record<string, unknown> | null
  metric_provenance: MetricProvenance
  retained_context: string
  limitation: string
  independent: boolean
  /** REQUIRED non-empty when independent === false. */
  derived_from: string | null
  permission_state: PermissionState
  gap_state: SourceGapState | null
  currency_state: CurrencyState
  /** Days between publication and the read. null when publication is unknown —
      never 0, which would read as "published today". */
  age_days: number | null
  /** Stable across re-reads of the same source version (T03). */
  snapshot_hash: string
  /** unseen/seen/pinned/dismissed. Separate from any legacy idea status. */
  curation_state: CurationState
  /** Incremented when the same native source is ingested again. A repeat
      ingestion updates this and creates NO corroboration (T05). */
  seen_version: number
  candidate_fields: CandidateFields | null
  /** Names the subset of `candidate_fields` that are the model's opinion. */
  derived_field_names: readonly string[]
}

export type SourceFilters = {
  kinds?: readonly SourceKind[]
  curation?: readonly CurationState[]
  publishedSince?: string
  relation?: EvidenceRelation
}

export type SourceCursor = { after: string; limit: number } | null

/** An input the adapter could not represent — an unsupported source kind, a
    permission failure — listed rather than dropped (T06/T09). */
export type SourcePageGap = {
  source_id: string | null
  reason: GapReason | 'unsupported_kind'
  detail: string
}

export type SourcePage = {
  client_id: EditorialClientId
  state: PageState
  items: SourceSnapshot[]
  /** Server-side recomputed. A caller-supplied count is never trusted (T02). */
  total: number
  /** Distinct source_id where independent === true and gap_state === null. */
  independent_source_count: number
  next_cursor: string | null
  /** Collection health, reported independently of synthesis health. */
  health: {
    last_successful_collection: MaybeDate
    source_cutoff: MaybeDate
    new_evidence_awaiting_refresh: number
    stale_inputs: number
  }
  gaps: SourcePageGap[]
  message?: string
}

/* -------------------------------------------------------------------------
   EditorialBrief — the exact object ARTIFACT-SPEC §4 defines. Brief authors
   write these files in parallel; this type accepts them verbatim.
   ------------------------------------------------------------------------- */

export type BriefIdentity = {
  brief_id: string
  version: number
  client_id: EditorialClientId
  kind: BriefKind
  created_at: string
  source_cutoff: string
  status: BriefStatus
  /** sha256 hex over the canonical brief payload. Stable across two reads. */
  content_hash: string
}

export type BriefPurpose = {
  objective: string
  intended_audience: string
  direction_version: string
  audience_status: 'approved' | 'provisional'
  relevance_reason: string
}

export type BriefEditorialDirection = {
  topic: string
  angle: string
  proposed_hook: string
  format: 'text' | 'single_image' | 'carousel' | 'video' | 'lm_promo' | 'resource'
  tone: string
  structural_beats: string[]
  why_now: string
  overlap_with_existing_content: string
  novelty_reason: string
}

export type BriefEvidence = {
  evidence_id: string
  relation: EvidenceRelation
  source_id: string
  /** Exact immutable source version used by a Run 2 synthesis batch. */
  seen_version?: number
  source_kind: SourceKind
  source_client_scope: 'public' | EditorialClientId
  source_ref: SourceRef
  source_published_date: MaybeDate
  captured_date: MaybeDate
  currency_state: CurrencyState
  owner: string
  source_content_hash: string | null
  passage: string | null
  retained_context: string
  limitation: string
  independent: boolean
  derived_from: string | null
  gap_state: SourceGapState | null
  candidate_fields?: CandidateFields
  permission_state?: PermissionState
}

export type BriefMeasurement = {
  metric_name: string
  formula: string
  /** Never defaulted to 0. A measurement with no observed value is a gap, and
      a gap is not a measurement (T08). */
  observed_value: number | string
  denominator: string
  comparison_population: string
  capture_age_days: number | Unknown
  observation_window: string
  comparison_method_version: string
  /** MUST resolve to an `evidence_id` in the same brief. */
  source_ref: string
  owner: string
  unknowns: string[]
  /** Which family this metric belongs to. A market metric may not populate a
      conversion field and a call-sourced value may not be a performance
      metric (T08). */
  metric_family?: MetricFamily
}

export const METRIC_FAMILIES = [
  'own_performance', 'market_performance', 'conversion', 'qualitative',
] as const
export type MetricFamily = (typeof METRIC_FAMILIES)[number]

/** Which evidence relations may legitimately supply which metric family. A
    call excerpt (`supports_buyer_concern`) can justify a topic and can never
    become an observed performance number. */
export const METRIC_FAMILY_SOURCES: Record<MetricFamily, readonly EvidenceRelation[]> = {
  own_performance: ['observed_own_performance'],
  market_performance: ['observed_market_performance', 'supplies_format_inspiration'],
  conversion: ['observed_own_performance'],
  qualitative: [
    'supports_buyer_concern', 'supports_claim', 'contradicts_claim',
    'supplies_asset_proof', 'supplies_format_inspiration',
  ],
}

export type BriefClaim = {
  claim_id: string
  statement: string
  supporting_refs: string[]
  attribution_owner: string
  allowed_phrasing: string
  prohibited_inference: string
  status: 'fact' | 'interpretation' | 'hypothesis'
}

export type BriefCall = {
  call_id: string
  call_date: string
  speaker: string
  excerpt_pointer: string
  surrounding_context: string
  permission_state: string
  withhold: string[]
}

export type BriefResource = {
  asset_id: string
  version: string
  artifact_role: string
  readiness: ResourceReadiness
  access_route: string
  permission_basis: string
  required_missing_material: string[]
  draft_state: string
  public_catalog_state: string
}

export type BriefDistribution = {
  channel: string
  cta: string
  route: 'ungated' | 'gated' | 'dm' | 'follow_up'
  fulfillment_requirements: string[]
  /** Frozen at 'none'. Nothing in this contract authorizes a send or an arm. */
  send_authorization: 'none'
}

export type VoicePromptRef = { prompt_id: string; version: string; hash: string }

export type BriefProduction = {
  structure: string
  required_materials: string[]
  voice_references: VoicePromptRef[]
  critical_constraints: string[]
  effort_category: string
}

export type BriefEvaluation = {
  primary_metric: string
  secondary_metrics: string[]
  comparator: string
  window: string
  earliest_valid_observation: string
  event_source_availability: string
  attribution_limitations: string
}

export type BriefDecisionsLinks = {
  selection_events: string[]
  generation_request: string | null
  draft_ids: string[]
  resource_ids: string[]
  publication_id: string | null
  observed_outcomes: string[]
}

export type BriefReview = {
  reviewer_seat: string
  reviewer_model: string
  verdict: 'pass' | 'revise' | 'fail'
  reviewed_at: string
  notes: string
}

export type EditorialBrief = {
  identity: BriefIdentity
  purpose: BriefPurpose
  editorial_direction: BriefEditorialDirection
  evidence: BriefEvidence[]
  independent_source_count: number
  measurements: BriefMeasurement[]
  measurements_none_reason: string | null
  claim_ledger: BriefClaim[]
  calls: BriefCall[]
  calls_none_reason: string | null
  resource: BriefResource
  distribution: BriefDistribution
  production: BriefProduction
  evaluation: BriefEvaluation
  decisions_links: BriefDecisionsLinks
  readiness: BriefReadiness
  missing_material: string[]
  rank: number
  strongest_three: boolean
  ranking_reason: string | null
  review: BriefReview | null
  /** Set when this version materially revises an earlier proposal. A revision
      requires a fresh selection; an unchanged rejected proposal is never
      resurrected. */
  revises?: { brief_id: string; version: number; changed_evidence: string }
  /** The batch this version was proposed in. */
  batch_id?: string
  /** The status derived from the append-only decision ledger, which may differ
      from `identity.status` (the status AT PROPOSAL). Read-only. */
  effective_status?: BriefStatus
}

export type BriefPage = {
  client_id: EditorialClientId
  batch_id: string | null
  state: PageState
  items: (EditorialBrief | BriefAccessGap)[]
  total: number
  next_cursor: string | null
  /** Coverage gaps carried from the batch — a partial batch cannot certify the
      clients or formats it did not cover. */
  coverage_gaps: string[]
  message?: string
}

/** Opaque read result when a linked source has since been denied or withheld.
    content_hash identifies the original immutable version, never this gap view. */
export type BriefAccessGap = {
  access: 'permission_unavailable'
  identity: Pick<BriefIdentity, 'brief_id' | 'client_id' | 'version' | 'kind' | 'status' | 'content_hash'>
  source_ids: string[]
  content_hash_scope: 'immutable_original'
}

/** The explicit not-found result. A request for a version that does not exist
    returns THIS, never the newest version (T01). */
export type BriefNotFound = {
  found: false
  client_id: EditorialClientId
  brief_id: string
  version: number
  reason: 'no_such_brief' | 'no_such_version' | 'wrong_client'
}

export type BriefRead = { found: true; brief: EditorialBrief } |
  { found: true; access: 'permission_unavailable'; gap: BriefAccessGap } | BriefNotFound

/* -------------------------------------------------------------------------
   DecisionReceipt
   ------------------------------------------------------------------------- */

export type DecisionTarget = {
  kind: DecisionTargetKind
  id: string
  version: number | null
}

export type DecisionOutcome = 'recorded' | 'duplicate' | 'conflict' | 'pending_reconciliation'

export type DecisionReceipt = {
  decision_id: string
  client_id: EditorialClientId
  request_id: string
  target: DecisionTarget
  action: DecisionAction
  scope: DecisionScope
  reason: string
  expected_version: number | null
  /** What the server actually holds. On a conflict this is the newer version
      the caller had not seen. */
  observed_version: number | null
  outcome: DecisionOutcome
  recorded_at: string
  /** Non-null exactly when outcome is 'conflict' or 'pending_reconciliation'.
      The newer decision is NEVER overwritten (T11). */
  conflict: { reason: string; newer_decision_id: string | null } | null
  /** Frozen false. A decision never promotes, approves or kicks off anything. */
  promoted: false
}

/* -------------------------------------------------------------------------
   OutcomeRead
   ------------------------------------------------------------------------- */

export type OutcomeObservation = {
  snapshot_id: string
  artifact_id: string | null
  artifact_role: string | null
  metric: string
  /** 'unknown' when telemetry is missing. NEVER 0 — a missing count and a real
      zero are different facts. */
  observed_value: number | Unknown
  denominator: string | Unknown
  scope: string
  window_start: MaybeDate
  window_end: MaybeDate
  captured_at: MaybeDate
  event_definition: string
  /** direct / assisted attribution stay distinct; 'unknown' is its own state. */
  attribution: 'direct' | 'assisted' | 'unknown'
  limitation: string
}

export type OutcomeRead = {
  client_id: EditorialClientId
  brief_id: string
  state: PageState
  /** One observation attached to a hypothesis. An outcome updates the record
      of a topic/format/asset; it never asserts a causal effect. */
  observations: OutcomeObservation[]
  unknowns: string[]
  attribution_limitations: string
  /** Publication is an EXISTING-flow fact, carried, never claimed here. */
  publication_id: string | null
  message?: string
}

/* -------------------------------------------------------------------------
   Batch / InputManifest / RefreshReceipt / RefreshState — frozen now,
   produced by Run 2's synthesis adapter.
   ------------------------------------------------------------------------- */

export type BriefVersionRef = { brief_id: string; version: number; content_hash: string }

export type Batch = {
  batch_id: string
  client_id: EditorialClientId
  status: BatchStatus
  /** Immutable references to the exact brief versions this batch proposed. */
  brief_refs: BriefVersionRef[]
  input_manifest_hash: string
  synthesis_method: string
  synthesis_model: string
  prompt_version: string
  requested_at: string
  started_at: MaybeDate
  completed_at: MaybeDate
  /** Exact coverage gaps. A partial batch names what it could not cover. */
  coverage_gaps: string[]
  prior_batch_id: string | null
  /** True only while this batch is the promoted current-suggestion pointer. */
  is_current: boolean
  /** Set when decisions landed after the input snapshot was taken. Those
      decisions are PRESERVED and the batch is marked, never overwritten. */
  awaiting_reconciliation: boolean
}

export type InputManifest = {
  input_manifest_hash: string
  client_id: EditorialClientId
  /** Exact source identities AND versions that were snapshotted. */
  source_refs: { source_id: string; seen_version: number }[]
  source_cutoff: string
  collector_cursors: Record<string, string>
  direction_version: string
  decision_cutoff: string
  decision_ids: string[]
  outcome_snapshot_ids: string[]
  created_at: string
}

export type RefreshReceipt = {
  refresh_id: string
  client_id: EditorialClientId
  request_id: string
  /** Repeating a request returns its EXISTING receipt. */
  deduplicated: boolean
  expected_direction_version: string
  observed_direction_version: string
  status: BatchStatus
  batch_id: string | null
  accepted_at: string
  /** Frozen false on every field: refresh starts no acquisition, no paid call,
      no approval, no drafting, no schedule, no send. */
  starts_acquisition: false
  starts_generation: false
  starts_publication: false
  conflict: { reason: 'stale_direction_version' | 'in_flight'; detail: string } | null
}

export type RefreshState = {
  refresh_id: string
  client_id: EditorialClientId
  status: BatchStatus
  batch_id: string | null
  /** The batch still serving suggestions. An empty/failed refresh KEEPS this
      and never erases the shortlist. */
  last_usable_batch_id: string | null
  coverage_gaps: string[]
  awaiting_reconciliation: boolean
  /** Collection health and synthesis health are separate questions. */
  collection_health: {
    last_successful_collection: MaybeDate
    new_evidence_awaiting_refresh: number
    stale_inputs: number
  }
  synthesis_health: {
    last_successful_synthesis: MaybeDate
    last_failure_reason: string | null
  }
  updated_at: string
}

/* -------------------------------------------------------------------------
   DraftReceipt — the Run-2 generation request identity.
   ------------------------------------------------------------------------- */

export type DraftReceipt = {
  request_id: string
  client_id: EditorialClientId
  brief_id: string
  brief_version: number
  expected_hash: string
  artifact_role: string
  /** The SAME identity on a retry. A changed brief version needs a new
      explicit request, never an automatic re-drive. */
  artifact_id: string | null
  idempotent_replay: boolean
  state: 'accepted' | 'blocked' | 'conflict'
  blocked_reason: string | null
}

/* -------------------------------------------------------------------------
   Small pure helpers both adapters use. Keeping them here means one
   definition of "how old is this" and "is this unknown".
   ------------------------------------------------------------------------- */

/** Whole days from `from` to `to`, or null when either date is unknown or
    unparsable. Null, not 0 — 0 means "the same day", which is a claim. */
export function daysBetween(from: MaybeDate | null | undefined, to: MaybeDate | null | undefined): number | null {
  if (!from || !to || isUnknown(from) || isUnknown(to)) return null
  const a = Date.parse(String(from))
  const b = Date.parse(String(to))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** The ONLY rule that may set `currency_state`. A capture date never refreshes
    currency: a 200-day-old post captured yesterday is `historical` (T07). */
export function deriveCurrencyState(
  publishedDate: MaybeDate | null | undefined,
  asOf: MaybeDate | null | undefined,
  staleDays: number = STALE_DAYS,
): CurrencyState {
  const age = daysBetween(publishedDate, asOf)
  if (age === null) return 'unknown'
  return age > staleDays ? 'historical' : 'current'
}

/** Distinct `source_id` values that are independent AND ungapped. Duplicates,
    reposts and derived summaries add nothing (T05). */
export function countIndependentSources(
  items: readonly { source_id: string; independent: boolean; gap_state: SourceGapState | null }[],
): number {
  const seen = new Set<string>()
  for (const i of items) {
    if (i.independent && i.gap_state === null) seen.add(i.source_id)
  }
  return seen.size
}

/** The dedupe identity of a source: its native id plus the url or pointer it
    was retained at. A repost under a new row id but the same native id/url
    collapses onto the same key. */
export function sourceDedupeKey(source_id: string, ref: SourceRef): string {
  const tail = 'url' in ref ? ref.url : ref.excerpt_pointer
  return `${source_id}|${tail}`
}

export function isPromotableBatchStatus(s: BatchStatus): boolean {
  return PROMOTABLE_BATCH_STATUSES.includes(s)
}
