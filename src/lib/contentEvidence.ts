/* ==========================================================================
   CONTENT EVIDENCE — the typed reader behind Strategy > Evidence.

   THE JSON CONTRACT THIS MODULE READS (documented here and in
   $OUT/UI-RECEIPT.md so the release owner writes the RPC to this exact
   shape). One browser-facing RPC, gated the same way `operator_market_outliers`
   is gated (db/102): `operator_gate_ok(p_gate)` then `lane_allowed(p_client_id)`,
   `security definer`, granted to `authenticated`. It is expected to be a thin
   wrapper over the service-only `content_evidence_pack(p_client_id, p_week_start)`
   (db/103), reshaped into the four view sections below.

     operator_content_evidence(p_gate text, p_client_id text) returns jsonb

     {
       "schema_version": 1,
       "client_id": "ivan",
       "week_start": "2026-09-28",                       // the cycle this pack answers for, or null
       "freshness": {
         "as_of": "2026-09-19T08:00:00Z" | null,          // when this pack was computed; null = never
         "stale_after_days": 14,
         "is_stale": false
       },
       "this_week": {
         "coverage_line": "29 ranked authors, 2163 eligible posts for ivan.",
         "candidates": [ {
           "id": "audn-rec:...",
           "topic": "Plain topic sentence",
           "evidence_sentence": "1,240 weighted reactions against a usual 129 across 29 posts",
           "source_url": "https://..." | null,
           "source_label": "Author name, 16 Mar 2026" | null,
           "client_fact_refs": [ { "source_id": "...", "kind": "founder" | "buyer_question" | "…", "label": "What the client can honestly say" } ] | null,
           // Render `label` only. `source_id` is a retained reference, never shown.
           "needs_material": false,
           "objective": "attention" | "buyer_response" | "conversion",
           "is_experiment": false,
           "experiment_reason": string | null,
           "test_metric": string | null,
           "detail": {
             "calculation": "likes + 3 x reposts, observed 3173 vs baseline 129 (n=29)",
             "formula": "likes + 3 x reposts" | null,
             "method_version": "content-evidence-methods-v2" | null,
             "published_at": "2026-03-16" | null,
             "captured_at": "2026-03-20" | null,
             "limitations": ["retrospective", "unmatched capture age"],
             "full_source_text": string | null
           }
         } ],
         "missing_inputs": ["no validated market study for this client"]
       },
       "winners": {
         // Market and own-account rows are two disjoint arrays. An own-account
         // post never joins the market array and never carries a market lift.
         "market": [ {
           "finding_id": "...", "author": string | null, "author_url": string | null,
           "first_line": string | null, "source_url": string | null, "published_at": string | null,
           "observed_value": number | null, "baseline_value": number | null, "baseline_n": number | null,
           "lift": number | null, "method_version": string | null,
           "legacy": boolean,        // imported under a legacy/unreconciled method
           "limitation": string | null
         } ],
         "own": [ {
           "post_id": "...", "published_at": string | null, "objective": string,
           "metric_label": "reach", "observed_value": number | null,
           "comparison_label": "Above the account 7-day median.", "sample_note": string | null,
           "limitation": string | null
         } ]
       },
       "inputs": {
         "study_state": "missing" | "imported" | "needs_reconciliation" | "validated" | "stale" | "failed",
         "stored_posts": number | null, "eligible_posts": number | null, "eligible_authors": number | null,
         "publication_window": { "from": string | null, "to": string | null } | null,
         "last_successful_collection": string | null,
         "connected_consumers": string[],           // which surfaces read this study
         "sufficient_for_this_question": boolean,
         "sufficiency_reason": string | null,
         "gaps": string[]
       },
       "results": {
         "choices": [ {
           "id": "...", "topic": string, "status": "candidate" | "needs_material" | "ready_for_review"
             | "approved" | "published" | "awaiting_publication" | "measuring" | "evaluated" | "passed"
             | "superseded",
           "published_at": string | null, "evaluation_age_days": number | null, "objective": string,
           "outcome": { "metric_label": string, "observed_value": number | null, "comparison_label": string } | null,
           "incomplete_measurement": boolean,
           "source_finding_id": string | null, "denominator_note": string | null
         } ],
         "prior_failures": [ { "id": "...", "topic": string, "reason": string } ]
       }
     }

   READER RULES. `readPack` is the ONLY place that talks to the network. A
   thrown/failed request yields `state: 'failed'` on every one of the four
   view reads, with a visible message; it never collapses into 'empty' — an
   unread surface and a confirmed-empty one are different facts. Every other
   state (ready/partial/empty/stale) is derived PURELY from the pack's own
   fields by the four `build*` functions below, which take no lane and touch
   no network, so a fixture in or a live pack in produces the same view out.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE, LANE_LABEL } from './content'
import type { ContentLane } from './content'

/** The display name a client id becomes wherever it reaches the screen.
    `LANE_LABEL` (src/lib/content.ts) is the one canonical map; 'risedtc' and
    'arch' are database values and are never shown verbatim (Phase-2 review,
    must-fix 3 / orchestrator ruling b). Falls back to the raw id only for a
    value LANE_LABEL does not know, which never leaks raw JSON, just an
    unfamiliar string. */
export function laneDisplayName(id: string): string {
  return (LANE_LABEL as Record<string, string>)[id] ?? id
}

export type ViewState = 'ready' | 'partial' | 'empty' | 'stale' | 'failed'

// `attention_reach` is the value the weekly writer actually saves (selector-pack.mjs's default
// objective, confirmed against $OUT/EVIDENCE-PACKAGE-SHAPE.json). It is the same objective as
// `attention` and is listed here so a real saved row renders its label instead of "Unrecognized
// item". Narrow integration fix from the pre-release audit's F3 pass.
export type Objective = 'attention' | 'attention_reach' | 'buyer_response' | 'conversion'

const OBJECTIVE_LABEL: Record<Objective, string> = {
  attention: 'Attention and reach',
  attention_reach: 'Attention and reach',
  buyer_response: 'A relevant buyer response',
  conversion: 'A defined conversion action',
}

/** Sentence-case, human label for an objective value. An unrecognized value
    (a vocabulary drift between the writer and this reader) renders as a
    plain line rather than the raw database string or a JSON dump. */
export function objectiveLabel(v: string | null | undefined): string {
  if (!v) return 'Objective not stated.'
  return OBJECTIVE_LABEL[v as Objective] ?? 'Unrecognized item'
}

export type StudyState = 'missing' | 'imported' | 'needs_reconciliation' | 'validated' | 'stale' | 'failed'

export type ChoiceStatus =
  | 'candidate' | 'needs_material' | 'ready_for_review' | 'approved'
  | 'published' | 'awaiting_publication' | 'measuring' | 'evaluated' | 'passed' | 'superseded'

const CHOICE_STATUS_LABEL: Record<ChoiceStatus, string> = {
  candidate: 'Candidate',
  needs_material: 'Needs material',
  ready_for_review: 'Ready for review',
  approved: 'Approved',
  published: 'Published',
  awaiting_publication: 'Awaiting publication',
  measuring: 'Measuring',
  evaluated: 'Evaluated',
  passed: 'Passed',
  superseded: 'Superseded',
}

/** Same discipline as `objectiveLabel`: a status this reader does not know
    about is shown as 'Unrecognized item', never as raw text off the wire. */
export function choiceStatusLabel(v: string | null | undefined): string {
  if (!v) return 'Unrecognized item'
  return CHOICE_STATUS_LABEL[v as ChoiceStatus] ?? 'Unrecognized item'
}

// ---------------------------------------------------------------------------
// The raw contract, typed
// ---------------------------------------------------------------------------

export type ContentEvidenceCandidateDetail = {
  calculation: string
  formula: string | null
  method_version: string | null
  published_at: string | null
  captured_at: string | null
  limitations: string[]
  full_source_text: string | null
}

/** Audit F3/client_fact_refs (Phase-2 audit fix pass): a fact reference is an
    object with a retained `source_id` and the one field ever shown, `label`.
    Never render `source_id` — printing an id where a person expects a fact is
    exactly the "raw id on screen" defect the audit named. */
export type ContentEvidenceFactRef = { source_id: string; kind: string; label: string }

export type ContentEvidenceCandidate = {
  id: string
  topic: string
  evidence_sentence: string
  source_url: string | null
  source_label: string | null
  client_fact_refs: ContentEvidenceFactRef[] | null
  needs_material: boolean
  objective: string
  is_experiment: boolean
  experiment_reason: string | null
  test_metric: string | null
  detail: ContentEvidenceCandidateDetail
}

export type ContentEvidenceMarketWinner = {
  finding_id: string
  author: string | null
  author_url: string | null
  first_line: string | null
  source_url: string | null
  published_at: string | null
  observed_value: number | null
  baseline_value: number | null
  baseline_n: number | null
  lift: number | null
  method_version: string | null
  legacy: boolean
  limitation: string | null
}

export type ContentEvidenceOwnResult = {
  post_id: string
  published_at: string | null
  objective: string
  metric_label: string
  observed_value: number | null
  comparison_label: string
  sample_note: string | null
  limitation: string | null
}

export type ContentEvidenceInputsRaw = {
  study_state: StudyState
  stored_posts: number | null
  eligible_posts: number | null
  eligible_authors: number | null
  publication_window: { from: string | null; to: string | null } | null
  last_successful_collection: string | null
  connected_consumers: string[]
  sufficient_for_this_question: boolean
  sufficiency_reason: string | null
  gaps: string[]
}

export type ContentEvidenceChoiceOutcome = {
  metric_label: string
  observed_value: number | null
  comparison_label: string
}

export type ContentEvidenceChoice = {
  id: string
  topic: string
  status: string
  published_at: string | null
  evaluation_age_days: number | null
  objective: string
  outcome: ContentEvidenceChoiceOutcome | null
  incomplete_measurement: boolean
  source_finding_id: string | null
  denominator_note: string | null
}

export type ContentEvidencePriorFailure = { id: string; topic: string; reason: string }

export type ContentEvidencePack = {
  schema_version: number
  client_id: string
  week_start: string | null
  freshness: { as_of: string | null; stale_after_days: number; is_stale: boolean }
  this_week: { coverage_line: string; candidates: ContentEvidenceCandidate[]; missing_inputs: string[] }
  winners: { market: ContentEvidenceMarketWinner[]; own: ContentEvidenceOwnResult[] }
  inputs: ContentEvidenceInputsRaw
  results: { choices: ContentEvidenceChoice[]; prior_failures: ContentEvidencePriorFailure[] }
}

// ---------------------------------------------------------------------------
// The four derived view reads. Flat objects (no discriminated union) so a
// caller can build a literal fixture without narrowing on `state` first.
// ---------------------------------------------------------------------------

export type ThisWeekRead = {
  state: ViewState
  clientId: string
  coverageLine: string
  candidates: ContentEvidenceCandidate[]
  missingInputs: string[]
  asOf: string | null
  message?: string
}

export type WinnersRead = {
  state: ViewState
  clientId: string
  market: ContentEvidenceMarketWinner[]
  own: ContentEvidenceOwnResult[]
  asOf: string | null
  message?: string
}

/** The Package-5 minimum contract (plan line 291), spelled exactly. Every
    extension is optional so a caller that builds only the minimum fields
    still type-checks — the InputsPanel fixture test in the plan constructs
    exactly the six required fields and nothing else. */
export type InputsView = {
  clientId: string
  state: ViewState
  storedPosts: number | null
  eligiblePosts: number | null
  studyState: StudyState
  gaps: string[]
  eligibleAuthors?: number | null
  publicationWindow?: { from: string | null; to: string | null } | null
  lastSuccessfulCollection?: string | null
  connectedConsumers?: string[]
  sufficientForThisQuestion?: boolean
  sufficiencyReason?: string | null
  message?: string
}

export type ResultsRead = {
  state: ViewState
  clientId: string
  choices: ContentEvidenceChoice[]
  priorFailures: ContentEvidencePriorFailure[]
  asOf: string | null
  message?: string
}

// A market read below this many findings is inspectable but unranked — the
// same floor D3 states for ARCH's two findings from one author: "eligible
// rows may be shown, but readiness is decided after preview and a coverage
// gap is the expected verdict."
export const MIN_MARKET_FOR_READY = 3

// The plan's screening floor for a market finding (baseline_n >= 20). A row
// below it is still shown — it is retained evidence, never dropped — but
// carries a visible low-sample warning rather than reading as a normal row.
export const LOW_SAMPLE_BASELINE_N = 20

export function isLowSample(baselineN: number | null): boolean {
  return baselineN !== null && baselineN < LOW_SAMPLE_BASELINE_N
}

// ---------------------------------------------------------------------------
// Pure builders. No network, no lane argument beyond what the pack already
// carries — a fixture pack and a live pack run through the identical code.
// ---------------------------------------------------------------------------

export function buildThisWeek(pack: ContentEvidencePack): ThisWeekRead {
  const base = {
    clientId: pack.client_id,
    coverageLine: pack.this_week.coverage_line,
    candidates: pack.this_week.candidates,
    missingInputs: pack.this_week.missing_inputs,
    asOf: pack.freshness.as_of,
  }
  if (pack.this_week.candidates.length === 0) return { ...base, state: 'empty' }
  if (pack.freshness.is_stale) return { ...base, state: 'stale' }
  if (pack.this_week.missing_inputs.length > 0) return { ...base, state: 'partial' }
  return { ...base, state: 'ready' }
}

export function buildWinners(pack: ContentEvidencePack): WinnersRead {
  const { market, own } = pack.winners
  const base = { clientId: pack.client_id, market, own, asOf: pack.freshness.as_of }
  if (market.length === 0 && own.length === 0) return { ...base, state: 'empty' }
  if (pack.freshness.is_stale) return { ...base, state: 'stale' }
  if (market.length > 0 && market.length < MIN_MARKET_FOR_READY) return { ...base, state: 'partial' }
  return { ...base, state: 'ready' }
}

export function buildInputs(pack: ContentEvidencePack): InputsView {
  const raw = pack.inputs
  const base: InputsView = {
    clientId: pack.client_id,
    state: 'ready',
    storedPosts: raw.stored_posts,
    eligiblePosts: raw.eligible_posts,
    studyState: raw.study_state,
    gaps: raw.gaps,
    eligibleAuthors: raw.eligible_authors,
    publicationWindow: raw.publication_window,
    lastSuccessfulCollection: raw.last_successful_collection,
    connectedConsumers: raw.connected_consumers,
    sufficientForThisQuestion: raw.sufficient_for_this_question,
    sufficiencyReason: raw.sufficiency_reason,
  }
  // Truly nothing: no stored posts and no study at all. Distinct from ARCH's
  // real shape (439 stored posts, study 'missing') which is a coverage gap,
  // not an empty lane — that case falls through to 'partial' below.
  if (raw.stored_posts === null && raw.eligible_posts === null && raw.study_state === 'missing') {
    return { ...base, state: 'empty' }
  }
  if (pack.freshness.is_stale || raw.study_state === 'stale') return { ...base, state: 'stale' }
  if (raw.study_state !== 'validated' || raw.eligible_posts === null || raw.gaps.length > 0) {
    return { ...base, state: 'partial' }
  }
  return { ...base, state: 'ready' }
}

export function buildResults(pack: ContentEvidencePack): ResultsRead {
  const { choices, prior_failures } = pack.results
  const base = { clientId: pack.client_id, choices, priorFailures: prior_failures, asOf: pack.freshness.as_of }
  if (choices.length === 0) return { ...base, state: 'empty' }
  if (pack.freshness.is_stale) return { ...base, state: 'stale' }
  if (choices.some(c => c.incomplete_measurement)) return { ...base, state: 'partial' }
  return { ...base, state: 'ready' }
}

/** Counts words across every string the default This-week view puts on
    screen, so a test can pin the <=300-word acceptance bar (spec
    "Acceptance": default client view is at most 300 words). Only the
    always-visible surface counts — `full_source_text` and other
    open-on-demand detail fields are excluded on purpose. */
export function thisWeekWordCount(view: ThisWeekRead): number {
  const parts: string[] = [view.coverageLine]
  for (const c of view.candidates) {
    parts.push(c.topic, c.evidence_sentence, objectiveLabel(c.objective))
    parts.push(c.needs_material ? 'Needs material.' : (c.client_fact_refs ?? []).map(r => r.label).join(' '))
    if (c.is_experiment) parts.push('Experiment', c.experiment_reason ?? '', c.test_metric ?? '')
  }
  const text = parts.filter(Boolean).join(' ')
  return text.split(/\s+/).filter(Boolean).length
}

// ---------------------------------------------------------------------------
// The network edge. Everything above this line is pure and unit-tested
// directly; everything below is the thin, untestable-by-unit-test wiring.
// ---------------------------------------------------------------------------

const FIXTURE_STATES = ['ready', 'partial', 'empty', 'stale', 'failed'] as const
export type FixtureUiState = (typeof FIXTURE_STATES)[number]

/** DEV ONLY. `?evidenceFixture=ready|partial|empty|stale|failed` swaps a
    canned pack in instead of the network read, the same lever
    `?audnFixture=1` / `?audnProposalsFixture=1` already use on this surface
    (see `useAudience.ts` / `proposals.ts:fetchProposals`). The
    `import.meta.env.DEV && typeof window !== 'undefined'` check has to sit
    INLINE at the exact call site, not behind a helper function whose boolean
    result is read one call later — Rollup only constant-folds and drops a
    dynamic `import()` when it can see the literal `if (import.meta.env.DEV
    && ...)` guarding it directly (confirmed by building: routing the same
    check through a separate `fixtureParam()` helper left
    `contentEvidence.fixtures-*.js` as a real emitted chunk in a default
    `npm run build`; inlined here, it is gone — verified in
    $OUT/UI-RECEIPT.md). `import.meta.env.DEV` is `!(process.env.NODE_ENV ===
    'production')` in this Vite version (NOT decided by the `--mode` CLI
    flag — confirmed by reading node_modules/vite's own resolveConfig), so a
    default `npm run build` (`vite build` sets `NODE_ENV=production`) never
    emits the fixture chunk, and `NODE_ENV=development npx vite build
    --outDir dist-fixture` keeps DEV true so the SAME optimized/rollup build
    can be served with `vite preview` for a screenshot pass.

    MUST-FIX 1 (Phase-2 review): the whole body is wrapped in try/catch. A
    REJECTED promise -- a thrown auth-refresh error, any network exception
    that never reaches the `{data,error}` shape, or a failed dynamic
    `import()` of the fixture chunk -- is still a failed read, never a hang.
    The packet is explicit: "a thrown/failed request MUST yield state
    'failed'"; before this fix the four `EvidenceBlock` hooks called
    `.then(...)` with no `.catch(...)`, so a rejection left `view` at `null`
    and the panel spun on "Reading…" forever. This is the one place in the
    module a rejection can occur and the one place it is caught. */
async function readPack(lane: ContentLane): Promise<{ ok: true; pack: ContentEvidencePack } | { ok: false; error: string }> {
  try {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const raw = new URLSearchParams(window.location.search).get('evidenceFixture')
      if (raw && (FIXTURE_STATES as readonly string[]).includes(raw)) {
        const fx = raw as FixtureUiState
        if (fx === 'failed') return { ok: false, error: 'Fixture: simulated read failure (?evidenceFixture=failed).' }
        const m = await import('./contentEvidence.fixtures')
        return { ok: true, pack: m.fixturePack(lane, fx) }
      }
    }
    const { data, error } = await supabase.rpc('operator_content_evidence', {
      p_gate: CLIENT_OPS_GATE, p_client_id: lane,
    })
    if (error) return { ok: false, error: error.message || 'The evidence read failed.' }
    if (!data || typeof data !== 'object') return { ok: false, error: 'The evidence read returned no usable payload.' }
    return { ok: true, pack: data as ContentEvidencePack }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** DEV-ONLY, tree-shaken exactly like the fixture lever above (the same
    inline `import.meta.env.DEV &&` shape at the call site is what makes
    Rollup fold the whole branch away in a `NODE_ENV=production` build --
    confirmed by building and grepping `dist/` for both `evidenceFixture` and
    this function's own name; see UI-RECEIPT.md). It exists for exactly one
    reader: W5's independent checker opens a `state_urls` URL with a fresh,
    signed-out browser profile and clicks nothing, so the app's own login
    gate (checked in `App.tsx` before any hash routing) has to be bypassed
    for a URL carrying a recognized `?evidenceFixture=` value, in DEV only.
    `isDev` is an explicit parameter (not read from `import.meta.env` inside
    this function) so the "never true when DEV is false" guarantee is
    unit-testable independent of whatever mode the test runner itself
    happens to build under -- see contentEvidence.test.ts. */
export function evidenceFixtureBypassActive(isDev: boolean, search: string): boolean {
  if (!isDev) return false
  const v = new URLSearchParams(search).get('evidenceFixture')
  return (FIXTURE_STATES as readonly string[]).includes(v ?? '')
}

function failedThisWeek(lane: ContentLane, message: string): ThisWeekRead {
  return { state: 'failed', message, clientId: lane, coverageLine: '', candidates: [], missingInputs: [], asOf: null }
}
function failedWinners(lane: ContentLane, message: string): WinnersRead {
  return { state: 'failed', message, clientId: lane, market: [], own: [], asOf: null }
}
function failedInputs(lane: ContentLane, message: string): InputsView {
  return { state: 'failed', message, clientId: lane, storedPosts: null, eligiblePosts: null, studyState: 'failed', gaps: [] }
}
function failedResults(lane: ContentLane, message: string): ResultsRead {
  return { state: 'failed', message, clientId: lane, choices: [], priorFailures: [], asOf: null }
}

export async function fetchThisWeek(lane: ContentLane): Promise<ThisWeekRead> {
  const r = await readPack(lane)
  return r.ok ? buildThisWeek(r.pack) : failedThisWeek(lane, r.error)
}

export async function fetchWinners(lane: ContentLane): Promise<WinnersRead> {
  const r = await readPack(lane)
  return r.ok ? buildWinners(r.pack) : failedWinners(lane, r.error)
}

export async function fetchInputs(lane: ContentLane): Promise<InputsView> {
  const r = await readPack(lane)
  return r.ok ? buildInputs(r.pack) : failedInputs(lane, r.error)
}

export async function fetchResults(lane: ContentLane): Promise<ResultsRead> {
  const r = await readPack(lane)
  return r.ok ? buildResults(r.pack) : failedResults(lane, r.error)
}

/** THE SHARED READ. `EvidenceBlock` calls this ONE function once per lane
    change and derives all four sub-view reads from its single result
    (Phase-2 review NOTE: the block's four independent hooks were firing four
    identical `operator_content_evidence` round trips on every mount). The
    four `fetch*` functions above stay exported and independently useful --
    every existing test that reads one view in isolation still can -- but
    nothing in this module calls them internally any more. */
export type ContentEvidenceViews = {
  thisWeek: ThisWeekRead
  winners: WinnersRead
  inputs: InputsView
  results: ResultsRead
}

export async function fetchContentEvidenceViews(lane: ContentLane): Promise<ContentEvidenceViews> {
  const r = await readPack(lane)
  if (!r.ok) {
    return {
      thisWeek: failedThisWeek(lane, r.error),
      winners: failedWinners(lane, r.error),
      inputs: failedInputs(lane, r.error),
      results: failedResults(lane, r.error),
    }
  }
  return {
    thisWeek: buildThisWeek(r.pack),
    winners: buildWinners(r.pack),
    inputs: buildInputs(r.pack),
    results: buildResults(r.pack),
  }
}
