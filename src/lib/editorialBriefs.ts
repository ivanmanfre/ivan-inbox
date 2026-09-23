/* ==========================================================================
   src/lib/editorialBriefs.ts — the typed, authenticated brief-side adapter.

   The Run 1 read/decision surface stays stable. Run 2 adds authenticated
   refresh, review, results and draft-request adapters; the server performs
   the exact identity, material and source checks before accepting a request.

   AN INJECTED CLIENT, ALWAYS. Nothing in this module imports `./supabase`.
   Every function takes an `EditorialClient` (RPC plus Edge invoke shape)
   as its first argument, which is what makes the whole module unit-testable
   without a network and makes it impossible for a test run to reach a live
   project. The app wires the real client at the call site.

   WHAT THE ADAPTER REFUSES, rather than smooths over:
     · an unregistered client id, BEFORE any query is issued
     · a caller-supplied evidence count — `independent_source_count` is always
       recomputed from the returned evidence, never trusted off the wire
     · a measurement with no denominator, no resolvable source ref, or a value
       drawn from the wrong evidence family
     · a supporting passage that arrived truncated
     · a `currency_state: 'current'` on evidence older than the stale bound
     · a `ready_to_draft` brief whose only review was written by its own author
     · a stale `expectedVersion` — that returns a conflict RECEIPT, and the
       newer decision is never overwritten

   UNKNOWN STAYS UNKNOWN. Nothing here turns a missing number into 0 or a
   missing date into the moment we read it. A failed transport yields
   `state: 'failed'` with the message; it never collapses into `'empty'`,
   because an unread surface and a confirmed-empty one are different facts.
   ========================================================================== */
import {
  EDITORIAL_RPCS, EditorialContractError,
  STALE_DAYS, METRIC_FAMILY_SOURCES,
  countIndependentSources, daysBetween, isEditorialClientId, isUnknown,
} from './editorialTypes.ts'
import type {
  Batch, BriefAccessGap, BriefMeasurement, BriefPage, BriefRead, BriefVersionRef,
  CurrencyState, DecisionAction, DecisionReceipt, DecisionScope, DecisionTarget,
  DraftReceipt, EditorialBrief, EditorialClient, EditorialClientId,
  InputManifest, MetricFamily, OutcomeRead, RefreshReceipt, RefreshState,
} from './editorialTypes.ts'

/* -------------------------------------------------------------------------
   Guards and small readers
   ------------------------------------------------------------------------- */

/** The tenant check that runs BEFORE any query. An id outside the explicit
    registry never reaches the database, so it can never be answered with a
    calm empty page that would read as "this tenant has nothing" (T02). The
    server repeats the check in `editorial_guard`; this one exists so a typo
    in the app fails loudly at the boundary instead of silently downstream. */
export function assertRegisteredClient(clientId: unknown): EditorialClientId {
  if (!isEditorialClientId(clientId)) {
    throw new EditorialContractError(
      'unknown_client',
      'That client id is not in the editorial registry, so no editorial read was issued.',
      String(clientId),
    )
  }
  return clientId
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

async function callRpc(
  client: EditorialClient, fn: string, params: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const { data, error } = await client.rpc(fn, params)
    if (error) return { ok: false, error: error.message || `${fn} failed.` }
    if (!isObj(data)) return { ok: false, error: `${fn} returned no usable payload.` }
    return { ok: true, data }
  } catch (e) {
    // A REJECTED promise is still a failed read, never a hang and never an
    // empty page — the same rule contentEvidence.ts states for its readPack.
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/* -------------------------------------------------------------------------
   Validators. Each one names the missing part; none of them defaults a value.
   ------------------------------------------------------------------------- */

/** Deterministic serialization of a brief for hashing: every object key sorted,
    and `identity.content_hash` itself removed, because a value cannot be part
    of its own digest. Arrays keep their order — order is meaning in
    `structural_beats` and in `evidence`. */
export function canonicalBriefPayload(brief: EditorialBrief): string {
  const clone = JSON.parse(JSON.stringify(brief)) as Record<string, unknown>
  const identity = clone.identity
  if (isObj(identity)) delete identity.content_hash
  return canonicalJson(clone)
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const keys = Object.keys(v as Record<string, unknown>).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`
}

/** Verifies a brief against its stored `content_hash`. The hasher is INJECTED
    (node's crypto in a test, SubtleCrypto in a browser) so this module stays
    dependency-free and synchronously testable. Returns the computed digest so
    a caller can show both sides of a mismatch rather than a bare boolean. */
export async function verifyContentHash(
  brief: EditorialBrief, sha256Hex: (input: string) => Promise<string> | string,
): Promise<{ ok: boolean; expected: string; computed: string }> {
  const expected = brief.identity.content_hash
  const computed = await sha256Hex(canonicalBriefPayload(brief))
  return { ok: computed === expected, expected, computed }
}

export async function assertContentHash(
  brief: EditorialBrief, sha256Hex: (input: string) => Promise<string> | string,
): Promise<void> {
  const r = await verifyContentHash(brief, sha256Hex)
  if (!r.ok) {
    throw new EditorialContractError(
      'content_hash_mismatch',
      `The brief body does not match its stored content hash.`,
      `${brief.identity.brief_id}@${brief.identity.version}: stored ${r.expected}, computed ${r.computed}`,
    )
  }
}

/** Recomputes `independent_source_count` from the evidence actually present.
    A count that arrived on the wire is never trusted: this is what catches a
    duplicated source, a repost under a new row id, and a derived summary being
    counted as corroboration (T02, T05). */
export function recomputeIndependentCount(brief: EditorialBrief): number {
  return countIndependentSources(brief.evidence)
}

/** True when the same `source_id` is carried with conflicting `independent`
    values — one source cannot be independent in one claim and derived in the
    next. */
export function hasConflictingIndependence(brief: EditorialBrief): string | null {
  const seen = new Map<string, boolean>()
  for (const e of brief.evidence) {
    const prior = seen.get(e.source_id)
    if (prior !== undefined && prior !== e.independent) return e.source_id
    seen.set(e.source_id, e.independent)
  }
  return null
}

/** T04. A supporting passage is present, or an explicit gap says why not.
    A silently shortened passage is an error, not a shortening: the server may
    mark a clipped body, and this turns that mark into a refusal. */
export function assertEvidenceBodyIntact(brief: EditorialBrief): void {
  for (const e of brief.evidence) {
    const clipped = (e as unknown as Record<string, unknown>).passage_truncated === true
    if (clipped) {
      throw new EditorialContractError(
        'truncated_passage',
        'A supporting passage arrived truncated; the brief is not readable as evidence.',
        `${brief.identity.brief_id} ${e.evidence_id}`,
      )
    }
    if (e.gap_state === null && (!str(e.passage) || !str(e.source_content_hash))) {
      throw new EditorialContractError(
        'permission_gap',
        'Evidence carries neither a retained body with its hash nor an explicit gap state.',
        `${brief.identity.brief_id} ${e.evidence_id}`,
      )
    }
  }
}

/** T07. The only rule that may contradict a stored `currency_state`. A capture
    date never refreshes currency; a 200-day-old post stays historical however
    recently it was ingested. */
export function currencyViolations(brief: EditorialBrief, staleDays = STALE_DAYS): string[] {
  const out: string[] = []
  for (const e of brief.evidence) {
    if (e.currency_state !== 'current') continue
    const age = daysBetween(e.source_published_date, brief.identity.created_at)
    if (age === null) {
      out.push(`${e.evidence_id}: currency_state "current" with an unknown publication date`)
    } else if (age > staleDays) {
      out.push(`${e.evidence_id}: published ${age} days before the brief but claimed current`)
    }
  }
  return out
}

/** The currency a piece of evidence is entitled to, computed rather than read.
    Exposed so a caller can show the honest value beside the stored one. */
export function evidenceCurrency(
  brief: EditorialBrief, evidenceId: string, staleDays = STALE_DAYS,
): CurrencyState {
  const e = brief.evidence.find(x => x.evidence_id === evidenceId)
  if (!e) return 'unknown'
  const age = daysBetween(e.source_published_date, brief.identity.created_at)
  if (age === null) return 'unknown'
  return age > staleDays ? 'historical' : 'current'
}

/** T08. A measurement is rejected — by a typed error naming the missing part —
    when it has no denominator, when its `source_ref` resolves to nothing in
    this brief, or when its value was drawn from an evidence relation that
    cannot supply that metric family. Nothing is defaulted to 0 and nothing is
    inferred. */
export function validateMeasurement(brief: EditorialBrief, m: BriefMeasurement): void {
  const at = `${brief.identity.brief_id} metric "${m.metric_name}"`
  if (m.observed_value === null || m.observed_value === undefined) {
    throw new EditorialContractError('invalid_measurement',
      'A measurement with no observed value is a gap, not a measurement.', `${at}: observed_value`)
  }
  if (!str(m.denominator)) {
    throw new EditorialContractError('invalid_measurement',
      'A counted value states its denominator.', `${at}: denominator`)
  }
  if (!str(m.owner)) {
    throw new EditorialContractError('invalid_measurement',
      'A measurement stays tied to the account that produced it.', `${at}: owner`)
  }
  const ev = brief.evidence.find(e => e.evidence_id === m.source_ref)
  if (!ev) {
    throw new EditorialContractError('invalid_measurement',
      'A measurement must resolve to evidence carried by this brief.',
      `${at}: source_ref "${m.source_ref}"`)
  }
  const family: MetricFamily | undefined = m.metric_family
  if (family) {
    const allowed = METRIC_FAMILY_SOURCES[family]
    if (!allowed.includes(ev.relation)) {
      throw new EditorialContractError('invalid_measurement',
        `A ${ev.relation} source cannot populate a ${family} metric.`,
        `${at}: relation "${ev.relation}"`)
    }
  }
}

export function validateMeasurements(brief: EditorialBrief): void {
  if (brief.measurements.length === 0) {
    if (!str(brief.measurements_none_reason)) {
      throw new EditorialContractError('invalid_measurement',
        'A brief with no measurement states why it has none.',
        `${brief.identity.brief_id}: measurements_none_reason`)
    }
    return
  }
  for (const m of brief.measurements) validateMeasurement(brief, m)
}

/** T09. `resource.readiness === 'ready'` needs an asset id, a version, an
    access route and a checked permission basis, and no outstanding material.
    A permission failure blocks THIS brief and nothing else. */
export function resourceBlockReason(brief: EditorialBrief): string | null {
  const r = brief.resource
  if (r.readiness !== 'ready') return null
  const missing: string[] = []
  if (!str(r.asset_id)) missing.push('asset_id')
  if (!str(r.version)) missing.push('version')
  if (!str(r.access_route)) missing.push('access_route')
  if (!str(r.permission_basis)) missing.push('permission_basis')
  if (r.required_missing_material.length > 0) missing.push('required_missing_material is not empty')
  return missing.length ? `resource.readiness "ready" without ${missing.join(', ')}` : null
}

/** T10. A brief reaches `ready_to_draft` + a passing verdict only with a review
    recorded by a DIFFERENT seat. No review, or a self-review, is un-reviewed. */
export function reviewIsIndependent(brief: EditorialBrief, authoredBySeat: string | null): boolean {
  const rev = brief.review
  if (!rev || !str(rev.reviewer_seat)) return false
  if (authoredBySeat && rev.reviewer_seat === authoredBySeat) return false
  return true
}

export function readinessBlockReasons(
  brief: EditorialBrief, authoredBySeat: string | null = null,
): string[] {
  const out: string[] = []
  if (brief.readiness === 'ready_to_draft' && brief.missing_material.length > 0) {
    out.push('ready_to_draft while missing_material is not empty')
  }
  if (brief.readiness === 'ready_to_draft' && brief.review?.verdict === 'pass'
      && !reviewIsIndependent(brief, authoredBySeat)) {
    out.push('ready_to_draft with a verdict recorded by its own author, or with no review at all')
  }
  const res = resourceBlockReason(brief)
  if (res) out.push(res)
  out.push(...currencyViolations(brief))
  const conflict = hasConflictingIndependence(brief)
  if (conflict) out.push(`source ${conflict} is carried with conflicting independence`)
  const recomputed = recomputeIndependentCount(brief)
  if (brief.independent_source_count !== recomputed) {
    out.push(`independent_source_count says ${brief.independent_source_count}, the evidence supports ${recomputed}`)
  }
  return out
}

/* -------------------------------------------------------------------------
   Parsers. Every one of them recomputes what must not be trusted.
   ------------------------------------------------------------------------- */

export function parseBrief(raw: unknown): EditorialBrief | null {
  if (!isObj(raw) || !isObj(raw.identity)) return null
  const brief = raw as unknown as EditorialBrief
  // Recomputed server-side AND here: whichever number arrived on the wire, the
  // evidence in hand is what the count means.
  brief.independent_source_count = countIndependentSources(arr(brief.evidence) as EditorialBrief['evidence'])
  return brief
}

function parseBriefAccessGap(raw: unknown): BriefAccessGap | null {
  if (!isObj(raw) || raw.access !== 'permission_unavailable' || !isObj(raw.identity)) return null
  const i = raw.identity
  if (!str(i.brief_id) || !str(i.client_id) || !Number.isInteger(i.version)
      || !str(i.content_hash) || !str(i.kind) || !str(i.status)
      || raw.content_hash_scope !== 'immutable_original') return null
  return raw as BriefAccessGap
}

function failedPage(clientId: EditorialClientId, batchId: string | null, message: string): BriefPage {
  return {
    client_id: clientId, batch_id: batchId, state: 'failed', items: [], total: 0,
    next_cursor: null, coverage_gaps: [], message,
  }
}

/* -------------------------------------------------------------------------
   1. readBriefs — implemented
   ------------------------------------------------------------------------- */

/** One page of the briefs in a batch. `batchId === null` follows the promoted
    current-suggestion pointer. A batch id that does not exist returns an
    EXPLICIT empty page — never a throw, never a fallback to the current batch,
    never another tenant's rows (T06). */
export async function readBriefs(
  client: EditorialClient,
  clientId: string,
  batchId: string | null = null,
  cursor: string | null = null,
  limit = 25,
): Promise<BriefPage> {
  const lane = assertRegisteredClient(clientId)
  const r = await callRpc(client, EDITORIAL_RPCS.readBriefs, {
    p_gate: EDITORIAL_GATE, p_client_id: lane, p_batch_id: batchId,
    p_cursor: cursor, p_limit: limit,
  })
  if (!r.ok) return failedPage(lane, batchId, r.error)

  const d = r.data
  const items = arr(d.items).map(raw => parseBriefAccessGap(raw) ?? parseBrief(raw))
    .filter((b): b is EditorialBrief | BriefAccessGap => b !== null)
  if (items.length !== arr(d.items).length) return failedPage(lane, batchId,
    'The brief page included an unreadable item; pagination was not trusted.')
  return {
    client_id: lane,
    batch_id: str(d.batch_id),
    state: (str(d.state) ?? 'empty') as BriefPage['state'],
    items,
    // The server's count is the population count; the page length is the page.
    total: typeof d.total === 'number' ? d.total : items.length,
    next_cursor: str(d.next_cursor),
    coverage_gaps: arr(d.coverage_gaps).filter((g): g is string => typeof g === 'string'),
    ...(str(d.message) ? { message: str(d.message) as string } : {}),
  }
}

/* -------------------------------------------------------------------------
   2. readBrief — implemented
   ------------------------------------------------------------------------- */

/** One exact brief version. A version that does not exist returns an explicit
    not-found; it NEVER answers with the newest version, and its not-found
    reason never discloses that the id belongs to another tenant (T01, T02). */
export async function readBrief(
  client: EditorialClient, clientId: string, briefId: string, version: number,
): Promise<BriefRead> {
  const lane = assertRegisteredClient(clientId)
  if (!str(briefId) || !Number.isInteger(version)) {
    throw new EditorialContractError('invalid_argument',
      'readBrief needs an exact brief id and an integer version.', `${briefId}@${version}`)
  }
  const r = await callRpc(client, EDITORIAL_RPCS.readBrief, {
    p_gate: EDITORIAL_GATE, p_client_id: lane, p_brief_id: briefId, p_version: version,
  })
  if (!r.ok) {
    throw new EditorialContractError('read_failed',
      'The brief read failed; the brief is unread, not absent.', r.error)
  }
  const d = r.data
  if (d.found !== true) {
    const reason = str(d.reason)
    return {
      found: false, client_id: lane, brief_id: briefId, version,
      reason: (reason === 'no_such_version' ? 'no_such_version' : 'no_such_brief'),
    }
  }
  const gap = parseBriefAccessGap(d.gap)
  if (d.access === 'permission_unavailable' && gap) return { found: true, access: 'permission_unavailable', gap }
  const brief = parseBrief(d.brief)
  if (!brief) {
    throw new EditorialContractError('read_failed',
      'The brief read returned a payload with no identity.', `${briefId}@${version}`)
  }
  if (brief.identity.version !== version) {
    // Belt and braces for the one substitution this contract must never make.
    throw new EditorialContractError('not_found',
      'The server answered with a different version than the one requested.',
      `asked ${version}, received ${brief.identity.version}`)
  }
  return { found: true, brief }
}

/* -------------------------------------------------------------------------
   3. recordEditorialDecision — implemented
   ------------------------------------------------------------------------- */

/** Appends one decision. Idempotent on `requestId`: a replay returns the same
    `decision_id` with `outcome: 'duplicate'` and writes no second row. A stale
    `expectedVersion` returns a conflict receipt carrying the version the server
    actually holds, and overwrites nothing (T11).

    This call has NO promoter permission. It writes one row in
    `editorial_decisions` and touches no queue, draft or schedule — `promoted`
    is frozen `false` on every receipt. */
export async function recordEditorialDecision(
  client: EditorialClient,
  clientId: string,
  target: DecisionTarget,
  expectedVersion: number | null,
  action: DecisionAction,
  reason: string,
  scope: DecisionScope,
  requestId: string,
): Promise<DecisionReceipt> {
  const lane = assertRegisteredClient(clientId)
  if (!str(reason)) {
    throw new EditorialContractError('invalid_argument',
      'A decision carries a reason. A skipped card records nothing at all.', 'reason')
  }
  if (!str(requestId)) {
    throw new EditorialContractError('invalid_argument',
      'A decision needs an explicit request id so a retry stays one decision.', 'requestId')
  }
  const r = await callRpc(client, EDITORIAL_RPCS.recordEditorialDecision, {
    p_gate: EDITORIAL_GATE, p_client_id: lane,
    p_target_kind: target.kind, p_target_id: target.id, p_target_version: target.version,
    p_expected_version: expectedVersion, p_action: action, p_reason: reason,
    p_scope: scope, p_request_id: requestId,
  })
  if (!r.ok) {
    throw new EditorialContractError('read_failed',
      'The decision was not recorded; nothing changed.', r.error)
  }
  const d = r.data
  const t = isObj(d.target) ? d.target : {}
  return {
    decision_id: String(d.decision_id ?? ''),
    client_id: lane,
    request_id: String(d.request_id ?? requestId),
    target: {
      kind: (str(t.kind) ?? target.kind) as DecisionTarget['kind'],
      id: str(t.id) ?? target.id,
      version: typeof t.version === 'number' ? t.version : null,
    },
    action: (str(d.action) ?? action) as DecisionAction,
    scope: (str(d.scope) ?? scope) as DecisionScope,
    reason: str(d.reason) ?? reason,
    expected_version: typeof d.expected_version === 'number' ? d.expected_version : null,
    observed_version: typeof d.observed_version === 'number' ? d.observed_version : null,
    outcome: (str(d.outcome) ?? 'recorded') as DecisionReceipt['outcome'],
    recorded_at: str(d.recorded_at) ?? 'unknown',
    conflict: isObj(d.conflict)
      ? {
        reason: String(d.conflict.reason ?? 'conflict'),
        newer_decision_id: str(d.conflict.newer_decision_id),
      }
      : null,
    promoted: false,
  }
}

/* -------------------------------------------------------------------------
   4. readBriefOutcomes — implemented
   ------------------------------------------------------------------------- */

/** The observations attached to a brief. A missing number arrives as the string
    `'unknown'` with its reason, never as 0 — and no causal claim is made: an
    outcome updates the record of a topic, format or asset, it does not prove
    that the brief caused it. */
export async function readBriefOutcomes(
  client: EditorialClient, clientId: string, briefId: string,
): Promise<OutcomeRead> {
  const lane = assertRegisteredClient(clientId)
  if (!str(briefId)) {
    throw new EditorialContractError('invalid_argument',
      'readBriefOutcomes needs an exact brief id.', 'briefId')
  }
  const r = await callRpc(client, EDITORIAL_RPCS.readBriefOutcomes, {
    p_gate: EDITORIAL_GATE, p_client_id: lane, p_brief_id: briefId,
  })
  if (!r.ok) {
    return {
      client_id: lane, brief_id: briefId, state: 'failed', observations: [],
      unknowns: [], attribution_limitations: 'The outcome read failed; nothing is known.',
      publication_id: null, message: r.error,
    }
  }
  const d = r.data
  const observations = arr(d.observations) as OutcomeRead['observations']
  return {
    client_id: lane,
    brief_id: briefId,
    state: (str(d.state) ?? (observations.length ? 'ready' : 'empty')) as OutcomeRead['state'],
    observations,
    unknowns: arr(d.unknowns).filter((u): u is string => typeof u === 'string'),
    attribution_limitations: str(d.attribution_limitations)
      ?? 'Direct and assisted attribution are distinct; an unmeasured event is unknown, not zero.',
    publication_id: str(d.publication_id),
  }
}

/** Convenience over an OutcomeRead: the metrics that are genuinely unknown,
    kept distinct from the ones that are a real zero. */
export function unknownOutcomeMetrics(read: OutcomeRead): string[] {
  return read.observations.filter(o => isUnknown(o.observed_value)).map(o => o.metric)
}

/* -------------------------------------------------------------------------
   5-7. Specified for Run 2. Types frozen; bodies refuse.
   ------------------------------------------------------------------------- */

/**
 * SPECIFIED FOR RUN 2 — `CONTRACT.json#/schemas/DraftReceipt`.
 *
 * CONTRACT, so Run 2 implements it against a frozen shape rather than a guess:
 *  · authenticated and tenant-scoped, exactly like the five above;
 *  · independently checks, in this order, the client, the brief version, the
 *    `expectedHash` against the stored `content_hash`, the resource readiness
 *    and the idempotency key — BEFORE invoking any existing generator;
 *  · reserves `(client_id, brief_id, version, artifact_role)` through
 *    `editorial_link_artifact` first, so a retry returns the SAME draft
 *    identity (`idempotent_replay: true`) and never mints a second draft;
 *  · a changed brief version requires a NEW explicit request — it is never
 *    auto-re-driven;
 *  · missing required material returns `state: 'blocked'` with the reason. It
 *    does not delete the suggestion and does not affect another client;
 *  · it never approves, schedules, publishes or sends.
 */
export async function requestDraft(
  client: EditorialClient, clientId: string, briefId: string, version: number,
  expectedHash: string, requestId: string, artifactRole: string,
): Promise<DraftReceipt> {
  const lane = assertRegisteredClient(clientId)
  if (!client.functions || !briefId || !Number.isInteger(version) || version < 1 ||
      !/^[0-9a-f]{64}$/.test(expectedHash) || !requestId || !artifactRole) {
    throw new EditorialContractError('invalid_argument', 'An authenticated function client and exact brief identity are required.', 'requestDraft')
  }
  const { data, error } = await client.functions.invoke('editorial-draft', {
    body: { client_id: lane, brief_id: briefId, version, expected_hash: expectedHash, request_id: requestId, artifact_role: artifactRole },
  })
  if (error || !isObj(data)) throw new EditorialContractError('read_failed', 'The draft request failed.', error?.message ?? 'No receipt')
  return data as DraftReceipt
}

/** An explicit human review writes a new immutable brief version. Passing it
    authorizes an internal draft request only; it never approves publication. */
export async function reviewEditorialBrief(
  client: EditorialClient, clientId: string, briefId: string, version: number,
  expectedHash: string, verdict: 'pass' | 'revise' | 'fail', reason: string, requestId: string,
): Promise<{ state: 'accepted' | 'blocked' | 'conflict'; brief_id?: string;
  version?: number; content_hash?: string; reason?: string; idempotent_replay?: boolean }> {
  const lane = assertRegisteredClient(clientId)
  if (!client.functions || !briefId || !Number.isInteger(version) || version < 1 ||
      !/^[0-9a-f]{64}$/.test(expectedHash) || !reason.trim() || !requestId.trim()) {
    throw new EditorialContractError('invalid_argument', 'Review needs an authenticated client, exact version/hash, reason and request ID.', 'reviewEditorialBrief')
  }
  const { data, error } = await client.functions.invoke('editorial-review', {
    body: { client_id: lane, brief_id: briefId, version, expected_hash: expectedHash,
      verdict, reason, request_id: requestId },
  })
  if (error || !isObj(data)) throw new EditorialContractError('read_failed', 'The editorial review failed.', error?.message ?? 'No receipt')
  return data as { state: 'accepted' | 'blocked' | 'conflict'; brief_id?: string;
    version?: number; content_hash?: string; reason?: string; idempotent_replay?: boolean }
}

/**
 * SPECIFIED FOR RUN 2 — `CONTRACT.json#/schemas/RefreshReceipt`.
 *
 * CONTRACT:
 *  · authenticated and tenant-scoped; validates `expectedDirectionVersion`
 *    against the client's active direction and returns a conflict receipt
 *    rather than synthesizing against a stale direction;
 *  · snapshots the available inputs into an immutable `InputManifest` and
 *    invokes a BOUNDED synthesis producer. It starts no acquisition, no paid
 *    source call, no approval and no drafting — the three `starts_*` fields
 *    are frozen `false`;
 *  · idempotent on `requestId`: a repeat returns the existing receipt
 *    (`deduplicated: true`). Equivalent unchanged input reuses the existing
 *    successful batch instead of producing a second one;
 *  · serialized per client (the partial unique index
 *    `editorial_refresh_active_one_per_client`), so two concurrent refreshes
 *    for one lane cannot both run;
 *  · decisions recorded after the input snapshot are PRESERVED and mark the
 *    batch `awaiting_reconciliation`; a stale decision cutoff yields
 *    `pending_reconciliation`, never an overwrite.
 */
export async function requestSuggestionRefresh(
  client: EditorialClient, clientId: string,
  expectedDirectionVersion: string, requestId: string,
  weekly?: { week_start: string; expected_manifest_hash: string; provisional_policy_suggestion_id?: string },
): Promise<RefreshReceipt> {
  const lane = assertRegisteredClient(clientId)
  if (!client.functions || !expectedDirectionVersion || !requestId) {
    throw new EditorialContractError('invalid_argument', 'An authenticated function client, direction version and request id are required.', 'requestSuggestionRefresh')
  }
  if (weekly && (!/^\d{4}-\d{2}-\d{2}$/.test(weekly.week_start) ||
      !/^[a-f0-9]{64}$/.test(weekly.expected_manifest_hash) ||
      weekly.provisional_policy_suggestion_id !== undefined && !weekly.provisional_policy_suggestion_id.trim()))
    throw new EditorialContractError('invalid_argument', 'A valid saved week and exact plan hash are required.', 'requestSuggestionRefresh')
  const { data, error } = await client.functions.invoke('editorial-refresh', {
    body: { client_id: lane, expected_direction_version: expectedDirectionVersion, request_id: requestId,
      ...(weekly ? { week_start: weekly.week_start, expected_manifest_hash: weekly.expected_manifest_hash,
        ...(weekly.provisional_policy_suggestion_id ? { provisional_policy_suggestion_id: weekly.provisional_policy_suggestion_id } : {}) } : {}) },
  })
  if (error || !isObj(data)) throw new EditorialContractError('read_failed', 'The refresh request failed.', error?.message ?? 'No receipt')
  return data as RefreshReceipt
}

/**
 * SPECIFIED FOR RUN 2 — `CONTRACT.json#/schemas/RefreshState`.
 *
 * CONTRACT:
 *  · side-effect free;
 *  · reports collection health and synthesis health as SEPARATE fields — a
 *    healthy collector with a failed synthesis is not a healthy surface;
 *  · on an empty or failed refresh it still names `last_usable_batch_id`: the
 *    previous shortlist is retained and the status is exposed. Suggestions are
 *    never erased by a failure;
 *  · a partial batch carries its exact `coverage_gaps` and cannot certify a
 *    client or a format it did not cover.
 */
export async function readSuggestionRefresh(
  client: EditorialClient, clientId: string, refreshId: string,
): Promise<RefreshState> {
  const lane = assertRegisteredClient(clientId)
  if (!refreshId) throw new EditorialContractError('invalid_argument', 'A refresh id is required.', 'readSuggestionRefresh')
  const r = await callRpc(client, 'editorial_read_refresh', {
    p_gate: EDITORIAL_GATE, p_client_id: lane, p_refresh_id: refreshId,
  })
  if (!r.ok) throw new EditorialContractError('read_failed', 'The refresh read failed.', r.error)
  return r.data as RefreshState
}

/* -------------------------------------------------------------------------
   Shape assertions for the Run-2 types. These exist so a change to
   editorialTypes.ts that breaks the frozen contract fails the BUILD, not a
   later run. They are type-level only and erase to nothing.
   ------------------------------------------------------------------------- */

export type FrozenRun2Shapes = {
  batch: Batch
  manifest: InputManifest
  refreshReceipt: RefreshReceipt
  refreshState: RefreshState
  draftReceipt: DraftReceipt
  briefRef: BriefVersionRef
}

/** The operator gate this adapter presents. It is the SAME constant the rest
    of the client-ops surface uses (`CLIENT_OPS_GATE` in src/lib/content.ts);
    it is restated here rather than imported so this module keeps zero runtime
    dependencies and stays importable by a node test with no DOM. */
export const EDITORIAL_GATE = 'clientops'
