/* ==========================================================================
   src/lib/editorialSources.ts — the typed, authenticated SOURCE-side adapter.

   ONE IMPLEMENTED FUNCTION: `readResearch`. It reads `editorial_sources`
   through `public.editorial_read_research` (db/105_editorial_brief_contract.sql)
   — the newest snapshot of every distinct source in one lane, tenant-scoped
   server-side by `editorial_guard`. Side-effect free: no curation row, no seen
   record, no generation request is written by a read (T12).

   AN INJECTED CLIENT, ALWAYS. Nothing in this module imports `./supabase`.
   `readResearch` takes an `EditorialClient` (`{ rpc(name, params) }`) as its
   first argument — the same shape `editorialBriefs.ts` takes — so the whole
   module is unit-testable with a stub and a test can never reach a network.

   WHAT THIS ADAPTER REFUSES, rather than smooths over:
     · an unregistered client id, BEFORE any query is issued (T02);
     · a source that arrives scoped to a tenant other than the one asked for —
       belt and braces over what `editorial_guard` already enforces server-side;
     · a `source_published_date` collapsed from the capture date, or from
       `null`, into anything but the literal 'unknown' (T03);
     · a `currency_state: 'current'` the server sent for evidence this adapter
       can itself compute is older than the stale bound — recomputed from the
       publication date only, same rule `deriveCurrencyState` states (T07);
     · a source row whose `source_kind` this contract does not recognize, or
       whose body arrived neither retained nor gapped — LISTED as a gap,
       never silently dropped from the page (T06, T04's truncation rule);
     · a derived item with no `derived_from`, or an item scoped `independent`
       that contradicts its own gap state.

   WHAT IT TRUSTS FROM THE SERVER, and why that differs from editorialBriefs.ts.
   `editorialBriefs.ts` recomputes `independent_source_count` from the evidence
   array on every read because a brief's evidence always arrives WHOLE — it is
   a bounded array carried entirely inside one JSON object. `readResearch`
   returns a CURSOR-PAGINATED page: `independent_source_count` is a population
   aggregate computed server-side over sources this page did not all carry.
   Recomputing it from page items alone would silently UNDER-count relative to
   the true population, which is a worse lie than trusting the server. So this
   adapter recomputes from the items in hand only in the one case where doing
   so is honest — when the whole filtered population fit on this one page
   (`items.length === total` and there is no `next_cursor`) — and otherwise
   reports the server's count, floored at zero. See `resolveIndependentCount`.
   ========================================================================== */
import {
  CANDIDATE_DERIVED_FIELDS, CURATION_STATES, EDITORIAL_RPCS, EditorialContractError,
  SOURCE_KINDS, UNKNOWN, countIndependentSources, daysBetween, deriveCurrencyState,
  isEditorialClientId, isUnknown,
} from './editorialTypes.ts'
import { resolveEvidenceCompleteness } from './editorialEvidenceCompleteness.ts'
import type {
  CandidateFields, CurationState, CurrencyState, EditorialClient, EditorialClientId,
  GapReason, PermissionState, SourceFilters, SourceGapState, SourceKind, SourcePage,
  SourcePageGap, SourceRef, SourceSnapshot,
} from './editorialTypes.ts'

/* -------------------------------------------------------------------------
   Guards and small readers — mirrors editorialBriefs.ts's shape exactly so
   the two adapters read as one contract even though neither imports the
   other. (Duplicated, not shared: see "Known limits" in the builder receipt
   for the same trade-off editorialBriefs.ts made with EDITORIAL_GATE.)
   ------------------------------------------------------------------------- */

/** The tenant check that runs BEFORE any query. An id outside the explicit
    registry never reaches the database (T02): a typo in the app fails loudly
    at the boundary, and the server repeats the same check in
    `editorial_guard` regardless. */
export function assertRegisteredClient(clientId: unknown): EditorialClientId {
  if (!isEditorialClientId(clientId)) {
    throw new EditorialContractError(
      'unknown_client',
      'That client id is not in the editorial registry, so no research read was issued.',
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

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
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
    // empty page — the same rule editorialBriefs.ts and contentEvidence.ts
    // state for their own reads.
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** The operator gate this adapter presents. Restated rather than imported
    from `editorialBriefs.ts` or `content.ts` so the two Run-1 adapters stay
    independent modules and neither has to load the other to be unit-tested.
    Change one, change both. */
export const EDITORIAL_GATE = 'clientops'

/* -------------------------------------------------------------------------
   Filter validation. An unrecognized value is DROPPED from what reaches the
   RPC and SURFACED as a gap — never silently swallowed into an empty result
   the caller would misread as "this lane has nothing" (T06).
   ------------------------------------------------------------------------- */

function splitKindFilter(
  kinds: readonly string[] | undefined,
): { valid: SourceKind[]; gaps: SourcePageGap[] } {
  const valid: SourceKind[] = []
  const gaps: SourcePageGap[] = []
  for (const k of kinds ?? []) {
    if ((SOURCE_KINDS as readonly string[]).includes(k)) valid.push(k as SourceKind)
    else {
      gaps.push({
        source_id: null,
        reason: 'unsupported_kind',
        detail: `Requested source kind "${k}" is not one this contract recognizes; it was `
          + 'dropped from the filter and listed here rather than silently returning nothing for it.',
      })
    }
  }
  return { valid, gaps }
}

function splitCurationFilter(
  states: readonly string[] | undefined,
): { valid: CurationState[]; gaps: SourcePageGap[] } {
  const valid: CurationState[] = []
  const gaps: SourcePageGap[] = []
  for (const s of states ?? []) {
    if ((CURATION_STATES as readonly string[]).includes(s)) valid.push(s as CurationState)
    else {
      gaps.push({
        source_id: null,
        reason: 'unsupported_kind',
        detail: `Requested curation state "${s}" is not one this contract recognizes; it was `
          + 'dropped from the filter and listed here rather than silently returning nothing for it.',
      })
    }
  }
  return { valid, gaps }
}

/* -------------------------------------------------------------------------
   Item parsing. Every source row is either a well-formed SourceSnapshot or an
   explicit, addressed gap — never a row that vanishes with no trace (T06).
   ------------------------------------------------------------------------- */

function parseSourceRef(raw: unknown): SourceRef | null {
  if (!isObj(raw)) return null
  const url = str(raw.url)
  if (url) return { url }
  const pointer = str(raw.excerpt_pointer)
  if (pointer) return { excerpt_pointer: pointer }
  return null
}

function parseGapState(raw: unknown): SourceGapState | null {
  if (!isObj(raw)) return null
  const reason = str(raw.reason)
  const detail = str(raw.detail)
  const known: readonly string[] = ['permission_denied', 'unavailable', 'expired', 'partial']
  if (!reason || !detail || !known.includes(reason)) return null
  return { reason: reason as GapReason, detail }
}

/** All five candidate fields, or none. A source claiming `source_kind:
    'candidate'` with a partial `candidate_fields` object is exactly the
    "silently dropped input" this contract refuses (T04). */
function parseCandidateFields(raw: unknown, kind: SourceKind): CandidateFields | null {
  if (!isObj(raw)) return null
  const evidence = str(raw.evidence)
  const rawContext = str(raw.raw_context)
  const assessment = str(raw.editorial_assessment)
  const strength = str(raw.editorial_strength)
  const angleOptions = Array.isArray(raw.angle_options)
    ? raw.angle_options.filter((x): x is string => typeof x === 'string')
    : null
  if (kind === 'candidate' && (!evidence || !rawContext || !assessment || !strength || !angleOptions)) return null
  return raw as CandidateFields
}

function sourceIdentity(raw: CandidateFields | null, sourceId: string): SourceSnapshot['source_identity'] {
  const identity = raw?.source_identity
  if (isObj(identity) && str(identity.platform) && str(identity.native_id)) {
    return { platform: str(identity.platform)!, native_id: str(identity.native_id)!,
      collector_row_id: str(identity.collector_row_id) }
  }
  return { platform: 'unknown', native_id: sourceId, collector_row_id: null }
}

function metricProvenance(raw: CandidateFields | null): SourceSnapshot['metric_provenance'] {
  const window = raw?.observation_window
  return {
    source: str(raw?.metric_source),
    denominator: str(raw?.metric_denominator),
    observation_window: isObj(window) ? window : null,
  }
}

export type ParsedSourceItem =
  | { ok: true; item: SourceSnapshot }
  | { ok: false; gap: SourcePageGap }

/** Parses one wire row into a `SourceSnapshot`, or an explicit gap when the
    row cannot honestly be represented as one.

    THROWS (rather than gaps) for the two violations that are never merely
    "this one row is unusable": a passage the server itself flagged as
    truncated (`truncated_passage` — T04, mirrors
    `assertEvidenceBodyIntact` in editorialBriefs.ts), and a retained body
    with neither a passage+hash nor an explicit gap state
    (`permission_gap`) — both mean the adapter cannot tell what it is
    looking at, which is different from a row it can identify as simply
    unsupported. */
export function parseSourceItem(raw: unknown, lane: EditorialClientId): ParsedSourceItem {
  if (!isObj(raw)) {
    return { ok: false, gap: { source_id: null, reason: 'unavailable', detail: 'A source row on the wire was not a usable object.' } }
  }
  const sourceId = str(raw.source_id)
  if (!sourceId) {
    return { ok: false, gap: { source_id: null, reason: 'unavailable', detail: 'A source row arrived with no source_id.' } }
  }
  const kindRaw = str(raw.source_kind)
  if (!kindRaw || !(SOURCE_KINDS as readonly string[]).includes(kindRaw)) {
    return {
      ok: false,
      gap: {
        source_id: sourceId, reason: 'unsupported_kind',
        detail: `Source kind "${kindRaw ?? 'missing'}" is not one this contract recognizes.`,
      },
    }
  }
  const kind = kindRaw as SourceKind

  const scope = str(raw.source_client_scope)
  if (!scope) {
    throw new EditorialContractError(
      'wrong_client',
      'A source arrived without an explicit tenant scope; refusing to assume it is public.',
      sourceId,
    )
  }
  if (scope !== 'public' && scope !== lane) {
    // Belt and braces over `editorial_guard` and the RLS-equivalent
    // `where s.client_id = p_client_id` in the SQL: a source scoped to a
    // tenant other than the one asked for is refused here too, rather than
    // returned and trusted (T02).
    throw new EditorialContractError(
      'wrong_client',
      'A source arrived scoped to a different tenant than the one requested; refusing to return it.',
      `${sourceId} scope=${scope} requested=${lane}`,
    )
  }

  const sourceRef = parseSourceRef(raw.source_ref)
  if (!sourceRef) {
    return {
      ok: false,
      gap: { source_id: sourceId, reason: 'unavailable', detail: 'The source carries neither a url nor an excerpt_pointer.' },
    }
  }

  if ((raw as Record<string, unknown>).passage_truncated === true) {
    throw new EditorialContractError(
      'truncated_passage',
      'A supporting passage arrived truncated; the source is not readable as evidence.',
      sourceId,
    )
  }

  const gapState = parseGapState(raw.gap_state)
  const passage = str(raw.passage)
  const contentHash = str(raw.source_content_hash)
  if (gapState === null && (!passage || !contentHash)) {
    throw new EditorialContractError(
      'permission_gap',
      'The source carries neither a retained body with its hash nor an explicit gap state.',
      sourceId,
    )
  }

  const independent = raw.independent !== false
  const derivedFrom = str(raw.derived_from)
  if (!independent && !derivedFrom) {
    return {
      ok: false,
      gap: { source_id: sourceId, reason: 'unavailable', detail: 'A derived source arrived with no derived_from origin.' },
    }
  }

  const candidateFields = parseCandidateFields(raw.candidate_fields, kind)
  if (kind === 'candidate' && candidateFields === null && gapState?.reason !== 'permission_denied') {
    return {
      ok: false,
      gap: { source_id: sourceId, reason: 'unavailable', detail: 'A candidate source arrived without its required candidate_fields.' },
    }
  }

  // `source_published_date`: the literal 'unknown' when the record has none,
  // NEVER the capture date and never a coerced-from-null guess (T03).
  const publishedRaw = str(raw.source_published_date)
  const publishedDate = publishedRaw ?? UNKNOWN
  const capturedDate = str(raw.captured_date) ?? UNKNOWN

  // Currency and age are RECOMPUTED here from the publication date alone,
  // never trusted off the wire: a fresh capture can never make an old post
  // "current" (T07). `daysBetween`/`deriveCurrencyState` are the same
  // functions editorialBriefs.ts uses for evidence currency, so the two
  // adapters can never disagree about what "120 days" means.
  const nowIso = new Date().toISOString()
  const currencyState: CurrencyState = deriveCurrencyState(publishedDate, nowIso)
  const ageDays = daysBetween(publishedDate, nowIso)

  const derivedFieldNames = kind === 'candidate'
    ? [...CANDIDATE_DERIVED_FIELDS]
    : arr(raw.derived_field_names).filter((x): x is string => typeof x === 'string')

  const completeness = resolveEvidenceCompleteness({
    body: passage,
    declaredState: candidateFields?.body_state,
    fetchFailed: gapState?.reason === 'unavailable',
  })
  const observations = candidateFields?.observed_metrics
  const item: SourceSnapshot = {
    source_id: sourceId,
    source_kind: kind,
    source_client_scope: scope as SourceSnapshot['source_client_scope'],
    source_ref: sourceRef,
    source_published_date: publishedDate,
    captured_date: capturedDate,
    owner: str(raw.owner) ?? UNKNOWN,
    source_content_hash: contentHash,
    passage,
    body_state: completeness.bodyState,
    source_identity: sourceIdentity(candidateFields, sourceId),
    observed_metrics: isObj(observations) ? observations : null,
    metric_provenance: metricProvenance(candidateFields),
    retained_context: str(raw.retained_context) ?? '',
    limitation: str(raw.limitation) ?? '',
    independent,
    derived_from: derivedFrom,
    permission_state: (str(raw.permission_state) as PermissionState | null) ?? 'unknown',
    gap_state: gapState,
    currency_state: currencyState,
    age_days: ageDays,
    snapshot_hash: str(raw.snapshot_hash) ?? '',
    curation_state: (str(raw.curation_state) as CurationState | null) ?? 'unseen',
    seen_version: num(raw.seen_version) ?? 1,
    candidate_fields: candidateFields,
    derived_field_names: derivedFieldNames,
  }
  return { ok: true, item }
}

/* -------------------------------------------------------------------------
   Population-vs-page independent count. See the module header: recomputing
   from page items is only honest when the page IS the whole population.
   ------------------------------------------------------------------------- */

export function resolveIndependentCount(
  items: readonly SourceSnapshot[], total: number, nextCursor: string | null,
  serverCount: number | null,
): number {
  const wholePopulationInHand = nextCursor === null && items.length === total
  if (wholePopulationInHand) return countIndependentSources(items)
  return serverCount !== null ? Math.max(0, Math.trunc(serverCount)) : countIndependentSources(items)
}

/* -------------------------------------------------------------------------
   `publishedSince` — a best-effort narrowing of the page already fetched.
   Documented limitation (not silently perfect): it does not change
   pagination math. `total`, `independent_source_count` and `next_cursor`
   describe the server's kind/curation-filtered population, not the
   publishedSince-narrowed one, because the underlying RPC (db/105) has no
   server-side publishedSince parameter to push this into. A source with an
   unknown publication date is never dropped by this filter — an unknown date
   cannot be shown to be BEFORE the cutoff, so it stays.
   ------------------------------------------------------------------------- */

export function applyPublishedSince(
  items: readonly SourceSnapshot[], publishedSince: string | undefined,
): SourceSnapshot[] {
  if (!publishedSince) return [...items]
  const cutoff = Date.parse(publishedSince)
  if (!Number.isFinite(cutoff)) return [...items]
  return items.filter((i) => {
    if (isUnknown(i.source_published_date)) return true
    const t = Date.parse(String(i.source_published_date))
    return !Number.isFinite(t) || t >= cutoff
  })
}

/* -------------------------------------------------------------------------
   Page-level assembly
   ------------------------------------------------------------------------- */

function emptyHealth(): SourcePage['health'] {
  return {
    last_successful_collection: UNKNOWN, source_cutoff: UNKNOWN,
    new_evidence_awaiting_refresh: 0, stale_inputs: 0,
  }
}

function parseHealth(raw: unknown): SourcePage['health'] {
  if (!isObj(raw)) return emptyHealth()
  return {
    last_successful_collection: str(raw.last_successful_collection) ?? UNKNOWN,
    source_cutoff: str(raw.source_cutoff) ?? UNKNOWN,
    new_evidence_awaiting_refresh: num(raw.new_evidence_awaiting_refresh) ?? 0,
    stale_inputs: num(raw.stale_inputs) ?? 0,
  }
}

function failedPage(clientId: EditorialClientId, message: string): SourcePage {
  return {
    client_id: clientId, state: 'failed', items: [], total: 0, independent_source_count: 0,
    next_cursor: null, health: emptyHealth(), gaps: [], message,
  }
}

/** The read state of the page. The RPC itself only ever emits `ready` or
    `empty` (db/105); a `ready` population that lost rows to a gap on THIS
    adapter's side (an unsupported kind, a malformed row) is downgraded to
    `partial` here rather than presented as a clean read — the same
    "confirmed-empty vs unread" discipline `contentEvidence.ts` states, applied
    to "fully readable vs partially readable" instead. */
function resolveState(
  rpcState: unknown, total: number, gapCount: number,
): SourcePage['state'] {
  const s = str(rpcState)
  if (s === 'ready' || s === 'partial' || s === 'empty' || s === 'stale' || s === 'failed') {
    if (s === 'ready' && gapCount > 0) return 'partial'
    return s
  }
  if (total === 0) return 'empty'
  return gapCount > 0 ? 'partial' : 'ready'
}

/** One page of the research pool for one lane: the newest snapshot of every
    distinct source, server-scoped and server-deduplicated by `source_id`.
    Side-effect free (T12) — the RPC is `stable` and writes nothing.

    A caller-supplied `clientId` outside the explicit registry is refused
    before any query is issued (T02). An unsupported `filters.kinds` /
    `filters.curation` value is dropped from what reaches the server and
    listed in `gaps` (T06), never silently swallowed into an empty page.
    `filters.relation` has no effect here: relation is established when a
    source becomes one piece of evidence inside a brief
    (`BriefEvidence.relation`), not an intrinsic property of the source
    snapshot itself — there is nothing on `SourceSnapshot` for it to filter
    against, so it is accepted and ignored rather than rejected as an error. */
export async function readResearch(
  client: EditorialClient,
  clientId: string,
  filters: SourceFilters = {},
  cursor: string | null = null,
  limit = 50,
): Promise<SourcePage> {
  const lane = assertRegisteredClient(clientId)

  const { valid: validKinds, gaps: kindGaps } = splitKindFilter(filters.kinds)
  const { valid: validCuration, gaps: curationGaps } = splitCurationFilter(filters.curation)

  const rpcFilters: Record<string, unknown> = {}
  if (validKinds.length) rpcFilters.kinds = validKinds
  if (validCuration.length) rpcFilters.curation = validCuration

  const r = await callRpc(client, EDITORIAL_RPCS.readResearch, {
    p_gate: EDITORIAL_GATE, p_client_id: lane, p_filters: rpcFilters,
    p_cursor: cursor, p_limit: limit,
  })
  if (!r.ok) return failedPage(lane, r.error)

  const d = r.data
  const gaps: SourcePageGap[] = [...kindGaps, ...curationGaps]
  const items: SourceSnapshot[] = []
  for (const raw of arr(d.items)) {
    const parsed = parseSourceItem(raw, lane)
    if (parsed.ok) items.push(parsed.item)
    else gaps.push(parsed.gap)
  }
  // Gaps the server itself reports (permission-denied / unavailable sources
  // it chose not to include as full items) are carried through, never merged
  // away — they answer "what exists but could not be shown", distinct from
  // "what this adapter could not parse".
  for (const g of arr(d.gaps)) {
    if (!isObj(g)) continue
    const reason = str(g.reason)
    const detail = str(g.detail)
    const known: readonly string[] = ['permission_denied', 'unavailable', 'expired', 'partial']
    if (reason && detail && known.includes(reason)) {
      gaps.push({ source_id: str(g.source_id), reason: reason as GapReason, detail })
    }
  }

  const total = num(d.total) ?? items.length
  const nextCursor = str(d.next_cursor)
  const independentCount = resolveIndependentCount(items, total, nextCursor, num(d.independent_source_count))
  const filteredItems = applyPublishedSince(items, filters.publishedSince)

  return {
    client_id: lane,
    state: resolveState(d.state, total, gaps.length),
    items: filteredItems,
    total,
    independent_source_count: independentCount,
    next_cursor: nextCursor,
    health: parseHealth(d.health),
    gaps,
    ...(str(d.message) ? { message: str(d.message) as string } : {}),
  }
}
