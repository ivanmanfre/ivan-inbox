import { supabase } from './supabase'
import type { ContentLane } from './content'

/* ==========================================================================
   AUDIENCE — the read-only layer behind the Strategy tab's audience block
   (goal-run audience-learning-03, worklist W16).

   Every `audn_*` object read here is a view from Run 02, plus
   `audn_recommendation_links_v` from Run 03's migration 08. They live on the
   personal-site worktree branch `audn-run02/03` and are NOT deployed:
   production answers a select on them with "relation does not exist". That is
   not a bug to hide — it is the `unavailable` state, and it is what this
   surface renders until Run 04 applies the migrations. (The link view is the
   one exception to `unavailable`: it is auxiliary, so losing it costs the top
   of the recommendation ladder and nothing else — see `fetchRecommendationLinks`.)

   Three rules from the data contract (R2/INTERFACES.md) are enforced here
   rather than left to the component:

     1. UNKNOWN IS A VALUE. `unknown`, `immature` and `not_collected` are
        rendered states, never zero. A person with no label row counts as
        unknown, not as "not positive".
     2. THE EXCLUSION FLAGS NEVER FILTER. A denominator over people excludes
        `is_operator` and shows the raw count beside the adjusted one, so a
        number can always be checked against the row set it came from.
     3. THE CONSUMER NEVER DERIVES THE CLIENT. `client_id` is a query
        parameter taken from the lane the operator picked in the Segmented
        control — never parsed out of a path, a slug or a session.

   And one rule from this app's own history (2026-09-09, the DMs outage):
   AN EMPTY RESULT OVER A KNOWN-NON-EMPTY SET IS A FAILURE. Zero people for
   risedtc is not an empty audience, it is a query that silently returned
   nothing, and it renders as a load failure with a retry — see
   `failed_nonempty_expected` below.
   ========================================================================== */

// ---------------------------------------------------------------------------
// The floor for the "empty over a known-non-empty set" check.
//
// Source: goal-runs/audience-learning-02-foundation-2026-09-09-out/fixtures/
// expected/census-baseline.json → `distinct_people`, frozen at the Run 01
// evidence cutoff 2026-09-09T14:30Z (events per lane in the same file:
// risedtc 275 · ivan 112 · arch 92).
//
// It is a FLOOR FOR A FAILURE CHECK, NOT A DISPLAY VALUE. Nothing renders
// these numbers; the block only ever shows counts it actually read. The
// audience can legitimately grow past them, and it can only shrink below them
// if rows were deleted — which is itself worth surfacing as a failure rather
// than as a calm smaller number.
// ---------------------------------------------------------------------------
export const KNOWN_NONEMPTY: Record<string, { people: number }> = {
  ivan: { people: 90 },
  risedtc: { people: 191 },
  arch: { people: 48 },
}

export function knownFloorFor(lane: string): number {
  return KNOWN_NONEMPTY[lane]?.people ?? 0
}

// The same check, one level down, for the store a recommendation LIVES in.
//
// Found by looking: signed out, PostgREST answers a select on `client_ideas`,
// `lm_idea_candidates`, `client_board_actions` and `lm_idea_review_decisions`
// with `count: 0` AND NO ERROR — RLS returns an empty set rather than a 401.
// So "no recommendation has been written yet" and "you cannot read this table"
// are the same response, and the first is a sentence this block would print
// under a lane that has 362 ideas on record.
//
// Census 2026-09-09T14:30Z (R1 census/raw): client_ideas risedtc 362 · arch 80;
// lm_idea_candidates 2,884. A zero here is therefore a READ FAILURE, and the
// recommendations section says so instead of claiming an empty bank.
export const STORE_NONEMPTY: Record<string, { ideas: number }> = {
  ivan: { ideas: 2884 },
  risedtc: { ideas: 362 },
  arch: { ideas: 80 },
}

export function storeFloorFor(lane: string): number {
  return STORE_NONEMPTY[lane]?.ideas ?? 0
}

// ---------------------------------------------------------------------------
// Row shapes (only the columns this surface reads)
// ---------------------------------------------------------------------------
export type PersonLabel = 'positive' | 'borderline' | 'negative' | 'unknown'

export type TopicPeopleRow = {
  client_id: string
  topic: string | null
  people: number | null
  events: number | null
  posts: number | null
}

export type PersonLabelRow = {
  client_id: string
  person_key: string
  label: string | null
  is_operator: boolean | null
  is_excluded: boolean | null
  conflict: boolean | null
}

export type PersonActivityRow = {
  client_id: string
  person_key: string
  distinct_posts: number | null
  total_events: number | null
  observed_across_posts: boolean | null
  confirmed_return: boolean | null
  return_timing: string | null
  is_operator: boolean | null
  is_excluded: boolean | null
}

export type MatchedAgeRankRow = {
  client_id: string
  post_social_id: string
  target_age_days: number | null
  reactions: number | null
  rank: number | null
  eligible_n: number | null
  rank_basis: string | null
}

export type MonthlyMedianRow = {
  client_id: string
  month: string | null
  target_age_days: number | null
  median_reactions: number | null
  n: number | null
  basis: string | null
}

/** A recommendation as it exists in the client's OWN idea store (D3: no new
    table). `client_ideas` for a client lane, `lm_idea_candidates` for Ivan. */
export type RecommendationRow = {
  /** The row's primary key in its own table — what a decision joins on. */
  id: string
  /** `audn-rec:<uuid>` — the recommendation identity that survives the copy
      from the review into the idea store. */
  source_ref: string | null
  title: string | null
  sub: string | null
  status: string | null
  created_at: string | null
  /** lm_idea_candidates only; a client_ideas row carries no draft pointer. */
  promoted_draft_id: string | null
}

export type DecisionRow = {
  /** `ref` for a client (matches `source_ref`), `candidate_id` for Ivan
      (matches the row `id`). */
  key: string
  action: string | null
  reason: string | null
  decided_at: string | null
}

/** One row of `audn_recommendation_links_v` (migration 08): the recommendation,
    the idea row it IS, the draft it became, and the published post it reached.

    The seven columns below are the ones this surface reads, taken from the
    view's own select list (`20260911_audn_08_recommendation_links.sql`, the
    `create or replace view` at the foot of the file). The view also carries
    `idea_table`, `idea_status`, `decision`, `decision_reason`, `decided_at` and
    `decision_source`; the decision half is deliberately NOT read here, because
    this block already reads the decision log directly out of
    `client_board_actions` / `lm_idea_review_decisions` and two sources for one
    fact is two chances to disagree. */
export type RecommendationLinkRow = {
  client_id: string
  /** The BARE uuid. */
  recommendation_id: string | null
  /** `audn-rec:<uuid>` — matches `RecommendationRow.source_ref`. */
  recommendation_ref: string | null
  /** The idea row's own primary key — matches `RecommendationRow.id`. */
  idea_id: string | null
  draft_id: string | null
  published_post_social_id: string | null
  link_state: string | null
}

// ---------------------------------------------------------------------------
// Soft failure. One missing relation must not take the whole block down (the
// same posture `fetchFilterSpec` takes on the same screen), but it must also
// never be swallowed into a calm zero — so a failure is a VALUE that travels
// to `summarize` and gets rendered, not a silently empty array.
// ---------------------------------------------------------------------------
export type Soft<T> =
  | { ok: true; rows: T[]; count?: number | null }
  | { ok: false; error: string }

function msg(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === 'string' ? e : 'unavailable'
}

async function soft<T>(
  what: string,
  run: () => PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>,
): Promise<Soft<T>> {
  try {
    const { data, error, count } = await run()
    if (error) return { ok: false, error: `${what}: ${error.message}` }
    return { ok: true, rows: (data ?? []) as T[], count: count ?? null }
  } catch (e: unknown) {
    return { ok: false, error: `${what}: ${msg(e)}` }
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// The summary the component renders
// ---------------------------------------------------------------------------
export type AudienceState =
  /** A source relation is missing, forbidden, or unreachable. Today this is
      what production returns for every lane: the audn_* views are not
      deployed yet. */
  | 'unavailable'
  /** Zero rows for a lane the census says has people. Treated as a load
      failure, never as an empty audience. */
  | 'failed_nonempty_expected'
  /** Genuinely nothing, and nothing was expected. */
  | 'empty'
  /** People exist, every one of them is unlabelled. */
  | 'unknown'
  | 'normal'

export type TopicLine = {
  topic: string | null
  /** What the row is called on screen — a null topic is "unlabelled", never
      dropped and never renamed into a category it was not given. */
  label: string
  people: number | null
  events: number | null
  posts: number | null
}

export type RankLine = {
  post_social_id: string
  rank: number | null
  eligible_n: number | null
  target_age_days: number | null
  reactions: number | null
}

export type MonthlyLine = {
  month: string | null
  median_reactions: number | null
  n: number | null
  target_age_days: number | null
  basis: string | null
}

export type DecisionState = 'accepted' | 'rejected' | 'deferred' | null

/** How far a recommendation got. The ladder is migration 08's, in its order:

      recommended  a decision is on record for a ref with NO idea row (an
                   orphan — the idea was deleted, or the answer arrived first)
      idea         the idea row exists, no draft
      drafted      a draft row exists, no published post resolves
      published    a published post resolves at the end of the chain
      unknown      the chain could not be evaluated

    `published` and `recommended` can only come from `audn_recommendation_links_v`
    (migration 08). Read from the idea store alone this block still tops out at
    `drafted`, because a status string does not prove a post went live and
    inventing one would be a claim we made up. Where the view is unreadable the
    old two-state derivation is what runs, and `AudienceSummary.linkSource` says
    which of the two produced the states on screen. */
export type LinkState = 'recommended' | 'idea' | 'drafted' | 'published' | 'unknown'

/** Ascending strength. Precedence is `published > drafted > idea > recommended`
    (CONTRACTS §2.3), and `unknown` is the floor: it is the absence of a
    judgement, so anything at all outranks it. Used to reconcile a view row with
    the local derivation, and to reconcile two view rows that name the same
    recommendation — always UPWARDS, so a partial read can never quietly
    downgrade a state something else already proved. */
const LINK_RANK: Record<LinkState, number> = {
  unknown: 0, recommended: 1, idea: 2, drafted: 3, published: 4,
}

function asLinkState(v: unknown): LinkState {
  return v === 'recommended' || v === 'idea' || v === 'drafted' || v === 'published'
    ? v
    : 'unknown'
}

function strongestLink(a: LinkState, b: LinkState): LinkState {
  return LINK_RANK[a] >= LINK_RANK[b] ? a : b
}

export type RecLine = {
  id: string
  /** `audn-rec:<uuid>` when present. Null means the row is in the store but
      carries no recommendation identity — shown, never hidden. */
  recommendation_ref: string | null
  title: string
  sub: string | null
  created_at: string | null
  decision: DecisionState
  reason: string | null
  decided_at: string | null
  link_state: LinkState
}

export type AudienceSummary = {
  lane: ContentLane
  state: AudienceState
  /** Why the state is what it is. Null on `normal`. */
  message: string | null
  people: {
    /** Every person row, operators included. */
    raw: number
    /** The denominator: operators excluded. */
    adjusted: number
    operators: number
  }
  /** Counts over the ADJUSTED person set. `unknown` includes people with no
      label row at all — absence of a judgement is unknown, not negative. */
  labels: Record<PersonLabel, number>
  /** The same counts over the raw set, so the exclusion is auditable. */
  labelsRaw: Record<PersonLabel, number>
  returns: {
    /** A pair of posts 24h apart — the only thing that earns the word. */
    confirmed: number
    /** Events on ≥2 posts. A named signal, NOT a return. */
    observedAcrossPosts: number
    /** People whose return timing could not be bounded. */
    timingUnknown: number
  }
  topics: TopicLine[]
  ranks: RankLine[]
  monthly: MonthlyLine[]
  recommendations: RecLine[]
  /** Where the `link_state` on each line came from.

      `view`    `audn_recommendation_links_v` was read, so `published` and
                `recommended` are reachable states. A read that succeeded and
                returned NO rows still counts as `view`: see the note on
                `AudienceSources.links`.
      `derived` the view was not read (absent or failed), so every line falls
                back to the idea store's own two states and the surface must
                not imply it can see publication. */
  linkSource: 'view' | 'derived'
  /** The recommendation read came back empty over a store that is not empty —
      i.e. it was not read at all. Rendered as a failure, never as "none yet". */
  recommendationsBlocked: boolean
  /** Auxiliary sources that failed or were truncated while the core held.
      Rendered as a line, never as a missing section pretending to be empty. */
  partial: string[]
}

const EMPTY_LABELS = (): Record<PersonLabel, number> =>
  ({ positive: 0, borderline: 0, negative: 0, unknown: 0 })

function asLabel(v: unknown): PersonLabel {
  return v === 'positive' || v === 'borderline' || v === 'negative' ? v : 'unknown'
}

export type AudienceSources = {
  lane: ContentLane
  topics: Soft<TopicPeopleRow>
  labels: Soft<PersonLabelRow>
  activity: Soft<PersonActivityRow>
  ranks: Soft<MatchedAgeRankRow>
  monthly: Soft<MonthlyMedianRow>
  recommendations: Soft<RecommendationRow>
  decisions: Soft<DecisionRow>
  /** `audn_recommendation_links_v`, client-scoped. THREE DIFFERENT THINGS, and
      the block must not confuse them:

        absent (undefined)  nobody asked. The old derivation runs and the
                            surface says only what the idea store proves.
        `{ok:false}`        the read FAILED — the view is not deployed, or RLS
                            refused it. Named in `partial` like every other
                            auxiliary source, and the derivation runs.
        `{ok:true, rows:[]}` the view WAS read and this lane has no link row.
                            THIS IS NOT A FAILURE. Migration 08 emits a row per
                            recommendation that reached an idea store; a
                            recommendation written moments ago, or one whose
                            chain 08 cannot evaluate, legitimately has no row.
                            Each such recommendation falls back to its own
                            derivation and nothing is flagged.

      That last case is why this source is NOT wired into the
      "empty over a known-non-empty set" check the way `storeCount` is: there
      is no floor to check it against. `recommendations` (the idea store) is
      the read that must never come back silently empty, and it still is. */
  links?: Soft<RecommendationLinkRow>
  /** Exact row count of the lane's whole idea store, unfiltered. `null` when
      it was not asked for. Zero is the RLS-empty signal described at
      STORE_NONEMPTY. */
  storeCount?: number | null
  /** Overrides the census floor. Only a caller that KNOWS the lane is new
      (a fourth client, a fixture) passes 0; the app never does. */
  knownFloor?: number
  storeFloor?: number
}

/** Pure. The whole state machine lives here so it can be tested without a
    network, and so the component has no arithmetic of its own to get wrong. */
export function summarize(src: AudienceSources): AudienceSummary {
  const base: AudienceSummary = {
    lane: src.lane,
    state: 'normal',
    message: null,
    people: { raw: 0, adjusted: 0, operators: 0 },
    labels: EMPTY_LABELS(),
    labelsRaw: EMPTY_LABELS(),
    returns: { confirmed: 0, observedAcrossPosts: 0, timingUnknown: 0 },
    topics: [],
    ranks: [],
    monthly: [],
    recommendations: [],
    linkSource: 'derived',
    recommendationsBlocked: false,
    partial: [],
  }

  // THE CORE. People and their labels are what every other line is a
  // denominator of, so if any of the three failed we do not render a partial
  // count that looks like a small audience — the block says it could not
  // read, and offers the retry.
  const core: Array<Soft<unknown>> = [src.topics, src.labels, src.activity]
  const firstCoreError = core.find(s => !s.ok)
  if (firstCoreError && !firstCoreError.ok) {
    return { ...base, state: 'unavailable', message: firstCoreError.error }
  }

  const topicRows = src.topics.ok ? src.topics.rows : []
  const labelRows = src.labels.ok ? src.labels.rows : []
  const activityRows = src.activity.ok ? src.activity.rows : []

  // ---- people -------------------------------------------------------------
  const raw = activityRows.length
  const operators = activityRows.filter(r => r.is_operator === true).length
  const adjusted = raw - operators
  base.people = { raw, adjusted, operators }

  // ---- labels -------------------------------------------------------------
  // Keyed by person so a person with several judged rows counts once, and so
  // "no row at all" can be counted as unknown against the activity set.
  const labelByPerson = new Map<string, PersonLabel>()
  const operatorKeys = new Set(
    activityRows.filter(r => r.is_operator === true).map(r => r.person_key),
  )
  for (const r of labelRows) {
    labelByPerson.set(r.person_key, asLabel(r.label))
    if (r.is_operator === true) operatorKeys.add(r.person_key)
  }
  for (const r of activityRows) {
    const l = labelByPerson.get(r.person_key) ?? 'unknown'
    base.labelsRaw[l] += 1
    if (!operatorKeys.has(r.person_key)) base.labels[l] += 1
  }

  // ---- returns ------------------------------------------------------------
  // Over the adjusted set, and the three figures are three different facts:
  // `confirmed` is a bounded pair of posts, `observedAcrossPosts` is only
  // "seen on more than one post", `timingUnknown` is neither.
  for (const r of activityRows) {
    if (operatorKeys.has(r.person_key)) continue
    if (r.confirmed_return === true) base.returns.confirmed += 1
    if (r.observed_across_posts === true) base.returns.observedAcrossPosts += 1
    if (r.return_timing === 'unknown' || r.return_timing == null) base.returns.timingUnknown += 1
  }

  // ---- topics -------------------------------------------------------------
  base.topics = topicRows
    .map(r => ({
      topic: r.topic,
      label: r.topic ?? 'unlabelled',
      people: num(r.people),
      events: num(r.events),
      posts: num(r.posts),
    }))
    .sort((a, b) => (b.people ?? 0) - (a.people ?? 0))

  // ---- auxiliary sources --------------------------------------------------
  if (src.ranks.ok) {
    base.ranks = src.ranks.rows
      .map(r => ({
        post_social_id: r.post_social_id,
        rank: num(r.rank),
        eligible_n: num(r.eligible_n),
        target_age_days: num(r.target_age_days),
        reactions: num(r.reactions),
      }))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 5)
  } else {
    base.partial.push(src.ranks.error)
  }

  if (src.monthly.ok) {
    base.monthly = src.monthly.rows.map(r => ({
      month: r.month,
      median_reactions: num(r.median_reactions),
      n: num(r.n),
      target_age_days: num(r.target_age_days),
      basis: r.basis,
    }))
  } else {
    base.partial.push(src.monthly.error)
  }

  if (!src.decisions.ok) base.partial.push(src.decisions.error)

  // The link view. A FAILED read is named (it is why the ladder tops out at
  // "a draft exists"); an EMPTY one is not, because a recommendation with no
  // link row yet is an ordinary state, not a lost read.
  if (src.links && !src.links.ok) base.partial.push(src.links.error)
  base.linkSource = src.links?.ok ? 'view' : 'derived'

  if (src.recommendations.ok) {
    base.recommendations = joinDecisions(
      src.lane,
      src.recommendations.rows,
      src.decisions.ok ? src.decisions.rows : [],
      src.links?.ok ? src.links.rows : [],
    )
    const storeFloor = src.storeFloor ?? storeFloorFor(src.lane)
    if (base.recommendations.length === 0 && src.storeCount === 0 && storeFloor > 0) {
      base.recommendationsBlocked = true
      base.partial.push(
        `recommendations: this lane's idea bank read as empty over ${storeFloor} rows on record — not read, sign in`,
      )
    }
  } else {
    base.partial.push(src.recommendations.error)
  }

  // A truncated read is a partial read. PostgREST caps a select long before
  // the caller notices (the 1000-row clamp), and a capped person set would
  // quietly shrink every denominator above.
  for (const [what, s] of [['labels', src.labels], ['people', src.activity]] as const) {
    if (s.ok && s.count != null && s.rows.length < s.count) {
      base.partial.push(`${what}: read ${s.rows.length} of ${s.count} rows (capped)`)
    }
  }

  // ---- the state ----------------------------------------------------------
  const floor = src.knownFloor ?? knownFloorFor(src.lane)
  if (raw === 0 && floor > 0) {
    return {
      ...base,
      state: 'failed_nonempty_expected',
      message:
        `0 rows for a lane that has ${floor} people on record — treat as a load failure, not an empty audience.`,
    }
  }
  if (raw === 0 && base.topics.length === 0 && base.recommendations.length === 0) {
    return { ...base, state: 'empty', message: null }
  }
  if (raw > 0 && base.labels.positive + base.labels.borderline + base.labels.negative === 0) {
    return {
      ...base,
      state: 'unknown',
      message: `No person in this lane carries a judgement yet — ${base.labels.unknown} of ${adjusted} unknown.`,
    }
  }
  return base
}

/** D3's decision vocabulary, per store. Kept next to `summarize` because the
    mapping IS the semantics: `audn_accept` and `approve` are the same
    editorial act recorded in two different tables. */
function joinDecisions(
  lane: ContentLane,
  recs: RecommendationRow[],
  decisions: DecisionRow[],
  links: RecommendationLinkRow[],
): RecLine[] {
  const byKey = new Map<string, DecisionRow>()
  for (const d of decisions) {
    // Last write wins: a re-decided recommendation shows its latest state.
    const prev = byKey.get(d.key)
    if (!prev || (d.decided_at ?? '') >= (prev.decided_at ?? '')) byKey.set(d.key, d)
  }

  // ---- the link view, keyed both ways ------------------------------------
  // A row is reachable by its prefixed ref (`audn-rec:<uuid>`, which is what a
  // client_ideas / lm_idea_candidates row carries as source_ref) and by the
  // idea's own primary key, because a recommendation that lost its source_ref
  // still has an id. Both maps hold the STRONGEST state seen for a key.
  //
  // AND EVERY ROW IS RE-CHECKED AGAINST THE LANE. The fetcher already sends
  // `.eq('client_id', lane)`, so a foreign row should never arrive — but "should
  // never arrive" is not a filter, and a link view is exactly the object where
  // one client's row landing under another client's heading would be a tenancy
  // leak rather than a cosmetic bug. Two locks, one door.
  const linkByRef = new Map<string, LinkState>()
  const linkByIdea = new Map<string, LinkState>()
  for (const row of links) {
    if (row.client_id !== lane) continue
    // Field evidence first: an id in `published_post_social_id` or `draft_id`
    // is the thing itself, and `link_state` is 08's summary of it. Reconciled
    // upwards so neither can pull the other down.
    const fromFields: LinkState = row.published_post_social_id
      ? 'published'
      : row.draft_id ? 'drafted' : 'unknown'
    const state = strongestLink(fromFields, asLinkState(row.link_state))
    for (const [map, key] of [
      [linkByRef, row.recommendation_ref],
      [linkByIdea, row.idea_id],
    ] as const) {
      if (!key) continue
      map.set(key, strongestLink(map.get(key) ?? 'unknown', state))
    }
  }

  return recs.map(r => {
    const d = byKey.get(lane === 'ivan' ? r.id : r.source_ref ?? r.id) ?? null
    let decision: DecisionState = null
    if (d) {
      if (d.action === 'audn_accept' || d.action === 'approve') decision = 'accepted'
      else if (d.action === 'audn_reject' || d.action === 'reject') decision = 'rejected'
      else if (d.action === 'audn_defer') decision = 'deferred'
    } else if (lane === 'ivan' && r.status === 'reviewing') {
      // D3: on Ivan's lane a defer leaves no row. A candidate still sitting in
      // `reviewing` with no decision IS the deferred state — documented there,
      // recorded here so the log does not read as undecided forever.
      decision = 'deferred'
    }

    // What the idea store alone proves. This is the whole of the old
    // derivation, and it is still what runs when the view has no row for this
    // recommendation — CONTRACTS §2.3, "no view row → existing derivation".
    const derived: LinkState = r.promoted_draft_id ? 'drafted' : r.status ? 'idea' : 'unknown'
    const fromView = (r.source_ref ? linkByRef.get(r.source_ref) : undefined)
      ?? linkByIdea.get(r.id)

    return {
      id: r.id,
      recommendation_ref: r.source_ref,
      title: r.title?.trim() || '(untitled recommendation)',
      sub: r.sub?.trim() || null,
      created_at: r.created_at,
      decision,
      reason: d?.reason ?? null,
      decided_at: d?.decided_at ?? null,
      link_state: fromView === undefined ? derived : strongestLink(derived, fromView),
    }
  })
}

// ---------------------------------------------------------------------------
// Fetchers. Every one soft-fails to an `{ok:false}` marker; none of them can
// throw the block down.
//
// `client_id` is passed in as a QUERY PARAMETER from the lane the operator
// chose. Nothing here derives a client from a route, and this module is never
// imported by a client-facing surface (contract §4).
// ---------------------------------------------------------------------------
const PERSON_CAP = 1000

export function fetchTopicPeople(lane: ContentLane): Promise<Soft<TopicPeopleRow>> {
  return soft('topics', () =>
    supabase.from('audn_topic_people_v')
      .select('client_id, topic, people, events, posts')
      .eq('client_id', lane))
}

export function fetchPersonLabels(lane: ContentLane): Promise<Soft<PersonLabelRow>> {
  return soft('labels', () =>
    supabase.from('audn_person_label_v')
      .select('client_id, person_key, label, is_operator, is_excluded, conflict', { count: 'exact' })
      .eq('client_id', lane)
      .limit(PERSON_CAP))
}

export function fetchPersonActivity(lane: ContentLane): Promise<Soft<PersonActivityRow>> {
  return soft('people', () =>
    supabase.from('audn_person_activity_v')
      .select(
        'client_id, person_key, distinct_posts, total_events, observed_across_posts, ' +
        'confirmed_return, return_timing, is_operator, is_excluded',
        { count: 'exact' },
      )
      .eq('client_id', lane)
      .limit(PERSON_CAP))
}

export function fetchMatchedAgeRanks(lane: ContentLane): Promise<Soft<MatchedAgeRankRow>> {
  return soft('matched-age ranks', () =>
    supabase.from('audn_matched_age_rank_v')
      .select('client_id, post_social_id, target_age_days, reactions, rank, eligible_n, rank_basis')
      .eq('client_id', lane)
      .order('rank', { ascending: true, nullsFirst: false })
      .limit(50))
}

export function fetchMonthlyMedian(lane: ContentLane): Promise<Soft<MonthlyMedianRow>> {
  return soft('monthly median', () =>
    supabase.from('audn_monthly_median_v')
      .select('client_id, month, target_age_days, median_reactions, n, basis')
      .eq('client_id', lane)
      .order('month', { ascending: false })
      .limit(12))
}

/** D3 recommendation identity, per store.

    🔴 The client lane reads `client_ideas` DIRECTLY rather than through
    `operator_client_ideas`. That RPC is the right call for "which ideas count"
    — it defines the staged queue — but it filters `status = 'staged'`, which
    would hide exactly the accepted and rejected recommendations this decision
    log exists to show, and it cannot express the `source_ref` filter that IS
    the definition of "an audience recommendation". Read-only, lane-scoped,
    and it soft-fails if anon cannot select. */
export async function fetchRecommendations(lane: ContentLane): Promise<Soft<RecommendationRow>> {
  if (lane === 'ivan') {
    const s = await soft<Record<string, unknown>>('recommendations', () =>
      supabase.from('lm_idea_candidates')
        .select('id, source, source_ref, raw_topic, normalized_topic, status, promoted_draft_id, ingested_at')
        .eq('source', 'audience_review')
        .limit(50))
    if (!s.ok) return s
    return {
      ok: true,
      rows: s.rows.map(r => ({
        id: String(r.id),
        source_ref: (r.source_ref as string | null) ?? null,
        title: (r.normalized_topic as string | null) ?? (r.raw_topic as string | null) ?? null,
        sub: (r.raw_topic as string | null) ?? null,
        status: (r.status as string | null) ?? null,
        created_at: (r.ingested_at as string | null) ?? null,
        promoted_draft_id: (r.promoted_draft_id as string | null) ?? null,
      })),
    }
  }
  const s = await soft<Record<string, unknown>>('recommendations', () =>
    supabase.from('client_ideas')
      .select('id, client_id, title, hook, source_label, source_ref, status, created_at')
      .eq('client_id', lane)
      .like('source_ref', 'audn-rec:%')
      .limit(50))
  if (!s.ok) return s
  return {
    ok: true,
    rows: s.rows.map(r => ({
      id: String(r.id),
      source_ref: (r.source_ref as string | null) ?? null,
      title: (r.title as string | null) ?? null,
      sub: (r.hook as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
      promoted_draft_id: null,
    })),
  }
}

/** `audn_recommendation_links_v` — recommendation → idea → draft → published
    post, one row per recommendation per client (migration 08).

    CLIENT-SCOPED BY THE LANE THAT WAS PASSED IN, exactly like every other
    `audn_*` read on this surface: the view carries a `client_id` for BOTH
    stores — `client_ideas.client_id` for a client lane and the literal `'ivan'`
    for the `lm_idea_candidates` branch — so one filter covers both and nothing
    here has to know which store it is looking at.

    Soft. This is an AUXILIARY source, not a core one: until migration 08 is
    applied, production answers this select with 42P01 and the block still
    renders every recommendation it can read from the idea store, with the
    ladder topping out at `drafted` and the failure named in `partial`. It must
    never take the block to `unavailable` — the people counts do not depend on
    it. */
export function fetchRecommendationLinks(lane: ContentLane): Promise<Soft<RecommendationLinkRow>> {
  return soft('recommendation links', () =>
    supabase.from('audn_recommendation_links_v')
      .select(
        'client_id, recommendation_id, recommendation_ref, idea_id, draft_id, ' +
        'published_post_social_id, link_state',
      )
      .eq('client_id', lane)
      .limit(200))
}

/** The lane's whole idea store, counted without the audn filter. The only
    thing that can tell an empty recommendation set apart from an unread table
    (see STORE_NONEMPTY). Never throws; `null` means the count itself failed. */
export async function fetchIdeaStoreCount(lane: ContentLane): Promise<number | null> {
  try {
    const q = lane === 'ivan'
      ? supabase.from('lm_idea_candidates').select('id', { count: 'exact', head: true })
      : supabase.from('client_ideas').select('id', { count: 'exact', head: true }).eq('client_id', lane)
    const { count, error } = await q
    return error ? null : count ?? null
  } catch {
    return null
  }
}

/** The decision log. Ivan's decisions are joined client-side on the candidate
    id, so this needs the recommendation rows first (D3). */
export async function fetchDecisions(
  lane: ContentLane, recs: RecommendationRow[],
): Promise<Soft<DecisionRow>> {
  if (lane === 'ivan') {
    const ids = recs.map(r => r.id)
    if (!ids.length) return { ok: true, rows: [] }
    const s = await soft<Record<string, unknown>>('decisions', () =>
      supabase.from('lm_idea_review_decisions')
        .select('id, candidate_id, decision, reason, decided_at')
        .in('candidate_id', ids)
        .limit(200))
    if (!s.ok) return s
    return {
      ok: true,
      rows: s.rows.map(r => ({
        key: String(r.candidate_id),
        action: (r.decision as string | null) ?? null,
        reason: (r.reason as string | null) ?? null,
        decided_at: (r.decided_at as string | null) ?? null,
      })),
    }
  }
  const s = await soft<Record<string, unknown>>('decisions', () =>
    supabase.from('client_board_actions')
      .select('id, client_id, action, ref, payload, created_at')
      .eq('client_id', lane)
      .in('action', ['audn_accept', 'audn_reject', 'audn_defer'])
      .limit(200))
  if (!s.ok) return s
  return {
    ok: true,
    rows: s.rows.map(r => {
      const p = (r.payload ?? {}) as Record<string, unknown>
      return {
        key: String(r.ref ?? ''),
        action: (r.action as string | null) ?? null,
        reason: typeof p.reason === 'string' ? p.reason : null,
        decided_at: (r.created_at as string | null) ?? null,
      }
    }),
  }
}

/** One lane's whole audience block. Reads in parallel; the decision log is the
    only sequential step, because Ivan's decisions key off the candidate ids
    the recommendation read returns. */
export async function fetchAudienceSummary(lane: ContentLane): Promise<AudienceSummary> {
  const [topics, labels, activity, ranks, monthly, storeCount, links, pair] = await Promise.all([
    fetchTopicPeople(lane),
    fetchPersonLabels(lane),
    fetchPersonActivity(lane),
    fetchMatchedAgeRanks(lane),
    fetchMonthlyMedian(lane),
    fetchIdeaStoreCount(lane),
    // Parallel with the recommendations rather than after them: the join is
    // done here, on keys the view already carries, so it needs no ids from the
    // idea read the way `fetchDecisions` does.
    fetchRecommendationLinks(lane),
    (async () => {
      const recommendations = await fetchRecommendations(lane)
      const decisions = await fetchDecisions(lane, recommendations.ok ? recommendations.rows : [])
      return { recommendations, decisions }
    })(),
  ])
  return summarize({
    lane, topics, labels, activity, ranks, monthly, storeCount, links,
    recommendations: pair.recommendations,
    decisions: pair.decisions,
  })
}
