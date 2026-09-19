// content-evidence / methods.mjs
//
// computeOutliers: the NEW (versioned) market-outlier metric. Distinct on purpose from the
// legacy RISE study's own reported figure (see OUTPUT/01-reconciliation/methods.json) -- this
// module's method_version never claims to BE the legacy study, only to be comparable to it under
// the same public-weighted formula: score = likes + repostWeight * reposts, baseline = an
// author's own median score over their eligible posts within the policy window, lift =
// score / baseline (contracts.mjs's computeLift: null on a non-positive baseline, never Infinity).
//
// Working unit: ONE OBSERVATION PER ROW (client_id, author_id, post_id, published_at,
// captured_at, likes, reposts, comments, is_reshare), matching the Package 2 acceptance fixture
// verbatim. A post captured more than once contributes its LATEST capture to both the author's
// baseline and its own candidacy -- earlier captures are lineage, not separate evidence.
//
// Three populations never merge: this module only ever seees ONE client's rows per call (the
// caller is responsible for tenant separation, same as normalize.mjs) and only ever scores a
// SOURCE population -- it has no concept of "own performance". Owner: outcomes.mjs, separately.

import { computeLift, hashObject } from './contracts.mjs';

export const METHOD_VERSION = 'content-evidence-methods-v1';

export class MethodsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MethodsError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new MethodsError(code, message, details); };

/**
 * @param {object} args
 * @param {object[]} args.posts   flat observation rows (see module docstring)
 * @param {string} args.cutoff    ISO date/time; observations captured after this are excluded
 * @param {object} args.policy    { id, windowDays, minimumN, repostWeight, minimumLift, minimumLikes }
 * @param {string} [args.studyId] optional; carried onto each finding when given
 * @returns {{ findings: object[], excluded: object[], baselineCoverage: object[], methodVersion: string }}
 */
export function computeOutliers({ posts, cutoff, policy, studyId = null } = {}) {
  if (!Array.isArray(posts)) fail('METHODS_BAD_POSTS', 'posts must be an array');
  if (typeof cutoff !== 'string' || cutoff.trim() === '') fail('METHODS_MISSING_CUTOFF', 'cutoff is required');
  const cutoffMs = Date.parse(cutoff);
  if (Number.isNaN(cutoffMs)) fail('METHODS_BAD_CUTOFF', `cutoff is not a parseable date: ${JSON.stringify(cutoff)}`);
  validatePolicyLoose(policy);

  const windowFloorMs = Number.isFinite(policy.windowDays) ? cutoffMs - policy.windowDays * 86400000 : -Infinity;

  const excluded = [];
  /** @type {Map<string, Map<string, object[]>>} client_id -> author_id -> observation rows kept */
  const eligibleByAuthor = new Map();
  /** @type {Map<string, Map<string, object>>} client_id -> post_id -> latest kept observation (per author scope) */
  const latestByPost = new Map();
  const seenAuthors = new Map(); // client_id -> Set(author_id), so a fully-excluded author still gets a coverage row

  for (const row of posts) {
    if (row === null || typeof row !== 'object') fail('METHODS_BAD_POSTS', 'every post row must be an object');
    const clientId = row.client_id ?? '(none)';
    const postId = row.post_id ?? row.canonical_source_id ?? null;
    const authorId = row.author_id ?? null;

    if (authorId !== null) {
      if (!seenAuthors.has(clientId)) seenAuthors.set(clientId, new Set());
      seenAuthors.get(clientId).add(authorId);
    }

    if (postId === null || authorId === null) {
      excluded.push({ client_id: clientId, post_id: postId, author_id: authorId, reason: 'missing_identity' });
      continue;
    }
    if (row.is_reshare === true) {
      excluded.push({ client_id: clientId, post_id: postId, author_id: authorId, reason: 'reshare' });
      continue;
    }
    const capturedMs = row.captured_at ? Date.parse(row.captured_at) : NaN;
    if (!Number.isNaN(capturedMs) && capturedMs > cutoffMs) {
      excluded.push({ client_id: clientId, post_id: postId, author_id: authorId, reason: 'observation_after_cutoff' });
      continue;
    }
    const publishedMs = row.published_at ? Date.parse(row.published_at) : NaN;
    if (!Number.isNaN(publishedMs) && publishedMs < windowFloorMs) {
      excluded.push({ client_id: clientId, post_id: postId, author_id: authorId, reason: 'outside_window' });
      continue;
    }

    // Duplicated captures of one post: keep only the latest capture per (client, post_id) as the
    // post's contribution to both the baseline and its own candidacy. An earlier, smaller capture
    // never gets a second vote.
    if (!latestByPost.has(clientId)) latestByPost.set(clientId, new Map());
    const postMap = latestByPost.get(clientId);
    const existing = postMap.get(postId);
    const existingCapturedMs = existing ? (existing.captured_at ? Date.parse(existing.captured_at) : -Infinity) : -Infinity;
    const thisCapturedMs = Number.isNaN(capturedMs) ? -Infinity : capturedMs;
    if (existing === undefined || thisCapturedMs >= existingCapturedMs) {
      postMap.set(postId, row);
    }
  }

  // Build eligible-per-author lists from the deduplicated latest-capture-per-post rows.
  for (const [clientId, postMap] of latestByPost) {
    if (!eligibleByAuthor.has(clientId)) eligibleByAuthor.set(clientId, new Map());
    const byAuthor = eligibleByAuthor.get(clientId);
    for (const row of postMap.values()) {
      const authorId = row.author_id;
      if (!byAuthor.has(authorId)) byAuthor.set(authorId, []);
      byAuthor.get(authorId).push(row);
    }
  }

  const repostWeight = policy.repostWeight;
  const minimumLikes = policy.minimumLikes;
  const minimumLift = policy.minimumLift;
  const minimumN = policy.minimumN;
  // baselineFloor: null (default, this module's OWN method) means a zero/low baseline yields NO
  // finite multiplier -- the author is inspectable but unranked. A non-null floor (e.g. 8, when
  // replaying the LEGACY study's recovered policy) raises any baseline below it up to the floor
  // before computing lift, so a near-zero denominator does not manufacture an enormous multiplier.
  // The two policies are never mixed: a caller wanting the legacy figure passes baselineFloor
  // explicitly and gets method_version-tagged findings that say so (see policy.id).
  const baselineFloor = policy.baselineFloor ?? null;

  const findings = [];
  const baselineCoverage = [];

  for (const [clientId, authorIds] of seenAuthors) {
    const byAuthor = eligibleByAuthor.get(clientId) ?? new Map();
    for (const authorId of authorIds) {
      const rows = byAuthor.get(authorId) ?? []; // an author every one of whose rows was excluded still gets a coverage row (0 eligible)
      const scores = rows.map((r) => score(r, repostWeight));
      const baselineValue = median(scores);
      const effectiveBaselineValue = baselineValue === null
        ? null
        : baselineFloor === null ? baselineValue : Math.max(baselineValue, baselineFloor);
      const n = rows.length;
      const ranked = effectiveBaselineValue !== null && effectiveBaselineValue > 0 && n >= minimumN;

      baselineCoverage.push({
        client_id: clientId,
        author_id: authorId,
        n,
        baseline_value: baselineValue,
        baseline_floor: baselineFloor,
        effective_baseline_value: effectiveBaselineValue,
        ranked,
        below_minimum_n: n < minimumN,
      });

      if (!ranked) continue; // zero/null baseline (no floor) or below minimumN: inspectable, not ranked

      for (const row of rows) {
        const observedValue = score(row, repostWeight);
        const likes = numOrNull(row.likes) ?? 0;
        const lift = computeLift(observedValue, effectiveBaselineValue);
        if (lift === null) continue;
        if (lift < minimumLift) continue;
        if (likes < minimumLikes) continue;

        const findingId = hashObject({ v: METHOD_VERSION, policyId: policy.id, clientId, postId: row.post_id ?? row.canonical_source_id });
        findings.push({
          client_id: clientId,
          study_id: studyId,
          finding_id: findingId,
          kind: 'market',
          source_ids: [row.post_id ?? row.canonical_source_id],
          metric_id: policy.id,
          observed_value: observedValue,
          baseline_value: effectiveBaselineValue,
          baseline_raw_value: baselineValue,
          baseline_floor: baselineFloor,
          baseline_n: n,
          lift,
          formula: `likes + ${repostWeight} * reposts`,
          method_version: METHOD_VERSION,
          source_dates: { published_at: row.published_at ?? null },
          capture_dates: { captured_at: row.captured_at ?? null },
          age_comparability: 'unknown',
          limitations: [
            'descriptive, not causal: a post crossing its author\'s own baseline is not evidence the FORMAT caused the reach',
            'reach approximated via likes + reposts (public impressions are not available)',
          ],
          validation_state: 'computed',
        });
      }
    }
  }

  findings.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0) || String(a.source_ids[0]).localeCompare(String(b.source_ids[0])));

  return {
    findings,
    excluded,
    baselineCoverage,
    methodVersion: METHOD_VERSION,
  };
}

// ---------------------------------------------------------------------------

function score(row, repostWeight) {
  const likes = numOrNull(row.likes) ?? 0;
  const reposts = numOrNull(row.reposts) ?? 0; // a public repost count that was never captured scores as 0, not unknown
  return likes + repostWeight * reposts;
}

function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(nums) {
  const clean = nums.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return null;
  const s = [...clean].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function validatePolicyLoose(policy) {
  if (policy === null || typeof policy !== 'object') fail('METHODS_BAD_POLICY', 'policy must be an object');
  for (const key of ['id']) {
    if (typeof policy[key] !== 'string' || policy[key].trim() === '') {
      fail('METHODS_BAD_POLICY', `policy.${key} must be a non-empty string`);
    }
  }
  for (const key of ['windowDays', 'minimumN', 'repostWeight', 'minimumLift', 'minimumLikes']) {
    if (typeof policy[key] !== 'number' || !Number.isFinite(policy[key]) || policy[key] < 0) {
      fail('METHODS_BAD_POLICY', `policy.${key} must be a finite number >= 0`);
    }
  }
  // baselineFloor is optional. Omitted or null = this module's own policy (no floor: a zero/low
  // baseline yields no finite multiplier). When present it must be a finite number >= 0.
  if (policy.baselineFloor !== undefined && policy.baselineFloor !== null) {
    if (typeof policy.baselineFloor !== 'number' || !Number.isFinite(policy.baselineFloor) || policy.baselineFloor < 0) {
      fail('METHODS_BAD_POLICY', 'policy.baselineFloor must be null/omitted or a finite number >= 0');
    }
  }
}
