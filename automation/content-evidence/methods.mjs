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

import { computeLift, hashObject, validatePolicy } from './contracts.mjs';

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
  checkPolicy(policy);

  const windowFloorMs = Number.isFinite(policy.windowDays) ? cutoffMs - policy.windowDays * 86400000 : -Infinity;

  const excluded = [];
  /** @type {Map<string, Map<string, object[]>>} client_id -> author_id -> observation rows kept */
  const eligibleByAuthor = new Map();
  /** @type {Map<string, Map<string, object>>} client_id -> post_id -> latest kept observation (per author scope) */
  const latestByPost = new Map();
  const seenAuthors = new Map(); // client_id -> Set(author_id), so a fully-excluded author still gets a coverage row
  /** @type {Map<string, Map<string, number>>} client_id -> author_id -> count of unknown-score posts,
   * so an author's coverage row can report how many of their posts were unscoreable without pretending
   * they scored zero. */
  const unknownScoreByAuthor = new Map();

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

  // Build eligible-per-author lists from the deduplicated latest-capture-per-post rows. A post
  // whose score cannot be computed (likes or reposts missing/null) is UNKNOWN, never a manufactured
  // zero: it is excluded here from both the baseline arithmetic and the minimumN count, and counted
  // separately so a coverage row can say how many of an author's posts were unscoreable.
  for (const [clientId, postMap] of latestByPost) {
    if (!eligibleByAuthor.has(clientId)) eligibleByAuthor.set(clientId, new Map());
    const byAuthor = eligibleByAuthor.get(clientId);
    for (const row of postMap.values()) {
      const authorId = row.author_id;
      if (score(row, policy.repostWeight) === null) {
        excluded.push({
          client_id: clientId, post_id: row.post_id ?? row.canonical_source_id ?? null, author_id: authorId,
          reason: 'unknown_metric',
        });
        if (!unknownScoreByAuthor.has(clientId)) unknownScoreByAuthor.set(clientId, new Map());
        const uByAuthor = unknownScoreByAuthor.get(clientId);
        uByAuthor.set(authorId, (uByAuthor.get(authorId) ?? 0) + 1);
        continue;
      }
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
  // explicitly and gets a DISTINCT method_version that says so -- a floored run and an unfloored
  // run must never be grouped under the same method_version, or a downstream consumer grouping by
  // that key (the obvious key, and the one WINNERS.md itself uses to keep the three live baselines
  // apart) would pool floored and unfloored multipliers into one population.
  const baselineFloor = policy.baselineFloor ?? null;
  const effectiveMethodVersion = baselineFloor === null ? METHOD_VERSION : `${METHOD_VERSION}-floor${baselineFloor}`;

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
        unknown_score_n: unknownScoreByAuthor.get(clientId)?.get(authorId) ?? 0,
      });

      if (!ranked) continue; // zero/null baseline (no floor) or below minimumN: inspectable, not ranked

      for (const row of rows) {
        const observedValue = score(row, repostWeight);
        const likes = numOrNull(row.likes) ?? 0;
        const lift = computeLift(observedValue, effectiveBaselineValue);
        if (lift === null) continue;
        if (lift < minimumLift) continue;
        if (likes < minimumLikes) continue;

        const findingId = hashObject({ v: effectiveMethodVersion, policyId: policy.id, clientId, postId: row.post_id ?? row.canonical_source_id });
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
          method_version: effectiveMethodVersion,
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
    methodVersion: effectiveMethodVersion,
  };
}

// ---------------------------------------------------------------------------

// Returns null -- UNKNOWN, never a manufactured 0 -- when either likes or reposts is missing/null.
// A missing public count is not evidence of a zero count; the audit's P1 finding 3 was exactly this
// module treating a never-captured metric as if it had been captured and found empty. There is no
// documented provider-absence flag anywhere in this codebase that would license a true-zero
// substitution (checked: adapters.mjs, contracts.mjs, normalize.mjs carry no such flag today), so
// both missing likes and missing reposts stay unknown rather than defaulting either one to 0.
// A REAL zero (the value 0, explicitly present) is a genuine observation and always scores as 0.
function score(row, repostWeight) {
  const likes = numOrNull(row.likes);
  const reposts = numOrNull(row.reposts);
  if (likes === null || reposts === null) return null;
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

// The frozen policy shape (id, windowDays, minimumN, repostWeight, minimumLift, minimumLikes) is
// contracts.mjs's own -- validatePolicy is imported and called directly rather than restated here,
// so this module and contracts.mjs cannot drift into two different definitions of a valid policy.
// baselineFloor is this module's own EXTRA, optional field (contracts.mjs's policy shape has no
// concept of a floor), so it gets its own check after the shared one.
function checkPolicy(policy) {
  validatePolicy(policy); // throws EvidenceValidationError (code POLICY_INVALID) on the shared shape
  // baselineFloor is optional. Omitted or null = this module's own policy (no floor: a zero/low
  // baseline yields no finite multiplier). When present it must be a finite number >= 0.
  if (policy.baselineFloor !== undefined && policy.baselineFloor !== null) {
    if (typeof policy.baselineFloor !== 'number' || !Number.isFinite(policy.baselineFloor) || policy.baselineFloor < 0) {
      fail('METHODS_BAD_POLICY', 'policy.baselineFloor must be null/omitted or a finite number >= 0');
    }
  }
}
