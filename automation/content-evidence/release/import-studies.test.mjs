// Tests for release/import-studies.mjs. Every fixture is synthetic: three invented posts and one
// invented finding, no corpus text and no real URL.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapManifestState,
  buildStudyImport,
  compareToSummary,
  renderImportSql,
  lit, jsonLit, numLit,
  StudyImportError,
  SOURCE_STATE,
} from './import-studies.mjs';

const A_SHA = 'a'.repeat(64);
const B_SHA = 'b'.repeat(64);
const C_SHA = 'c'.repeat(64);

function fixtureStudy(over = {}) {
  return {
    schema_version: 2,
    client_id: 'testclient',
    study_id: 'study-1',
    state: SOURCE_STATE,
    cutoff: '2026-09-20T00:00:00Z',
    policy: { id: 'new-policy-v1', windowDays: 365, minimumN: 20, repostWeight: 3, minimumLift: 4, minimumLikes: 40 },
    method_version: 'content-evidence-methods-v2',
    method_sha256: C_SHA,
    source: { path: 'work/testclient-posts.json', sha256: B_SHA },
    summary: { stored_posts: 3, own_control_posts_excluded: 1, eligible_posts: 2, findings: 1 },
    own_control_exclusions: [{ post_id: 'p3', author_id: 'own-seat', reason: 'own_client_control_author' }],
    findings: [{
      client_id: 'testclient', study_id: 'study-1', finding_id: 'f1', kind: 'market',
      source_ids: ['p1'], metric_id: 'new-policy-v1',
      observed_value: 400, baseline_value: 50, baseline_raw_value: 50, baseline_floor: null,
      baseline_n: 24, lift: 8, formula: 'likes + 3 * reposts',
      method_version: 'content-evidence-methods-v2',
      source_dates: { published_at: '2026-06-01T00:00:00Z' },
      capture_dates: { captured_at: '2026-06-04T00:00:00Z' },
      age_comparability: 'unknown', limitations: ['descriptive, not causal'],
      validation_state: 'computed',
    }],
    excluded: [],
    baselineCoverage: [
      { author_id: 'a1', n: 24, ranked: true },
      { author_id: 'a2', n: 4, ranked: false },
    ],
    limitations: ['Retrospective descriptive attention only; no performance prediction.'],
    ...over,
  };
}

function fixturePosts() {
  return [
    { client_id: 'testclient', post_id: 'p1', author_id: 'a1', published_at: '2026-06-01T00:00:00Z', captured_at: '2026-06-04T00:00:00Z', likes: 400, reposts: 0, comments: 3, _raw: { url: 'https://example.org/p1', text: 'body one', post_type: 'text' } },
    { client_id: 'testclient', post_id: 'p2', author_id: 'a2', published_at: '2026-05-01T00:00:00Z', captured_at: '2026-05-03T00:00:00Z', likes: 4, reposts: 0, comments: 0, _raw: { url: 'https://example.org/p2', text: 'body two', post_type: 'text' } },
    { client_id: 'testclient', post_id: 'p3', author_id: 'own-seat', published_at: '2026-04-01T00:00:00Z', captured_at: '2026-04-03T00:00:00Z', likes: 9, reposts: 1, comments: 1, _raw: { url: 'https://example.org/p3', text: 'our own post', post_type: 'text' } },
  ];
}

const verified = { sourceHashVerified: true, methodHashVerified: true, studySha256: A_SHA, sourceSha256: B_SHA, methodSha256: C_SHA };

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

test('descriptive_only with both hashes verified maps to validated', () => {
  const r = mapManifestState({ sourceState: SOURCE_STATE, sourceHashVerified: true, methodHashVerified: true });
  assert.equal(r.state, 'validated');
  assert.match(r.reason, /hash as declared/);
});

test('an unverified source hash never reaches validated', () => {
  assert.equal(mapManifestState({ sourceState: SOURCE_STATE, sourceHashVerified: false, methodHashVerified: true }).state, 'imported');
});

test('an unverified method hash never reaches validated', () => {
  assert.equal(mapManifestState({ sourceState: SOURCE_STATE, sourceHashVerified: true, methodHashVerified: false }).state, 'imported');
});

test('an unresolved discrepancy wins over both hashes', () => {
  const r = mapManifestState({
    sourceState: SOURCE_STATE, sourceHashVerified: true, methodHashVerified: true,
    unresolvedDiscrepancies: [{ metric_id: 'public_weighted' }],
  });
  assert.equal(r.state, 'needs_reconciliation');
});

test('an unknown source state is never upgraded on a guess', () => {
  assert.equal(mapManifestState({ sourceState: 'something_else', sourceHashVerified: true, methodHashVerified: true }).state, 'imported');
});

test('a study with no state at all is refused', () => {
  assert.throws(() => mapManifestState({ sourceHashVerified: true, methodHashVerified: true }),
    (e) => e instanceof StudyImportError && e.code === 'IMPORT_UNKNOWN_SOURCE_STATE');
});

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

test('own control posts never enter the market population', () => {
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified });
  const control = plan.post_rows.find((r) => r.canonical_source_id === 'p3');
  assert.equal(control.population, 'own_control');
  assert.equal(control.is_own_control, true);
  assert.equal(control.inclusion, 'excluded');
  assert.equal(control.exclusion_reason, 'own_control');
  assert.equal(plan.counts.market_rows, 2);
  assert.equal(plan.counts.own_control_rows, 1);
});

test('every excluded row keeps a reason', () => {
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified });
  for (const r of plan.post_rows) {
    if (r.inclusion === 'excluded') assert.ok(r.exclusion_reason && r.exclusion_reason.trim() !== '');
  }
});

test('the scope statement survives: findings stay computed and age comparability stays unknown', () => {
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified });
  assert.equal(plan.study_row.state, 'validated');
  assert.ok(plan.finding_rows.every((f) => f.validation_state === 'computed'));
  assert.ok(plan.finding_rows.every((f) => f.age_comparability === 'unknown'));
  assert.ok(plan.post_rows.every((p) => p.age_comparability === 'unknown'));
  assert.deepEqual(plan.manifest.limitations, ['Retrospective descriptive attention only; no performance prediction.']);
  assert.equal(plan.manifest.source_state, SOURCE_STATE);
});

test('an unverified hash leaves the study stored but unserved', () => {
  const plan = buildStudyImport({
    clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(),
    ...verified, sourceHashVerified: false,
  });
  assert.equal(plan.study_row.state, 'imported');
  assert.equal(plan.counts.source_hash_verified, false);
});

test('no number is dropped: the floored baseline and the floor are kept', () => {
  const study = fixtureStudy();
  study.findings[0].baseline_raw_value = 12;
  study.findings[0].baseline_floor = 50;
  const plan = buildStudyImport({ clientId: 'testclient', study, posts: fixturePosts(), ...verified });
  assert.deepEqual(plan.finding_rows[0].uncertainty, { baseline_raw_value: 12, baseline_floor: 50 });
});

test('a foreign tenant post is an error, never a filter', () => {
  const posts = fixturePosts();
  posts[1].client_id = 'arch';
  assert.throws(() => buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts, ...verified }),
    (e) => e.code === 'IMPORT_TENANT_MISMATCH');
});

test('a market finding pointing at a control row is refused', () => {
  const study = fixtureStudy();
  study.findings[0].source_ids = ['p3'];
  assert.throws(() => buildStudyImport({ clientId: 'testclient', study, posts: fixturePosts(), ...verified }),
    (e) => e.code === 'IMPORT_FINDING_SOURCE_NOT_MARKET');
});

test('a finding pointing at a row the corpus does not hold is refused', () => {
  const study = fixtureStudy();
  study.findings[0].source_ids = ['p-missing'];
  assert.throws(() => buildStudyImport({ clientId: 'testclient', study, posts: fixturePosts(), ...verified }),
    (e) => e.code === 'IMPORT_FINDING_SOURCE_MISSING');
});

test('the publication window comes from the market rows that are actually retained', () => {
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified });
  assert.equal(plan.manifest.publication_window.from, '2026-05-01');
  assert.equal(plan.manifest.publication_window.to, '2026-06-01');
});

test('a thin roster is named as a missing input rather than hidden', () => {
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified });
  assert.ok(plan.study_row.missing_inputs.some((g) => /only 1 of 2 authors/.test(g)));
  assert.ok(plan.study_row.missing_inputs.some((g) => /age comparable/.test(g)));
});

// ---------------------------------------------------------------------------
// Counts against the study's own summary
// ---------------------------------------------------------------------------

test('a plan that matches the study summary compares clean', () => {
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified });
  assert.equal(plan.comparison.ok, true, JSON.stringify(plan.comparison.problems));
});

test('a summary that disagrees with the rows is a problem, not a note', () => {
  const c = compareToSummary(
    { post_rows: 3, market_rows: 2, own_control_rows: 1, method_excluded_rows: 0, finding_rows: 1 },
    { stored_posts: 9, own_control_posts_excluded: 1, findings: 1 });
  assert.equal(c.ok, false);
  assert.ok(c.problems.some((p) => /9 stored posts/.test(p)));
});

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

test('the transaction is one begin/commit with an upsert per table', () => {
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified });
  const sql = renderImportSql(plan);
  assert.ok(sql.startsWith('begin;'));
  assert.ok(sql.trimEnd().endsWith('commit;'));
  assert.ok(sql.includes('on conflict (client_id, study_id) do update'));
  assert.ok(sql.includes('on conflict (client_id, study_id, canonical_source_id) do update'));
  assert.ok(sql.includes('on conflict (client_id, study_id, finding_id) do update'));
  assert.equal(sql.match(/^insert into/gm).length, 3);
});

test('rendering twice is byte identical, so a replay is the same transaction', () => {
  const build = () => renderImportSql(buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts: fixturePosts(), ...verified }));
  assert.equal(build(), build());
});

test('a quote in a post body cannot end the literal', () => {
  const posts = fixturePosts();
  posts[0]._raw.text = "it's a '); drop table x; -- body";
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts, ...verified });
  const sql = renderImportSql(plan);
  assert.ok(sql.includes("it''s a ''); drop table x; -- body"));
  assert.ok(!sql.includes("'it's"));
});

test('literal helpers keep nulls null and refuse a non-finite number', () => {
  assert.equal(lit(null), 'null');
  assert.equal(jsonLit(null), 'null');
  assert.equal(numLit(null), 'null');
  assert.equal(numLit(0), '0');
  assert.throws(() => numLit(Number.POSITIVE_INFINITY), (e) => e.code === 'IMPORT_NON_FINITE_NUMBER');
});

test('an unknown metric stays null rather than becoming a zero', () => {
  const posts = fixturePosts();
  delete posts[0].reposts;
  const plan = buildStudyImport({ clientId: 'testclient', study: fixtureStudy(), posts, ...verified });
  const row = plan.post_rows.find((r) => r.canonical_source_id === 'p1');
  assert.equal(row.observed_metrics.reposts, null);
  assert.equal(row.observed_metrics.likes, 400);
});
