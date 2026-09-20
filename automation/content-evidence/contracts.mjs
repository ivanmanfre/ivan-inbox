// content-evidence / contracts.mjs
//
// The frozen shapes of the evidence system: what a study manifest must say about itself, what a
// finding must carry before anything may display it, and what a weekly evidence package must
// prove before a selector may use it. Nothing in this file reads a store or computes a metric --
// it only refuses malformed things, loudly and by field name.
//
// Two rules decide most of the code below.
//
//   1. A number without its denominator, formula, dates and method version is not evidence, so
//      those are required fields rather than optional annotations.
//   2. `validated` is a claim about arithmetic, not a workflow step. A manifest may not call
//      itself validated while it still carries an unresolved numerical discrepancy -- that is the
//      exact state the September 19 RISE study is in (147 stored outliers, 153 and 140 reproduced
//      by two quick replays), and the point of the contract is that such a study can be imported
//      and shown as `needs_reconciliation` without ever acquiring a verified badge.
//
// Timestamps are UTC ISO strings. Arrays are stable-sorted before hashing.

import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 1;

/** Named, stable-coded validation failure. `.code` is the contract; `.message` is for humans. */
export class EvidenceValidationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'EvidenceValidationError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new EvidenceValidationError(code, message, details); };

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const MANIFEST_STATES = Object.freeze([
  'imported', 'needs_reconciliation', 'validated', 'stale', 'failed',
]);

export const MANIFEST_REQUIRED_FIELDS = Object.freeze([
  'schema_version', 'client_id', 'study_id', 'study_kind', 'method_version',
  'source_paths', 'publication_window', 'observation_cutoff', 'metric_definitions',
  'roster_version', 'eligibility', 'excluded_counts', 'classifier_versions', 'state',
]);

// Not in the plan's minimum list, so a manifest in any non-validated state may omit it and it
// defaults to "none recorded". It becomes REQUIRED the moment a manifest claims `validated`:
// silence is not evidence that the arithmetic reconciled.
export const MANIFEST_DISCREPANCY_FIELD = 'unresolved_discrepancies';

export const STUDY_KINDS = Object.freeze(['market', 'own', 'pattern', 'audience']);

export const FINDING_KINDS = Object.freeze(['market', 'pattern', 'audience', 'own_result']);

export const FINDING_VALIDATION_STATES = Object.freeze([
  'computed', 'needs_reconciliation', 'validated', 'withheld', 'failed',
]);

export const AGE_COMPARABILITY = Object.freeze(['comparable', 'age_unmatched', 'unknown']);

export const FINDING_REQUIRED_FIELDS = Object.freeze([
  'client_id', 'study_id', 'finding_id', 'kind', 'source_ids', 'metric_id',
  'observed_value', 'baseline_value', 'baseline_n', 'formula', 'method_version',
  'source_dates', 'capture_dates', 'age_comparability', 'limitations', 'validation_state',
]);

// A market finding is a multiple of an author's own baseline, so it carries that multiple.
export const MARKET_FINDING_REQUIRED_FIELDS = Object.freeze(['lift']);

// A pattern claim is a comparison, so it carries what it was compared against and how the
// comparison came out author by author -- a pattern common among winners may be common among
// everything that author publishes.
export const PATTERN_FINDING_REQUIRED_FIELDS = Object.freeze([
  'comparator_ids', 'comparator_n', 'per_author_results',
]);

// An audience claim is a sample, so it carries how the sample was drawn, how big it was, how much
// of it is unknown, what the class means and which classifier version said so.
export const AUDIENCE_FINDING_REQUIRED_FIELDS = Object.freeze([
  'sample_method', 'sample_size', 'unknown_count', 'class_definition', 'classifier_version',
]);

export const EVIDENCE_PACKAGE_REQUIRED_FIELDS = Object.freeze([
  'schema_version', 'client_id', 'week_start', 'objective', 'source_finding_ids',
  'source_posts', 'client_fact_refs', 'proposed_angle', 'format', 'structural_features',
  'adaptation_history', 'test_metric', 'comparison_rule', 'observation_window',
  'needs_material', 'limitations',
]);

// `recommendation_id` or `draft_key`: one of the two identifies the decision this package backs.
export const EVIDENCE_PACKAGE_IDENTITY_FIELDS = Object.freeze(['recommendation_id', 'draft_key']);

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

// The screening knobs, in one object with a version id, so a stored finding can name the exact
// settings that produced it. These are the study's inherited intent, NOT validated optima --
// sensitivity to window and thresholds is tested later, and a changed knob is a new policy id.
export const DEFAULT_POLICY = Object.freeze({
  id: 'public-weighted-v1',
  windowDays: 365,
  minimumN: 20,
  repostWeight: 3,
  minimumLift: 4,
  minimumLikes: 40,
});

export function validatePolicy(policy) {
  if (!isObject(policy)) fail('POLICY_INVALID', 'policy must be an object');
  if (typeof policy.id !== 'string' || policy.id.trim() === '') {
    fail('POLICY_INVALID', 'policy.id must be a non-empty string');
  }
  for (const key of ['windowDays', 'minimumN', 'repostWeight', 'minimumLift', 'minimumLikes']) {
    const v = policy[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      fail('POLICY_INVALID', `policy.${key} must be a finite number >= 0, got ${JSON.stringify(v)}`);
    }
  }
  return policy;
}

// ---------------------------------------------------------------------------
// Lift
// ---------------------------------------------------------------------------

/**
 * Lift: how many times the author's own baseline this post scored, on the SAME metric.
 *
 *   lift = observed_value / baseline_value
 *
 * A zero or missing baseline gives no finite multiplier, so it returns null rather than Infinity
 * -- an author with no measurable baseline stays inspectable and unranked. A genuine zero
 * observation over a positive baseline is a real 0, not a gap.
 */
export function computeLift(observedValue, baselineValue) {
  if (!isFiniteNumber(observedValue) || !isFiniteNumber(baselineValue)) return null;
  if (baselineValue <= 0) return null;
  return observedValue / baselineValue;
}

// ---------------------------------------------------------------------------
// Canonical sort + hashing
// ---------------------------------------------------------------------------

/** Recursively: object keys sorted, Dates to UTC ISO, undefined dropped. Arrays keep their order. */
export function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    fail('HASH_NON_FINITE', `cannot hash a non-finite number: ${value}`);
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Stable content hash of an array: each item canonicalized to JSON, the JSON strings sorted, then
 * hashed as one document. Two captures of the same set in a different order hash identically, so
 * a reimport can be recognised as the same snapshot without depending on row order.
 */
export function hashArray(items) {
  if (!Array.isArray(items)) fail('HASH_NOT_ARRAY', 'hashArray expects an array');
  const lines = items.map((item) => canonicalJson(item)).sort();
  return sha256Hex(lines.join('\n'));
}

/** Content hash of a single object (no sorting question to answer). */
export function hashObject(value) {
  return sha256Hex(canonicalJson(value));
}

/** UTC ISO string, or null. Never invents a date from another date. */
export function utcIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * @param {object} manifest
 * @param {{clientId?: string}} [context] caller's tenant. Supplied, it must match the manifest.
 * @returns {object} the same manifest object, on success.
 * @throws {EvidenceValidationError}
 */
export function validateManifest(manifest, context = {}) {
  if (!isObject(manifest)) fail('MANIFEST_NOT_OBJECT', 'manifest must be an object');

  for (const field of MANIFEST_REQUIRED_FIELDS) {
    if (isMissing(manifest[field])) {
      fail('MANIFEST_MISSING_FIELD', `manifest is missing required field: ${field}`, { field });
    }
  }

  if (manifest.schema_version !== SCHEMA_VERSION) {
    fail('MANIFEST_SCHEMA_VERSION',
      `manifest schema_version must be ${SCHEMA_VERSION}, got ${JSON.stringify(manifest.schema_version)}`);
  }
  if (typeof manifest.client_id !== 'string' || manifest.client_id.trim() === '') {
    fail('MANIFEST_INVALID_FIELD', 'manifest.client_id must be a non-empty string');
  }
  if (typeof manifest.study_id !== 'string' || manifest.study_id.trim() === '') {
    fail('MANIFEST_INVALID_FIELD', 'manifest.study_id must be a non-empty string');
  }
  if (!STUDY_KINDS.includes(manifest.study_kind)) {
    fail('MANIFEST_INVALID_FIELD',
      `manifest.study_kind must be one of ${STUDY_KINDS.join(', ')}, got ${JSON.stringify(manifest.study_kind)}`);
  }
  if (!MANIFEST_STATES.includes(manifest.state)) {
    fail('MANIFEST_INVALID_STATE',
      `manifest.state must be one of ${MANIFEST_STATES.join(', ')}, got ${JSON.stringify(manifest.state)}`);
  }
  if (!Array.isArray(manifest.source_paths) || manifest.source_paths.length === 0) {
    fail('MANIFEST_INVALID_FIELD', 'manifest.source_paths must be a non-empty array');
  }
  for (const [i, sp] of manifest.source_paths.entries()) {
    if (!isObject(sp) || typeof sp.path !== 'string' || !/^[0-9a-f]{64}$/.test(String(sp.sha256))) {
      fail('MANIFEST_INVALID_FIELD',
        `manifest.source_paths[${i}] needs {path, sha256} with a 64-hex sha256`);
    }
  }
  if (!isObject(manifest.publication_window)
      || isMissing(manifest.publication_window.from) || isMissing(manifest.publication_window.to)) {
    fail('MANIFEST_INVALID_FIELD', 'manifest.publication_window needs {from, to}');
  }
  if (utcIso(manifest.observation_cutoff) === null) {
    fail('MANIFEST_INVALID_FIELD', 'manifest.observation_cutoff must be a parseable UTC timestamp');
  }
  if (!isObject(manifest.metric_definitions) || Object.keys(manifest.metric_definitions).length === 0) {
    fail('MANIFEST_INVALID_FIELD', 'manifest.metric_definitions must name at least one metric');
  }
  if (!Array.isArray(manifest.classifier_versions)) {
    fail('MANIFEST_INVALID_FIELD', 'manifest.classifier_versions must be an array (empty is fine)');
  }

  // The discrepancy rule.
  const raw = manifest[MANIFEST_DISCREPANCY_FIELD];
  if (manifest.state === 'validated' && isMissing(raw)) {
    fail('MANIFEST_MISSING_FIELD',
      `a validated manifest must state ${MANIFEST_DISCREPANCY_FIELD} explicitly (use [] when the arithmetic reconciled)`,
      { field: MANIFEST_DISCREPANCY_FIELD });
  }
  const unresolved = countDiscrepancies(raw);
  if (manifest.state === 'validated' && unresolved > 0) {
    fail('MANIFEST_VALIDATED_WITH_DISCREPANCIES',
      `manifest.state is validated while ${unresolved} numerical discrepancy/discrepancies are unresolved; use needs_reconciliation`,
      { unresolved });
  }

  if (context.clientId !== undefined && manifest.client_id !== context.clientId) {
    fail('MANIFEST_TENANT_MISMATCH',
      `manifest belongs to tenant ${JSON.stringify(manifest.client_id)} but the caller context is ${JSON.stringify(context.clientId)}`);
  }

  return manifest;
}

function countDiscrepancies(raw) {
  if (isMissing(raw)) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0) {
      fail('MANIFEST_INVALID_FIELD', `${MANIFEST_DISCREPANCY_FIELD} as a count must be a non-negative integer`);
    }
    return raw;
  }
  fail('MANIFEST_INVALID_FIELD', `${MANIFEST_DISCREPANCY_FIELD} must be an array of discrepancies or a count`);
  return 0; // unreachable
}

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------

export function requiredFieldsForFindingKind(kind) {
  switch (kind) {
    case 'market': return [...FINDING_REQUIRED_FIELDS, ...MARKET_FINDING_REQUIRED_FIELDS];
    case 'pattern': return [...FINDING_REQUIRED_FIELDS, ...PATTERN_FINDING_REQUIRED_FIELDS];
    case 'audience': return [...FINDING_REQUIRED_FIELDS, ...AUDIENCE_FINDING_REQUIRED_FIELDS];
    case 'own_result': return [...FINDING_REQUIRED_FIELDS];
    default: return null;
  }
}

/**
 * @param {object} finding
 * @param {{clientId?: string}} [context]
 * @returns {object} the same finding object, on success.
 */
export function validateFinding(finding, context = {}) {
  if (!isObject(finding)) fail('FINDING_NOT_OBJECT', 'finding must be an object');

  const required = requiredFieldsForFindingKind(finding.kind);
  if (required === null) {
    fail('FINDING_UNKNOWN_KIND',
      `finding.kind must be one of ${FINDING_KINDS.join(', ')}, got ${JSON.stringify(finding.kind)}`);
  }
  for (const field of required) {
    // observed_value / baseline_value may be null (missing stays missing); presence is what is
    // required, so only `undefined` and an absent key count as missing here.
    if (!(field in finding) || finding[field] === undefined) {
      fail('FINDING_MISSING_FIELD', `${finding.kind} finding is missing required field: ${field}`, { field });
    }
  }
  if (!Array.isArray(finding.source_ids) || finding.source_ids.length === 0) {
    fail('FINDING_INVALID_FIELD', 'finding.source_ids must be a non-empty array');
  }
  if (!Array.isArray(finding.limitations)) {
    fail('FINDING_INVALID_FIELD', 'finding.limitations must be an array');
  }
  if (!AGE_COMPARABILITY.includes(finding.age_comparability)) {
    fail('FINDING_INVALID_FIELD',
      `finding.age_comparability must be one of ${AGE_COMPARABILITY.join(', ')}`);
  }
  if (!FINDING_VALIDATION_STATES.includes(finding.validation_state)) {
    fail('FINDING_INVALID_STATE',
      `finding.validation_state must be one of ${FINDING_VALIDATION_STATES.join(', ')}`);
  }
  if (!isObject(finding.source_dates) || !isObject(finding.capture_dates)) {
    fail('FINDING_INVALID_FIELD', 'source_dates and capture_dates are distinct objects and both are required');
  }
  if (context.clientId !== undefined && finding.client_id !== context.clientId) {
    fail('FINDING_TENANT_MISMATCH',
      `finding belongs to tenant ${JSON.stringify(finding.client_id)} but the caller context is ${JSON.stringify(context.clientId)}`);
  }
  return finding;
}

// ---------------------------------------------------------------------------
// Evidence package
// ---------------------------------------------------------------------------

/**
 * @param {object} pkg
 * @param {{clientId?: string, knownFindingIds?: string[], knownSourceIds?: string[]}} [context]
 * @returns {object} the same package object, on success.
 */
export function validateEvidencePackage(pkg, context = {}) {
  if (!isObject(pkg)) fail('PACKAGE_NOT_OBJECT', 'evidence package must be an object');

  for (const field of EVIDENCE_PACKAGE_REQUIRED_FIELDS) {
    if (isMissing(pkg[field])) {
      fail('PACKAGE_MISSING_FIELD', `evidence package is missing required field: ${field}`, { field });
    }
  }
  if (!EVIDENCE_PACKAGE_IDENTITY_FIELDS.some((f) => !isMissing(pkg[f]))) {
    fail('PACKAGE_MISSING_FIELD',
      `evidence package needs one of ${EVIDENCE_PACKAGE_IDENTITY_FIELDS.join(' or ')}`);
  }
  if (pkg.schema_version !== SCHEMA_VERSION) {
    fail('PACKAGE_SCHEMA_VERSION',
      `evidence package schema_version must be ${SCHEMA_VERSION}, got ${JSON.stringify(pkg.schema_version)}`);
  }
  if (context.clientId !== undefined && pkg.client_id !== context.clientId) {
    fail('PACKAGE_TENANT_MISMATCH',
      `evidence package belongs to tenant ${JSON.stringify(pkg.client_id)} but the caller context is ${JSON.stringify(context.clientId)}`);
  }

  // Limitations are the honest part of the package: an empty list is a claim that there are none,
  // which for a descriptive source lift is never true.
  if (!Array.isArray(pkg.limitations)) {
    fail('PACKAGE_MISSING_LIMITATIONS', 'evidence package limitations must be an array');
  }
  const stated = pkg.limitations.filter((l) => typeof l === 'string' ? l.trim() !== '' : isObject(l));
  if (stated.length === 0) {
    fail('PACKAGE_MISSING_LIMITATIONS',
      'evidence package must state at least one limitation; an empty list is not "no limitations"');
  }

  for (const field of ['source_finding_ids', 'source_posts', 'client_fact_refs',
                       'structural_features', 'adaptation_history', 'needs_material']) {
    if (!Array.isArray(pkg[field])) {
      fail('PACKAGE_INVALID_FIELD', `evidence package ${field} must be an array`);
    }
  }
  if (pkg.source_finding_ids.length === 0 && pkg.source_posts.length === 0) {
    fail('PACKAGE_MISSING_REFERENCES',
      'evidence package must reference at least one measured finding or one source post');
  }

  if (Array.isArray(context.knownFindingIds)) {
    const known = new Set(context.knownFindingIds);
    const missing = pkg.source_finding_ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      fail('PACKAGE_UNKNOWN_REFERENCE',
        `evidence package references unknown finding id(s): ${missing.join(', ')}`, { missing });
    }
  }
  if (Array.isArray(context.knownSourceIds)) {
    const known = new Set(context.knownSourceIds);
    const missing = pkg.source_posts.filter((id) => !known.has(id));
    if (missing.length > 0) {
      fail('PACKAGE_UNKNOWN_REFERENCE',
        `evidence package references unknown source post id(s): ${missing.join(', ')}`, { missing });
    }
  }

  return pkg;
}

// ---------------------------------------------------------------------------

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function isMissing(v) { return v === undefined || v === null; }
function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
