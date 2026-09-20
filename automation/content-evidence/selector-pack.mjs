// content-evidence / selector-pack.mjs
//
// Turns eligible findings (market outliers, own-result follow-ups) plus permission-checked
// client facts into a bounded, traceable weekly evidence package for the writer -- and refuses
// to let that package commit outside its explicit rollout gate. This module is pure and
// dependency-free on purpose: automation/weekly-topics/writer.js is one n8n Code-node body and
// cannot import anything, so sync-selector.mjs copies this file's functions verbatim into a
// generated region of writer.js. Nothing here reads a store, calls a network, or reads the
// clock -- every input is passed in by the caller, and the same inputs always produce the same
// output, in the same order.
//
// THE PRODUCTION ELIGIBILITY FLOOR (binding -- spec "Weekly selection contract" + D3 in
// $OUT/DECISIONS.md): a finding may become an `evidence_backed` candidate only when
// observed_value > baseline_value, baseline_n >= 20, lift (observed/baseline) >= 4, and --
// only when likes is present at all -- likes >= 40. Unknown likes is a limitation, never an
// invented number, so a finding with likes absent is judged on the other three alone. This is
// the SAME floor for a market finding and a supported own-result finding: "measured" means
// measured, regardless of whose post it was.
//
// WHAT "NEEDS MATERIAL" MEANS (D4): a market finding is someone else's post. Adapting it
// truthfully for this client needs a permission-checked client fact. When none resolves, the
// candidate is still returned -- never silently dropped or padded -- with `needs_material` set
// to a plain reason. An own-result finding is already the client's own publication, so it needs
// no separate permission to be materially truthful about itself.
//
// WHAT NEVER BECOMES A CANDIDATE: a finding with no source_ids (no link back to the outlier
// study), an unrecognized `kind`, a finding whose only referenced client fact is permission
// `denied`, or a bare audience sample_size with none of its required disclosure fields --
// presenting a sample as if it were total reach is exactly the failure mode this module refuses
// to reproduce.

const RECOGNIZED_FINDING_KINDS = new Set(['market', 'market_outlier', 'own_result', 'pattern']);

// D10 (orchestrator, binding, bound-after-Phase-0 fix pass): the pool a 12-wide writer.js
// EVIDENCE_POOL_LIMIT hands the model must not let one prolific author or one tiny-baseline
// outlier own the whole week. Two stated, non-weighted rules, applied while ranking the pool --
// never a synthesized score.
const AUTHOR_POOL_CAP = 2;
const SMALL_BASELINE_THRESHOLD = 8;
const SMALL_BASELINE_LIMITATION = 'Very small author baseline; the ratio overstates the gap.';

const BASE_LIMITATIONS = Object.freeze([
  "Descriptive, not causal: a post crossing its own author's baseline is not evidence the format caused the reach.",
  'Retrospective measurement with an unmatched capture age.',
]);

const EXPERIMENT_LIMITATION =
  'Source-only example with unresolved transferability. Presented as an experiment, never a proven client winner.';

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The production floor for a single finding (market or own-result; audience findings are
 * evaluated separately by `eligibilityForAudienceFinding`).
 *
 * @returns {{ok:true, lift:number|null} | {ok:false, code:string, reason:string}}
 */
function eligibilityForFinding(finding) {
  if (!RECOGNIZED_FINDING_KINDS.has(finding.kind)) {
    return {
      ok: false,
      code: 'missing_outliers_connection',
      reason: `unrecognized finding kind: ${JSON.stringify(finding.kind)}`,
    };
  }
  // Checked BEFORE source_ids on purpose (Sol review must-fix 5): when a follow-up has neither
  // a measured result nor a valid study link, "no measured result" is the more specific and
  // more actionable gap -- report that, not a study-connection error that would suggest the
  // missing piece is the citation rather than the measurement itself.
  const hasObserved = isFiniteNumber(finding.observed_value);
  const hasBaseline = isFiniteNumber(finding.baseline_value);
  if (!hasObserved || !hasBaseline) {
    return {
      ok: false,
      code: 'no_performance_support',
      reason: 'no measured observed_value/baseline_value supplied for this follow-up',
    };
  }
  const sourceIds = finding.source_ids;
  if (!Array.isArray(sourceIds) || sourceIds.length === 0
      || sourceIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    return {
      ok: false,
      code: 'missing_outliers_connection',
      reason: 'finding has no valid source_ids connection back to its outlier study',
    };
  }
  const baselineN = finding.baseline_n;
  if (!isFiniteNumber(baselineN) || baselineN < 0) {
    return { ok: false, code: 'below_baseline', reason: 'baseline_n is missing or invalid' };
  }
  if (baselineN < 3) {
    return {
      ok: false,
      code: 'insufficient_data',
      reason: `baseline_n ${baselineN} is too thin to compute anything at all (< 3)`,
    };
  }
  if (finding.observed_value <= finding.baseline_value) {
    return { ok: false, code: 'below_baseline', reason: 'observed_value does not exceed baseline_value' };
  }
  if (baselineN < 20) {
    return {
      ok: false,
      code: 'below_baseline',
      reason: `baseline_n ${baselineN} is below the production floor of 20`,
    };
  }
  const lift = finding.baseline_value > 0 ? finding.observed_value / finding.baseline_value : null;
  if (lift === null || lift < 4) {
    return {
      ok: false,
      code: 'below_baseline',
      reason: `lift ${lift === null ? 'n/a' : lift.toFixed(2)} is below the production floor of 4`,
    };
  }
  if (isFiniteNumber(finding.likes) && finding.likes < 40) {
    return {
      ok: false,
      code: 'below_baseline',
      reason: `likes ${finding.likes} is below the production floor of 40`,
    };
  }
  return { ok: true, lift };
}

/**
 * Audience findings are sample evidence, never a primary evidence_backed source in this
 * version. A bare sample_size with none of its required disclosure fields is exactly the
 * "sample presented as total reach" failure mode, so it gets a distinct, louder code.
 */
function eligibilityForAudienceFinding(finding) {
  const hasSampleSize = isFiniteNumber(finding.sample_size);
  const hasFullDisclosure = hasSampleSize
    && typeof finding.sample_method === 'string' && finding.sample_method.trim() !== ''
    && isFiniteNumber(finding.unknown_count)
    && typeof finding.classifier_version === 'string' && finding.classifier_version.trim() !== '';
  if (hasSampleSize && !hasFullDisclosure) {
    return {
      code: 'audience_sample_mislabeled',
      reason: 'audience finding carries a sample_size without sample_method/unknown_count/classifier_version; '
        + 'a sample can never be presented as total reach',
    };
  }
  return {
    code: 'no_performance_support',
    reason: 'audience findings inform limitations and sample context, not a primary evidence-backed source',
  };
}

/**
 * Prior adaptations of the same source, including failures. Never filtered by outcome -- a
 * failed or weak prior test is exactly the information a candidate must never silently drop.
 */
function historyForFinding(finding, previousTests) {
  const sourceIds = Array.isArray(finding.source_ids) ? finding.source_ids : [];
  return previousTests.filter((t) => t && typeof t === 'object' && (
    (typeof t.source_id === 'string' && sourceIds.includes(t.source_id))
    || (typeof t.finding_id === 'string' && t.finding_id === finding.finding_id)
    || (typeof t.source_ref === 'string' && sourceIds.includes(t.source_ref))
    // The key the committed row actually persists (writer.js context.evidence_package.
    // source_finding_ids) -- without this, a failed prior adaptation of THIS system's own
    // output is invisible to itself.
    || (Array.isArray(t.source_finding_ids) && (
      t.source_finding_ids.includes(finding.finding_id)
      || t.source_finding_ids.some((id) => sourceIds.includes(id))
    ))
  ));
}

/** An author id/name, when one is available on the finding itself or its source post (D10a). */
function authorKeyForFinding(finding) {
  const raw = finding.author_id || finding.author
    || (isObject(finding.source_post) && (finding.source_post.author_id || finding.source_post.author));
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim().toLowerCase() : null;
}

function resolveClientFacts(finding, clientFactsById, origin) {
  const factIds = Array.isArray(finding.client_fact_ids) ? finding.client_fact_ids : [];
  const resolved = [];
  for (const factId of factIds) {
    const fact = clientFactsById.get(factId);
    if (!fact) continue; // unresolved reference: treated as unavailable material, not a denial
    if (fact.permission === 'denied') {
      return { denied: factId, resolved: [], needsMaterial: null };
    }
    if (fact.permission === 'approved') resolved.push(factId);
  }
  let needsMaterial = null;
  if (origin !== 'own_result' && resolved.length === 0) {
    needsMaterial = factIds.length
      ? 'referenced client fact(s) could not be resolved to an approved source'
      : 'no permitted client material is available for this source; source-only, transferability unresolved';
  }
  return { denied: null, resolved, needsMaterial };
}

// F6 (audit): test_metric must be a declared test in plain words a person can act on, not a
// policy/metric id. metric_id is kept as its own candidate field for provenance instead of
// being conflated with the human-readable measurement plan.
const DECLARED_TEST_METRIC_BY_OBJECTIVE = Object.freeze({
  attention_reach: "weighted reactions (likes + 3 x reposts) at 7 and 14 days against the account's own usual",
  buyer_response: "relevant buyer replies or DMs at 7 and 14 days against the account's own usual",
  conversion_action: "the defined conversion action (click, booking or signup) at 7 and 14 days against the account's own usual",
});
function declaredTestMetric(objective, explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  return DECLARED_TEST_METRIC_BY_OBJECTIVE[objective]
    || "weighted reactions (likes + 3 x reposts) at 7 and 14 days against the account's own usual";
}

/** Builds one Candidate, or a rejection when a client-fact permission blocks it outright. */
function buildCandidate({ clientId, weekStart, finding, origin, lift, isExperiment, experimentReason,
  clientFactsById, previousTests }) {
  const factResolution = resolveClientFacts(finding, clientFactsById, origin);
  if (factResolution.denied) {
    return {
      candidate: null,
      deniedFactId: factResolution.denied,
      rejected: {
        code: 'client_fact_permission_denied',
        reason: `client fact ${factResolution.denied} is permission-denied and cannot support this candidate`,
      },
    };
  }

  const limitations = [...BASE_LIMITATIONS];
  if (!isFiniteNumber(finding.likes)) {
    limitations.push('Likes unknown for this finding; reach is approximated via likes + reposts where known, never invented.');
  }
  if (isFiniteNumber(finding.baseline_value) && finding.baseline_value < SMALL_BASELINE_THRESHOLD) {
    limitations.push(SMALL_BASELINE_LIMITATION);
  }
  if (isExperiment) limitations.push(EXPERIMENT_LIMITATION);

  const observationWindowDays = [7, 14].includes(finding.observation_window_days)
    ? finding.observation_window_days : 7;

  const objective = typeof finding.objective === 'string' && finding.objective.trim() ? finding.objective : 'attention_reach';
  const candidate = {
    schema_version: 1,
    client_id: clientId,
    week_start: weekStart,
    recommendation_id: null,
    draft_key: `${clientId}:${weekStart}:${finding.finding_id}`,
    objective,
    source_finding_ids: [finding.finding_id],
    source_posts: Array.isArray(finding.source_ids) ? finding.source_ids.slice() : [],
    client_fact_refs: factResolution.resolved,
    proposed_angle: isExperiment
      ? `Test an unsupported pattern from ${finding.finding_id}; transferability to this client is not yet established.`
      : `Adapt the structure behind ${finding.finding_id}: observed ${finding.observed_value} vs. author baseline `
        + `${finding.baseline_value} (n=${finding.baseline_n}, lift ${lift === null ? 'n/a' : lift.toFixed(2)}x).`,
    format: typeof finding.format === 'string' && finding.format ? finding.format : null,
    structural_features: Array.isArray(finding.structural_features) ? finding.structural_features.slice() : [],
    adaptation_history: historyForFinding(finding, previousTests),
    // metric_id is provenance (the study's own policy/metric identifier, when supplied);
    // test_metric is the declared, plain-words measurement plan a person can act on.
    metric_id: (typeof finding.metric_id === 'string' && finding.metric_id) || null,
    test_metric: declaredTestMetric(objective, finding.test_metric),
    comparison_rule: 'author_own_baseline_multiple',
    observation_window: { days: observationWindowDays },
    needs_material: factResolution.needsMaterial,
    limitations,
    label: isExperiment ? 'experiment' : 'evidence_backed',
  };
  if (isExperiment) candidate.experiment_reason = experimentReason;
  return { candidate, rejected: null };
}

/**
 * @param {object} params
 * @returns {object} the evidence pack -- see verification/SELECTOR-CONTRACT.md for the pinned shape.
 */
export function buildEvidencePack({
  clientId, weekStart, studies = [], findings = [], ownResults = [], clientFacts = [],
  previousTests = [], limit,
} = {}) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new TypeError('buildEvidencePack requires a non-empty clientId');
  }
  if (typeof weekStart !== 'string' || weekStart.trim() === '') {
    throw new TypeError('buildEvidencePack requires a non-empty weekStart');
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3;
  const findingsIn = Array.isArray(findings) ? findings : [];
  const ownResultsIn = Array.isArray(ownResults) ? ownResults : [];
  const previousTestsIn = Array.isArray(previousTests) ? previousTests : [];
  // Never mutate the caller's array: a fresh snapshot, read-only from here on.
  const previousTestsSnapshot = previousTestsIn.slice();

  const clientFactsById = new Map();
  for (const fact of (Array.isArray(clientFacts) ? clientFacts : [])) {
    if (!isObject(fact)) continue;
    const factId = fact.source_id || fact.fact_id || fact.id;
    if (typeof factId === 'string' && factId) clientFactsById.set(factId, fact);
  }

  const entries = [
    ...findingsIn.map((finding) => ({ finding, origin: 'finding' })),
    ...ownResultsIn.map((finding) => ({ finding, origin: 'own_result' })),
  ];

  const rejected = [];
  const evidenceBacked = [];
  const experiments = [];
  // Must-fix 3: track denied facts already surfaced via a specific candidate's rejection, so the
  // global "every denied fact is visible, referenced or not" pass below never double-reports one.
  const deniedFactIdsReported = new Set();

  for (const { finding, origin } of entries) {
    if (!isObject(finding)) {
      rejected.push({ finding_id: undefined, code: 'missing_outliers_connection', reason: 'finding entry is not an object' });
      continue;
    }
    const findingId = typeof finding.finding_id === 'string' ? finding.finding_id : (finding.source_id || '(unknown)');

    // Must-fix 6: a finding stamped with another client's id can never become this client's
    // candidate, however strong its numbers -- the 09-12 shared-table leak shape.
    if (typeof finding.client_id === 'string' && finding.client_id !== clientId) {
      rejected.push({ finding_id: findingId, code: 'foreign_client_finding', reason: 'finding belongs to another client' });
      continue;
    }

    const explicitExperimentReason = typeof finding.experiment_reason === 'string' && finding.experiment_reason.trim()
      ? finding.experiment_reason.trim() : null;

    if (finding.kind === 'audience') {
      const outcome = eligibilityForAudienceFinding(finding);
      rejected.push({ finding_id: findingId, code: outcome.code, reason: outcome.reason });
      continue;
    }

    const outcome = eligibilityForFinding(finding);
    if (outcome.ok) {
      const built = buildCandidate({
        clientId, weekStart, finding, origin, lift: outcome.lift, isExperiment: false, experimentReason: null,
        clientFactsById, previousTests: previousTestsSnapshot,
      });
      if (built.rejected) {
        rejected.push({ finding_id: findingId, ...built.rejected });
        if (built.deniedFactId) deniedFactIdsReported.add(built.deniedFactId);
        continue;
      }
      evidenceBacked.push({ finding, findingId, lift: outcome.lift, candidate: built.candidate });
      continue;
    }
    // Must-fix 4: an eligibility FLAG, not only a hand-authored reason string, can fill the
    // experiment slot -- an upstream store may know a finding is worth testing without anyone
    // having written prose about it yet. The candidate still always carries a concrete,
    // non-empty experiment_reason (contract requirement), synthesized from the floor outcome
    // when the caller supplied none.
    const effectiveExperimentReason = explicitExperimentReason
      || (finding.experiment_eligible === true
        ? `Unsupported by the measured floor: ${outcome.reason}. Offered as a test.`
        : null);
    if (effectiveExperimentReason) {
      const built = buildCandidate({
        clientId, weekStart, finding, origin, lift: null, isExperiment: true, experimentReason: effectiveExperimentReason,
        clientFactsById, previousTests: previousTestsSnapshot,
      });
      if (built.rejected) {
        rejected.push({ finding_id: findingId, ...built.rejected });
        if (built.deniedFactId) deniedFactIdsReported.add(built.deniedFactId);
        continue;
      }
      experiments.push({ finding, findingId, candidate: built.candidate });
      continue;
    }
    rejected.push({ finding_id: findingId, code: outcome.code, reason: outcome.reason });
  }

  // Declared ranking rule (D10): a below-SMALL_BASELINE_THRESHOLD baseline_value sorts after
  // every finding at or above it (tier first), then strongest directly-observed multiple, then
  // sample size, then finding_id for determinism. No synthesized/weighted score.
  evidenceBacked.sort((a, b) => {
    const at = isFiniteNumber(a.finding.baseline_value) && a.finding.baseline_value < SMALL_BASELINE_THRESHOLD ? 1 : 0;
    const bt = isFiniteNumber(b.finding.baseline_value) && b.finding.baseline_value < SMALL_BASELINE_THRESHOLD ? 1 : 0;
    if (at !== bt) return at - bt;
    if (b.lift !== a.lift) return b.lift - a.lift;
    const bn = (isFiniteNumber(b.finding.baseline_n) ? b.finding.baseline_n : 0)
      - (isFiniteNumber(a.finding.baseline_n) ? a.finding.baseline_n : 0);
    if (bn !== 0) return bn;
    return String(a.findingId).localeCompare(String(b.findingId));
  });
  experiments.sort((a, b) => String(a.findingId).localeCompare(String(b.findingId)));

  // D10a: at most AUTHOR_POOL_CAP evidence_backed candidates per author in the pool, applied on
  // the already-ranked list so the strongest per author are the ones kept. A finding with no
  // resolvable author id/name is never capped.
  const authorCounts = new Map();
  let authorCapOmitted = 0;
  const evidenceBackedAfterAuthorCap = [];
  for (const entry of evidenceBacked) {
    const authorKey = authorKeyForFinding(entry.finding);
    if (authorKey !== null) {
      const count = authorCounts.get(authorKey) || 0;
      if (count >= AUTHOR_POOL_CAP) {
        authorCapOmitted += 1;
        rejected.push({
          finding_id: entry.findingId,
          code: 'author_pool_cap_exceeded',
          reason: `at most ${AUTHOR_POOL_CAP} candidates per author are kept in the pool; author already has ${AUTHOR_POOL_CAP}`,
        });
        continue;
      }
      authorCounts.set(authorKey, count + 1);
    }
    evidenceBackedAfterAuthorCap.push(entry);
  }
  const smallBaselineCount = evidenceBackedAfterAuthorCap.filter((entry) => isFiniteNumber(entry.finding.baseline_value)
    && entry.finding.baseline_value < SMALL_BASELINE_THRESHOLD).length;

  let chosenExperiment = null;
  experiments.forEach((entry, index) => {
    if (index === 0) { chosenExperiment = entry; return; }
    rejected.push({
      finding_id: entry.findingId,
      code: 'experiment_cap_exceeded',
      reason: 'only one experiment slot is available per weekly pack; this finding was not first by finding_id',
    });
  });

  const ordered = [...evidenceBackedAfterAuthorCap, ...(chosenExperiment ? [chosenExperiment] : [])];
  const kept = ordered.slice(0, cap);
  const overflow = ordered.slice(cap);
  for (const entry of overflow) {
    rejected.push({
      finding_id: entry.findingId,
      code: 'candidate_cap_exceeded',
      reason: `candidate cap of ${cap} was reached before this finding could be included`,
    });
  }

  const candidates = kept.map((entry) => entry.candidate);

  // Must-fix 3: every denied client fact is visible in rejected[], referenced by a candidate or
  // not -- D4 says denied stays denied and visible, never silently absent.
  for (const fact of (Array.isArray(clientFacts) ? clientFacts : [])) {
    if (!isObject(fact) || fact.permission !== 'denied') continue;
    if (fact.client_id !== undefined && fact.client_id !== clientId) continue;
    const factId = fact.source_id || fact.fact_id || fact.id;
    if (typeof factId !== 'string' || !factId || deniedFactIdsReported.has(factId)) continue;
    rejected.push({
      source_id: factId,
      code: 'client_fact_permission_denied',
      reason: `client fact ${factId} is permission-denied for ${clientId}`,
    });
    deniedFactIdsReported.add(factId);
  }

  const missingInputs = [];
  if (candidates.length === 0) {
    missingInputs.push({
      code: 'no_qualified_sources',
      reason: `no eligible source cleared the production floor for ${clientId} in ${weekStart} `
        + `(${entries.length} finding(s) considered, ${rejected.length} rejected)`,
    });
  }

  return {
    schemaVersion: 1,
    clientId,
    weekStart,
    candidates,
    coverage: {
      history_count: previousTestsSnapshot.length,
      findings_considered: findingsIn.length,
      own_results_considered: ownResultsIn.length,
      eligible_evidence_backed: evidenceBacked.length,
      eligible_experiment: experiments.length,
      candidates_selected: candidates.length,
      rejected_count: rejected.length,
      author_pool_cap: { limit: AUTHOR_POOL_CAP, omitted: authorCapOmitted },
      small_author_baseline: { threshold: SMALL_BASELINE_THRESHOLD, count: smallBaselineCount },
    },
    missingInputs,
    sourceManifest: {
      studies: (Array.isArray(studies) ? studies : []).map((s) => ({
        study_id: s && s.study_id, state: s && s.state,
      })),
      finding_kinds_seen: [...new Set(entries.map((e) => e.finding && e.finding.kind))],
    },
    rejected,
  };
}

/**
 * The evidence path is preview-only until Phase 3's per-client rollout switch names the client
 * for a live (non-preview) run, and it never re-commits a week the client already has a saved
 * commit for.
 *
 * @param {{pack:object, rolloutEnabled?:boolean, existingCommits?:Array<{client_id:string, week_start:string}>}} params
 * @returns {{allowed:boolean, reason:string}}
 */
export function commitGuard({ pack, rolloutEnabled, existingCommits } = {}) {
  if (!isObject(pack)) {
    return { allowed: false, reason: 'commitGuard requires a pack to evaluate' };
  }
  if (rolloutEnabled !== true) {
    return {
      allowed: false,
      reason: 'evidence path is preview-only until the per-client rollout switch enables it for this client',
    };
  }
  const commits = Array.isArray(existingCommits) ? existingCommits : [];
  const duplicate = commits.some((c) => c && c.client_id === pack.clientId && c.week_start === pack.weekStart);
  if (duplicate) {
    return {
      allowed: false,
      reason: `duplicate commit already exists for ${pack.clientId} ${pack.weekStart}; the evidence path never re-commits a week`,
    };
  }
  return { allowed: true, reason: 'rollout switch names this client and no prior commit exists for this week' };
}
