// Normalize tests. Synthetic fixtures only: no private corpus text, no reactor identity, no
// client receipt. The first test below is copied VERBATIM from
// docs/superpowers/plans/2026-09-20-content-evidence-system.md, Package 1's fixture -- it is the
// acceptance contract for this module and must not be altered.
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStudy, NormalizeError } from './normalize.mjs';

// ---------------------------------------------------------------------------
// Verbatim Package 1 fixture
// ---------------------------------------------------------------------------
test('study refuses a foreign tenant', () => {
  const base = { clientId: 'risedtc', studyId: 's1',
    manifest: {
      schema_version: 1, client_id: 'risedtc', study_id: 's1',
      study_kind: 'market', method_version: 'fixture-v1',
      source_paths: [{ path: 'synthetic.json', sha256: 'a'.repeat(64) }],
      publication_window: { from: '2025-09-01', to: '2026-09-01' },
      observation_cutoff: '2026-09-01T00:00:00Z',
      metric_definitions: { public_weighted: 'likes + 3 * reposts' },
      roster_version: 'synthetic-v1', eligibility: { originals_only: true },
      excluded_counts: {}, classifier_versions: [], state: 'imported'
    } };
  assert.throws(() => normalizeStudy({ ...base,
    records: [{ client_id: 'arch', id: 'p1', url: 'https://example.org/p1' }] }),
    /tenant/);
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
function manifest(over = {}) {
  return {
    schema_version: 1,
    client_id: 'risedtc',
    study_id: 's1',
    study_kind: 'market',
    method_version: 'fixture-v1',
    source_paths: [{ path: 'synthetic.json', sha256: 'a'.repeat(64) }],
    publication_window: { from: '2025-09-01', to: '2026-09-01' },
    observation_cutoff: '2026-09-01T00:00:00Z',
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
  return normalizeStudy({ clientId: 'risedtc', studyId: 's1', manifest: manifest(), records, ...over });
}

// ---------------------------------------------------------------------------
// Package 1's own explicit follow-on requirements: duplicate lineage, no silent replacement of a
// newer study, exact original IDs, idempotent reimport, private controls excluded from public
// counts -- plus the extra fixtures this goal-run's Phase B specifically asks for.
// ---------------------------------------------------------------------------

test('a duplicate capture is one post with two observations, not two posts (repeated snapshots)', () => {
  const r = run([
    record({ captured_at: '2026-08-20T00:00:00Z', metrics: { likes: 40, comments: 2, reposts: 0, impressions: null } }),
    record({ captured_at: '2026-08-27T00:00:00Z', metrics: { likes: 61, comments: 3, reposts: 1, impressions: null } }),
  ]);
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].observations.length, 2);
  assert.deepEqual(r.posts[0].observations.map((o) => o.metrics.likes), [40, 61]);
  // publication identity is fixed by the first capture and never moved by a later one
  assert.equal(r.posts[0].source_dates.published_at, '2026-08-01T00:00:00.000Z');
});

test('identical public text alone does not merge two genuinely distinct posts', () => {
  const r = run([
    record({ canonical_source_id: 'urn:li:activity:1', source_url: 'https://x/1', text: 'the same words' }),
    record({ canonical_source_id: 'urn:li:activity:2', source_url: 'https://x/2', text: 'the same words', author_id: 'author-b' }),
  ]);
  assert.equal(r.posts.length, 2);
  assert.deepEqual(r.posts.map((p) => p.canonical_source_id).sort(), ['urn:li:activity:1', 'urn:li:activity:2']);
});

test('private own-control posts are excluded from the public population, with a reason', () => {
  const r = run([
    record(),
    record({ canonical_source_id: 'ctl-1', source_url: 'https://x/c1', author_id: 'mattan', is_own_control: true }),
    record({ canonical_source_id: 'ctl-2', source_url: 'https://x/c2', author_id: 'chad-davis', is_own_control: true }),
  ]);
  assert.equal(r.posts.length, 1);
  assert.deepEqual(r.posts.map((p) => p.canonical_source_id), ['urn:li:activity:1']);
  const reasons = Object.fromEntries(r.excluded.map((e) => [e.canonical_source_id, e.reason]));
  assert.equal(reasons['ctl-1'], 'own_control');
  assert.equal(reasons['ctl-2'], 'own_control');
});

test('reshares and selftest rows are excluded with reasons, never silently merged', () => {
  const r = run([
    record(),
    record({ canonical_source_id: 'a2', source_url: 'https://x/2', is_reshare: true }),
    record({ canonical_source_id: 'a3', source_url: 'https://x/3', is_selftest: true }),
  ]);
  assert.equal(r.posts.length, 1);
  const reasons = Object.fromEntries(r.excluded.map((e) => [e.canonical_source_id, e.reason]));
  assert.equal(reasons.a2, 'reshare');
  assert.equal(reasons.a3, 'selftest');
});

test('a future observation (captured after the cutoff) is excluded, not silently included', () => {
  const r = run([
    record(),
    record({ canonical_source_id: 'a2', source_url: 'https://x/2', captured_at: '2026-09-15T00:00:00Z' }),
  ]);
  assert.equal(r.posts.length, 1);
  const excludedIds = r.excluded.map((e) => e.canonical_source_id);
  assert.ok(excludedIds.includes('a2'));
  assert.equal(r.excluded.find((e) => e.canonical_source_id === 'a2').reason, 'observation_after_cutoff');
});

test('a duplicate source URL under a different declared canonical id is excluded, not merged', () => {
  const r = run([
    record(),
    record({ canonical_source_id: 'a5', source_url: record().source_url }),
  ]);
  assert.equal(r.posts.length, 1);
  assert.equal(r.excluded.find((e) => e.canonical_source_id === 'a5').reason, 'duplicate_source_url');
});

test('a blank canonical id is excluded as missing_canonical_id, never silently dropped without a reason', () => {
  const r = run([record(), record({ canonical_source_id: '', source_url: 'https://x/6' })]);
  assert.equal(r.posts.length, 1);
  const missing = r.excluded.find((e) => e.canonical_source_id === '');
  assert.ok(missing);
  assert.equal(missing.reason, 'missing_canonical_id');
});

test('the same post id under two different client_ids refuses the foreign one, atomically', () => {
  assert.throws(() => run([
    record(),
    record({ canonical_source_id: 'urn:li:activity:1', client_id: 'arch' }),
  ]), /tenant/i);
});

test('missing reposts stays null, a real zero reposts stays 0 -- never coerced into each other', () => {
  const r = run([
    record({ metrics: { likes: 40, comments: 2, reposts: null, impressions: null } }),
    record({ canonical_source_id: 'a2', source_url: 'https://x/2', metrics: { likes: 40, comments: 2, reposts: 0, impressions: null } }),
  ]);
  const byId = Object.fromEntries(r.posts.map((p) => [p.canonical_source_id, p]));
  assert.equal(byId['urn:li:activity:1'].observations[0].metrics.reposts, null);
  assert.equal(byId.a2.observations[0].metrics.reposts, 0);
});

test('a real zero-performance post (0 likes) is retained, not treated as missing', () => {
  const r = run([record({ metrics: { likes: 0, comments: 0, reposts: 0, impressions: null } })]);
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].observations[0].metrics.likes, 0);
});

test('an identity conflict is flagged when the same canonical id later carries a different author', () => {
  const r = run([
    record(),
    record({ author_id: 'author-DIFFERENT' }), // same canonical_source_id, same client, contradicts author_id
  ]);
  assert.equal(r.posts.length, 1); // still one post identity by canonical id
  assert.ok(r.identityConflicts.length >= 1);
  assert.equal(r.identityConflicts[0].canonical_source_id, 'urn:li:activity:1');
  assert.equal(r.identityConflicts[0].field, 'author_id');
});

test('reimporting the identical snapshot is idempotent: same input twice gives the same post set', () => {
  const records = [record(), record({ canonical_source_id: 'urn:li:activity:2', source_url: 'https://x/2' })];
  const a = run(records);
  const b = run([...records].reverse());
  assert.deepEqual(a.posts.map((p) => p.canonical_source_id).sort(), b.posts.map((p) => p.canonical_source_id).sort());
  assert.equal(a.posts.length, b.posts.length);
});

test('a malformed manifest is refused before any record is read', () => {
  assert.throws(() => normalizeStudy({ clientId: 'risedtc', studyId: 's1', manifest: { not: 'a manifest' }, records: [] }),
    (err) => err.name === 'EvidenceValidationError');
});

test('the manifest is returned unchanged for lineage', () => {
  const m = manifest();
  const r = run([record()], { manifest: m });
  assert.equal(r.manifest, m);
});
