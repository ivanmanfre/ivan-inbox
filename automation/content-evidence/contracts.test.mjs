// Contract tests. Synthetic fixtures only: no private corpus text, no reactor identity,
// no client receipt. Every manifest/post here is invented for the test.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  MANIFEST_STATES,
  MANIFEST_REQUIRED_FIELDS,
  FINDING_REQUIRED_FIELDS,
  EVIDENCE_PACKAGE_REQUIRED_FIELDS,
  DEFAULT_POLICY,
  EvidenceValidationError,
  validateManifest,
  validateEvidencePackage,
  validateFinding,
  validatePolicy,
  computeLift,
  canonicalJson,
  hashArray,
  sha256Hex,
} from './contracts.mjs';

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

function marketFinding(over = {}) {
  return {
    client_id: 'risedtc',
    study_id: 's1',
    finding_id: 'f1',
    kind: 'market',
    source_ids: ['p1'],
    metric_id: 'public_weighted',
    observed_value: 80,
    baseline_value: 10,
    baseline_n: 21,
    lift: 8,
    formula: 'likes + 3 * reposts',
    method_version: 'fixture-v1',
    source_dates: { published_at: '2026-08-01T00:00:00Z' },
    capture_dates: { captured_at: '2026-09-01T00:00:00Z' },
    age_comparability: 'age_unmatched',
    limitations: ['descriptive only'],
    validation_state: 'computed',
    ...over,
  };
}

function evidencePackage(over = {}) {
  return {
    schema_version: 1,
    client_id: 'risedtc',
    week_start: '2026-09-21',
    recommendation_id: 'r1',
    objective: 'attention',
    source_finding_ids: ['f1'],
    source_posts: ['p1'],
    client_fact_refs: ['fact:1'],
    proposed_angle: 'a concrete point',
    format: 'text',
    structural_features: ['numbered list'],
    adaptation_history: [],
    test_metric: 'reactions',
    comparison_rule: 'author median, 14 day',
    observation_window: { days: 14 },
    needs_material: [],
    limitations: ['source lift is descriptive'],
    ...over,
  };
}

test('schema version and state vocabulary are exported and frozen', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(MANIFEST_STATES,
    ['imported', 'needs_reconciliation', 'validated', 'stale', 'failed']);
  assert.ok(MANIFEST_REQUIRED_FIELDS.includes('observation_cutoff'));
  assert.ok(FINDING_REQUIRED_FIELDS.includes('age_comparability'));
  assert.ok(EVIDENCE_PACKAGE_REQUIRED_FIELDS.includes('limitations'));
});

test('a valid manifest is returned unchanged', () => {
  const m = manifest();
  assert.equal(validateManifest(m), m);
});

test('a missing required field is rejected by name', () => {
  const m = manifest();
  delete m.roster_version;
  assert.throws(() => validateManifest(m), (err) => {
    assert.ok(err instanceof EvidenceValidationError);
    assert.equal(err.code, 'MANIFEST_MISSING_FIELD');
    assert.match(err.message, /roster_version/);
    return true;
  });
});

test('an unknown state is rejected', () => {
  assert.throws(() => validateManifest(manifest({ state: 'nearly_done' })),
    (err) => err.code === 'MANIFEST_INVALID_STATE' && /nearly_done/.test(err.message));
});

test('validated with an unresolved numerical discrepancy is rejected', () => {
  assert.throws(() => validateManifest(manifest({
    state: 'validated',
    unresolved_discrepancies: [{ metric_id: 'public_weighted', reported: 147, reproduced: 153 }],
  })), (err) => err.code === 'MANIFEST_VALIDATED_WITH_DISCREPANCIES');
});

test('a discrepancy count, not only an array, blocks validated', () => {
  assert.throws(() => validateManifest(manifest({ state: 'validated', unresolved_discrepancies: 6 })),
    (err) => err.code === 'MANIFEST_VALIDATED_WITH_DISCREPANCIES');
});

test('validated must state its discrepancies explicitly, absence is not proof', () => {
  assert.throws(() => validateManifest(manifest({ state: 'validated' })),
    (err) => err.code === 'MANIFEST_MISSING_FIELD' && /unresolved_discrepancies/.test(err.message));
});

test('validated with an empty discrepancy list passes', () => {
  const m = manifest({ state: 'validated', unresolved_discrepancies: [] });
  assert.equal(validateManifest(m), m);
});

test('needs_reconciliation may carry discrepancies', () => {
  const m = manifest({ state: 'needs_reconciliation', unresolved_discrepancies: [{ metric_id: 'x' }] });
  assert.equal(validateManifest(m), m);
});

test('a manifest for another client is rejected under a caller context', () => {
  assert.throws(() => validateManifest(manifest({ client_id: 'arch' }), { clientId: 'risedtc' }),
    (err) => err.code === 'MANIFEST_TENANT_MISMATCH');
});

test('an evidence package for arch is rejected when the caller is risedtc', () => {
  assert.throws(() => validateEvidencePackage(evidencePackage({ client_id: 'arch' }), { clientId: 'risedtc' }),
    (err) => err.code === 'PACKAGE_TENANT_MISMATCH');
});

test('an evidence package without limitations is rejected', () => {
  const pkg = evidencePackage();
  delete pkg.limitations;
  assert.throws(() => validateEvidencePackage(pkg), (err) => err.code === 'PACKAGE_MISSING_FIELD');
});

test('an empty limitations array is not limitations', () => {
  assert.throws(() => validateEvidencePackage(evidencePackage({ limitations: [] })),
    (err) => err.code === 'PACKAGE_MISSING_LIMITATIONS');
});

test('a package referencing an unknown finding is rejected', () => {
  assert.throws(() => validateEvidencePackage(evidencePackage(), { knownFindingIds: ['f9'] }),
    (err) => err.code === 'PACKAGE_UNKNOWN_REFERENCE' && /f1/.test(err.message));
});

test('a package with no source finding and no source post is rejected', () => {
  assert.throws(() => validateEvidencePackage(evidencePackage({ source_finding_ids: [], source_posts: [] })),
    (err) => err.code === 'PACKAGE_MISSING_REFERENCES');
});

test('a package on a foreign schema version is rejected', () => {
  assert.throws(() => validateEvidencePackage(evidencePackage({ schema_version: 2 })),
    (err) => err.code === 'PACKAGE_SCHEMA_VERSION');
});

test('a market finding must carry lift', () => {
  const f = marketFinding();
  delete f.lift;
  assert.throws(() => validateFinding(f), (err) => err.code === 'FINDING_MISSING_FIELD' && /lift/.test(err.message));
});

test('a pattern finding must carry comparators and per-author results', () => {
  assert.throws(() => validateFinding(marketFinding({ kind: 'pattern', lift: undefined })),
    (err) => err.code === 'FINDING_MISSING_FIELD' && /comparator_ids/.test(err.message));
});

test('an audience finding must carry sample method, size, unknowns and classifier version', () => {
  assert.throws(() => validateFinding(marketFinding({ kind: 'audience', lift: undefined })),
    (err) => err.code === 'FINDING_MISSING_FIELD' && /sample_method/.test(err.message));
});

test('an unknown finding kind is rejected', () => {
  assert.throws(() => validateFinding(marketFinding({ kind: 'vibes' })),
    (err) => err.code === 'FINDING_UNKNOWN_KIND');
});

test('lift is undefined for a zero or null baseline, never Infinity', () => {
  assert.equal(computeLift(80, 10), 8);
  assert.equal(computeLift(80, 0), null);
  assert.equal(computeLift(80, null), null);
  assert.equal(computeLift(null, 10), null);
  assert.equal(computeLift(0, 10), 0);
});

test('the policy shape is the six named knobs', () => {
  assert.deepEqual(Object.keys(DEFAULT_POLICY).sort(),
    ['id', 'minimumLift', 'minimumLikes', 'minimumN', 'repostWeight', 'windowDays']);
  assert.equal(validatePolicy(DEFAULT_POLICY), DEFAULT_POLICY);
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, minimumN: -1 }),
    (err) => err.code === 'POLICY_INVALID');
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, id: '' }),
    (err) => err.code === 'POLICY_INVALID');
});

test('canonical json sorts object keys and normalizes timestamps to UTC ISO', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ t: new Date('2026-09-01T00:00:00Z') }), '{"t":"2026-09-01T00:00:00.000Z"}');
});

test('array hashing is stable under reordering and sensitive to content', () => {
  const a = hashArray([{ id: 'p2', n: 1 }, { id: 'p1', n: 2 }]);
  const b = hashArray([{ id: 'p1', n: 2 }, { id: 'p2', n: 1 }]);
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(a, hashArray([{ id: 'p1', n: 3 }, { id: 'p2', n: 1 }]));
  assert.equal(sha256Hex('').length, 64);
});
