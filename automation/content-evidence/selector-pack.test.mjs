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
// 5. failed prior adaptation omitted (synthetic Toby Waller shape)
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
