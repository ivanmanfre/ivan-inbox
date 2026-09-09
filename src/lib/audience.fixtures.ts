/* ==========================================================================
   DEV ONLY. Not imported by anything that ships.

   `useAudience` reaches this module through a dynamic `import()` guarded by
   `import.meta.env.DEV && ?audnFixture=1`, so the production bundle drops the
   branch and never emits the chunk. It exists for one reason: the audn_* views
   are not deployed, so the only state the running app can show today is
   `unavailable` — and a layout nobody has LOOKED at is a layout nobody has
   checked. This renders the real component against the real state machine.

   The numbers are the Run 01 census, frozen at 2026-09-09T14:30Z
   (R2/fixtures/expected/census-baseline.json, mirrored in
   OUT/inbox/fixtures/normal-<lane>.json). Nothing here is a claim about the
   audience; it is a shape to look at.
   ========================================================================== */
import type { ContentLane } from './content'
import {
  summarize,
  type AudienceSources, type AudienceSummary, type MatchedAgeRankRow,
  type MonthlyMedianRow, type PersonActivityRow, type PersonLabelRow,
  type RecommendationRow, type RecommendationLinkRow, type DecisionRow,
  type TopicPeopleRow, type PersonLabel,
} from './audience'

type LaneSpec = {
  people: number
  operators: number
  labels: Record<Exclude<PersonLabel, 'unknown'>, number>
  confirmed: number
  observed: number
  topics: Array<[string | null, number, number, number]>   // topic, people, events, posts
  ranks: Array<[string, number, number, number, number]>   // post, rank, eligible_n, age, reactions
  monthly: Array<[string, number, number]>                  // month, median, n
  recs: RecSpec[]
}

/** One fixture recommendation. Spelled out rather than positional, because Run
    04 A2 has to steer three things per row that used to be hard-coded: the idea
    row's status, whether the store knows about a draft, and what (if anything)
    `audn_recommendation_links_v` says about it.

    `link: null` — and a row that omits `link` — means THE VIEW HAS NO ROW FOR
    THIS RECOMMENDATION. That is a legitimate state, not a load failure, and the
    derivation off the idea store alone is what runs for it. */
type RecSpec = {
  ref: string
  title: string
  /** The decision action, or null for a recommendation nobody has answered. */
  action: string | null
  reason: string | null
  /** The idea row's own status. `null` = a row in the store with no status at
      all, which is the only way the ladder can floor at `unknown`. */
  status?: string | null
  /** `promoted_draft_id` on the idea row. */
  draft?: boolean
  /** What migration 08's view would answer for this ref, if anything. */
  link?: { state: string; draft_id?: string | null; published?: string | null } | null
}

// Census: distinct_people ivan 90 · risedtc 191 · arch 48;
// events 112 / 275 / 92; confirmed_return 4 / 18 / 15.
const SPEC: Record<ContentLane, LaneSpec> = {
  ivan: {
    people: 90, operators: 0,
    labels: { positive: 5, borderline: 21, negative: 48 },
    confirmed: 4, observed: 6,
    topics: [
      ['personal', 54, 64, 6], ['demand', 13, 17, 7], ['authority', 10, 11, 5],
      ['teardown', 6, 8, 4], [null, 7, 8, 2], ['case_study', 4, 4, 2],
    ],
    ranks: [
      ['urn:li:activity:7490000000000000011', 1, 26, 7, 88],
      ['urn:li:activity:7490000000000000012', 2, 26, 7, 61],
      ['urn:li:activity:7490000000000000013', 3, 26, 7, 44],
    ],
    monthly: [['2026-08', 31, 12], ['2026-07', 24, 9]],
    recs: [
      { ref: 'audn-rec:11111111-1111-4111-8111-111111111111', title: 'Publish the seat-pacing receipt as a teardown', action: 'approve', reason: 'matches the demand topic the positive engagers cluster on', draft: true, link: { state: 'published', draft_id: 'draft-1', published: 'urn:li:activity:7490000000000000011' } },
      { ref: 'audn-rec:22222222-2222-4222-8222-222222222222', title: 'Second post on the same rebuild', action: 'reject', reason: 'same claim as last week, no new receipt', link: { state: 'drafted', draft_id: 'draft-2' } },
      // No decision row and no view row. On Ivan's lane this is the case Seat D
      // caught rendering a `deferred` badge for a call nobody took: it now says
      // "no decision · reviewing", which is the whole of what is on record.
      { ref: 'audn-rec:33333333-3333-4333-8333-333333333333', title: 'Ask the three quiet buyers what broke', action: null, reason: null },
    ],
  },
  risedtc: {
    people: 191, operators: 1,
    labels: { positive: 13, borderline: 57, negative: 121 },
    confirmed: 20, observed: 28,
    topics: [['trust', 137, 165, 5], ['reach', 40, 57, 13], ['buyers', 37, 53, 18]],
    ranks: [
      ['urn:li:activity:7490000000000000021', 1, 36, 7, 214],
      ['urn:li:activity:7490000000000000022', 2, 36, 7, 152],
    ],
    monthly: [['2026-08', 96, 18], ['2026-07', 88, 15], ['2026-06', 71, 11]],
    recs: [
      { ref: 'audn-rec:44444444-4444-4444-8444-444444444444', title: 'One founder-voice post per week on supply', action: 'audn_accept', reason: 'the 13 positive people all engaged on trust posts', draft: true, link: { state: 'published', draft_id: 'draft-1', published: 'urn:li:activity:7490000000000000021' } },
      { ref: 'audn-rec:55555555-5555-4555-8555-555555555555', title: 'Run the same angle twice in a week', action: 'audn_defer', reason: 'wait for the next two weeks of snapshots', link: { state: 'drafted', draft_id: 'draft-2' } },
    ],
  },
  arch: {
    people: 48, operators: 1,
    labels: { positive: 2, borderline: 0, negative: 46 },
    confirmed: 15, observed: 21,
    // The census has no topic on any ARCH post: the row is real and unlabelled,
    // and it renders as "unlabelled" rather than being dropped.
    topics: [[null, 48, 92, 6]],
    ranks: [],       // no matched-age snapshots — the block says so in words
    monthly: [],
    // ARCH carries the two states no lane could reach before Run 04 A2. Seat D
    // photographed three of the five link phrases and reported the other two as
    // never having reached a screen; these are those two, on the shortest lane,
    // so both land in one frame.
    recs: [
      { ref: 'audn-rec:66666666-6666-4666-8666-666666666666', title: 'Publish the placement rule as a games-marketing note', action: 'audn_accept', reason: 'two positive engagers are both studio-side', draft: true, link: { state: 'published', draft_id: 'draft-1', published: 'urn:li:activity:7490000000000000031' } },
      // `recommended`: 08 emits it for a ref with NO idea row behind it. The
      // corner where this consumer can still see one is 08's `audn_cutoff()` —
      // an idea created after the cutoff is invisible to the view while the app
      // reads it fine, so the view answers with an orphan recommendation. The
      // store side has no status at all, which is what stops precedence lifting
      // it to `idea`.
      { ref: 'audn-rec:77777777-7777-4777-8777-777777777777', title: 'Name the placement judge in the weekly note', action: 'audn_reject', reason: 'the second judge pass is four days old, wait for a Saturday run', status: null, link: { state: 'recommended' } },
      // `link unknown`: no view row AND no status to derive from. The floor of
      // the ladder, said out loud rather than smoothed into "idea only".
      { ref: 'audn-rec:88888888-8888-4888-8888-888888888888', title: 'Ask the two studio-side engagers what they build on', action: null, reason: null, status: null },
    ],
  },
}

function buildPeople(spec: LaneSpec): { activity: PersonActivityRow[]; labels: PersonLabelRow[] } {
  const activity: PersonActivityRow[] = []
  const labels: PersonLabelRow[] = []
  const seq: PersonLabel[] = []
  for (let i = 0; i < spec.labels.positive; i++) seq.push('positive')
  for (let i = 0; i < spec.labels.borderline; i++) seq.push('borderline')
  for (let i = 0; i < spec.labels.negative; i++) seq.push('negative')
  for (let i = 0; i < spec.people; i++) {
    const key = `ACoAA_fixture_${String(i).padStart(4, '0')}`
    // The operator sits at the END of the range, so excluding them does not
    // eat into the census counts the earlier indices reproduce.
    const isOperator = i >= spec.people - spec.operators
    activity.push({
      client_id: 'fixture', person_key: key,
      distinct_posts: i < spec.observed ? 2 : 1,
      total_events: i < spec.observed ? 2 : 1,
      observed_across_posts: i < spec.observed,
      confirmed_return: i < spec.confirmed,
      return_timing: i < spec.confirmed ? 'bounded' : 'unknown',
      is_operator: isOperator, is_excluded: isOperator,
    })
    // People past the labelled run carry NO label row at all — which is how
    // the census looks, and how `unknown` has to be counted (by absence).
    const l = seq[i]
    if (l) {
      labels.push({
        client_id: 'fixture', person_key: key, label: l,
        is_operator: isOperator, is_excluded: isOperator, conflict: false,
      })
    }
  }
  return { activity, labels }
}

export function fixtureSources(lane: ContentLane): AudienceSources {
  const spec = SPEC[lane]
  const { activity, labels } = buildPeople(spec)
  const topics: TopicPeopleRow[] = spec.topics.map(([topic, people, events, posts]) =>
    ({ client_id: lane, topic, people, events, posts }))
  const ranks: MatchedAgeRankRow[] = spec.ranks.map(([post, rank, n, age, reactions]) =>
    ({ client_id: lane, post_social_id: post, rank, eligible_n: n, target_age_days: age, reactions, rank_basis: 'matched_age' }))
  const monthly: MonthlyMedianRow[] = spec.monthly.map(([month, median, n]) =>
    ({ client_id: lane, month, median_reactions: median, n, target_age_days: 7, basis: 'matched_age' }))
  const recommendations: RecommendationRow[] = spec.recs.map((r, i) => ({
    id: `${lane}-rec-${i}`,
    source_ref: r.ref,
    title: r.title,
    sub: null,
    status: r.status === undefined ? 'reviewing' : r.status,
    created_at: '2026-09-08T09:00:00Z',
    promoted_draft_id: r.draft ? 'draft-1' : null,
  }))
  const decisions: DecisionRow[] = spec.recs.flatMap((r, i) =>
    r.action ? [{
      key: lane === 'ivan' ? `${lane}-rec-${i}` : r.ref,
      action: r.action, reason: r.reason, decided_at: '2026-09-09T08:30:00Z',
    }] : [])
  // `audn_recommendation_links_v` as migration 08 would answer it once applied,
  // so the preview shows the WHOLE ladder rather than the two states the idea
  // store can prove on its own. A rec that declares no `link` gets NO ROW here,
  // which is the case that must not read as a failure: a recommendation can
  // legitimately have no link row yet, and the derivation off its own idea row
  // is what runs for it.
  const links: RecommendationLinkRow[] = spec.recs.flatMap((r, i) =>
    r.link ? [{
      client_id: lane,
      recommendation_id: r.ref.replace('audn-rec:', ''),
      recommendation_ref: r.ref,
      idea_id: `${lane}-rec-${i}`,
      draft_id: r.link.draft_id ?? null,
      published_post_social_id: r.link.published ?? null,
      link_state: r.link.state,
    }] : [])
  return {
    lane,
    topics: { ok: true, rows: topics },
    labels: { ok: true, rows: labels, count: labels.length },
    activity: { ok: true, rows: activity, count: activity.length },
    ranks: { ok: true, rows: ranks },
    monthly: { ok: true, rows: monthly },
    recommendations: { ok: true, rows: recommendations },
    decisions: { ok: true, rows: decisions },
    links: { ok: true, rows: links },
  }
}

export function fixtureSummary(lane: ContentLane): AudienceSummary {
  return summarize(fixtureSources(lane))
}
