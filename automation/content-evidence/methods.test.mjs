// Methods tests. Synthetic fixtures only. The first test below is copied VERBATIM from
// docs/superpowers/plans/2026-09-20-content-evidence-system.md, Package 2's core calculation
// fixture -- it is the acceptance contract for this module and must not be altered.
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeOutliers } from './methods.mjs';
import { validateFinding } from './contracts.mjs';

// ---------------------------------------------------------------------------
// Verbatim Package 2 fixture
// ---------------------------------------------------------------------------
test('same-metric baseline is explicit', () => {
  const ordinary = Array.from({ length: 20 }, (_, i) => ({
    client_id: 'test', author_id: 'a', post_id: 'p' + i,
    published_at: '2026-08-01', captured_at: '2026-09-01',
    likes: 10, reposts: 0, comments: 0, is_reshare: false
  }));
  const winner = { ...ordinary[0], post_id: 'w', likes: 50, reposts: 10 };
  const r = computeOutliers({ posts: [...ordinary, winner], cutoff: '2026-09-02',
    policy: { id: 'public-weighted-v1', windowDays: 365, minimumN: 20,
      repostWeight: 3, minimumLift: 4, minimumLikes: 40 } });
  assert.equal(r.findings[0].observed_value, 80);
  assert.equal(r.findings[0].baseline_value, 10);
  assert.equal(r.findings[0].baseline_n, 21);
  assert.equal(r.findings[0].lift, 8);
});

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------
const POLICY = { id: 'public-weighted-v1', windowDays: 365, minimumN: 20, repostWeight: 3, minimumLift: 4, minimumLikes: 40 };

function ordinaryPosts(n, over = {}) {
  return Array.from({ length: n }, (_, i) => ({
    client_id: 'test', author_id: 'a', post_id: 'p' + i,
    published_at: '2026-08-01', captured_at: '2026-09-01',
    likes: 10, reposts: 0, comments: 0, is_reshare: false,
    ...over,
  }));
}

// ---------------------------------------------------------------------------
// Zero / null baselines
// ---------------------------------------------------------------------------
test('a zero baseline yields no finite multiplier -- inspectable, not ranked', () => {
  const posts = ordinaryPosts(20, { likes: 0 });
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, reposts: 0, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.length, 0);
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.ok(coverage);
  assert.equal(coverage.baseline_value, 0);
  assert.equal(coverage.ranked, false);
});

test('an author with no eligible posts at all has a null baseline, not zero and not a crash', () => {
  const posts = [{ client_id: 'test', author_id: 'lonely', post_id: 'only-one', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 5, reposts: 0, comments: 0, is_reshare: true }]; // the only post is a reshare
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.length, 0);
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'lonely');
  assert.ok(coverage);
  assert.equal(coverage.baseline_value, null);
  assert.equal(coverage.ranked, false);
});

// ---------------------------------------------------------------------------
// Future observations relative to cutoff
// ---------------------------------------------------------------------------
test('an observation captured after the cutoff is excluded, not treated as evidence', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-10', likes: 500, reposts: 50, comments: 0, is_reshare: false }); // future capture
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.find((f) => f.source_ids.includes('w')), undefined);
  assert.ok(r.excluded.some((e) => e.post_id === 'w' && e.reason === 'observation_after_cutoff'));
});

// ---------------------------------------------------------------------------
// Authors below minimumN stay unranked
// ---------------------------------------------------------------------------
test('an author with exactly 19 eligible posts (one short of minimumN=20) is unranked', () => {
  const posts = ordinaryPosts(18);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 500, reposts: 50, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.length, 0);
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.n, 19); // 18 ordinary + the candidate itself
  assert.equal(coverage.ranked, false);
});

test('an author with exactly 20 eligible posts (meeting minimumN) is ranked', () => {
  const posts = ordinaryPosts(19);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 500, reposts: 50, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: { ...POLICY, minimumN: 20 } });
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.n, 20);
  assert.equal(coverage.ranked, true);
  assert.equal(r.findings.length, 1);
});

// ---------------------------------------------------------------------------
// Duplicated captures of the same post
// ---------------------------------------------------------------------------
test('repeated snapshots of one post contribute once to the baseline and produce one finding', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-08-15', likes: 30, reposts: 5, comments: 0, is_reshare: false }); // earlier, smaller capture
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, reposts: 10, comments: 0, is_reshare: false }); // later, larger capture
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  const wFindings = r.findings.filter((f) => f.source_ids.includes('w'));
  assert.equal(wFindings.length, 1);
  // uses the latest capture, not the earlier one
  assert.equal(wFindings[0].observed_value, 80);
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.n, 21); // 20 ordinary + ONE contribution from post w, not two
});

// ---------------------------------------------------------------------------
// Missing metrics (audit P1 finding 3: a missing likes/reposts count must never manufacture a
// denominator by silently becoming 0). Corrects the previous "missing reposts is treated as 0"
// expectation -- that was the exact bug the audit demonstrated (methods.test.mjs:127).
// ---------------------------------------------------------------------------
test('missing reposts is UNKNOWN, not zero -- excluded from the finding, from the baseline, and from minimumN', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, comments: 0, is_reshare: false }); // reposts omitted entirely
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.find((f) => f.source_ids.includes('w')), undefined);
  assert.ok(r.excluded.some((e) => e.post_id === 'w' && e.reason === 'unknown_metric'));
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.n, 20); // the unknown-score post never joined the 20 known ordinary posts
  assert.equal(coverage.unknown_score_n, 1);
});

test('missing likes is UNKNOWN, not zero -- same treatment as missing reposts', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', reposts: 10, comments: 0, is_reshare: false }); // likes omitted entirely
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.find((f) => f.source_ids.includes('w')), undefined);
  assert.ok(r.excluded.some((e) => e.post_id === 'w' && e.reason === 'unknown_metric'));
});

test('a real zero for both likes and reposts is a genuine 0, stays eligible, and is not confused with unknown', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 0, reposts: 0, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.ok(!r.excluded.some((e) => e.post_id === 'w'));
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.n, 21); // the real-zero post counted toward n, unlike an unknown-score post
  assert.equal(coverage.unknown_score_n, 0);
});

test('the exact audit UNKNOWN_BASELINE counterexample: likes [null,10,100], reposts known-zero, minimumN 3 -- only two score-eligible posts, below minimumN, no finding', () => {
  const policy = { id: 'x', windowDays: 365, minimumN: 3, repostWeight: 3, minimumLift: 4, minimumLikes: 40 };
  const posts = [null, 10, 100].map((likes, i) => ({
    client_id: 'ivan', post_id: 'p' + i, author_id: 'a',
    published_at: '2026-09-01', captured_at: '2026-09-08', likes, reposts: 0,
  }));
  const r = computeOutliers({ posts, cutoff: '2026-09-20', policy, studyId: 's1' });
  assert.equal(r.findings.length, 0);
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.n, 2);
  assert.equal(coverage.unknown_score_n, 1);
  assert.equal(coverage.below_minimum_n, true);
  assert.ok(r.excluded.some((e) => e.post_id === 'p0' && e.reason === 'unknown_metric'));
});

// ---------------------------------------------------------------------------
// Cross-client identical post ids
// ---------------------------------------------------------------------------
test('the same post_id under two different client_ids is scored per-client, never pooled together', () => {
  const postsA = ordinaryPosts(20, { client_id: 'clientA' });
  postsA.push({ client_id: 'clientA', author_id: 'a', post_id: 'shared-id', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, reposts: 10, comments: 0, is_reshare: false });
  const postsB = ordinaryPosts(20, { client_id: 'clientB', likes: 200 }); // very different baseline
  postsB.push({ client_id: 'clientB', author_id: 'a', post_id: 'shared-id', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, reposts: 10, comments: 0, is_reshare: false });

  const rA = computeOutliers({ posts: postsA, cutoff: '2026-09-02', policy: POLICY });
  const rB = computeOutliers({ posts: postsB, cutoff: '2026-09-02', policy: POLICY });
  // client A: baseline 10, score 80 -> 8x, a finding
  assert.equal(rA.findings.filter((f) => f.source_ids.includes('shared-id')).length, 1);
  // client B: baseline 200, score 80 -> 0.4x, never a finding despite the identical post_id
  assert.equal(rB.findings.filter((f) => f.source_ids.includes('shared-id')).length, 0);
});

// ---------------------------------------------------------------------------
// A real zero-performance post
// ---------------------------------------------------------------------------
test('a real zero-performance post scores 0, is never confused with a missing value', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'flop', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 0, reposts: 0, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.filter((f) => f.source_ids.includes('flop')).length, 0); // 0 is not an outlier
  assert.ok(!r.excluded.some((e) => e.post_id === 'flop')); // but it is not EXCLUDED either -- it was evaluated
});

// ---------------------------------------------------------------------------
// Reshares excluded from both baseline and candidacy
// ---------------------------------------------------------------------------
test('a reshare never enters the baseline and is never itself a candidate', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'rt', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 5000, reposts: 500, comments: 0, is_reshare: true });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.equal(r.findings.filter((f) => f.source_ids.includes('rt')).length, 0);
  assert.ok(r.excluded.some((e) => e.post_id === 'rt' && e.reason === 'reshare'));
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.n, 20); // the reshare did not join the 20 ordinary posts
});

// ---------------------------------------------------------------------------
// methodVersion is present and distinct from the legacy study's method
// ---------------------------------------------------------------------------
test('every finding and the top-level result carry a method_version distinct from the legacy figure', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, reposts: 10, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY });
  assert.ok(typeof r.methodVersion === 'string' && r.methodVersion.length > 0);
  assert.notEqual(r.methodVersion, 'legacy-2026-09-19');
  assert.equal(r.findings[0].method_version, r.methodVersion);
});

// ---------------------------------------------------------------------------
// baselineFloor: the legacy study's recovered low-baseline policy, kept distinct from this
// module's own default (no floor -- see OUTPUT/01-reconciliation/methods.json,
// legacy-likes-median-floor8-v1, recovered independently by the parent verifier).
// ---------------------------------------------------------------------------
test('default policy (no baselineFloor) gives a zero baseline no finite multiplier, same as the null-baseline test', () => {
  const posts = ordinaryPosts(20, { likes: 0 });
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, reposts: 0, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY }); // POLICY has no baselineFloor
  assert.equal(r.findings.length, 0);
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.baseline_floor, null);
  assert.equal(coverage.effective_baseline_value, 0);
  assert.equal(coverage.ranked, false);
});

test('baselineFloor:8 replays the legacy low-baseline policy -- a near-zero baseline is raised to the floor, not left at 0', () => {
  const posts = ordinaryPosts(20, { likes: 2 }); // raw median = 2, below the floor
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 40, reposts: 0, comments: 0, is_reshare: false });
  const legacyPolicy = { ...POLICY, id: 'legacy-likes-median-floor8-v1', baselineFloor: 8 };
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: legacyPolicy });
  const coverage = r.baselineCoverage.find((c) => c.author_id === 'a');
  assert.equal(coverage.baseline_value, 2); // raw median, unfloored, still reported
  assert.equal(coverage.baseline_floor, 8);
  assert.equal(coverage.effective_baseline_value, 8); // floored up from 2
  assert.equal(coverage.ranked, true);
  const finding = r.findings.find((f) => f.source_ids.includes('w'));
  assert.ok(finding);
  assert.equal(finding.lift, 5); // 40/8, not 40/2=20 -- the floor caps the multiplier
  assert.equal(finding.baseline_value, 8);
  assert.equal(finding.baseline_raw_value, 2);
  assert.equal(finding.baseline_floor, 8);
});

test('a baselineFloor:8 run stamps a DISTINCT method_version from a no-floor run on the same posts -- never pooled under one key', () => {
  const posts = ordinaryPosts(20, { likes: 2 });
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 40, reposts: 0, comments: 0, is_reshare: false });

  const noFloor = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY }); // baselineFloor omitted
  const floored = computeOutliers({ posts, cutoff: '2026-09-02', policy: { ...POLICY, baselineFloor: 8 } });

  assert.notEqual(floored.methodVersion, noFloor.methodVersion);
  assert.equal(floored.methodVersion, `${noFloor.methodVersion}-floor8`);
  // and every finding under each run carries its own run's method_version, not the other's
  const flooredFinding = floored.findings.find((f) => f.source_ids.includes('w'));
  assert.equal(flooredFinding.method_version, floored.methodVersion);
  assert.notEqual(flooredFinding.method_version, noFloor.methodVersion);
});

// ---------------------------------------------------------------------------
// Required Finding contract fields are all present (contracts.mjs shape)
// ---------------------------------------------------------------------------
test('a market finding satisfies contracts.mjs\'s own validateFinding -- a real conformance check, not a name check', () => {
  const posts = ordinaryPosts(20);
  posts.push({ client_id: 'test', author_id: 'a', post_id: 'w', published_at: '2026-08-01',
    captured_at: '2026-09-01', likes: 50, reposts: 10, comments: 0, is_reshare: false });
  const r = computeOutliers({ posts, cutoff: '2026-09-02', policy: POLICY, studyId: 's1' });
  const f = r.findings[0];
  // validateFinding is the thing that actually decides whether the contract accepts this finding:
  // it checks presence AND shape (kind-specific required fields, array types, enum membership),
  // not merely that seventeen key names exist. It throws on failure, so a passing call IS the
  // assertion.
  assert.doesNotThrow(() => validateFinding(f, { clientId: 'test' }));
  assert.equal(f.kind, 'market');
});
