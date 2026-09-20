// Import tests. Synthetic fixtures only. Nothing here touches a database: preview is a pure
// function of the records handed in, which is exactly what makes idempotency provable offline.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportError, importStudy, PREVIEW_ONLY } from './import-study.mjs';

const CUTOFF = '2026-09-01T00:00:00Z';

function manifest(over = {}) {
  return {
    schema_version: 1,
    client_id: 'risedtc',
    study_id: 's1',
    study_kind: 'market',
    method_version: 'fixture-v1',
    source_paths: [{ path: 'synthetic.json', sha256: 'a'.repeat(64) }],
    publication_window: { from: '2025-09-01', to: '2026-09-01' },
    observation_cutoff: CUTOFF,
    metric_definitions: { public_weighted: 'likes + 3 * reposts' },
    roster_version: 'synthetic-v1',
    eligibility: { originals_only: true },
    excluded_counts: {},
    classifier_versions: [],
    state: 'imported',
    ...over,
  };
}

function record(over = {}) {
  return {
    client_id: 'risedtc',
    canonical_source_id: 'urn:li:activity:1',
    source_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
    author_id: 'author-a',
    author_role: 'direct_competitor',
    published_at: '2026-08-01T00:00:00Z',
    captured_at: '2026-08-20T00:00:00Z',
    text: 'synthetic body one',
    format_evidence: { format: 'text' },
    metrics: { likes: 40, comments: 2, reposts: 0, impressions: null },
    is_reshare: false,
    ...over,
  };
}

function run(records, over = {}) {
  return importStudy({ clientId: 'risedtc', manifest: manifest(), records, cutoff: CUTOFF, ...over });
}

test('preview is the default and the only reachable mode', () => {
  const r = run([record()]);
  assert.equal(PREVIEW_ONLY, true);
  assert.equal(r.apply, false);
  assert.equal(r.mode, 'preview');
});

test('apply is refused in this package', () => {
  assert.throws(() => run([record()], { apply: true }),
    (err) => err instanceof ImportError && err.code === 'IMPORT_APPLY_NOT_AUTHORIZED');
});

test('preview returns the counts a reviewer needs', () => {
  const r = run([record(), record({ canonical_source_id: 'urn:li:activity:2', source_url: 'https://x/2' })]);
  assert.deepEqual(Object.keys(r.counts).sort(), [
    'excluded', 'findings_already_present', 'findings_to_insert', 'observations_to_insert',
    'own_controls', 'posts_already_present', 'posts_to_insert',
  ]);
  assert.equal(r.counts.posts_to_insert, 2);
  assert.equal(r.counts.posts_already_present, 0);
  assert.equal(r.counts.excluded, 0);
  assert.equal(typeof r.hashes.posts_sha256, 'string');
  assert.equal(r.hashes.posts_sha256.length, 64);
  assert.ok(r.hashes.manifest_sha256 && r.hashes.findings_sha256 && r.hashes.study_sha256);
});

test('a record from another tenant is refused', () => {
  assert.throws(() => run([record({ client_id: 'arch' })]), /tenant/i);
});

test('a duplicate capture is a second observation of one post, not a second post', () => {
  const r = run([
    record({ captured_at: '2026-08-20T00:00:00Z', metrics: { likes: 40, comments: 2, reposts: 0, impressions: null } }),
    record({ captured_at: '2026-08-27T00:00:00Z', metrics: { likes: 61, comments: 3, reposts: 1, impressions: null } }),
  ]);
  assert.equal(r.counts.posts_to_insert, 1);
  assert.equal(r.counts.observations_to_insert, 2);
  assert.equal(r.posts[0].observations.length, 2);
  assert.deepEqual(r.posts[0].observations.map((o) => o.metrics.likes), [40, 61]);
  // the first capture does not get overwritten by the later one
  assert.equal(r.posts[0].source_dates.published_at, '2026-08-01T00:00:00.000Z');
});

test('identical public text alone does not merge two genuinely distinct posts', () => {
  const r = run([
    record({ canonical_source_id: 'urn:li:activity:1', source_url: 'https://x/1', text: 'the same words' }),
    record({ canonical_source_id: 'urn:li:activity:2', source_url: 'https://x/2', text: 'the same words', author_id: 'author-b' }),
  ]);
  assert.equal(r.counts.posts_to_insert, 2);
  assert.deepEqual(r.posts.map((p) => p.canonical_source_id).sort(),
    ['urn:li:activity:1', 'urn:li:activity:2']);
});

test('private own-control posts stay out of the market population and are counted separately', () => {
  const controls = [
    record({ canonical_source_id: 'ctl-1', source_url: 'https://x/c1', author_id: 'mattan', is_own_control: true }),
    record({ canonical_source_id: 'ctl-2', source_url: 'https://x/c2', author_id: 'mattan', is_own_control: true }),
    record({ canonical_source_id: 'ctl-3', source_url: 'https://x/c3', author_id: 'mattan', is_own_control: true }),
    record({ canonical_source_id: 'ctl-4', source_url: 'https://x/c4', author_id: 'chad-davis', is_own_control: true }),
    record({ canonical_source_id: 'ctl-5', source_url: 'https://x/c5', author_id: 'chad-davis', is_own_control: true }),
    record({ canonical_source_id: 'ctl-6', source_url: 'https://x/c6', author_id: 'chad-davis', is_own_control: true }),
    record({ canonical_source_id: 'ctl-7', source_url: 'https://x/c7', author_id: 'chad-davis', is_own_control: true }),
  ];
  const r = run([record(), ...controls]);
  assert.equal(r.counts.posts_to_insert, 1);
  assert.equal(r.counts.own_controls, 7);
  assert.equal(r.own_controls.length, 7);
  assert.deepEqual(r.posts.map((p) => p.canonical_source_id), ['urn:li:activity:1']);
  for (const id of controls.map((c) => c.canonical_source_id)) {
    assert.ok(r.excluded.some((e) => e.canonical_source_id === id && e.reason === 'own_control'));
  }
});

test('reshares, post-cutoff captures, selftest rows and duplicate URLs are excluded with reasons', () => {
  const r = run([
    record(),
    record({ canonical_source_id: 'a2', source_url: 'https://x/2', is_reshare: true }),
    record({ canonical_source_id: 'a3', source_url: 'https://x/3', captured_at: '2026-09-15T00:00:00Z' }),
    record({ canonical_source_id: 'a4', source_url: 'https://x/4', is_selftest: true }),
    record({ canonical_source_id: 'a5', source_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/' }),
    record({ canonical_source_id: '', source_url: 'https://x/6' }),
  ]);
  const byReason = Object.fromEntries(r.excluded.map((e) => [e.canonical_source_id || '(blank)', e.reason]));
  assert.equal(byReason.a2, 'reshare');
  assert.equal(byReason.a3, 'observation_after_cutoff');
  assert.equal(byReason.a4, 'selftest');
  assert.equal(byReason.a5, 'duplicate_source_url');
  assert.equal(byReason['(blank)'], 'missing_canonical_id');
  assert.equal(r.counts.posts_to_insert, 1);
  assert.equal(r.counts.excluded, 5);
});

test('reimporting the same snapshot creates no new identity', () => {
  const records = [record(), record({ canonical_source_id: 'urn:li:activity:2', source_url: 'https://x/2' })];
  const first = run(records);
  const existing = {
    posts: first.posts.map((p) => ({ canonical_source_id: p.canonical_source_id, content_sha256: p.content_sha256 })),
  };
  const second = run(records, { existing });
  assert.equal(second.counts.posts_to_insert, 0);
  assert.equal(second.counts.posts_already_present, 2);
  assert.deepEqual(second.newIdentities, []);
  assert.equal(second.hashes.posts_sha256, first.hashes.posts_sha256);
});

test('preview is deterministic: the same input twice gives byte-identical hashes', () => {
  const records = [record({ canonical_source_id: 'b' , source_url: 'https://x/b' }), record()];
  const a = run(records);
  const b = run([...records].reverse());
  assert.equal(a.hashes.study_sha256, b.hashes.study_sha256);
});

test('findings are previewed and deduplicated by finding_id', () => {
  const findings = [{
    client_id: 'risedtc', study_id: 's1', finding_id: 'f1', kind: 'market',
    source_ids: ['urn:li:activity:1'], metric_id: 'public_weighted',
    observed_value: 40, baseline_value: 10, baseline_n: 21, lift: 4,
    formula: 'likes + 3 * reposts', method_version: 'fixture-v1',
    source_dates: { published_at: '2026-08-01T00:00:00Z' },
    capture_dates: { captured_at: '2026-08-20T00:00:00Z' },
    age_comparability: 'age_unmatched', limitations: ['descriptive'], validation_state: 'computed',
  }];
  const r = run([record()], { findings });
  assert.equal(r.counts.findings_to_insert, 1);
  const again = run([record()], { findings, existing: { findings: [{ finding_id: 'f1' }] } });
  assert.equal(again.counts.findings_to_insert, 0);
  assert.equal(again.counts.findings_already_present, 1);
});

test('a finding pointing at a source the study excluded is refused', () => {
  const findings = [{
    client_id: 'risedtc', study_id: 's1', finding_id: 'f1', kind: 'market',
    source_ids: ['ghost'], metric_id: 'public_weighted',
    observed_value: 40, baseline_value: 10, baseline_n: 21, lift: 4,
    formula: 'likes + 3 * reposts', method_version: 'fixture-v1',
    source_dates: { published_at: '2026-08-01T00:00:00Z' },
    capture_dates: { captured_at: '2026-08-20T00:00:00Z' },
    age_comparability: 'age_unmatched', limitations: ['descriptive'], validation_state: 'computed',
  }];
  assert.throws(() => run([record()], { findings }),
    (err) => err.code === 'IMPORT_FINDING_SOURCE_MISSING' && /ghost/.test(err.message));
});
