/* ==========================================================================
   src/lib/editorialSources.fixtures.ts — synthetic source rows and a stub
   client for the SOURCE-side adapter.

   Every string here is invented for the shape it exercises. No post body, no
   author name, no client receipt and no real source id is in this file: the
   project rule is explicit that private corpus text never enters the repo —
   see BRIEF-CONTRACT.md's worked-evidence seed, which names a real
   risedtc post and stays entirely out of test fixtures. `research/snapshots/
   {ivan,risedtc,arch}.json` was read to model REAL ROW SHAPES (lm_idea_
   candidates' five candidate fields, own_posts' metric formula, client_
   research_findings' baseline/lift columns) but no value from those files is
   copied here.

   `rawSourceItem` / `rawResearchPage` build WIRE-shaped plain objects — the
   same snake_case shape `editorial_read_research` (db/105) actually returns —
   rather than already-typed `SourceSnapshot`s, because the tests in
   `editorialSources.test.ts` exist to prove the adapter's own parsing and
   recomputation, not to echo a pre-built object back at itself. A test that
   wants a typed `SourceSnapshot` directly (for a pure-function check that
   never goes through `readResearch`) uses `sourceSnapshot` instead.

   `stubClient` / `failingClient` are LOCAL copies of the same two helpers
   `editorialBriefs.fixtures.ts` defines. Duplicated on purpose, not shared:
   see "Known limits" in the adapter builder receipt — the same trade-off
   `EDITORIAL_GATE` makes in `editorialSources.ts` itself, so this module
   never has to import the other seat's file to be tested.
   ========================================================================== */
import type {
  CandidateFields, CurationState, EditorialClient, EditorialClientId,
  EditorialRpcResult, GapReason, PermissionState, SourceKind, SourceRef, SourceSnapshot,
} from './editorialTypes'

/* -------------------------------------------------------------------------
   The stub client (local copy — see header)
   ------------------------------------------------------------------------- */

export type StubCall = { fn: string; params: Record<string, unknown> }

export type StubRoutes = Record<
  string,
  (params: Record<string, unknown>) => EditorialRpcResult | Promise<EditorialRpcResult>
>

/** Records every call it receives, which is how a test proves an unregistered
    client id was rejected BEFORE any query was issued. */
export function stubClient(routes: StubRoutes): EditorialClient & { calls: StubCall[] } {
  const calls: StubCall[] = []
  return {
    calls,
    async rpc(fn: string, params: Record<string, unknown>): Promise<EditorialRpcResult> {
      calls.push({ fn, params })
      const route = routes[fn]
      if (!route) return { data: null, error: { message: `no stub route for ${fn}` } }
      return route(params)
    },
  }
}

/** A stub whose every route rejects — the transport-failure case (T12/failed
    state, never collapsed into 'empty'). */
export function failingClient(message = 'network refused'): EditorialClient & { calls: StubCall[] } {
  const calls: StubCall[] = []
  return {
    calls,
    async rpc(fn: string, params: Record<string, unknown>): Promise<EditorialRpcResult> {
      calls.push({ fn, params })
      return { data: null, error: { message } }
    },
  }
}

/* -------------------------------------------------------------------------
   Wire-shaped rows — what editorial_read_research actually returns
   ------------------------------------------------------------------------- */

export const FIXTURE_NOW = () => new Date()

/** ISO date `days` ago, computed relative to the real clock at test-run time
    — the same trick `db/tests/editorial_brief_contract.sql` uses
    (`now() - interval '200 days'`) instead of a fixed absolute date, so the
    fixture's staleness stays true no matter when the suite runs. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export type RawCandidateFields = {
  evidence: string
  raw_context: string
  editorial_assessment: string
  editorial_strength: string
  angle_options: string[]
}

export function rawCandidateFields(over: Partial<RawCandidateFields> = {}): RawCandidateFields {
  return {
    evidence: 'A synthetic source-fact sentence standing in for a retained observation.',
    raw_context: 'A synthetic block of surrounding context, source fact.',
    editorial_assessment: "A synthetic model opinion about why this might matter — derived, not observed.",
    editorial_strength: 'medium',
    angle_options: ['a synthetic angle one', 'a synthetic angle two'],
    ...over,
  }
}

/** One wire-shaped source row, matching the object `editorial_read_research`
    builds in db/105 field-for-field. Defaults to a fresh, independent,
    public, fully-retained `public_post` so a test that wants to break ONE
    field starts from a row that would otherwise pass every check. */
export function rawSourceItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    source_id: 'urn:fixture:source:1',
    source_kind: 'public_post',
    source_client_scope: 'public',
    source_ref: { url: 'https://fixture.invalid/source-1' },
    source_published_date: daysAgoIso(10),
    captured_date: daysAgoIso(1),
    owner: 'Synthetic Author A',
    source_content_hash: 'a'.repeat(64),
    passage: 'A bounded synthetic excerpt standing in for a retained source body.',
    retained_context: 'Synthetic context around the excerpt.',
    limitation: 'One account, one observation.',
    independent: true,
    derived_from: null,
    permission_state: 'public_source',
    gap_state: null,
    currency_state: 'current',
    age_days: 10,
    snapshot_hash: 'snap-fixture-1-v1',
    curation_state: 'unseen',
    seen_version: 1,
    candidate_fields: null,
    derived_field_names: [],
  }
  return { ...base, ...over }
}

/** A `candidate`-kind row carrying all five `lm_idea_candidates`-shaped
    fields — modeled on research/snapshots/ivan.json's `candidates.items[]`
    shape (source, raw_topic, evidence[], editorial_assessment,
    editorial_strength, angle_options), with every value synthetic. */
export function rawCandidateSourceItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return rawSourceItem({
    source_id: 'urn:fixture:candidate:1',
    source_kind: 'candidate',
    source_ref: { excerpt_pointer: 'editorial_sources:urn:fixture:candidate:1:passage@1' },
    candidate_fields: rawCandidateFields(),
    derived_field_names: ['editorial_assessment', 'editorial_strength', 'angle_options'],
    ...over,
  })
}

/** A repost of `urn:fixture:source:1` under a different row id — derived,
    names its origin, adds no independent corroboration. Mirrors the SQL
    fixture in db/tests/editorial_brief_contract.sql section on duplicate
    evidence. */
export function rawRepostSourceItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return rawSourceItem({
    source_id: 'urn:fixture:source:1-repost',
    independent: false,
    derived_from: 'urn:fixture:source:1',
    owner: 'Synthetic Reposter',
    ...over,
  })
}

/** A source with no publication date at all — the honest answer is the
    literal 'unknown', never the capture date and never a guessed date. */
export function rawUndatedSourceItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return rawSourceItem({
    source_id: 'urn:fixture:source:nodate',
    source_kind: 'call',
    source_ref: { excerpt_pointer: 'editorial_sources:urn:fixture:source:nodate:passage@1' },
    source_published_date: 'unknown',
    currency_state: 'unknown',
    age_days: null,
    permission_state: 'granted',
    ...over,
  })
}

/** Published 200 days ago, captured yesterday — historical, however fresh
    the capture. The server-sent `currency_state`/`age_days` here are
    DELIBERATELY WRONG ('current' / 1) so a test can prove the adapter
    recomputes rather than trusting them (T07). */
export function rawStaleSourceItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return rawSourceItem({
    source_id: 'urn:fixture:source:old',
    source_published_date: daysAgoIso(200),
    captured_date: daysAgoIso(1),
    currency_state: 'current',
    age_days: 1,
    ...over,
  })
}

/** A permission-denied asset: pointer retained, body withheld. */
export function rawGapSourceItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return rawSourceItem({
    source_id: 'urn:fixture:source:denied',
    source_kind: 'asset',
    source_ref: { excerpt_pointer: 'editorial_sources:urn:fixture:source:denied:passage@1' },
    source_published_date: 'unknown',
    passage: null,
    source_content_hash: null,
    permission_state: 'denied',
    gap_state: { reason: 'permission_denied', detail: 'The asset owner has not granted republication.' },
    currency_state: 'unknown',
    age_days: null,
    ...over,
  })
}

export type RawResearchPageOverrides = {
  client_id?: string
  state?: string
  total?: number
  independent_source_count?: number
  next_cursor?: string | null
  health?: Record<string, unknown>
  gaps?: unknown[]
  message?: string
}

/** The full wire-shaped `editorial_read_research` payload. */
export function rawResearchPage(
  clientId: string, items: Record<string, unknown>[], over: RawResearchPageOverrides = {},
): Record<string, unknown> {
  const base = {
    client_id: clientId,
    state: items.length ? 'ready' : 'empty',
    items,
    total: items.length,
    independent_source_count: items.filter((i) => i.independent === true && i.gap_state == null).length,
    next_cursor: null,
    health: {
      last_successful_collection: daysAgoIso(1),
      source_cutoff: daysAgoIso(1),
      new_evidence_awaiting_refresh: 0,
      stale_inputs: 0,
    },
    gaps: [],
  }
  return { ...base, ...over }
}

/* -------------------------------------------------------------------------
   Typed SourceSnapshot builder — for pure-function tests that never go
   through readResearch's own parsing.
   ------------------------------------------------------------------------- */

export function sourceSnapshot(over: Partial<SourceSnapshot> = {}): SourceSnapshot {
  const base: SourceSnapshot = {
    source_id: 'urn:fixture:source:1',
    source_kind: 'public_post' as SourceKind,
    source_client_scope: 'public',
    source_ref: { url: 'https://fixture.invalid/source-1' } as SourceRef,
    source_published_date: daysAgoIso(10),
    captured_date: daysAgoIso(1),
    owner: 'Synthetic Author A',
    source_content_hash: 'a'.repeat(64),
    passage: 'A bounded synthetic excerpt.',
    retained_context: 'Synthetic context.',
    limitation: 'One account, one observation.',
    independent: true,
    derived_from: null,
    permission_state: 'public_source' as PermissionState,
    gap_state: null,
    currency_state: 'current',
    age_days: 10,
    snapshot_hash: 'snap-fixture-1-v1',
    curation_state: 'unseen' as CurationState,
    seen_version: 1,
    candidate_fields: null,
    derived_field_names: [],
  }
  return { ...base, ...over }
}

export function lanes(): EditorialClientId[] {
  return ['ivan', 'risedtc', 'arch']
}

export const FIXTURE_GAP_REASONS: readonly GapReason[] = [
  'permission_denied', 'unavailable', 'expired', 'partial',
]

export function fixtureCandidateFields(over: Partial<CandidateFields> = {}): CandidateFields {
  return { ...rawCandidateFields(), ...over } as CandidateFields
}
