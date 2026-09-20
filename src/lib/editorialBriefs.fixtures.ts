/* ==========================================================================
   src/lib/editorialBriefs.fixtures.ts — synthetic briefs and a stub client.

   Every string here is invented for the shape it exercises. No post body, no
   author name, no client receipt and no real source id is in this file: the
   project rule is explicit that private corpus text never enters the repo, so
   tests use small synthetic fixtures.

   `stubClient` is an `EditorialClient` backed by a routing table. It opens no
   socket, so importing this file can never reach a live project.
   ========================================================================== */
import type {
  BriefEvidence, BriefMeasurement, EditorialBrief, EditorialClient,
  EditorialClientId, EditorialRpcResult,
} from './editorialTypes'

export const FIXTURE_CREATED_AT = '2026-09-20T09:00:00Z'

export function evidence(over: Partial<BriefEvidence> = {}): BriefEvidence {
  return {
    evidence_id: 'ev-01',
    relation: 'observed_market_performance',
    source_id: 'urn:fixture:source:1',
    source_kind: 'public_post',
    source_client_scope: 'public',
    source_ref: { url: 'https://fixture.invalid/source-1' },
    source_published_date: '2026-09-01T00:00:00Z',
    captured_date: '2026-09-18T00:00:00Z',
    currency_state: 'current',
    owner: 'Synthetic Author A',
    source_content_hash: 'a'.repeat(64),
    passage: 'A bounded synthetic excerpt standing in for a retained source body.',
    retained_context: 'Synthetic context around the excerpt.',
    limitation: 'One account, one observation.',
    independent: true,
    derived_from: null,
    gap_state: null,
    ...over,
  }
}

export function measurement(over: Partial<BriefMeasurement> = {}): BriefMeasurement {
  return {
    metric_name: 'impressions',
    formula: 'platform impressions, single post',
    observed_value: 1200,
    denominator: 'one post, one account',
    comparison_population: 'the same account, prior twenty posts',
    capture_age_days: 17,
    observation_window: '2026-09-01 to 2026-09-18',
    comparison_method_version: 'fixture-v1',
    source_ref: 'ev-01',
    owner: 'Synthetic Author A',
    unknowns: ['age-matched lift'],
    metric_family: 'market_performance',
    ...over,
  }
}

/** A complete brief with all thirteen field groups present, so a test that
    wants to break ONE of them starts from a valid object. */
export function brief(over: Partial<EditorialBrief> = {}): EditorialBrief {
  const base: EditorialBrief = {
    identity: {
      brief_id: 'brief-fixture-01',
      version: 1,
      client_id: 'ivan',
      kind: 'post',
      created_at: FIXTURE_CREATED_AT,
      source_cutoff: '2026-09-19T00:00:00Z',
      status: 'proposed',
      content_hash: 'c'.repeat(64),
    },
    purpose: {
      objective: 'Test the shape, not a real editorial objective.',
      intended_audience: 'A synthetic audience description.',
      direction_version: 'dir-fixture-v1',
      audience_status: 'provisional',
      relevance_reason: 'A synthetic relevance sentence.',
    },
    editorial_direction: {
      topic: 'A synthetic topic',
      angle: 'A synthetic angle',
      proposed_hook: 'A synthetic opening line.',
      format: 'text',
      tone: 'plain',
      structural_beats: ['beat one', 'beat two'],
      why_now: 'A synthetic timeliness sentence.',
      overlap_with_existing_content: 'None recorded in this fixture.',
      novelty_reason: 'A synthetic novelty sentence.',
    },
    evidence: [evidence()],
    independent_source_count: 1,
    measurements: [measurement()],
    measurements_none_reason: null,
    claim_ledger: [{
      claim_id: 'cl-01',
      statement: 'A synthetic statement bounded by its evidence.',
      supporting_refs: ['ev-01'],
      attribution_owner: 'Synthetic Author A',
      allowed_phrasing: 'Describe the observation as one account’s result.',
      prohibited_inference: 'Do not describe it as a market average.',
      status: 'interpretation',
    }],
    calls: [],
    calls_none_reason: 'No call excerpt is part of this synthetic fixture.',
    resource: {
      asset_id: '',
      version: '',
      artifact_role: 'none',
      readiness: 'not_needed',
      access_route: '',
      permission_basis: '',
      required_missing_material: [],
      draft_state: 'not applicable',
      public_catalog_state: 'not applicable',
    },
    distribution: {
      channel: 'synthetic channel',
      cta: 'a synthetic call to action',
      route: 'ungated',
      fulfillment_requirements: ['none for this fixture'],
      send_authorization: 'none',
    },
    production: {
      structure: 'A synthetic structure note.',
      required_materials: ['none'],
      voice_references: [{ prompt_id: 'fixture-voice', version: 'v1', hash: 'd'.repeat(64) }],
      critical_constraints: ['stay inside the evidence'],
      effort_category: 'small',
    },
    evaluation: {
      primary_metric: 'impressions',
      secondary_metrics: ['comments'],
      comparator: 'the same account, prior twenty posts',
      window: 'fourteen days',
      earliest_valid_observation: '2026-09-27T00:00:00Z',
      event_source_availability: 'platform analytics only',
      attribution_limitations: 'No buyer-share breakdown exists for this fixture.',
    },
    decisions_links: {
      selection_events: [], generation_request: null, draft_ids: [],
      resource_ids: [], publication_id: null, observed_outcomes: [],
    },
    readiness: 'ready_to_draft',
    missing_material: [],
    rank: 1,
    strongest_three: true,
    ranking_reason: 'A synthetic ranking reason.',
    review: {
      reviewer_seat: 'Reviewer Seat',
      reviewer_model: 'fixture-reviewer',
      verdict: 'pass',
      reviewed_at: '2026-09-20T10:00:00Z',
      notes: 'A synthetic review note.',
    },
  }
  return { ...base, ...over }
}

/* -------------------------------------------------------------------------
   The stub client
   ------------------------------------------------------------------------- */

export type StubCall = { fn: string; params: Record<string, unknown> }

export type StubRoutes = Record<
  string,
  (params: Record<string, unknown>) => EditorialRpcResult | Promise<EditorialRpcResult>
>

/** Records every call it receives, which is how a test proves that an
    unregistered client id was rejected BEFORE any query was issued. */
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

/** A stub whose every route rejects — the transport-failure case. */
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

/** The tenant-scoped brief store the read routes answer from: a map of lane to
    the briefs that lane owns. A route built over this can only ever return
    rows for the lane in `p_client_id`, which is the boundary T02 checks. */
export type BriefStore = Record<string, EditorialBrief[]>

export function briefStore(): BriefStore {
  return {
    ivan: [brief()],
    arch: [brief({
      identity: { ...brief().identity, brief_id: 'brief-arch-01', client_id: 'arch' },
    })],
  }
}

export function lanes(): EditorialClientId[] {
  return ['ivan', 'risedtc', 'arch']
}
