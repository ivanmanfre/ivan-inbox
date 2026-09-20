// content-evidence (staged, Run-3-ready) / patterns.mjs
//
// comparePatterns: within-author "does this post carry pattern P" vs "does it carry some other,
// already-known pattern value" comparison on one already-computed same-metric `value` (a caller's
// engagement score, e.g. methods.mjs's score -- this module never recomputes engagement itself and
// never reads a store).
//
// This file is STAGED under OUT only, for Run 3 to integrate. It is deliberately self-contained
// (no import from any repaired/production module) so it can be copied wholesale without dragging a
// hidden dependency graph behind it. Where its vocabulary overlaps contracts.mjs from the repaired
// worktree (limitations, validation_state, finding shape), the overlap is by convention, not by
// import -- Run 3 is expected to reconcile the two when it integrates this package.
//
// Five rules govern the arithmetic below, straight from the spec's Pattern evidence section:
//
//   1. Comparisons are WITHIN one author. A pattern's apparent effect is computed per author and
//      reported per author; this module NEVER pools raw values across authors into one number,
//      because a pooled average can show an effect that is entirely an artifact of which author
//      happens to use the pattern more (see the "disappears within authors" test below). The one
//      cross-author summary this module does produce is the MEDIAN of the per-author effects --
//      never a pooled mean of raw values -- and it accompanies, never replaces, the per-author list.
//   2. A pattern occurring often among winners may also be common across everything an author
//      publishes, so prevalence is always reported two ways side by side: among ALL eligible
//      (known-labeled) posts, and among posts flagged `role: 'winner'`.
//   3. A post whose label is the literal string 'unknown', or that carries no label row at all, is
//      excluded from BOTH the pattern numerator and the comparator denominator for every candidate
//      pattern -- and the exclusion is counted, never silently dropped.
//   4. A chronological discovery/holdout split is enforced structurally: the same post id may never
//      appear in both halves (a leak across a chronological split invalidates the whole holdout),
//      and a partition whose `exposure` is explicitly `'retrospective'` can never be reported as a
//      blind test, however clean its holdout looks.
//   5. A cross-author finding needs at least `policy.minimumAuthors` authors that INDEPENDENTLY
//      clear `policy.minimumPatternPerAuthor` and `policy.minimumComparatorPerAuthor`. Below that,
//      the pattern is `insufficient`, with raw counts and example ids preserved rather than
//      discarded, so a reviewer can still see what was found without a caller mistaking it for a
//      validated claim.

const ROLES = Object.freeze(['winner', 'ordinary', 'weak']);
const UNKNOWN_LABEL = 'unknown';

export const METHOD_VERSION = 'content-evidence-patterns-v1';

export const DEFAULT_POLICY = Object.freeze({
  minimumPatternPerAuthor: 5,
  minimumComparatorPerAuthor: 5,
  minimumAuthors: 3,
});

/** Named, stable-coded failure. `.code` is the contract; `.message` is for humans. */
export class PatternsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PatternsError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new PatternsError(code, message, details); };

// ---------------------------------------------------------------------------
// comparePatterns
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {object[]} args.posts     flat rows: { client_id, author_id, post_id, value, role? }
 * @param {object[]} args.labels    { post_id, pattern, label_version, client_id? } one row per post
 *                                  per labeling dimension this call is testing. `pattern` may be
 *                                  the literal string 'unknown' when the body/media was unavailable.
 * @param {object} args.partition   { discovery: string[], holdout: string[], exposure?: 'retrospective'|'prospective', holdout_untouched?: boolean }
 * @param {object} [args.policy]    { minimumPatternPerAuthor, minimumComparatorPerAuthor, minimumAuthors }
 * @returns {{ findings: object[], insufficient: object[], sensitivity: object[], holdoutStatus: string }}
 */
export function comparePatterns({ posts, labels, partition, policy = DEFAULT_POLICY } = {}) {
  validatePosts(posts);
  validateLabels(labels);
  validatePartition(partition);
  const pol = validatePolicy(policy);

  const clientId = resolveTenant(posts, labels);

  // Structural leak check: a post id in both halves of the chronological split invalidates the
  // whole holdout, so this throws rather than silently preferring one half.
  const discoverySet = new Set(partition.discovery);
  const holdoutSet = new Set(partition.holdout);
  const leaked = [...discoverySet].filter((id) => holdoutSet.has(id));
  if (leaked.length > 0) {
    fail('PATTERNS_SPLIT_LEAK',
      `post id(s) present in both discovery and holdout: ${leaked.join(', ')}`, { leaked });
  }

  const postById = new Map(posts.map((p) => [p.post_id, p]));
  const holdoutStatus = resolveHoldoutStatus(partition, postById);
  const labelByPost = buildLabelIndex(labels);

  // Only discovery posts ever produce a candidate pattern or a finding -- the plan's own rule:
  // "Lock the chronological discovery/holdout partition before selecting candidate patterns."
  const discoveryKnown = []; // { post, pattern }
  let unknownLabelCount = 0;
  let unlabeledCount = 0;
  for (const postId of discoverySet) {
    const post = postById.get(postId);
    if (post === undefined) continue; // a partitioned id with no matching post row is not this module's evidence
    const label = labelByPost.get(postId);
    if (label === undefined) { unlabeledCount += 1; continue; }
    if (label.pattern === UNKNOWN_LABEL) { unknownLabelCount += 1; continue; }
    discoveryKnown.push({ post, pattern: label.pattern });
  }

  const candidatePatterns = [...new Set(discoveryKnown.map((d) => d.pattern))].sort();

  // ONE shared author -> known-posts index, covering every candidate pattern. For a given
  // candidate pattern P, evaluateAuthors() below does its own P vs not-P split against this same
  // full known population -- a post labeled 'Q' is P's comparator population, not excluded from it.
  const byAuthorKnownAll = new Map(); // author_id -> [{ post_id, value, role, pattern }]
  for (const { post, pattern } of discoveryKnown) {
    if (!byAuthorKnownAll.has(post.author_id)) byAuthorKnownAll.set(post.author_id, []);
    byAuthorKnownAll.get(post.author_id).push({ ...post, pattern });
  }

  const findings = [];
  const insufficient = [];
  const sensitivity = [];

  for (const pattern of candidatePatterns) {
    const evaluation = evaluateAuthors(pattern, byAuthorKnownAll, pol);
    const totalPatternN = sumBy(evaluation.perAuthor, (a) => a.patternPosts.length);
    const totalComparatorN = sumBy(evaluation.perAuthor, (a) => a.comparatorPosts.length);
    const prevalence = computePrevalence(pattern, discoveryKnown, unknownLabelCount, unlabeledCount);
    const exampleSourceIds = evaluation.perAuthor
      .flatMap((a) => a.patternPosts.map((p) => p.post_id))
      .sort()
      .slice(0, 5);

    if (totalComparatorN === 0) {
      insufficient.push({
        pattern, reason: 'missing_comparator_population',
        pattern_n_total: totalPatternN, comparator_n_total: 0,
        authors_examined: evaluation.perAuthor.length, qualifying_authors: 0,
        example_source_ids: exampleSourceIds, prevalence,
      });
      continue;
    }
    if (totalPatternN === 0) {
      insufficient.push({
        pattern, reason: 'missing_pattern_population',
        pattern_n_total: 0, comparator_n_total: totalComparatorN,
        authors_examined: evaluation.perAuthor.length, qualifying_authors: 0,
        example_source_ids: exampleSourceIds, prevalence,
      });
      continue;
    }
    if (evaluation.qualifying.length === 0) {
      insufficient.push({
        pattern, reason: 'no_qualifying_authors',
        pattern_n_total: totalPatternN, comparator_n_total: totalComparatorN,
        authors_examined: evaluation.perAuthor.length, qualifying_authors: 0,
        example_source_ids: exampleSourceIds, prevalence,
      });
      continue;
    }
    if (evaluation.qualifying.length < pol.minimumAuthors) {
      insufficient.push({
        pattern, reason: 'below_minimum_authors',
        pattern_n_total: totalPatternN, comparator_n_total: totalComparatorN,
        authors_examined: evaluation.perAuthor.length, qualifying_authors: evaluation.qualifying.length,
        example_source_ids: exampleSourceIds, prevalence,
      });
      continue;
    }

    const finding = buildFinding({ clientId, pattern, qualifying: evaluation.qualifying, holdoutStatus, prevalence });
    findings.push(finding);
    sensitivity.push(buildSensitivity({ pattern, findingId: finding.finding_id, evaluation, pol }));
  }

  findings.sort((a, b) => a.pattern.localeCompare(b.pattern));
  insufficient.sort((a, b) => a.pattern.localeCompare(b.pattern));
  sensitivity.sort((a, b) => a.pattern.localeCompare(b.pattern));

  return { findings, insufficient, sensitivity, holdoutStatus };
}

// ---------------------------------------------------------------------------
// Per-author evaluation (reused by the main pass and by both sensitivity checks)
// ---------------------------------------------------------------------------

function evaluateAuthors(pattern, byAuthorKnown, policy) {
  const perAuthor = [];
  for (const [authorId, knownPosts] of byAuthorKnown) {
    const patternPosts = knownPosts.filter((p) => p.pattern === pattern);
    const comparatorPosts = knownPosts.filter((p) => p.pattern !== pattern);
    perAuthor.push({ authorId, patternPosts, comparatorPosts });
  }
  perAuthor.sort((a, b) => a.authorId.localeCompare(b.authorId));
  const qualifying = perAuthor.filter((a) =>
    a.patternPosts.length >= policy.minimumPatternPerAuthor
    && a.comparatorPosts.length >= policy.minimumComparatorPerAuthor);
  return { perAuthor, qualifying };
}

function buildFinding({ clientId, pattern, qualifying, holdoutStatus, prevalence }) {
  const perAuthorResults = qualifying.map((a) => authorResult(a));
  const summaryEffectMedian = median(perAuthorResults.map((r) => r.effect));
  const sourceIds = qualifying.flatMap((a) => a.patternPosts.map((p) => p.post_id)).sort();
  const comparatorIds = qualifying.flatMap((a) => a.comparatorPosts.map((p) => p.post_id)).sort();

  return {
    client_id: clientId,
    kind: 'pattern',
    pattern,
    finding_id: `${clientId}:pattern:${pattern}`,
    method_version: METHOD_VERSION,
    source_ids: sourceIds,
    comparator_ids: comparatorIds,
    comparator_n: comparatorIds.length,
    per_author_results: perAuthorResults,
    // A median of per-author effects, never a pooled mean of raw values across authors -- see the
    // module docstring, rule 1. This is the one number this module will show across authors, and it
    // is not a "universal ranking" of the pattern against anything else.
    summary_effect_median: summaryEffectMedian,
    prevalence,
    holdout_status: holdoutStatus,
    validation_state: 'computed',
    limitations: [
      'descriptive, not causal: within-author recurrence is not proof the pattern caused the outcome',
      'per-author results are reported separately and never pooled into one universal ranking across authors',
      'a pattern common among winners may also be common across everything the author publishes; see prevalence.all_eligible_rate',
      holdoutStatus === 'retrospective'
        ? 'retrospective: this data already informed the hypothesis; treat as descriptive until a genuinely untouched extension is held out'
        : holdoutStatus === 'unavailable'
          ? 'no untouched holdout was available to validate this pattern going forward'
          : 'holdout is untouched (blind) but has not yet been checked against a future publication',
    ],
  };
}

function authorResult(a) {
  const patternValues = a.patternPosts.map((p) => p.value);
  const comparatorValues = a.comparatorPosts.map((p) => p.value);
  const patternMean = mean(patternValues);
  const comparatorMean = mean(comparatorValues);
  return {
    author_id: a.authorId,
    pattern_n: a.patternPosts.length,
    comparator_n: a.comparatorPosts.length,
    pattern_mean: patternMean,
    comparator_mean: comparatorMean,
    effect: patternMean - comparatorMean,
  };
}

// ---------------------------------------------------------------------------
// Sensitivity: leave-largest-author-out, leave-largest-post-out
// ---------------------------------------------------------------------------

function buildSensitivity({ pattern, findingId, evaluation, pol }) {
  return {
    pattern,
    finding_id: findingId,
    leave_largest_author_out: leaveLargestAuthorOut(evaluation, pol),
    leave_largest_post_out: leaveLargestPostOut(evaluation, pol),
  };
}

function leaveLargestAuthorOut(evaluation, pol) {
  const ranked = [...evaluation.qualifying].sort((a, b) => {
    const sizeA = a.patternPosts.length + a.comparatorPosts.length;
    const sizeB = b.patternPosts.length + b.comparatorPosts.length;
    return sizeB - sizeA || a.authorId.localeCompare(b.authorId);
  });
  const largest = ranked[0];
  const remaining = evaluation.qualifying.filter((a) => a.authorId !== largest.authorId);
  const survives = remaining.length >= pol.minimumAuthors;
  return {
    excluded_author_id: largest.authorId,
    remaining_qualifying_authors: remaining.length,
    survives,
    effect_median_after: survives ? median(remaining.map((a) => authorResult(a).effect)) : null,
  };
}

function leaveLargestPostOut(evaluation, pol) {
  // The single most extreme pattern-group value across all qualifying authors -- the one data
  // point most capable of manufacturing an apparent effect on its own.
  let extreme = null;
  for (const a of evaluation.qualifying) {
    for (const p of a.patternPosts) {
      if (extreme === null || p.value > extreme.value
          || (p.value === extreme.value && p.post_id.localeCompare(extreme.post_id) < 0)) {
        extreme = { ...p, authorId: a.authorId };
      }
    }
  }
  if (extreme === null) {
    return { excluded_post_id: null, excluded_author_id: null, remaining_qualifying_authors: evaluation.qualifying.length, survives: true, effect_median_after: null };
  }
  const adjusted = evaluation.qualifying.map((a) => {
    if (a.authorId !== extreme.authorId) return a;
    return { ...a, patternPosts: a.patternPosts.filter((p) => p.post_id !== extreme.post_id) };
  });
  const stillQualifying = adjusted.filter((a) =>
    a.patternPosts.length >= pol.minimumPatternPerAuthor
    && a.comparatorPosts.length >= pol.minimumComparatorPerAuthor);
  const survives = stillQualifying.length >= pol.minimumAuthors;
  return {
    excluded_post_id: extreme.post_id,
    excluded_author_id: extreme.authorId,
    remaining_qualifying_authors: stillQualifying.length,
    survives,
    effect_median_after: survives ? median(stillQualifying.map((a) => authorResult(a).effect)) : null,
  };
}

// ---------------------------------------------------------------------------
// Prevalence
// ---------------------------------------------------------------------------

function computePrevalence(pattern, discoveryKnown, unknownLabelCount, unlabeledCount) {
  const total = discoveryKnown.length;
  const patternCount = discoveryKnown.filter((d) => d.pattern === pattern).length;
  const winners = discoveryKnown.filter((d) => (d.post.role ?? 'ordinary') === 'winner');
  const winnersPatternCount = winners.filter((d) => d.pattern === pattern).length;
  return {
    pattern,
    all_eligible_known_n: total,
    all_eligible_pattern_n: patternCount,
    all_eligible_rate: total > 0 ? patternCount / total : null,
    winners_known_n: winners.length,
    winners_pattern_n: winnersPatternCount,
    winners_rate: winners.length > 0 ? winnersPatternCount / winners.length : null,
    unknown_label_excluded_n: unknownLabelCount,
    unlabeled_excluded_n: unlabeledCount,
  };
}

// ---------------------------------------------------------------------------
// Holdout status
// ---------------------------------------------------------------------------

function resolveHoldoutStatus(partition, postById) {
  // A partition marked retrospective (this data already informed the hypothesis) can never be
  // reported as a blind test, whatever its holdout array looks like.
  if (partition.exposure === 'retrospective') return 'retrospective';
  if (!Array.isArray(partition.holdout) || partition.holdout.length === 0) return 'unavailable';
  // Blind is an affirmative claim: it requires a prospective declaration and an explicit
  // attestation that the holdout was untouched. Missing provenance is unavailable, not blind.
  if (partition.exposure !== 'prospective' || partition.holdout_untouched !== true) return 'unavailable';

  const latestDiscoveryByAuthor = new Map();
  for (const id of partition.discovery) {
    const post = postById.get(id);
    const ms = post ? Date.parse(post.published_at ?? '') : NaN;
    if (!post || Number.isNaN(ms)) return 'unavailable';
    latestDiscoveryByAuthor.set(post.author_id, Math.max(latestDiscoveryByAuthor.get(post.author_id) ?? -Infinity, ms));
  }
  for (const id of partition.holdout) {
    const post = postById.get(id);
    const holdoutMs = post ? Date.parse(post.published_at ?? '') : NaN;
    const discoveryMs = post ? latestDiscoveryByAuthor.get(post.author_id) : undefined;
    if (!post || Number.isNaN(holdoutMs) || discoveryMs === undefined || holdoutMs <= discoveryMs) return 'unavailable';
  }
  return 'blind';
}

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

function resolveTenant(posts, labels) {
  const first = posts[0].client_id;
  for (const p of posts) {
    if (p.client_id !== first) {
      fail('PATTERNS_TENANT_MISMATCH',
        `post ${JSON.stringify(p.post_id)} carries client_id ${JSON.stringify(p.client_id)} but the population's tenant is ${JSON.stringify(first)}`);
    }
  }
  for (const l of labels) {
    if (l.client_id !== undefined && l.client_id !== null && l.client_id !== first) {
      fail('PATTERNS_TENANT_MISMATCH',
        `label for post ${JSON.stringify(l.post_id)} carries client_id ${JSON.stringify(l.client_id)} but the population's tenant is ${JSON.stringify(first)}`);
    }
  }
  return first;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePosts(posts) {
  if (!Array.isArray(posts) || posts.length === 0) {
    fail('PATTERNS_BAD_POSTS', 'posts must be a non-empty array');
  }
  const seen = new Set();
  for (const p of posts) {
    if (!isObject(p)) fail('PATTERNS_BAD_POSTS', 'every post must be an object');
    if (typeof p.client_id !== 'string' || p.client_id.trim() === '') {
      fail('PATTERNS_BAD_POSTS', 'every post needs a non-empty client_id; there is no default tenant');
    }
    if (typeof p.author_id !== 'string' || p.author_id.trim() === '') {
      fail('PATTERNS_BAD_POSTS', `post ${JSON.stringify(p.post_id)} needs a non-empty author_id`);
    }
    if (typeof p.post_id !== 'string' || p.post_id.trim() === '') {
      fail('PATTERNS_BAD_POSTS', 'every post needs a non-empty post_id');
    }
    if (seen.has(p.post_id)) {
      fail('PATTERNS_DUPLICATE_POST', `post_id ${JSON.stringify(p.post_id)} appears more than once in posts`);
    }
    seen.add(p.post_id);
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) {
      fail('PATTERNS_BAD_POSTS', `post ${JSON.stringify(p.post_id)} needs a finite numeric value`);
    }
    if (p.role !== undefined && !ROLES.includes(p.role)) {
      fail('PATTERNS_BAD_POSTS', `post ${JSON.stringify(p.post_id)} has an invalid role ${JSON.stringify(p.role)}; expected one of ${ROLES.join(', ')}`);
    }
  }
}

function validateLabels(labels) {
  if (!Array.isArray(labels)) fail('PATTERNS_BAD_LABELS', 'labels must be an array');
  for (const l of labels) {
    if (!isObject(l)) fail('PATTERNS_BAD_LABELS', 'every label must be an object');
    if (typeof l.post_id !== 'string' || l.post_id.trim() === '') {
      fail('PATTERNS_BAD_LABELS', 'every label needs a non-empty post_id');
    }
    if (typeof l.pattern !== 'string' || l.pattern.trim() === '') {
      fail('PATTERNS_BAD_LABELS', `label for post ${JSON.stringify(l.post_id)} needs a non-empty pattern`);
    }
    if (typeof l.label_version !== 'string' || l.label_version.trim() === '') {
      fail('PATTERNS_BAD_LABELS', `label for post ${JSON.stringify(l.post_id)} needs a label_version`);
    }
  }
}

function buildLabelIndex(labels) {
  const map = new Map();
  for (const l of labels) {
    const existing = map.get(l.post_id);
    if (existing !== undefined && existing.pattern !== l.pattern) {
      fail('PATTERNS_LABEL_CONFLICT',
        `post ${JSON.stringify(l.post_id)} has conflicting labels: ${JSON.stringify(existing.pattern)} vs ${JSON.stringify(l.pattern)}`);
    }
    map.set(l.post_id, l);
  }
  return map;
}

function validatePartition(partition) {
  if (!isObject(partition)) fail('PATTERNS_BAD_PARTITION', 'partition must be an object');
  if (!Array.isArray(partition.discovery)) fail('PATTERNS_BAD_PARTITION', 'partition.discovery must be an array of post ids');
  if (!Array.isArray(partition.holdout)) fail('PATTERNS_BAD_PARTITION', 'partition.holdout must be an array of post ids');
  if (partition.exposure !== undefined && typeof partition.exposure !== 'string') {
    fail('PATTERNS_BAD_PARTITION', 'partition.exposure, when present, must be a string');
  }
  if (partition.holdout_untouched !== undefined && typeof partition.holdout_untouched !== 'boolean') {
    fail('PATTERNS_BAD_PARTITION', 'partition.holdout_untouched, when present, must be a boolean');
  }
}

function validatePolicy(policy) {
  if (!isObject(policy)) fail('PATTERNS_BAD_POLICY', 'policy must be an object');
  for (const key of ['minimumPatternPerAuthor', 'minimumComparatorPerAuthor', 'minimumAuthors']) {
    const v = policy[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      fail('PATTERNS_BAD_POLICY', `policy.${key} must be a positive integer, got ${JSON.stringify(v)}`);
    }
  }
  return policy;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function sumBy(arr, fn) { return arr.reduce((s, x) => s + fn(x), 0); }
function mean(nums) { return nums.length === 0 ? null : nums.reduce((s, n) => s + n, 0) / nums.length; }
function median(nums) {
  const clean = nums.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return null;
  const s = [...clean].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
