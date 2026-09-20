// Selector-pack tests. Synthetic fixtures only -- no private post bodies, no reactor
// identities, no real profile URLs. See verification/SELECTOR-CONTRACT.md for the pinned shape
// this module implements to, and DECISIONS.md D3/D4/D6 for the eligibility and permission
// rules being tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildEvidencePack, commitGuard } from './selector-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (name) => JSON.parse(readFileSync(path.join(HERE, 'fixtures', name), 'utf8'));

// A market finding that clears the production floor by a wide margin -- baseline_n>=20,
// lift>=4, likes>=40 -- used as a plain "this one should qualify" building block.
function qualifyingMarketFinding(overrides = {}) {
  return {
    client_id: 'ivan',
    finding_id: 'f-qualify',
    kind: 'market',
    source_ids: ['post-qualify'],
    observed_value: 400,
    baseline_value: 50,
    baseline_n: 30,
    likes: 90,
    metric_id: 'likes_plus_reposts',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Verbatim plan fixture (Package 4, lines 260-270)
// ---------------------------------------------------------------------------
test('a below-baseline citation cannot become a measured-winner recommendation (verbatim plan fixture)', () => {
  const f = readFixture('selector-verbatim-fixture.json');
  const pack = buildEvidencePack({
    clientId: f.clientId, weekStart: f.weekStart, studies: f.studies, ownResults: f.ownResults,
    clientFacts: f.clientFacts, previousTests: f.previousTests, limit: f.limit, findings: f.findings,
  });
  assert.equal(pack.candidates.length, 0);
  assert(pack.missingInputs.some((x) => x.code === 'no_qualified_sources'));
});

// ---------------------------------------------------------------------------
// 1. below-baseline source presented as winner
// ---------------------------------------------------------------------------
test('a below-baseline market finding is rejected, never presented as a winner', () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-below', observed_value: 60, baseline_value: 55, baseline_n: 25, likes: 90 })],
  });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected.length, 1);
  assert.equal(pack.rejected[0].code, 'below_baseline');
  assert.equal(pack.rejected[0].finding_id, 'f-below');
});

// ---------------------------------------------------------------------------
// 2. missing/invalid Outliers (study) connection
// ---------------------------------------------------------------------------
test('a finding with no source_ids cannot connect to its outlier study, even with strong numbers', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-no-source' });
  delete finding.source_ids;
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'missing_outliers_connection');
});

test('an unrecognized finding kind cannot connect to its outlier study', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-bad-kind', kind: 'mystery_kind' });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'missing_outliers_connection');
});

// ---------------------------------------------------------------------------
// 3. generic own-post follow-up lacking performance
// ---------------------------------------------------------------------------
test('a generic own-post follow-up with no measured result is not evidence-backed', () => {
  const followUp = {
    client_id: 'ivan', finding_id: 'f-generic-follow-up', kind: 'own_result', source_ids: ['own-post-1'],
  };
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, ownResults: [followUp] });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'no_performance_support');
});

test('a generic own-post follow-up CAN enter the experiment slot when explicitly labeled', () => {
  const followUp = {
    client_id: 'ivan', finding_id: 'f-generic-experiment', kind: 'own_result', source_ids: ['own-post-2'],
    experiment_reason: 'No measured result yet; testing whether this angle resonates at all.',
  };
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, ownResults: [followUp] });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.candidates[0].label, 'experiment');
  assert.equal(pack.candidates[0].experiment_reason, followUp.experiment_reason);
});

// ---------------------------------------------------------------------------
// 4. richer own outcomes omitted (defect: a thinner own result must never beat a richer one)
// ---------------------------------------------------------------------------
test('a richer own outcome is kept over a thinner one when the cap forces a choice', () => {
  const thin = qualifyingMarketFinding({
    finding_id: 'f-thin-own', kind: 'own_result', source_ids: ['own-thin'],
    observed_value: 200, baseline_value: 50, baseline_n: 20, likes: undefined,
  });
  delete thin.likes;
  const rich = qualifyingMarketFinding({
    finding_id: 'f-rich-own', kind: 'own_result', source_ids: ['own-rich'],
    observed_value: 800, baseline_value: 100, baseline_n: 40, likes: 150,
  });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 1, ownResults: [thin, rich] });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.candidates[0].source_finding_ids[0], 'f-rich-own');
  assert.equal(pack.rejected.some((r) => r.finding_id === 'f-thin-own' && r.code === 'candidate_cap_exceeded'), true);
});

// ---------------------------------------------------------------------------
// 5. failed prior adaptation omitted (synthetic prior-adaptation shape, fictional author)
// ---------------------------------------------------------------------------
test('a failed prior adaptation of the same source is carried in adaptation_history, never omitted', () => {
  const f = readFixture('selector-toby-adaptation.json');
  const pack = buildEvidencePack({
    clientId: f.clientId, weekStart: f.weekStart, studies: f.studies, ownResults: f.ownResults,
    clientFacts: f.clientFacts, previousTests: f.previousTests, limit: f.limit, findings: f.findings,
  });
  assert.equal(pack.candidates.length, 1);
  const [candidate] = pack.candidates;
  assert.equal(candidate.adaptation_history.length, 1);
  assert.equal(candidate.adaptation_history[0].status, 'failed');
  assert.equal(candidate.adaptation_history[0].recommendation_id, 'rec-synthetic-toby-1');
});

// ---------------------------------------------------------------------------
// 6. client-fact permission denial
// ---------------------------------------------------------------------------
test('a permission-denied client fact blocks its candidate even when the numbers clear the floor', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-denied-fact', client_fact_ids: ['fact-denied'] });
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding],
    clientFacts: [{ source_id: 'fact-denied', permission: 'denied' }],
  });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'client_fact_permission_denied');
});

// ---------------------------------------------------------------------------
// 7. audience sample mislabeled as total reach
// ---------------------------------------------------------------------------
test('a bare audience sample_size with no disclosure fields is never treated as total reach', () => {
  const finding = {
    client_id: 'ivan', finding_id: 'f-audience-bare', kind: 'audience', source_ids: ['aud-1'],
    sample_size: 5000,
  };
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'audience_sample_mislabeled');
});

test('a fully disclosed audience sample is still not a primary evidence-backed source', () => {
  const finding = {
    client_id: 'ivan', finding_id: 'f-audience-full', kind: 'audience', source_ids: ['aud-2'],
    sample_size: 5000, sample_method: 'profile_action_classifier', unknown_count: 300, classifier_version: 'v2',
  };
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'no_performance_support');
});

// ---------------------------------------------------------------------------
// 8. insufficient data returns []
// ---------------------------------------------------------------------------
test('insufficient data (baseline_n < 3) returns an empty candidate list, not a padded one', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-thin', baseline_n: 2 });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.deepEqual(pack.candidates, []);
  assert.equal(pack.rejected[0].code, 'insufficient_data');
  assert(pack.missingInputs.some((x) => x.code === 'no_qualified_sources'));
});

// ---------------------------------------------------------------------------
// 9. valid source with no client facts -> needs_material
// ---------------------------------------------------------------------------
test('a valid market source with no resolvable client facts is returned flagged needs_material, never padded', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-no-facts' });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding], clientFacts: [] });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.candidates[0].label, 'evidence_backed');
  assert.equal(typeof pack.candidates[0].needs_material, 'string');
  assert(pack.candidates[0].needs_material.length > 0);
  assert.deepEqual(pack.candidates[0].client_fact_refs, []);
});

// ---------------------------------------------------------------------------
// 10. a useful personal story from the client's own supported history
// ---------------------------------------------------------------------------
test("a supported own-history finding is a legitimate evidence-backed candidate needing no external client fact", () => {
  const finding = qualifyingMarketFinding({
    finding_id: 'f-own-story', kind: 'own_result', source_ids: ['own-story-1'],
    observed_value: 900, baseline_value: 60, baseline_n: 25, likes: 200,
  });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, ownResults: [finding], clientFacts: [] });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.candidates[0].label, 'evidence_backed');
  assert.equal(pack.candidates[0].needs_material, null);
});

// ---------------------------------------------------------------------------
// 11. ONE legitimate experiment
// ---------------------------------------------------------------------------
test('exactly one explicitly labeled experiment can join a shortlist of measured winners', () => {
  const winner = qualifyingMarketFinding({ finding_id: 'f-winner' });
  const experiment = {
    client_id: 'ivan', finding_id: 'f-experiment', kind: 'market', source_ids: ['post-experiment'],
    observed_value: 10, baseline_value: 50, baseline_n: 25,
    experiment_reason: 'Untested format for this client; no market winner covers it yet.',
  };
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [winner, experiment] });
  assert.equal(pack.candidates.length, 2);
  const labels = pack.candidates.map((c) => c.label).sort();
  assert.deepEqual(labels, ['evidence_backed', 'experiment']);
});

// ---------------------------------------------------------------------------
// 12. more than 3 candidates
// ---------------------------------------------------------------------------
test('more than three qualifying candidates are capped at the registry limit, ranked by lift', () => {
  const findings = [10, 30, 5, 20, 8].map((lift, i) => qualifyingMarketFinding({
    finding_id: `f-cap-${i}`, source_ids: [`post-cap-${i}`], observed_value: 50 * lift, baseline_value: 50, baseline_n: 25, likes: 90,
  }));
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings });
  assert.equal(pack.candidates.length, 3);
  const kept = pack.candidates.map((c) => c.source_finding_ids[0]);
  assert.deepEqual(kept, ['f-cap-1', 'f-cap-3', 'f-cap-0']); // lift 30, 20, 10 in that order
  const overflow = pack.rejected.filter((r) => r.code === 'candidate_cap_exceeded');
  assert.equal(overflow.length, 2);
});

// ---------------------------------------------------------------------------
// 13. two experiments
// ---------------------------------------------------------------------------
test('a second experiment-eligible finding is rejected once one experiment slot is filled', () => {
  const experimentA = {
    client_id: 'ivan', finding_id: 'f-exp-a', kind: 'market', source_ids: ['post-exp-a'],
    observed_value: 10, baseline_value: 50, baseline_n: 25, experiment_reason: 'First untested angle.',
  };
  const experimentB = {
    client_id: 'ivan', finding_id: 'f-exp-b', kind: 'market', source_ids: ['post-exp-b'],
    observed_value: 10, baseline_value: 50, baseline_n: 25, experiment_reason: 'Second untested angle.',
  };
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [experimentB, experimentA] });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.candidates[0].label, 'experiment');
  assert.equal(pack.candidates[0].source_finding_ids[0], 'f-exp-a'); // deterministic tie-break by finding_id
  assert.equal(pack.rejected.some((r) => r.finding_id === 'f-exp-b' && r.code === 'experiment_cap_exceeded'), true);
});

// ---------------------------------------------------------------------------
// Determinism and history preservation (pinned additions in SELECTOR-CONTRACT.md)
// ---------------------------------------------------------------------------
test('buildEvidencePack never mutates previousTests and coverage.history_count matches its length', () => {
  const previousTests = [
    { recommendation_id: 'r1', source_id: 'p1', status: 'accepted' },
    { recommendation_id: 'r2', source_id: 'p2', status: 'rejected' },
  ];
  const snapshot = JSON.stringify(previousTests);
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding()], previousTests,
  });
  assert.equal(pack.coverage.history_count, 2);
  assert.equal(JSON.stringify(previousTests), snapshot);
  assert.equal(previousTests.length, 2);
});

test('two calls with identical inputs produce identical output (deterministic, stable sort)', () => {
  const findings = [
    qualifyingMarketFinding({ finding_id: 'f-a', observed_value: 300 }),
    qualifyingMarketFinding({ finding_id: 'f-b', source_ids: ['post-b'], observed_value: 300 }),
  ];
  const a = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings });
  const b = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// commitGuard
// ---------------------------------------------------------------------------
test('commitGuard refuses by default (rollout omitted or false), regardless of pack contents', () => {
  const pack = { clientId: 'ivan', weekStart: '2026-09-28', candidates: [{ label: 'evidence_backed' }] };
  const a = commitGuard({ pack });
  assert.equal(a.allowed, false);
  assert.match(a.reason, /preview|rollout/i);
  const b = commitGuard({ pack, rolloutEnabled: false });
  assert.equal(b.allowed, false);
  assert.match(b.reason, /preview|rollout/i);
});

test('commitGuard refuses a duplicate commit for the same client and week even when rollout is enabled', () => {
  const pack = { clientId: 'risedtc', weekStart: '2026-09-28' };
  const result = commitGuard({
    pack, rolloutEnabled: true,
    existingCommits: [{ client_id: 'risedtc', week_start: '2026-09-28' }],
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /duplicate/i);
});

test('commitGuard allows a rollout-enabled client with no prior commit for the week', () => {
  const pack = { clientId: 'arch', weekStart: '2026-09-28' };
  const result = commitGuard({ pack, rolloutEnabled: true, existingCommits: [{ client_id: 'arch', week_start: '2026-09-21' }] });
  assert.equal(result.allowed, true);
  assert(result.reason.length > 0);
});

// ---------------------------------------------------------------------------
// Fix pass (Sol review, PHASE-1-REVIEW.md must-fix 1-6; D10)
// ---------------------------------------------------------------------------

// Must-fix 1: adaptation_history must also match previousTests[].source_finding_ids, the exact
// key the committed row persists (writer.js context.evidence_package.source_finding_ids).
test('adaptation_history matches a previousTests entry keyed by source_finding_ids, not just source_id', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-history-key' });
  const previousTests = [{ recommendation_id: 'rec-1', status: 'failed', source_finding_ids: ['f-history-key'] }];
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding], previousTests });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.candidates[0].adaptation_history.length, 1);
  assert.equal(pack.candidates[0].adaptation_history[0].recommendation_id, 'rec-1');
});

// Must-fix 3: a denied client fact must be visible in rejected[] even when it is keyed fact_id
// (not source_id) and referenced by nobody -- D4 says denied stays denied and visible.
test('a denied client fact keyed fact_id and referenced by no candidate still appears in rejected', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-unreferenced' });
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding],
    clientFacts: [{ fact_id: 'fact-unreferenced', permission: 'denied' }],
  });
  assert.equal(pack.candidates.length, 1); // unreferenced denial never blocks an unrelated candidate
  assert(pack.rejected.some((r) => r.code === 'client_fact_permission_denied' && r.source_id === 'fact-unreferenced'));
});

// Must-fix 4: an eligibility-flagged (not hand-authored) finding can still fill the experiment
// slot, with a synthesized non-empty experiment_reason.
test('experiment_eligible:true alone (no hand-written experiment_reason) fills the experiment slot', () => {
  const finding = qualifyingMarketFinding({
    finding_id: 'f-flagged-experiment', observed_value: 10, baseline_value: 50, baseline_n: 25, experiment_eligible: true,
  });
  delete finding.likes;
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.candidates[0].label, 'experiment');
  assert.equal(typeof pack.candidates[0].experiment_reason, 'string');
  assert(pack.candidates[0].experiment_reason.length > 0);
});

// Must-fix 5: a finding with neither a valid source_ids connection NOR a measured result must
// report no_performance_support, not missing_outliers_connection -- performance is the more
// specific and more informative gap when both are absent.
test('a finding missing both source_ids and a measured result reports no_performance_support', () => {
  const finding = { client_id: 'ivan', finding_id: 'f-both-missing', kind: 'own_result' };
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, ownResults: [finding] });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'no_performance_support');
});

// Must-fix 6: a finding stamped with another client's client_id must never become this client's
// candidate (the 09-12 shared-table leak shape).
test('a finding belonging to another client is rejected, never adapted for this client', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-foreign', client_id: 'risedtc' });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'foreign_client_finding');
});

// D10(a): at most 2 candidates per source author in the pool when an author id/name is
// available on the finding.
test('D10: at most two candidates per author are kept in the pool; the rest are author-capped', () => {
  const findings = ['a1', 'a2', 'a3'].map((id, i) => qualifyingMarketFinding({
    finding_id: `f-author-${id}`, source_ids: [`post-${id}`], author: 'Zain Kahn',
    observed_value: 500 - i * 10, baseline_value: 50, baseline_n: 25, likes: 90,
  }));
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 12, findings });
  assert.equal(pack.candidates.length, 2);
  assert.equal(pack.rejected.some((r) => r.code === 'author_pool_cap_exceeded' && r.finding_id === 'f-author-a3'), true);
  assert.equal(pack.coverage.author_pool_cap.limit, 2);
  assert.equal(pack.coverage.author_pool_cap.omitted, 1);
});

test('D10: an author id/name on finding.source_post also triggers the per-author pool cap', () => {
  const findings = ['b1', 'b2', 'b3'].map((id, i) => qualifyingMarketFinding({
    finding_id: `f-sp-author-${id}`, source_ids: [`post-${id}`], source_post: { author_id: 'author-9' },
    observed_value: 500 - i * 10, baseline_value: 50, baseline_n: 25, likes: 90,
  }));
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 12, findings });
  assert.equal(pack.candidates.length, 2);
});

// D10(b): a finding whose baseline_value is below 8 sorts after all findings at or above 8, and
// carries the small-baseline limitation.
test('D10: a below-8 baseline sorts after all at-or-above-8 findings and is limitation-flagged', () => {
  const tiny = qualifyingMarketFinding({
    finding_id: 'f-tiny-baseline', source_ids: ['post-tiny'], observed_value: 400, baseline_value: 1, baseline_n: 25, likes: 90,
  }); // lift 400 -- would rank first on lift alone
  const normal = qualifyingMarketFinding({
    finding_id: 'f-normal-baseline', source_ids: ['post-normal'], observed_value: 200, baseline_value: 20, baseline_n: 25, likes: 90,
  }); // lift 10 -- lower lift, but baseline_value >= 8
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 12, findings: [tiny, normal] });
  assert.equal(pack.candidates.length, 2);
  assert.equal(pack.candidates[0].source_finding_ids[0], 'f-normal-baseline');
  assert.equal(pack.candidates[1].source_finding_ids[0], 'f-tiny-baseline');
  assert(pack.candidates[1].limitations.includes('Very small author baseline; the ratio overstates the gap.'));
  assert.equal(pack.coverage.small_author_baseline.threshold, 8);
  assert.equal(pack.coverage.small_author_baseline.count, 1);
});

// F6 (PRELEASE-AUDIT.md): test_metric must be a declared test in plain words derived from the
// objective, not a policy/metric id; metric_id is kept separately for provenance.
test('F6: test_metric is a plain-words declared test, metric_id is kept separately for provenance', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-metric', metric_id: 'new-policy-v1' });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  const c = pack.candidates[0];
  assert.equal(c.metric_id, 'new-policy-v1');
  assert.notEqual(c.test_metric, 'new-policy-v1');
  assert.match(c.test_metric, /reactions|reposts|likes/i);
  assert.match(c.test_metric, /\bdays\b/);
});

test('F6: an unknown objective still gets a plain-words declared test, never a raw id', () => {
  const finding = qualifyingMarketFinding({ finding_id: 'f-metric-2', objective: 'buyer_response', metric_id: 'x' });
  const pack = buildEvidencePack({ clientId: 'ivan', weekStart: '2026-09-28', limit: 3, findings: [finding] });
  assert.notEqual(pack.candidates[0].test_metric, 'x');
  assert(pack.candidates[0].test_metric.length > 10);
});

// ---------------------------------------------------------------------------
// D11: a source with no identifiable body to adapt is refused by name, and the refusal is
// counted. Fixtures are synthetic; the shapes mirror the live rows the guard was calibrated
// against (see the comment block above SOURCE_BODY_FLOOR in selector-pack.mjs).
// ---------------------------------------------------------------------------
const post = (id, text, extra = {}) => ({ canonical_source_id: id, post_text: text, ...extra });
const LONG_GENERIC = 'Consistency is the whole game on this platform. '.repeat(20);
// 282 characters of real argument, the length of the shortest source an independent reviewer
// accepted (ivan finding f3024b73).
const SHORT_SUBSTANTIVE = 'Writers overcorrect to prove a human wrote it. They chop every sentence in half, '
  + 'drop capital letters and avoid punctuation they think a machine would use. The reader notices '
  + 'the flinching before they notice the writing. Fix the tells that actually repeat instead.';

test('D11: a 37-character source is refused source_no_adaptable_body and the refusal is counted', () => {
  const pack = buildEvidencePack({
    clientId: 'risedtc', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ client_id: 'risedtc', finding_id: 'f-bare', source_ids: ['p-bare'] })],
    sourcePosts: [post('p-bare', '"The price for one TikTok is $45,000"')],
  });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'source_no_adaptable_body');
  assert.match(pack.rejected[0].reason, /nothing in it to adapt/);
  assert.equal(pack.coverage.adaptable_source.applied, true);
  assert.equal(pack.coverage.adaptable_source.refused, 1);
  assert.equal(pack.coverage.adaptable_source.refused_by_code.source_no_adaptable_body, 1);
});

test('D11: a short but substantive source is kept -- the floor is an availability guard, not a length preference', () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-short-good', source_ids: ['p-short-good'] })],
    sourcePosts: [post('p-short-good', SHORT_SUBSTANTIVE)],
  });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.coverage.adaptable_source.refused, 0);
  assert(SHORT_SUBSTANTIVE.length < 300);
});

test('D11: a long generic source is NOT refused -- this guard never decides relevance', () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-long-generic', source_ids: ['p-long-generic'] })],
    sourcePosts: [post('p-long-generic', LONG_GENERIC)],
  });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.coverage.adaptable_source.refused, 0);
});

test('D11: truncated source text is kept and carries its own limitation, never silently repaired', () => {
  const truncated = 'a'.repeat(3000);
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-trunc', source_ids: ['p-trunc'] })],
    sourcePosts: [post('p-trunc', truncated)],
  });
  assert.equal(pack.candidates.length, 1);
  assert(pack.candidates[0].limitations.some((l) => /cut off at the capture limit/.test(l)));
});

test('D11: a caption on a carousel or video is refused source_caption_only, with no invented slides', () => {
  const pack = buildEvidencePack({
    clientId: 'risedtc', weekStart: '2026-09-28', limit: 3,
    findings: [
      qualifyingMarketFinding({ client_id: 'risedtc', finding_id: 'f-carousel', source_ids: ['p-carousel'] }),
      qualifyingMarketFinding({ client_id: 'risedtc', finding_id: 'f-video', source_ids: ['p-video'] }),
    ],
    sourcePosts: [
      post('p-carousel', 'pov: you posted a personal instagram story to the brand account', { format_evidence: { post_type: 'carousel' } }),
      post('p-video', 'Who can relate?', { format_evidence: { post_type: 'video' } }),
    ],
  });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.coverage.adaptable_source.refused_by_code.source_caption_only, 2);
  assert(pack.rejected.every((r) => !/slide|shot|frame/i.test(r.reason)));
});

test('D11: a link-only promotion normalises below the floor once the link and pictograph are removed', () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-link', source_ids: ['p-link'] })],
    sourcePosts: [post('p-link', 'Grab my new reach guide (free) \u{1F449} https://lnkd.in/dqccAVpw #reach @someone')],
  });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'source_no_adaptable_body');
});

test('D11: a finding whose source post did not resolve is refused source_text_unavailable', () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-missing', source_ids: ['p-absent'] })],
    sourcePosts: [],
  });
  assert.equal(pack.candidates.length, 0);
  assert.equal(pack.rejected[0].code, 'source_text_unavailable');
  assert.equal(pack.coverage.adaptable_source.refused_by_code.source_text_unavailable, 1);
});

test('D11: a caller that supplies no source posts leaves the guard inactive and says so', () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-nosrc', source_ids: ['p-any'] })],
  });
  assert.equal(pack.candidates.length, 1);
  assert.equal(pack.coverage.adaptable_source.applied, false);
});

// ---------------------------------------------------------------------------
// D15: mechanism class comes from the support actually held, computed here, never from the model
// ---------------------------------------------------------------------------
test('D15: a market source-only adaptation is classed experiment and carries its competing explanations', () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ finding_id: 'f-mech' })],
  });
  const c = pack.candidates[0];
  assert.equal(c.mechanism_class, 'experiment');
  assert.equal(c.mechanism_support, 'source_only');
  assert.equal(c.label, 'evidence_backed'); // the measured FLOOR was cleared; the mechanism is still untested
  assert.match(c.mechanism_reason, /test/i);
  assert(c.limitations.some((l) => /giveaway|distribution/i.test(l)));
  assert.equal(pack.coverage.mechanism_class.experiment, 1);
});

test("D15: the client's own measured result is classed supported", () => {
  const pack = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    ownResults: [qualifyingMarketFinding({ finding_id: 'f-own', kind: 'own_result' })],
  });
  const c = pack.candidates[0];
  assert.equal(c.mechanism_class, 'supported');
  assert.equal(c.mechanism_support, 'client_own_result');
  assert.equal(c.mechanism_reason, null);
  assert(!c.limitations.some((l) => /giveaway|distribution/i.test(l)));
});

test('D15: a pattern comparison is supported only when it was predeclared AND passed', () => {
  const base = { finding_id: 'f-pattern', kind: 'pattern' };
  const passed = buildEvidencePack({
    clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
    findings: [qualifyingMarketFinding({ ...base, predeclared: true, validation_state: 'passed' })],
  });
  assert.equal(passed.candidates[0].mechanism_class, 'supported');
  assert.equal(passed.candidates[0].mechanism_support, 'pattern_comparison');

  for (const drift of [{ predeclared: false, validation_state: 'passed' }, { predeclared: true, validation_state: 'computed' }]) {
    const pack = buildEvidencePack({
      clientId: 'ivan', weekStart: '2026-09-28', limit: 3,
      findings: [qualifyingMarketFinding({ ...base, ...drift })],
    });
    assert.equal(pack.candidates[0].mechanism_class, 'experiment', JSON.stringify(drift));
  }
});
