import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  AudienceSources, PersonActivityRow, PersonLabelRow, RecommendationRow,
  RecommendationLinkRow, DecisionRow, Soft,
} from './audience'
import type { ContentLane } from './content'

/* ==========================================================================
   The audience block's state machine (W16).

   The case this suite exists for is the third one down: ZERO ROWS FOR A LANE
   THAT HAS PEOPLE IS A FAILURE, NOT AN EMPTY AUDIENCE. On 2026-09-09 this app
   shipped two cache reads that returned nothing over a set that was known not
   to be empty, and both rendered as a calm "nothing here". The floor comes
   from the Run 01 census (risedtc 191 people / ivan 90 / arch 48; events
   275 / 112 / 92), frozen at 2026-09-09T14:30Z.
   ========================================================================== */

type Q = { table: string; ops: Array<[string, ...unknown[]]> }
let queries: Q[] = []
let result: { data: unknown; error: { message: string } | null; count?: number | null } =
  { data: [], error: null, count: 0 }

function builder(table: string) {
  const q: Q = { table, ops: [] }
  queries.push(q)
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'like', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => { q.ops.push([m, ...args]); return chain }
  }
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return chain
}

vi.mock('./supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const {
  summarize, fetchRecommendations, fetchDecisions, fetchPersonLabels,
  fetchRecommendationLinks, fetchAudienceSummary, KNOWN_NONEMPTY, knownFloorFor,
} = await import('./audience')
const { fixtureSummary } = await import('./audience.fixtures')

beforeEach(() => {
  queries = []
  result = { data: [], error: null, count: 0 }
})

const ok = <T,>(rows: T[], count?: number): Soft<T> => ({ ok: true, rows, count })
const bad = <T,>(error: string): Soft<T> => ({ ok: false, error })

const sources = (o: Partial<AudienceSources> = {}): AudienceSources => ({
  lane: 'risedtc',
  topics: ok([]), labels: ok([]), activity: ok([]),
  ranks: ok([]), monthly: ok([]), recommendations: ok([]), decisions: ok([]),
  ...o,
})

const person = (key: string, o: Partial<PersonActivityRow> = {}): PersonActivityRow => ({
  client_id: 'risedtc', person_key: key,
  distinct_posts: 1, total_events: 1,
  observed_across_posts: false, confirmed_return: false, return_timing: 'unknown',
  is_operator: false, is_excluded: false,
  ...o,
})

const labelled = (key: string, label: string, o: Partial<PersonLabelRow> = {}): PersonLabelRow => ({
  client_id: 'risedtc', person_key: key, label,
  is_operator: false, is_excluded: false, conflict: false,
  ...o,
})

const rec = (o: Partial<RecommendationRow> = {}): RecommendationRow => ({
  id: 'c1', source_ref: 'audn-rec:1111', title: 'Publish the placement rule',
  sub: null, status: 'reviewing', created_at: '2026-09-08T09:00:00Z',
  promoted_draft_id: null, ...o,
})

const decision = (o: Partial<DecisionRow> = {}): DecisionRow => ({
  key: 'audn-rec:1111', action: 'audn_accept', reason: 'two positive engagers',
  decided_at: '2026-09-09T08:00:00Z', ...o,
})

// One row of audn_recommendation_links_v, keyed the way migration 08 keys it:
// `recommendation_ref` is the prefixed source_ref, `idea_id` the idea row's own
// primary key. Defaults to the weakest honest row — the idea exists and nothing
// downstream of it does.
const link = (o: Partial<RecommendationLinkRow> = {}): RecommendationLinkRow => ({
  client_id: 'risedtc',
  recommendation_id: '1111',
  recommendation_ref: 'audn-rec:1111',
  idea_id: 'c1',
  draft_id: null,
  published_post_social_id: null,
  link_state: 'idea',
  ...o,
})

// ---------------------------------------------------------------------------

describe('the five states', () => {
  it('is unavailable when any CORE source could not be read, and carries the message', () => {
    // This is what production returns TODAY on every lane: the audn_* views are
    // built on a branch and not applied. It must read as "could not load",
    // never as "you have no audience".
    const missing = 'labels: relation "public.audn_person_label_v" does not exist'
    const s = summarize(sources({ labels: bad(missing) }))
    expect(s.state).toBe('unavailable')
    expect(s.message).toBe(missing)
  })

  it('treats a failure in ANY of people / labels / topics as unavailable, not as a smaller audience', () => {
    // A partial core read would render a denominator that is simply wrong, and
    // a wrong denominator is worse than a missing one.
    for (const k of ['topics', 'labels', 'activity'] as const) {
      const s = summarize(sources({ [k]: bad(`${k}: permission denied`) }))
      expect(s.state).toBe('unavailable')
      expect(s.message).toContain('permission denied')
    }
  })

  it('keeps rendering when an AUXILIARY source fails, and names what is missing', () => {
    const s = summarize(sources({
      activity: ok([person('a'), person('b')]),
      labels: ok([labelled('a', 'positive')]),
      ranks: bad('matched-age ranks: relation does not exist'),
      monthly: bad('monthly median: relation does not exist'),
    }))
    expect(s.state).toBe('normal')
    expect(s.people.adjusted).toBe(2)
    expect(s.partial).toEqual([
      'matched-age ranks: relation does not exist',
      'monthly median: relation does not exist',
    ])
  })

  it('calls a genuinely empty lane empty ONLY when nothing was expected', () => {
    const s = summarize(sources({ lane: 'risedtc', knownFloor: 0 }))
    expect(s.state).toBe('empty')
    expect(s.message).toBeNull()
  })

  it('is unknown when people exist and not one of them carries a judgement', () => {
    const s = summarize(sources({
      activity: ok([person('a'), person('b'), person('c')]),
      labels: ok([]),
    }))
    expect(s.state).toBe('unknown')
    expect(s.labels.unknown).toBe(3)
    expect(s.message).toContain('3 of 3 unknown')
  })

  it('is normal once a single judgement exists', () => {
    const s = summarize(sources({
      activity: ok([person('a'), person('b')]),
      labels: ok([labelled('a', 'borderline')]),
    }))
    expect(s.state).toBe('normal')
    expect(s.message).toBeNull()
  })
})

describe('empty over a known-non-empty set is a FAILURE', () => {
  // One case per lane, because the floor is per lane and a lane added to the
  // Segmented control without a floor would silently lose the check.
  const floors: Array<[ContentLane, number]> = [['ivan', 90], ['risedtc', 191], ['arch', 48]]

  for (const [lane, people] of floors) {
    it(`${lane}: zero rows is a load failure, not an empty audience`, () => {
      const s = summarize(sources({ lane }))
      expect(s.state).toBe('failed_nonempty_expected')
      expect(s.message).toContain(`${people} people on record`)
      expect(s.message).toContain('load failure')
      // And never the calm one.
      expect(s.state).not.toBe('empty')
    })
  }

  it('holds the census numbers the check is floored on', () => {
    // R2/fixtures/expected/census-baseline.json → distinct_people, cutoff
    // 2026-09-09T14:30Z. If this ever needs editing, the reason belongs in the
    // commit message, because lowering a floor turns the check off.
    expect(KNOWN_NONEMPTY).toEqual({
      ivan: { people: 90 }, risedtc: { people: 191 }, arch: { people: 48 },
    })
    expect(knownFloorFor('zz-audn')).toBe(0)
  })

  it('does not fire on a lane that really has rows', () => {
    const s = summarize(sources({ lane: 'arch', activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]) }))
    expect(s.state).toBe('normal')
  })
})

describe('unknown is a value — it never lowers or hides a count', () => {
  it('counts a person with no label row as unknown rather than dropping them', () => {
    const withUnknowns = summarize(sources({
      activity: ok([person('a'), person('b'), person('c'), person('d'), person('e')]),
      labels: ok([labelled('a', 'positive')]),
    }))
    const withoutUnknowns = summarize(sources({
      activity: ok([person('a')]),
      labels: ok([labelled('a', 'positive')]),
    }))
    // The positive count is the SAME number either way: unknowns neither add to
    // it nor subtract from it.
    expect(withUnknowns.labels.positive).toBe(1)
    expect(withoutUnknowns.labels.positive).toBe(1)
    // And the unknowns are still people — the denominator does not shrink.
    expect(withUnknowns.people.adjusted).toBe(5)
    expect(withUnknowns.labels.unknown).toBe(4)
    expect(
      withUnknowns.labels.positive + withUnknowns.labels.borderline
      + withUnknowns.labels.negative + withUnknowns.labels.unknown,
    ).toBe(withUnknowns.people.adjusted)
  })

  it('reads an unrecognised label as unknown instead of guessing a bucket', () => {
    const s = summarize(sources({
      activity: ok([person('a')]),
      labels: ok([labelled('a', 'maybe-later')]),
    }))
    expect(s.labels.unknown).toBe(1)
    expect(s.labels.negative).toBe(0)
  })

  it('counts a person once even when the classifier judged several of their rows', () => {
    const s = summarize(sources({
      activity: ok([person('a')]),
      labels: ok([labelled('a', 'positive'), labelled('a', 'positive')]),
    }))
    expect(s.people.adjusted).toBe(1)
    expect(s.labels.positive).toBe(1)
  })
})

describe('the operator is excluded from the denominator and still shown', () => {
  it('reports raw, adjusted and the operator count side by side', () => {
    const s = summarize(sources({
      activity: ok([
        person('op', { is_operator: true, is_excluded: true }),
        person('a'), person('b'), person('c'),
      ]),
      labels: ok([
        labelled('op', 'positive', { is_operator: true, is_excluded: true }),
        labelled('a', 'positive'),
      ]),
    }))
    expect(s.people).toEqual({ raw: 4, adjusted: 3, operators: 1 })
    // The exclusion is auditable: the raw tally still carries the operator.
    expect(s.labels.positive).toBe(1)
    expect(s.labelsRaw.positive).toBe(2)
  })

  it('excludes an operator known only to the label view, not to the activity view', () => {
    const s = summarize(sources({
      activity: ok([person('op'), person('a')]),
      labels: ok([labelled('op', 'positive', { is_operator: true }), labelled('a', 'negative')]),
    }))
    expect(s.labels.positive).toBe(0)
    expect(s.labelsRaw.positive).toBe(1)
  })
})

describe('returns: three different facts, three different lines', () => {
  it('counts unknown timing separately from a confirmed return', () => {
    const s = summarize(sources({
      activity: ok([
        // A bounded pair of posts — the only thing that earns the word.
        person('a', { confirmed_return: true, return_timing: 'bounded', observed_across_posts: true }),
        // Seen on two posts, but the timing could not be bounded. NOT a return.
        person('b', { confirmed_return: false, return_timing: 'unknown', observed_across_posts: true }),
        person('c'),
      ]),
      labels: ok([labelled('a', 'positive')]),
    }))
    expect(s.returns.confirmed).toBe(1)
    expect(s.returns.observedAcrossPosts).toBe(2)
    expect(s.returns.timingUnknown).toBe(2)
    // The two must never be added together or substituted for one another.
    expect(s.returns.observedAcrossPosts).not.toBe(s.returns.confirmed)
  })

  it('counts a null return_timing as unknown rather than as bounded', () => {
    const s = summarize(sources({
      activity: ok([person('a', { return_timing: null })]),
      labels: ok([labelled('a', 'positive')]),
    }))
    expect(s.returns.timingUnknown).toBe(1)
  })

  it('leaves the operator out of the return counts too', () => {
    const s = summarize(sources({
      activity: ok([
        person('op', { is_operator: true, confirmed_return: true, return_timing: 'bounded' }),
        person('a', { confirmed_return: true, return_timing: 'bounded' }),
      ]),
      labels: ok([labelled('a', 'positive')]),
    }))
    expect(s.returns.confirmed).toBe(1)
  })
})

describe('topics keep their unlabelled rows', () => {
  it('renders a null topic as unlabelled instead of dropping the row', () => {
    // Every ARCH post in the census has a null topic; dropping them would show
    // an empty topic table over 48 real people.
    const s = summarize(sources({
      lane: 'arch',
      activity: ok([person('a')]),
      labels: ok([labelled('a', 'positive')]),
      topics: ok([{ client_id: 'arch', topic: null, people: 48, events: 92, posts: 6 }]),
    }))
    expect(s.topics).toHaveLength(1)
    expect(s.topics[0]).toMatchObject({ topic: null, label: 'unlabelled', people: 48, events: 92 })
  })
})

describe('a capped read is a partial read', () => {
  it('says so when PostgREST returned fewer rows than it counted', () => {
    // The 1000-row clamp: a capped person set silently shrinks every
    // denominator above it.
    const rows = Array.from({ length: 3 }, (_, i) => person(`p${i}`))
    const s = summarize(sources({ activity: ok(rows, 1200), labels: ok([labelled('p0', 'positive')]) }))
    expect(s.partial.some(p => p.includes('read 3 of 1200 rows (capped)'))).toBe(true)
  })
})

describe('recommendations and their decisions (D3: no new table)', () => {
  it('maps a client board action onto the recommendation it names', () => {
    const s = summarize(sources({
      lane: 'risedtc',
      activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
      recommendations: ok([rec()]),
      decisions: ok([decision()]),
    }))
    expect(s.recommendations[0]).toMatchObject({
      decision: 'accepted', reason: 'two positive engagers', link_state: 'idea',
    })
  })

  it('reads audn_reject and audn_defer as their own states', () => {
    for (const [action, state] of [['audn_reject', 'rejected'], ['audn_defer', 'deferred']] as const) {
      const s = summarize(sources({
        lane: 'risedtc',
        activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
        recommendations: ok([rec()]), decisions: ok([decision({ action })]),
      }))
      expect(s.recommendations[0].decision).toBe(state)
    }
  })

  it('joins Ivan’s decisions on the candidate id, not on the recommendation ref', () => {
    const s = summarize(sources({
      lane: 'ivan',
      activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
      recommendations: ok([rec({ id: 'cand-9', source_ref: 'audn-rec:9999' })]),
      decisions: ok([decision({ key: 'cand-9', action: 'approve', reason: 'top of the queue' })]),
    }))
    expect(s.recommendations[0].decision).toBe('accepted')
    expect(s.recommendations[0].reason).toBe('top of the queue')
  })

  it('reads a candidate still in review with no decision row as deferred (Ivan lane only)', () => {
    // D3: on Ivan's lane a defer writes nothing; the candidate is simply left
    // at status='reviewing'. On a client lane the same absence is undecided,
    // because a defer there DOES write an audn_defer row.
    const ivan = summarize(sources({
      lane: 'ivan',
      activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
      recommendations: ok([rec({ status: 'reviewing' })]), decisions: ok([]),
    }))
    expect(ivan.recommendations[0].decision).toBe('deferred')

    const client = summarize(sources({
      lane: 'risedtc',
      activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
      recommendations: ok([rec({ status: 'staged' })]), decisions: ok([]),
    }))
    expect(client.recommendations[0].decision).toBeNull()
  })

  it('never claims a recommendation was published when the link view was not read', () => {
    // Without audn_recommendation_links_v the furthest this block may go is
    // "a draft exists". A status string does not prove a post went live.
    const s = summarize(sources({
      lane: 'ivan',
      activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
      recommendations: ok([rec({ promoted_draft_id: 'd-1' })]), decisions: ok([]),
    }))
    expect(s.recommendations[0].link_state).toBe('drafted')
    expect(s.linkSource).toBe('derived')
    expect(JSON.stringify(s.recommendations)).not.toContain('published')
  })

  it('shows the latest decision when a recommendation was decided twice', () => {
    const s = summarize(sources({
      lane: 'risedtc',
      activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
      recommendations: ok([rec()]),
      decisions: ok([
        decision({ action: 'audn_defer', decided_at: '2026-09-01T00:00:00Z', reason: 'wait' }),
        decision({ action: 'audn_accept', decided_at: '2026-09-08T00:00:00Z', reason: 'go' }),
      ]),
    }))
    expect(s.recommendations[0]).toMatchObject({ decision: 'accepted', reason: 'go' })
  })
})

describe('the link view carries the rest of the ladder (migration 08)', () => {
  /* Run 04 F-A. Before this, `LinkState` was idea | drafted | unknown and
     nothing ever queried audn_recommendation_links_v — so "published" could not
     be shown no matter how many migrations were applied. These cases fix the
     four states, the absent-row fallback, and the tenancy filter. */
  const withLinks = (
    links: RecommendationLinkRow[] | null,
    o: Partial<AudienceSources> = {},
  ) => summarize(sources({
    lane: 'risedtc',
    activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
    recommendations: ok([rec()]), decisions: ok([]),
    ...(links === null ? {} : { links: ok(links) }),
    ...o,
  }))

  it('reads `published` off a resolved post id', () => {
    const s = withLinks([link({
      link_state: 'published',
      draft_id: 'd-1',
      published_post_social_id: 'urn:li:activity:7490000000000000021',
    })])
    expect(s.recommendations[0].link_state).toBe('published')
    expect(s.linkSource).toBe('view')
  })

  it('reads `drafted` when a draft resolved and no post did', () => {
    expect(withLinks([link({ link_state: 'drafted', draft_id: 'd-1' })])
      .recommendations[0].link_state).toBe('drafted')
  })

  it('reads `idea` when only the idea row resolved', () => {
    expect(withLinks([link()]).recommendations[0].link_state).toBe('idea')
  })

  it('reads `recommended` for a ref the idea store cannot place', () => {
    // 08's orphan branch: a decision on record for a ref with no idea row. It
    // reaches a line here only when the local derivation has nothing either —
    // an idea row with no status at all — because precedence never downgrades.
    const s = withLinks(
      [link({ link_state: 'recommended', idea_id: null })],
      { recommendations: ok([rec({ status: null })]) },
    )
    expect(s.recommendations[0].link_state).toBe('recommended')
  })

  it('falls back to the idea store for a recommendation with no view row', () => {
    // CONTRACTS §2.3. And an EMPTY view result is not a load failure: a
    // recommendation can legitimately have no link row yet, so nothing is
    // named in `partial` and nothing is flagged.
    const s = withLinks([], { recommendations: ok([rec({ promoted_draft_id: 'd-9' })]) })
    expect(s.recommendations[0].link_state).toBe('drafted')
    expect(s.linkSource).toBe('view')
    expect(s.partial).toEqual([])
    expect(s.recommendationsBlocked).toBe(false)
  })

  it('never lets a view row downgrade a state the idea store already proved', () => {
    // The view says `idea`; the store holds a draft pointer. Reconciled
    // upwards, because a partial chain reading low is the failure mode 08's
    // own header warns about.
    const s = withLinks(
      [link({ link_state: 'idea' })],
      { recommendations: ok([rec({ promoted_draft_id: 'd-1' })]) },
    )
    expect(s.recommendations[0].link_state).toBe('drafted')
  })

  it('ignores another client’s rows even when they are handed to it', () => {
    // The fetcher scopes by client_id, so a foreign row should never arrive.
    // "Should never arrive" is not a filter: on a LINK view, one client's row
    // under another client's heading is a tenancy leak, not a cosmetic bug.
    const foreign = withLinks([
      link({
        client_id: 'arch',
        link_state: 'published',
        published_post_social_id: 'urn:li:activity:7490000000000000099',
      }),
    ])
    expect(foreign.recommendations[0].link_state).toBe('idea')

    // Same payload with the lane's OWN row present: the foreign row still
    // changes nothing, and the lane's row is honoured.
    const both = withLinks([
      link({
        client_id: 'arch',
        link_state: 'published',
        published_post_social_id: 'urn:li:activity:7490000000000000099',
      }),
      link({ client_id: 'risedtc', link_state: 'drafted', draft_id: 'd-1' }),
    ])
    expect(both.recommendations[0].link_state).toBe('drafted')
  })

  it('names a FAILED link read in partial, and drops back to the derivation', () => {
    // Until migration 08 is applied this is what production answers. It must
    // not take the block to `unavailable` — the people counts do not need it.
    const s = withLinks(null, {
      links: bad('recommendation links: relation "public.audn_recommendation_links_v" does not exist'),
      recommendations: ok([rec({ promoted_draft_id: 'd-1' })]),
    })
    expect(s.state).toBe('normal')
    expect(s.linkSource).toBe('derived')
    expect(s.recommendations[0].link_state).toBe('drafted')
    expect(s.partial.some(p => p.includes('audn_recommendation_links_v'))).toBe(true)
  })

  it('matches on the idea id when the recommendation carries no ref', () => {
    const s = withLinks(
      [link({ recommendation_ref: null, idea_id: 'c1', link_state: 'published', published_post_social_id: 'urn:li:activity:1' })],
      { recommendations: ok([rec({ source_ref: null })]) },
    )
    expect(s.recommendations[0].link_state).toBe('published')
  })

  it('reads the view client-scoped, on BOTH lanes', async () => {
    await fetchRecommendationLinks('arch')
    expect(queries).toHaveLength(1)
    expect(queries[0].table).toBe('audn_recommendation_links_v')
    expect(queries[0].ops).toContainEqual(['eq', 'client_id', 'arch'])

    queries = []
    // Ivan's own store (lm_idea_candidates) has no client_id column, but the
    // VIEW gives that branch the literal 'ivan' — so the same filter applies
    // here, and it is the only thing keeping the lanes apart in one relation.
    await fetchRecommendationLinks('ivan')
    expect(queries[0].table).toBe('audn_recommendation_links_v')
    expect(queries[0].ops).toContainEqual(['eq', 'client_id', 'ivan'])
  })

  it('is read by fetchAudienceSummary — the whole point of Run 04 F-A', async () => {
    result = { data: [], error: null, count: 0 }
    await fetchAudienceSummary('risedtc')
    expect(queries.some(q => q.table === 'audn_recommendation_links_v')).toBe(true)
  })
})

describe('an unread idea bank is not an empty idea bank', () => {
  // Measured live, signed out, 2026-09-09T21:38Z through the app's own client:
  // client_ideas / lm_idea_candidates / client_board_actions /
  // lm_idea_review_decisions all answer `count: 0` with NO error under RLS.
  // Against a store the census says holds 362 rows (risedtc), zero rows is a
  // read that did not happen.
  const withStore = (storeCount: number | null) => summarize(sources({
    lane: 'risedtc',
    activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
    recommendations: ok([]), decisions: ok([]),
    storeCount,
  }))

  it('flags a zero-row read over a non-empty store as unread', () => {
    const s = withStore(0)
    expect(s.recommendationsBlocked).toBe(true)
    expect(s.partial.some(p => p.includes('362 rows on record'))).toBe(true)
  })

  it('says nothing when the store really was read and really is thin', () => {
    // 40 ideas in the bank, none of them audience recommendations yet. That IS
    // "none yet", and it must not be dressed up as a failure.
    expect(withStore(40).recommendationsBlocked).toBe(false)
    // And an uncounted store makes no claim in either direction.
    expect(withStore(null).recommendationsBlocked).toBe(false)
  })

  it('never fires when recommendations actually came back', () => {
    const s = summarize(sources({
      lane: 'risedtc',
      activity: ok([person('a')]), labels: ok([labelled('a', 'positive')]),
      recommendations: ok([rec()]), decisions: ok([]), storeCount: 0,
    }))
    expect(s.recommendationsBlocked).toBe(false)
  })
})

describe('each lane reads its own store', () => {
  it('sends Ivan to lm_idea_candidates by source, and adds no tenancy filter that table does not have', async () => {
    await fetchRecommendations('ivan')
    expect(queries).toHaveLength(1)
    expect(queries[0].table).toBe('lm_idea_candidates')
    expect(queries[0].ops).toContainEqual(['eq', 'source', 'audience_review'])
    // lm_idea_candidates has NO client_id column; filtering on one would 42703
    // the whole block into `unavailable`.
    expect(queries[0].ops.some(o => o[0] === 'eq' && o[1] === 'client_id')).toBe(false)
  })

  it('sends a client lane to client_ideas, scoped by the lane it was PASSED', async () => {
    await fetchRecommendations('arch')
    expect(queries[0].table).toBe('client_ideas')
    expect(queries[0].ops).toContainEqual(['eq', 'client_id', 'arch'])
    expect(queries[0].ops).toContainEqual(['like', 'source_ref', 'audn-rec:%'])
  })

  it('reads Ivan’s decisions out of lm_idea_review_decisions, keyed by candidate id', async () => {
    await fetchDecisions('ivan', [rec({ id: 'cand-1' }), rec({ id: 'cand-2' })])
    expect(queries[0].table).toBe('lm_idea_review_decisions')
    expect(queries[0].ops).toContainEqual(['in', 'candidate_id', ['cand-1', 'cand-2']])
  })

  it('asks for nothing at all when Ivan has no recommendations to join to', async () => {
    const d = await fetchDecisions('ivan', [])
    expect(queries).toHaveLength(0)
    expect(d).toEqual({ ok: true, rows: [] })
  })

  it('reads a client lane’s decisions out of client_board_actions, the three audn actions only', async () => {
    await fetchDecisions('risedtc', [rec()])
    expect(queries[0].table).toBe('client_board_actions')
    expect(queries[0].ops).toContainEqual(['eq', 'client_id', 'risedtc'])
    expect(queries[0].ops).toContainEqual(['in', 'action', ['audn_accept', 'audn_reject', 'audn_defer']])
  })
})

describe('a missing relation reaches the surface as a message, not as an exception', () => {
  it('wraps a PostgREST error into a soft failure that names the source', async () => {
    result = { data: null, error: { message: 'relation "public.audn_person_label_v" does not exist' }, count: null }
    const s = await fetchPersonLabels('risedtc')
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.error).toBe('labels: relation "public.audn_person_label_v" does not exist')
  })

  it('is what the whole block renders today, on every lane', async () => {
    // Until Run 04 applies the migrations, every audn_* select 42P01s. The
    // block has to say that, and it must not turn it into an empty audience.
    result = { data: null, error: { message: 'relation "public.audn_topic_people_v" does not exist' }, count: null }
    const s = await fetchAudienceSummary('risedtc')
    expect(s.state).toBe('unavailable')
    expect(s.message).toContain('does not exist')
  })
})

describe('the dev fixture renders the census, not an invention', () => {
  it('reproduces each lane’s people count from the frozen baseline', () => {
    expect(fixtureSummary('ivan').people.raw).toBe(90)
    expect(fixtureSummary('risedtc').people.raw).toBe(191)
    expect(fixtureSummary('arch').people.raw).toBe(48)
  })

  it('lands on `normal` so the layout under the fixture flag is the real one', () => {
    for (const lane of ['ivan', 'risedtc', 'arch'] as const) {
      expect(fixtureSummary(lane).state).toBe('normal')
    }
  })

  it('shows the whole link ladder, so the preview is the post-08 layout', () => {
    // The dev preview is the only place the `normal` layout can be LOOKED at,
    // and a preview that tops out at "a draft exists" would hide the states
    // Run 04 added. Ivan's lane included: the view covers lm_idea_candidates.
    for (const lane of ['ivan', 'risedtc'] as const) {
      const s = fixtureSummary(lane)
      expect(s.linkSource).toBe('view')
      expect(s.recommendations.map(r => r.link_state)).toEqual(['published', 'drafted', 'idea'].slice(0, s.recommendations.length))
    }
  })

  it('keeps ARCH without matched-age ranks, because ARCH has none', () => {
    expect(fixtureSummary('arch').ranks).toEqual([])
    expect(fixtureSummary('risedtc').ranks.length).toBeGreaterThan(0)
  })
})
