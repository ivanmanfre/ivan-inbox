// Pattern-evidence tests. Synthetic fixtures only -- no private post bodies, no reactor
// identities, no real profile URLs. The first test is copied VERBATIM (via fixtures/
// pattern-recurrence-fixture.json) from docs/superpowers/plans/2026-09-20-content-evidence-system.md,
// Package 3's pattern fixture -- it is the acceptance contract for this module and must not be altered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { comparePatterns, PatternsError } from './patterns.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERBATIM_FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures/pattern-recurrence-fixture.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Verbatim Package 3 fixture
// ---------------------------------------------------------------------------
test('recurrence among winners alone cannot qualify a pattern (verbatim plan fixture)', () => {
  const { posts, labels, partition, policy } = VERBATIM_FIXTURE;
  const result = comparePatterns({ posts, labels, partition, policy });
  assert.equal(result.findings.length, 0);
  assert.equal(result.insufficient[0].reason, 'missing_comparator_population');
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------
const POLICY = { minimumPatternPerAuthor: 5, minimumComparatorPerAuthor: 5, minimumAuthors: 3 };

function post(clientId, authorId, postId, value, role) {
  const p = { client_id: clientId, author_id: authorId, post_id: postId, value };
  if (role !== undefined) p.role = role;
  return p;
}
function label(postId, pattern, version = 'v1') {
  return { post_id: postId, pattern, label_version: version };
}

// ---------------------------------------------------------------------------
// A pooled effect that disappears within authors (Simpson's-paradox-shaped confound)
// ---------------------------------------------------------------------------
test('a pooled effect that disappears within authors is not reported as one universal effect', () => {
  const posts = [];
  const labels = [];

  // Author A: high baseline engagement, heavily over-represented in the pattern group.
  for (let i = 0; i < 10; i += 1) {
    const id = `a-pattern-${i}`;
    posts.push(post('test', 'A', id, 96 + i));
    labels.push(label(id, 'P'));
  }
  for (let i = 0; i < 5; i += 1) {
    const id = `a-cmp-${i}`;
    posts.push(post('test', 'A', id, 90 + i));
    labels.push(label(id, 'Q'));
  }

  // Author B: low baseline, under-represented in the pattern group.
  for (let i = 0; i < 5; i += 1) {
    const id = `b-pattern-${i}`;
    posts.push(post('test', 'B', id, 10 + i));
    labels.push(label(id, 'P'));
  }
  for (let i = 0; i < 10; i += 1) {
    const id = `b-cmp-${i}`;
    posts.push(post('test', 'B', id, 6 + i));
    labels.push(label(id, 'Q'));
  }

  // Author C: mid baseline.
  for (let i = 0; i < 5; i += 1) {
    const id = `c-pattern-${i}`;
    posts.push(post('test', 'C', id, 40 + i));
    labels.push(label(id, 'P'));
  }
  for (let i = 0; i < 5; i += 1) {
    const id = `c-cmp-${i}`;
    posts.push(post('test', 'C', id, 36 + i));
    labels.push(label(id, 'Q'));
  }

  const partition = { discovery: posts.map((p) => p.post_id), holdout: [] };
  const result = comparePatterns({ posts, labels, partition, policy: POLICY });

  const finding = result.findings.find((f) => f.pattern === 'P');
  assert.ok(finding, 'pattern P should qualify: 3 authors each clear both minimums');
  assert.equal(finding.per_author_results.length, 3);

  // Never pooled: the module must never emit a single combined mean of raw values across authors.
  for (const r of finding.per_author_results) {
    assert.ok(Number.isFinite(r.effect));
  }

  // A naive pool (computed here, NOT by the module) is dramatically larger than any real
  // per-author effect and larger than the module's own per-author-median summary -- proof that
  // pooling manufactures an effect the within-author data does not support.
  const patternRows = posts.filter((p) => labels.find((l) => l.post_id === p.post_id).pattern === 'P');
  const comparatorRows = posts.filter((p) => labels.find((l) => l.post_id === p.post_id).pattern === 'Q');
  const naivePooledEffect = mean(patternRows.map((p) => p.value)) - mean(comparatorRows.map((p) => p.value));
  const maxPerAuthorEffect = Math.max(...finding.per_author_results.map((r) => r.effect));

  assert.ok(naivePooledEffect > 20, `expected a large naive pooled effect, got ${naivePooledEffect}`);
  assert.ok(naivePooledEffect > maxPerAuthorEffect * 2,
    `pooled effect (${naivePooledEffect}) should dwarf every real per-author effect (max ${maxPerAuthorEffect})`);
  assert.equal(finding.summary_effect_median, 4); // median of [8.5, 1.5, 4]
});

function mean(nums) { return nums.reduce((s, n) => s + n, 0) / nums.length; }

// ---------------------------------------------------------------------------
// One source dominating: sensitivity to the largest author
// ---------------------------------------------------------------------------
test('a pattern driven by one dominant source does not survive leave-largest-author-out', () => {
  const posts = [];
  const labels = [];

  // BIG: 40 posts, dwarfing the other two authors combined.
  for (let i = 0; i < 20; i += 1) {
    const id = `big-pattern-${i}`;
    posts.push(post('test', 'BIG', id, 60 + i));
    labels.push(label(id, 'P'));
  }
  for (let i = 0; i < 20; i += 1) {
    const id = `big-cmp-${i}`;
    posts.push(post('test', 'BIG', id, 55 + i));
    labels.push(label(id, 'Q'));
  }
  // Two small authors, each right at the minimums.
  for (const authorId of ['S1', 'S2']) {
    for (let i = 0; i < 5; i += 1) {
      const id = `${authorId}-pattern-${i}`;
      posts.push(post('test', authorId, id, 10 + i));
      labels.push(label(id, 'P'));
    }
    for (let i = 0; i < 5; i += 1) {
      const id = `${authorId}-cmp-${i}`;
      posts.push(post('test', authorId, id, 8 + i));
      labels.push(label(id, 'Q'));
    }
  }

  const partition = { discovery: posts.map((p) => p.post_id), holdout: [] };
  const result = comparePatterns({ posts, labels, partition, policy: POLICY });
  const finding = result.findings.find((f) => f.pattern === 'P');
  assert.ok(finding, 'all three authors should qualify initially');

  const sens = result.sensitivity.find((s) => s.pattern === 'P');
  assert.ok(sens);
  assert.equal(sens.leave_largest_author_out.excluded_author_id, 'BIG');
  assert.equal(sens.leave_largest_author_out.survives, false,
    'removing the dominant source should drop qualifying authors below minimumAuthors');
});

// ---------------------------------------------------------------------------
// Unknown labels change the denominator
// ---------------------------------------------------------------------------
test('unknown and unlabeled posts are excluded from both numerator and denominator, and counted', () => {
  const posts = [];
  const labels = [];
  for (let i = 0; i < 5; i += 1) {
    const id = `p-${i}`;
    posts.push(post('test', 'X', id, 50 + i));
    labels.push(label(id, 'P'));
  }
  for (let i = 0; i < 5; i += 1) {
    const id = `q-${i}`;
    posts.push(post('test', 'X', id, 40 + i));
    labels.push(label(id, 'Q'));
  }
  for (let i = 0; i < 3; i += 1) {
    const id = `u-${i}`;
    posts.push(post('test', 'X', id, 99));
    labels.push(label(id, 'unknown'));
  }
  for (let i = 0; i < 2; i += 1) {
    const id = `nolabel-${i}`;
    posts.push(post('test', 'X', id, 1));
    // no label row at all
  }

  const partition = { discovery: posts.map((p) => p.post_id), holdout: [] };
  const result = comparePatterns({ posts, labels, partition, policy: POLICY });

  // Only author X, so cross-author minimumAuthors (3) is never met -- expect insufficient, not a finding.
  const insufficient = result.insufficient.find((x) => x.pattern === 'P');
  assert.ok(insufficient);
  assert.equal(insufficient.reason, 'below_minimum_authors');
  assert.equal(insufficient.comparator_n_total, 5, 'comparator denominator must exclude unknown/unlabeled posts');
  assert.equal(insufficient.pattern_n_total, 5);
  assert.equal(insufficient.prevalence.unknown_label_excluded_n, 3);
  assert.equal(insufficient.prevalence.unlabeled_excluded_n, 2);
  assert.equal(insufficient.prevalence.all_eligible_known_n, 10, 'known denominator = 5 pattern + 5 comparator, excluding 3 unknown + 2 unlabeled');
});

// ---------------------------------------------------------------------------
// Chronological split leak
// ---------------------------------------------------------------------------
test('a post id present in both discovery and holdout throws a named error', () => {
  const posts = [post('test', 'a', 'dup', 10), post('test', 'a', 'other', 20)];
  const labels = [label('dup', 'P'), label('other', 'Q')];
  const partition = { discovery: ['dup', 'other'], holdout: ['dup'] };
  assert.throws(
    () => comparePatterns({ posts, labels, partition, policy: POLICY }),
    (err) => err instanceof PatternsError && err.code === 'PATTERNS_SPLIT_LEAK',
  );
});

// ---------------------------------------------------------------------------
// Tenant enforcement
// ---------------------------------------------------------------------------
test('a post with a foreign client_id throws', () => {
  const posts = [post('test', 'a', 'p1', 10), post('other-client', 'a', 'p2', 20)];
  const labels = [label('p1', 'P'), label('p2', 'Q')];
  const partition = { discovery: ['p1', 'p2'], holdout: [] };
  assert.throws(
    () => comparePatterns({ posts, labels, partition, policy: POLICY }),
    (err) => err instanceof PatternsError && err.code === 'PATTERNS_TENANT_MISMATCH',
  );
});

test('a label with a foreign client_id throws', () => {
  const posts = [post('test', 'a', 'p1', 10), post('test', 'a', 'p2', 20)];
  const labels = [label('p1', 'P'), { post_id: 'p2', pattern: 'Q', label_version: 'v1', client_id: 'other-client' }];
  const partition = { discovery: ['p1', 'p2'], holdout: [] };
  assert.throws(
    () => comparePatterns({ posts, labels, partition, policy: POLICY }),
    (err) => err instanceof PatternsError && err.code === 'PATTERNS_TENANT_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// Holdout status
// ---------------------------------------------------------------------------
test('holdoutStatus is unavailable with no holdout posts and no exposure flag', () => {
  const posts = [post('test', 'a', 'p1', 10)];
  const labels = [label('p1', 'P')];
  const result = comparePatterns({ posts, labels, partition: { discovery: ['p1'], holdout: [] }, policy: POLICY });
  assert.equal(result.holdoutStatus, 'unavailable');
});

test('holdoutStatus is unavailable without an explicit prospective untouched attestation', () => {
  const posts = [post('test', 'a', 'p1', 10), post('test', 'a', 'p2', 20)];
  const labels = [label('p1', 'P'), label('p2', 'Q')];
  const result = comparePatterns({ posts, labels, partition: { discovery: ['p1'], holdout: ['p2'] }, policy: POLICY });
  assert.equal(result.holdoutStatus, 'unavailable');
});

test('blind holdout requires valid per-author chronology and an explicit untouched attestation', () => {
  const posts = [
    { ...post('test', 'a', 'd', 10), published_at: '2026-09-01T00:00:00Z' },
    { ...post('test', 'a', 'h', 20), published_at: '2026-09-02T00:00:00Z' },
  ];
  const labels = [label('d', 'P'), label('h', 'Q')];
  const partition = { discovery: ['d'], holdout: ['h'], exposure: 'prospective', holdout_untouched: true };
  assert.equal(comparePatterns({ posts, labels, partition, policy: POLICY }).holdoutStatus, 'blind');
});

test('a reversed or undated per-author holdout is unavailable even when marked prospective and untouched', () => {
  const reversed = [
    { ...post('test', 'a', 'd', 10), published_at: '2026-09-19T00:00:00Z' },
    { ...post('test', 'a', 'h', 20), published_at: '2026-01-01T00:00:00Z' },
  ];
  const labels = [label('d', 'P'), label('h', 'Q')];
  const prospective = { discovery: ['d'], holdout: ['h'], exposure: 'prospective', holdout_untouched: true };
  assert.equal(comparePatterns({ posts: reversed, labels, partition: prospective, policy: POLICY }).holdoutStatus, 'unavailable');
  const undated = reversed.map((p) => p.post_id === 'h' ? { ...p, published_at: null } : p);
  assert.equal(comparePatterns({ posts: undated, labels, partition: prospective, policy: POLICY }).holdoutStatus, 'unavailable');
  const discoveryUndated = [
    { ...post('test', 'a', 'd', 10), published_at: null },
    { ...post('test', 'a', 'd2', 12), published_at: '2026-09-01T00:00:00Z' },
    { ...post('test', 'a', 'h', 20), published_at: '2026-09-20T00:00:00Z' },
  ];
  const labelsWithSecondDiscovery = [...labels, label('d2', 'P')];
  assert.equal(comparePatterns({ posts: discoveryUndated, labels: labelsWithSecondDiscovery, partition: { ...prospective, discovery: ['d', 'd2'] }, policy: POLICY }).holdoutStatus, 'unavailable');
});

test('exposure: retrospective can never yield blind, even with a nonempty holdout', () => {
  const posts = [post('test', 'a', 'p1', 10), post('test', 'a', 'p2', 20)];
  const labels = [label('p1', 'P'), label('p2', 'Q')];
  const result = comparePatterns({
    posts, labels,
    partition: { discovery: ['p1'], holdout: ['p2'], exposure: 'retrospective' },
    policy: POLICY,
  });
  assert.equal(result.holdoutStatus, 'retrospective');
  assert.notEqual(result.holdoutStatus, 'blind');
});

// ---------------------------------------------------------------------------
// Limitations always carry "descriptive, not causal"
// ---------------------------------------------------------------------------
test('every produced finding carries a "descriptive, not causal" limitation', () => {
  const posts = [];
  const labels = [];
  for (const authorId of ['A', 'B', 'C']) {
    for (let i = 0; i < 5; i += 1) {
      const pid = `${authorId}-p-${i}`;
      posts.push(post('test', authorId, pid, 50 + i));
      labels.push(label(pid, 'P'));
    }
    for (let i = 0; i < 5; i += 1) {
      const cid = `${authorId}-c-${i}`;
      posts.push(post('test', authorId, cid, 40 + i));
      labels.push(label(cid, 'Q'));
    }
  }
  const partition = { discovery: posts.map((p) => p.post_id), holdout: [] };
  const result = comparePatterns({ posts, labels, partition, policy: POLICY });
  assert.ok(result.findings.length > 0);
  for (const finding of result.findings) {
    assert.ok(finding.limitations.some((l) => l.includes('descriptive, not causal')));
  }
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
test('an empty posts array is refused rather than silently producing zero findings', () => {
  assert.throws(
    () => comparePatterns({ posts: [], labels: [], partition: { discovery: [], holdout: [] }, policy: POLICY }),
    (err) => err instanceof PatternsError && err.code === 'PATTERNS_BAD_POSTS',
  );
});

test('an invalid policy is refused', () => {
  const posts = [post('test', 'a', 'p1', 10)];
  const labels = [label('p1', 'P')];
  assert.throws(
    () => comparePatterns({ posts, labels, partition: { discovery: ['p1'], holdout: [] }, policy: { minimumPatternPerAuthor: 0, minimumComparatorPerAuthor: 5, minimumAuthors: 3 } }),
    (err) => err instanceof PatternsError && err.code === 'PATTERNS_BAD_POLICY',
  );
});
