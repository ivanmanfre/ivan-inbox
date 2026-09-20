/* ==========================================================================
   src/lib/contentEvidence.fixtures.ts — synthetic packs, not corpus text.

   Two consumers: `contentEvidence.ts`'s DEV-only `?evidenceFixture=` lever
   (dynamic import, dropped from a production-mode build — see the comment on
   `fixtureParam`), and `contentEvidence.test.ts`, which imports this module
   directly to unit-test the pure `build*` functions without a network.

   Every string here is invented for the shape it exercises. No post body,
   author name or reactor label in this file is a real observation — the
   project rule is explicit: "Private corpus text (post bodies, reactor
   data) never enters the repo: tests use small synthetic fixtures."
   ========================================================================== */
import type { ContentLane } from './content'
import type {
  ContentEvidenceCandidate, ContentEvidenceChoice, ContentEvidenceMarketWinner,
  ContentEvidenceOwnResult, ContentEvidencePack,
} from './contentEvidence'

export type FixtureScenario = 'ready' | 'partial' | 'empty' | 'stale'

const LANE_FLAVOR: Record<ContentLane, { authors: number; posts: number }> = {
  ivan: { authors: 29, posts: 2163 },
  risedtc: { authors: 46, posts: 4273 },
  arch: { authors: 1, posts: 439 },
}

function candidate(i: number, over: Partial<ContentEvidenceCandidate> = {}): ContentEvidenceCandidate {
  return {
    id: `fixture-candidate-${i}`,
    topic: `Synthetic topic ${i}, a compact worked example`,
    evidence_sentence: `${1000 + i * 40} weighted reactions against a usual ${90 + i * 5} across ${25 + i} posts`,
    source_url: `https://example.com/fixture-source-${i}`,
    source_label: `Fixture author ${i}, 1 Sep 2026`,
    client_material: i % 3 === 0 ? null : `A real fact the client can honestly say for topic ${i}.`,
    needs_material: i % 3 === 0,
    objective: (['attention', 'buyer_response', 'conversion'] as const)[i % 3],
    is_experiment: i === 2,
    experiment_reason: i === 2 ? 'No qualifying source example exists yet for this angle.' : null,
    test_metric: i === 2 ? 'Reply rate on the close question' : null,
    detail: {
      calculation: `likes + 3 x reposts, observed ${1000 + i * 40} vs baseline ${90 + i * 5} (n=${25 + i})`,
      formula: 'likes + 3 x reposts',
      method_version: 'content-evidence-methods-v2',
      published_at: '2026-08-01',
      captured_at: '2026-08-09',
      limitations: ['retrospective', 'unmatched capture age', 'likes+3*reposts proxy'],
      full_source_text: null,
    },
    ...over,
  }
}

function marketWinner(i: number, over: Partial<ContentEvidenceMarketWinner> = {}): ContentEvidenceMarketWinner {
  return {
    finding_id: `fixture-market-${i}`,
    author: `Fixture author ${i}`,
    author_url: `https://example.com/authors/${i}`,
    first_line: `Synthetic opening line for fixture post ${i}.`,
    source_url: `https://example.com/fixture-post-${i}`,
    published_at: '2026-06-01',
    observed_value: 1000 + i * 120,
    baseline_value: 80 + i * 4,
    baseline_n: 25,
    lift: Number((6 + i).toFixed(1)),
    method_version: 'content-evidence-methods-v2',
    legacy: false,
    limitation: 'Retrospective, capture age unmatched.',
    ...over,
  }
}

function ownResult(i: number, over: Partial<ContentEvidenceOwnResult> = {}): ContentEvidenceOwnResult {
  return {
    post_id: `fixture-own-${i}`,
    published_at: '2026-08-15',
    objective: 'attention',
    metric_label: 'reach',
    observed_value: 3200 + i * 90,
    comparison_label: 'Above the account 7-day median.',
    sample_note: 'n=8 own posts in window',
    limitation: 'Historical capture, not a 7-/14-day comparable window.',
    ...over,
  }
}

function choice(i: number, over: Partial<ContentEvidenceChoice> = {}): ContentEvidenceChoice {
  return {
    id: `fixture-choice-${i}`,
    topic: `Synthetic published choice ${i}`,
    status: 'evaluated',
    published_at: '2026-08-20',
    evaluation_age_days: 14,
    objective: 'attention',
    outcome: { metric_label: 'reach', observed_value: 2900, comparison_label: 'Above the account median.' },
    incomplete_measurement: false,
    source_finding_id: `fixture-market-${i}`,
    denominator_note: 'n=8 own posts in the comparison window',
    ...over,
  }
}

export function fixturePack(lane: ContentLane, scenario: FixtureScenario): ContentEvidencePack {
  const flavor = LANE_FLAVOR[lane]

  if (scenario === 'empty') {
    return {
      schema_version: 1,
      client_id: lane,
      week_start: '2026-09-28',
      freshness: { as_of: null, stale_after_days: 14, is_stale: false },
      this_week: {
        coverage_line: `No verified market study for ${lane} yet.`,
        candidates: [],
        missing_inputs: ['no validated market study for this client'],
      },
      winners: { market: [], own: [] },
      inputs: {
        study_state: 'missing',
        stored_posts: null,
        eligible_posts: null,
        eligible_authors: null,
        publication_window: null,
        last_successful_collection: null,
        connected_consumers: [],
        sufficient_for_this_question: false,
        sufficiency_reason: 'No study has been imported for this client yet.',
        gaps: ['No study has been imported for this client yet.'],
      },
      results: { choices: [], prior_failures: [] },
    }
  }

  const partial = scenario === 'partial'
  const isStale = scenario === 'stale'
  const asOf = isStale ? '2026-07-01T00:00:00Z' : '2026-09-19T08:00:00Z'

  const candidates = partial
    ? [candidate(0), candidate(2, { needs_material: true, client_material: null })]
    : [candidate(0), candidate(1), candidate(2)]

  // Deliberately carries a low-sample AND a legacy row so the same fixture
  // exercises both retained warnings without a sixth scenario.
  const market = partial
    ? [marketWinner(0, { baseline_n: 16, legacy: true })]
    : [marketWinner(0), marketWinner(1, { legacy: true }), marketWinner(2, { baseline_n: 18 })]
  const own = partial ? [] : [ownResult(0), ownResult(1)]

  const choices = partial
    ? [
        choice(0, { status: 'awaiting_publication', outcome: null, incomplete_measurement: true, evaluation_age_days: null }),
        choice(1, { status: 'measuring', outcome: null, incomplete_measurement: true }),
      ]
    : [
        choice(0),
        choice(1, { status: 'passed', outcome: null, incomplete_measurement: false }),
        choice(2, { status: 'awaiting_publication', outcome: null, incomplete_measurement: false, evaluation_age_days: null }),
      ]

  const priorFailures = partial
    ? [{ id: 'fixture-fail-1', topic: 'A synthetic test that did not repeat', reason: 'Reach stayed at the account median, no lift observed.' }]
    : []

  return {
    schema_version: 1,
    client_id: lane,
    week_start: '2026-09-28',
    freshness: { as_of: asOf, stale_after_days: 14, is_stale: isStale },
    this_week: {
      coverage_line: `${flavor.authors} ranked authors, ${flavor.posts} eligible posts for ${lane}.`,
      candidates,
      missing_inputs: partial ? ['Author baselines have not been reviewed for one candidate.'] : [],
    },
    winners: { market, own },
    inputs: {
      study_state: partial ? 'needs_reconciliation' : 'validated',
      stored_posts: flavor.posts,
      eligible_posts: partial ? null : flavor.posts,
      eligible_authors: flavor.authors,
      publication_window: { from: '2025-09-20', to: '2026-09-19' },
      last_successful_collection: '2026-09-19T04:00:00Z',
      connected_consumers: ['Weekly Topics Writer', 'Strategy > Markets'],
      sufficient_for_this_question: !partial,
      sufficiency_reason: partial ? 'Two stored discrepancies are unresolved.' : null,
      gaps: partial ? ['Two stored discrepancies are unresolved.'] : [],
    },
    results: { choices, prior_failures: priorFailures },
  }
}
