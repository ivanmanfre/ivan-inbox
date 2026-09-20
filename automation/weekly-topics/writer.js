/* AUDN RUN 06 - Recommendation Writer (CONTRACTS 2.3). Secrets come from the Secrets node
   (n8n credential -> integration_config), never from a literal in this file. The resolver
   line below is copied VERBATIM from the Run 04 deployable pattern. */
const _S = (() => { for (const n of ["Secrets", "Secrets 2", "Secrets 3", "Secrets 4"]) { try { const r = $(n).all(); if (r && r.length) { const o = {}; for (const i of r) { if (i.json && i.json.key) o[i.json.key] = i.json.value; } if (o.n8n_sb_key) return o; } } catch (e) {} } throw new Error("harden_secrets_unavailable: no Secrets node ran before this Code node"); })();

// WHAT THIS NODE WRITES: ops_drafts rows of kind 'audn_recommendation' and NOTHING ELSE.
// It never touches client_ideas or lm_idea_candidates (only the approve RPC does, on
// Ivan's hand), and it has no path to outreach, carousels, schedules or any sender.
const START = Date.now();
// Actual runner task timeout2700s verified at build cutoff. Bound this node to900s.
const BUDGET_MS = 900000;
const SB = 'https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1';
const KEY = _S.n8n_sb_key;
const HDR = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const claudeUrl = 'https://claude-code-railway-production.up.railway.app/v1/messages';
const claudeKey = _S.railway_proxy_key;
const http = async (opts) => {
  const remaining = BUDGET_MS - (Date.now() - START) - 5000;
  if (remaining <= 0) throw new Error('audn_run_deadline');
  return this.helpers.httpRequest({ ...opts, timeout: Math.min(opts.timeout || (opts.method === 'GET' ? 45000 : 20000), remaining) });
};

const PROMPT_SLUG = 'audn-recommendation-writer';
const KIND = 'audn_recommendation';
const SOURCE_WINDOW_DAYS = 45;
// D10 (orchestrator, binding): the pool buildEvidencePack ranks from is wider than the weekly
// choice cap, so a client-aware pass (this file, then the model) can pick among real candidates
// instead of a pre-made shortlist of the top 3 by raw lift alone. The final weekly cap (t.limit,
// typically 3) and the one-experiment cap are unchanged and still enforced downstream.
const EVIDENCE_POOL_LIMIT = 12;

const RUN_ISO = new Date().toISOString();
const enc = encodeURIComponent;
// Scheduled and manual runs share one immutable UTC week, including accepted slots.
const REQUEST = (() => {
  try { for (const it of $input.all()) { const j = it && it.json || {}; const b = j.body || j; if (b && ['preview','client_id','week_start','force_review_gap','evidence'].some(k => Object.prototype.hasOwnProperty.call(b,k))) return b; } } catch (e) {}
  return {};
})();
const PREVIEW = REQUEST.preview === true;
const monday = new Date(RUN_ISO.slice(0,10) + 'T00:00:00.000Z');
const weekday = monday.getUTCDay();
monday.setUTCDate(monday.getUTCDate() - (weekday + 6) % 7);
const CURRENT_WEEK = monday.toISOString().slice(0,10);
monday.setUTCDate(monday.getUTCDate() + 7);
const NEXT_WEEK = monday.toISOString().slice(0,10);
// D7, scoped: only a preview explicitly carrying evidence:true may target one week further out
// than the ordinary two-week rule -- the first uncommitted Monday can sit past NEXT_WEEK when
// every current/next-week slot is already committed. Any other request (live, or preview
// without evidence:true) keeps exactly the original two-week rule.
monday.setUTCDate(monday.getUTCDate() + 7);
const NEXT_WEEK_PLUS_7 = monday.toISOString().slice(0,10);
const WEEK_START = REQUEST.week_start === undefined ? (weekday === 0 || weekday === 6 ? NEXT_WEEK : CURRENT_WEEK) : REQUEST.week_start;
const EVIDENCE_PREVIEW = PREVIEW && REQUEST.evidence === true;
const ALLOWED_WEEKS = EVIDENCE_PREVIEW ? [CURRENT_WEEK,NEXT_WEEK,NEXT_WEEK_PLUS_7] : [CURRENT_WEEK,NEXT_WEEK];
if (typeof WEEK_START !== 'string' || !ALLOWED_WEEKS.includes(WEEK_START)) throw new Error('audn_invalid_week: current or next UTC Monday required' + (EVIDENCE_PREVIEW ? ' (or next+7 for an evidence preview)' : ''));
const CYCLE_ID = 'weekly:' + WEEK_START;
const FORCE_GAP = false; // Weekly RPC branch owns the cap; legacy gap override is irrelevant.

const nz = (v) => String(v === null || v === undefined ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
const dOnly = (v) => { if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10) : null; };
const sourceGroup = url => {
  if (!url) return null;
  let u = String(url).replace(/#.*$/, '').replace(/^https?:\/\/(?:www\.)?([^/]+)/i, (_,host) => 'https://' + host.toLowerCase());
  const activity = u.match(/(?:linkedin\.com.*(?:activity-|urn:li:activity:))(\d+)/i);
  if (activity) return 'linkedin:' + activity[1];
  const tweet = u.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i);
  if (tweet) return 'x:' + tweet[1];
  const [path,query] = u.split('?');
  const kept = (query || '').split('&').filter(x => x && !/^(?:utm_[^=]*|fbclid|gclid|trk)=/i.test(x));
  return path.replace(/\/$/,'') + (kept.length ? '?' + kept.sort().join('&') : '');
};
const fresh = date => date !== null && Date.parse(date) <= Date.parse(RUN_ISO) && Date.parse(WEEK_START) - Date.parse(date) <= 14 * 864e5;
const shortName = (a) => { const s = String(a === null || a === undefined ? '' : a); const i = s.indexOf(' ('); return (i > 0 ? s.slice(0, i) : s).trim(); };
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const medianOf = (xs) => {
  const a = xs.filter(x => typeof x === 'number' && isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const getJson = async (path) => {
  const r = await http({ method: 'GET', url: SB + path, headers: HDR, json: true });
  if (!Array.isArray(r)) throw new Error('audn_required_read_shape:' + path.split('?')[0]);
  return r;
};

const getAll = async (path) => {
  const rows=[];
  for (let offset=0; ;offset+=500) {
    const page=await getJson(path+'&limit=500&offset='+offset);
    rows.push(...page);
    if (page.length<500) return rows;
  }
};

// <selector-pack:begin sha256=6b2bddcff395f085f12b9ebd9d51ea6e2f2d8ac3fd994bac1bc2051e30b8fd4f>
// GENERATED from automation/content-evidence/selector-pack.mjs by sync-selector.mjs.
// Do not hand-edit this block -- edit selector-pack.mjs and rerun the sync script.
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
function buildEvidencePack({
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
function commitGuard({ pack, rolloutEnabled, existingCommits } = {}) {
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
// <selector-pack:end>

// Per D8: the switch is ONE row in the existing integration_config table, key
// weekly_evidence_selector_clients, read through the writer's existing getJson helper (same
// table/columns the Secrets node already reads -- key,value -- just a different key). Row
// absent, unreadable, or non-array value = [] (legacy path for every client). A read ERROR
// (HTTP failure) fails closed to [] for this run and is recorded on the run summary; it never
// enables the evidence path.
async function readEvidenceRollout() {
  try {
    const rows = await getJson('/integration_config?select=key,value&key=eq.weekly_evidence_selector_clients&limit=1');
    const row = Array.isArray(rows) && rows[0] ? rows[0] : undefined;
    if (!row) return { clients: [], readError: null }; // no row at all: legacy path, not malformed
    let raw = row.value;
    // F1 (audit): integration_config.value is a `text` column live, so PostgREST returns the
    // JSON array literally as a JSON STRING ('["ivan"]'), never as an already-parsed array.
    // Without this, the switch can never enable anyone. Parsed inside the same try, so a parse
    // failure falls through to the catch below only if it throws past this block -- it does not,
    // it returns directly, recording exactly which text failed to parse.
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); }
      catch (e) {
        return { clients: [], readError: 'weekly_evidence_selector_clients text is not valid JSON: ' + String((e && e.message) || e).slice(0, 150) };
      }
    }
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || x === '')) {
      return { clients: [], readError: 'weekly_evidence_selector_clients value is not a JSON array of non-empty strings' };
    }
    return { clients: raw, readError: null };
  } catch (e) {
    return { clients: [], readError: String((e && e.message) || e).slice(0, 200) };
  }
}

// Pure projection: full evidence remains local for validation and saved provenance.
function makeModelPack(pack) {
  const pick = (r,keys) => Object.fromEntries(keys.filter(k => r[k] !== undefined).map(k => [k,r[k]]));
  const short = v => String(v || '').toLowerCase().split(' (')[0].trim();
  const evidence = pack.evidence_items || [];
  const competitors = evidence.filter(e => e.kind === 'competitor').slice(0,12);
  const own = evidence.filter(e => e.kind === 'own_post').sort((a,b) => String(b.source_date || '').localeCompare(String(a.source_date || '')));
  const ownChosen = own.slice(0,4);
  const matched = (pack.measurement.matched_age || []).filter(r => Number.isFinite(r.standing_pct) && r.eligible_n >= (r.minimum_n || 20)).sort((a,b) => b.standing_pct-a.standing_pct);
  for (const row of [matched[0],matched[matched.length-1]]) {
    const found = row && own.find(e => String(e.native_id) === String(row.canonical_post_id));
    if (found && !ownChosen.includes(found)) ownChosen.push(found);
  }
  for (const e of own) if (ownChosen.length<6 && !ownChosen.includes(e)) ownChosen.push(e);
  const ownIds = new Set(ownChosen.map(e => String(e.native_id)));
  const publicQueues = ['news','trend'].map(kind => evidence.filter(e => e.kind===kind).sort((a,b) => String(b.source_date || '').localeCompare(String(a.source_date || ''))));
  const discovery = [];
  for (let i=0;discovery.length<6;i++) {
    let added=false;
    for (const queue of publicQueues) if (queue[i] && discovery.length<6) {discovery.push(queue[i]);added=true;}
    if (!added) break;
  }
  const selected = [...competitors,...ownChosen,...evidence.filter(e => ['founder','buyer_question'].includes(e.kind)),...discovery];
  const definitions = {}, definitionIds = new Map();
  const modelEvidence = selected.map(e => {
    const limitations = (e.limitations || []).map(text => {if (!definitionIds.has(text)) {const id='L'+(definitionIds.size+1);definitionIds.set(text,id);definitions[id]=text;}return definitionIds.get(text);});
    const out = {...pick(e,['id','kind','source_date','url','format','competitor_name','likes_count','comments_count','reposts_count','source_group']),excerpt:e.excerpt.slice(0,['founder','buyer_question'].includes(e.kind)?e.excerpt.length:1000),limitations};
    if (out.excerpt.length < e.excerpt.length) out.excerpt_truncated=true;
    if (e.location && e.location !== e.url) out.location=e.location;
    if (e.gate) out.gate=pick(e.gate,['is_gated','cta_kind','gate_keyword','offer','confidence','judged_at','rubric_version']);
    return out;
  });
  const measurement = {...pack.measurement};
  const relevant = r => ownIds.has(String(r.canonical_post_id || r.identity_post_social_id));
  const coverageRows = (measurement.coverage || []).filter(relevant);
  measurement.coverage = [...ownIds].map(id => {
    const rows=coverageRows.filter(r => String(r.canonical_post_id || r.identity_post_social_id)===id);
    const canonical=rows.find(r => r.row_kind==='canonical_post');
    return {canonical_post_id:id,source_rows:rows.length,canonical:canonical?pick(canonical,['collection_status','selected_snapshot_count','last_visited_at','resolution_status','unresolved_reason','note']):null,observed_status_counts:rows.reduce((o,r)=>{const k=r.collection_status || 'unknown';o[k]=(o[k] || 0)+1;return o;},{})};
  });
  const perMetric = new Map();
  for (const r of (measurement.matched_age || []).filter(relevant).sort((a,b)=>(b.target_age_days || 0)-(a.target_age_days || 0))) {
    const key=r.canonical_post_id+':'+r.metric;
    if (!perMetric.has(key)) perMetric.set(key,pick(r,['canonical_post_id','metric','value','status','minimum_n','missing_n','eligible_n','captured_at','cohort_basis','published_at','standing_pct','actual_age_days','target_age_days','p50','p75','p90']));
  }
  measurement.matched_age=[...perMetric.values()];
  measurement.classifications=(measurement.classifications || []).filter(relevant).map(r=>pick(r,['canonical_post_id','subject','hook','format','purpose','classified','confidence','classified_at','taxonomy_version']));
  // Monthly aggregates stay intact: re-summarizing them could change their cohort basis.
  const authors=new Set(competitors.map(e=>short(e.competitor_name)));
  const marketResearch={};
  for(const [table,rows]of Object.entries(pack.market_research || {})) marketResearch[table]=rows.slice(0,3).map(r=>({run_id:r.run_id,captured_at:r.created_at,freshness:r.freshness,limitation:r.limitation,theme:r.theme,section:r.section,headline:r.reading && String(r.reading.headline || '').slice(0,300),editorial_suggestion:r.reading && String(r.reading.change || '').slice(0,300)}));
  const prior = (pack.already_recommended || []).slice().sort((a,b)=>(a.source==='proposal'?0:1)-(b.source==='proposal'?0:1));
  const already=prior.slice(0,40).map(r=>({...pick(r,['source','recommendation_id','topic_key']),subject:String(r.subject || '').slice(0,160),original_angle:String(r.original_angle || '').slice(0,160)}));
  const feedbackDate = r => Math.max(Date.parse(r.decided_at || '') || 0,...(r.linked_results || []).map(x => Date.parse(x.captured_at || x.measured_at || x.published_at || '') || 0));
  const feedback=(pack.previous_decisions_and_results || []).slice().sort((a,b) => Number(b.decision_source === 'weekly_review') - Number(a.decision_source === 'weekly_review') || feedbackDate(b) - feedbackDate(a)).slice(0,12);
  const selectedKinds=Object.fromEntries(['competitor','own_post','founder','buyer_question','news','trend'].map(kind=>[kind,{available:selected.filter(e=>e.kind===kind).length,fresh:selected.filter(e=>e.kind===kind && e.source_date && Date.parse(pack.week_start)-Date.parse(e.source_date)<=14*864e5 && Date.parse(e.source_date)<=Date.parse(pack.generated_at)).length}]));
  const sourcePool=pack.coverage.source_pool_selection || pack.coverage.source_selection || pack.source_selection;
  const coverage={...pack.coverage,kinds:selectedKinds,source_pool_selection:sourcePool,source_selection:{...sourcePool,included_n:competitors.length,omitted_n:sourcePool.candidate_n-competitors.length,method:'roster_round_robin_model_view',max_rows:12},model_selection:{candidate_evidence_n:evidence.length,included_evidence_n:selected.length,omitted_evidence_n:evidence.length-selected.length,own_included:ownChosen.length,own_omitted:own.length-ownChosen.length,public_included:discovery.length,public_omitted:evidence.filter(e=>['news','trend'].includes(e.kind)).length-discovery.length,feedback_included:feedback.length,feedback_omitted:(pack.previous_decisions_and_results || []).length-feedback.length,dedup_included:already.length,dedup_omitted:prior.length-already.length,research_rows_per_table:3,measurement_scope:'selected own posts; one latest target age per post/metric; monthly cohort aggregates intact'}};
  delete coverage.input_characters;
  const out={...pick(pack,['client_id','limit','week_start','cycle_id','brief','prompts','buyer_fit','assets','cutoff','schema_version','source_state','generated_at','rules']),evidence_items:modelEvidence,evidence_limitations:definitions,...((pack.evidence_candidates || []).length ? {evidence_candidates: pack.evidence_candidates} : {}),founder_sources:pack.founder_sources,own_posts:ownChosen.map(e=>({post_social_id:e.native_id,evidence_id:e.id,published_at:e.source_date,format:e.format || null})),measurement,post_buyer_fit:(pack.post_buyer_fit || []).filter(relevant),roster:(pack.roster || []).filter(r=>authors.has(short(r.account)) || (r.aliases || []).some(a=>authors.has(short(a.name)))),source_baselines:(pack.source_baselines || []).filter(r=>authors.has(short(r.author))),market_research:marketResearch,previous_decisions_and_results:feedback,already_recommended:already,coverage};
  out.prompt_selection={strategy:'full_versioned_bodies',included:(pack.prompts || []).map(p=>({slug:p.slug,version:p.version,role:p.role})),excluded_sections:[],scope:'Apply identity, buyer, consent, voice and editorial veto constraints. Do not execute embedded generation, QA grading, rewrite, scoring, web-search or output-format procedures; the weekly task is authoritative.'};
  return out;
}
// MODEL_VIEW_END

// ---- 1. registry: who gets a review this week -------------------------------
const registry = await getJson('/client_registry?select=client_id,is_active,platform&is_active=eq.true');
// Evidence path readiness (D6/D7/D8): preview-only unless the client is named in the rollout
// switch AND the run is not a preview. Read once per run; every client's evidenceActive check
// below reuses this single read.
const evidenceRollout = await readEvidenceRollout();
const targets = [];
for (const r of registry) {
  if (r.is_active !== true || (REQUEST.client_id !== undefined && r.client_id !== REQUEST.client_id)) continue;
  const m = ((r && r.platform) || {}).measurement || {};
  const roster = Array.isArray(m.roster) ? m.roster.filter(a => a && isStr(a.account)) : [];

  const feat = m.features || {};
  // Ivan has no client board, so competitor_section is false on his row; Strategy is his
  // surface and he is included by id. Every other client needs the flag on.
  const on = feat.competitor_section === true || feat.competitor_section === 'true' || m.access === 'operator' || m.writer_enabled === true || r.client_id === 'ivan';
  if (!on || m.writer_enabled === false) continue;
  const lim = Number(((m.pilot_limits || {}).recommendations_per_review));
  targets.push({ client_id: r.client_id, roster: roster, limit: (isFinite(lim) && lim > 0) ? Math.floor(lim) : 3 });
}

if (REQUEST.client_id !== undefined && !targets.length) throw new Error('audn_client_not_enabled:' + REQUEST.client_id);

// ---- 2. pinned prompt, FAIL-CLOSED, before anything is written ---------------
// An empty response, an empty body or a missing version aborts the whole run here.
// Writing proposals against an empty system prompt, or stamping '...@vundefined', puts
// client-readable copy in the table that nobody can trace back to a body.
let systemPrompt = '';
let promptVersion = null;
try {
  const pr = await http({ method: 'GET', url: SB + '/content_prompts?slug=eq.' + PROMPT_SLUG + '&is_active=eq.true&select=body,version', headers: HDR, json: true });
  systemPrompt = (pr && pr[0] && pr[0].body) || '';
  promptVersion = (pr && pr[0] && pr[0].version !== undefined) ? pr[0].version : null;
} catch (e) {}
if (!systemPrompt || promptVersion === null || promptVersion === undefined) throw new Error('audn_rubric_missing: ' + PROMPT_SLUG);
const PROMPT_STAMP = PROMPT_SLUG + '@v' + promptVersion;

// ---- copy lint + quote check (deterministic, node-side) ----------------------
const FORBIDDEN = ['—', '--', 'shopify brand', 'guarantee', 'will book', 'revenue', 'pipeline will'];
const quotedSpans = (s) => {
  const out = [];
  const str = String(s || '');
  let m;
  const re1 = /"([^"]{25,})"/g;
  while ((m = re1.exec(str)) !== null) out.push(m[1]);
  const re2 = /“([^”]{25,})”/g;
  while ((m = re2.exec(str)) !== null) out.push(m[1]);
  return out;
};

// F3 (audit): a saved client_fact_refs entry must never render as a raw id on screen. The
// consent-checked approved source itself carries no dedicated "title" field, so the short human
// label is the source's own retained excerpt (what a reader would recognize), falling back to
// its location, then its kind, in that order -- never the bare source_id.
const clientFactLabel = (source) => {
  const text = (source && typeof source.excerpt === 'string' && source.excerpt.trim())
    || (source && typeof source.location === 'string' && source.location.trim())
    || (source && typeof source.kind === 'string' && source.kind.trim())
    || 'Approved client source';
  return text.length > 80 ? text.slice(0, 80).trim() + '…' : text;
};

const summary = { run_at: RUN_ISO, cycle_id: CYCLE_ID, prompt: PROMPT_STAMP, preview: PREVIEW, week_start: WEEK_START, clients: [], evidence_rollout: { clients: evidenceRollout.clients, read_error: evidenceRollout.readError } };

const prepared = [];
for (const t of targets) {
  const cid = t.client_id;
  const rec = { client_id: cid, skipped: false, reason: null, pack_ids: [], proposed: 0, dropped: [], writer_bail: false, prompt: PROMPT_STAMP };
  // Evidence path readiness for this client (D6): a preview explicitly carrying evidence:true,
  // OR this client named in the rollout switch. Never both required at once, and PREVIEW here
  // is the outer run's boolean -- a live (non-preview) run for a client NOT in the rollout stays
  // legacy regardless of any REQUEST.evidence value.
  const evidenceActive = (PREVIEW && REQUEST.evidence === true) || evidenceRollout.clients.includes(cid);
  rec.evidence_path = evidenceActive;
  summary.clients.push(rec);
  if (Date.now() - START > BUDGET_MS - 280000) { rec.skipped = true; rec.reason = 'run_budget_exhausted'; continue; }

  // An existing cycle is final even if its proposals have since been accepted.
  const cycles = await getJson('/audn_writer_cycles?select=*&client_id=eq.' + enc(cid) + '&cycle_id=eq.' + enc(CYCLE_ID) + '&limit=1');
  if (cycles.length) { rec.skipped = true; rec.already_committed = true; rec.reason = 'already_committed'; continue; }
  // Recent history includes every status, with a fixed input bound independent of queue size.
  const historySince = new Date(Date.now() - 90 * 864e5).toISOString();
  const historyRows = await getJson('/ops_drafts?select=id,body,context,created_at,approved_at,sent_at&kind=eq.' + KIND + '&client_id=eq.' + enc(cid) + '&created_at=gte.' + enc(historySince) + '&order=created_at.desc,id.asc&limit=121');
  const openRows = historyRows.slice(0,120);
  const historyCoverage = {window_days:90,included:openRows.length,max_rows:120,omitted_at_least:Math.max(0,historyRows.length - openRows.length),older_history_excluded:true,exhaustive:historyRows.length <= 120};

  // ---- 4. Required scoped evidence. Read failures throw before model or writes.
  const context = await http({ method: 'POST', url: SB + '/rpc/audn_writer_context', headers: HDR, body: { p_client_id: cid }, json: true, timeout:45000 });
  if (!context || context.client_id !== cid || !context.brief || !Array.isArray(context.own_posts) || !context.measurement || !context.buyer_fit || !Array.isArray(context.previous_decisions_and_results)) {
    throw new Error('audn_required_context_invalid:' + cid);
  }
  context.own_posts = context.own_posts.filter(r => !r.client_id || r.client_id === cid);
  // Retain recent material plus measured standing extremes; never crop serialized JSON.
  const allOwn = context.own_posts.slice().sort((a,b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));
  const matched = Array.isArray(context.measurement.matched_age) ? context.measurement.matched_age : [];
  const measured = matched.filter(r => Number.isFinite(r.standing_pct) && r.eligible_n >= (r.minimum_n || 20)).sort((a,b) => b.standing_pct - a.standing_pct);
  const ownIds = new Set(allOwn.slice(0,18).map(r => String(r.post_social_id)));
  for (const r of [...measured.slice(0,6),...measured.slice(-6)]) if (allOwn.some(p => String(p.post_social_id) === String(r.canonical_post_id))) ownIds.add(String(r.canonical_post_id));
  for (const r of allOwn) if (ownIds.size < 30) ownIds.add(String(r.post_social_id));
  context.own_posts = allOwn.filter(r => ownIds.has(String(r.post_social_id)));
  const ownSelection = {candidate_n:allOwn.length,included_n:context.own_posts.length,omitted_n:allOwn.length-context.own_posts.length,method:'18_most_recent_plus_matched_age_standing_extremes_then_recent_to_30',maximum_posts:30,excerpt_max_characters:1800};
  const measurementSelection = {};
  const compactMeasurement = {...context.measurement};
  for (const key of ['coverage','classifications','matched_age']) {
    const rows = Array.isArray(context.measurement[key]) ? context.measurement[key] : [];
    const selected = rows.filter(r => [r.canonical_post_id,r.identity_post_social_id].some(id => ownIds.has(String(id))));
    compactMeasurement[key] = selected;
    measurementSelection[key] = {candidate_n:rows.length,included_n:selected.length,omitted_n:rows.length-selected.length,scope:'selected_own_posts_only',whole_account_summary:key === 'coverage' ? rows.reduce((out,r) => {const status=r.collection_status || 'unknown';out[status]=(out[status] || 0)+1;return out;},{}) : null};
  }
  if (Array.isArray(context.post_buyer_fit)) context.post_buyer_fit = context.post_buyer_fit.filter(r => ownIds.has(String(r.canonical_post_id)));
  context.previous_decisions_and_results = context.previous_decisions_and_results.filter(r => !r.client_id || r.client_id === cid);
  for (const r of openRows) {
    const decision = (r.context || {}).weekly_decision;
    if (!decision || decision.decision !== 'rejected') continue;
    const prior = context.previous_decisions_and_results.find(x => x.recommendation_id === r.id);
    const rejection = {client_id:cid,recommendation_id:r.id,decision:'rejected',decision_reason:decision.reason || null,decided_at:decision.decided_at || null,decision_source:'weekly_review',linked_results:prior && prior.linked_results || []};
    if (prior) Object.assign(prior,rejection); else context.previous_decisions_and_results.push(rejection);
  }
  const allowedSubjects = Array.isArray(context.brief.subjects) ? context.brief.subjects : [];
  if (!allowedSubjects.length) throw new Error('audn_subject_contract_missing:' + cid);
  const approvedSources = (context.sources || []).filter(x => x.client_id === cid && x.writer_eligible === true && x.state === 'approved' && x.source_id && x.location && x.excerpt && x.consent && x.consent.state === 'approved' && Array.isArray(x.consent.purpose) && x.consent.purpose.includes('drafting') && x.revoked_at == null && !/(?:consent|permission)/i.test(x.source_id) && x.content_evidence !== false);

  // roster accounts, matched to the collector's competitor_name (the part before ' (')
  const rosterOut = t.roster.map(a => ({ account: String(a.account), role: a.role === undefined ? null : a.role, url: a.url === undefined ? null : a.url, reason: a.reason || null, aliases: Array.isArray(a.aliases) ? a.aliases.filter(x => x && isStr(x.name) && isStr(x.url_owner)).map(x => ({ name: String(x.name), url_owner: String(x.url_owner).toLowerCase() })) : [] }));
  const roleByName = {};
  const accountByName = {};
  for (const a of rosterOut) {
    roleByName[nz(a.account)] = a.role;
    accountByName[nz(a.account)] = a.account;
    const s = shortName(a.account);
    if (s && !roleByName[nz(s)]) { roleByName[nz(s)] = a.role; accountByName[nz(s)] = a.account; }
    for (const alias of a.aliases) {
      roleByName[nz(alias.name)] = a.role;
      accountByName[nz(alias.name)] = a.account;
    }
  }
  const names = [];
  for (const a of rosterOut) {
    for (const name of [shortName(a.account), ...a.aliases.map(x => x.name)]) if (name && names.indexOf(name) < 0) names.push(name);
  }

  let compRows = [];
  if (names.length) {
    const sinceIso = new Date(Date.now() - SOURCE_WINDOW_DAYS * 864e5).toISOString();
    const inList = '(' + names.map(n => '"' + n.replace(/"/g, '') + '"').join(',') + ')';
    // Ivan's lane still lives in competitor_posts; every client lane was moved to
    // audn_competitor_posts on 2026-09-12 (migration 13) because five active Ivan
    // workflows read competitor_posts with no client filter. Reading the wrong table
    // here returns zero rows and the week's review is written from nothing.
    if (cid === 'ivan') {
      compRows = await getAll('/competitor_posts?select=id,competitor_name,post_date,likes_count,comments_count,reposts_count,linkedin_post_url,post_text,post_type,post_topic,hook_pattern&post_date=gte.' + enc(sinceIso) + '&competitor_name=in.' + enc(inList) + '&order=post_date.desc,id.asc');
    } else {
      // audn_competitor_posts carries no post_topic / hook_pattern; suggested_angle is
      // the nearest column the harvest fills, and the writer treats it as the topic hint.
      const cr = await getAll('/audn_competitor_posts?select=id,competitor_name,post_date,likes_count,comments_count,reposts_count,linkedin_post_url,post_text,post_type,suggested_angle&client_id=eq.' + enc(cid) + '&post_date=gte.' + enc(sinceIso) + '&competitor_name=in.' + enc(inList) + '&order=post_date.desc,id.asc');
      compRows = cr.map(r => ({ ...r, post_topic: (r.suggested_angle === undefined ? null : r.suggested_angle), hook_pattern: null }));
    }
  }
  const aliasOwnerByName = {};
  for (const a of rosterOut) for (const alias of a.aliases) aliasOwnerByName[nz(alias.name)] = alias.url_owner;
  compRows = compRows.filter(r => {
    const owner = aliasOwnerByName[nz(r.competitor_name)];
    return !owner || String(r.linkedin_post_url || '').toLowerCase().includes('/posts/' + owner + '_');
  });
  if (new Set(compRows.map(r => String(r.id))).size !== compRows.length) throw new Error('audn_duplicate_source_identity:' + cid);
  const SOURCE_TEXT_BUDGET = 72000;
  const MAX_SOURCE_ROWS = 80;
  const sourceQueues = names.map(name => compRows.filter(r => nz(shortName(r.competitor_name)) === nz(name)));
  const selectedSources = [];
  const selectedIds = new Set();
  let sourceTextRemaining = SOURCE_TEXT_BUDGET;
  for (let round = 0; selectedSources.length < MAX_SOURCE_ROWS && sourceTextRemaining > 0; round++) {
    let any = false;
    for (const queue of sourceQueues) {
      const r = queue[round];
      if (!r || selectedIds.has(String(r.id))) continue;
      any = true;
      const excerpt = String(r.post_text || '').slice(0, Math.min(1800, sourceTextRemaining));
      sourceTextRemaining -= excerpt.length;
      selectedIds.add(String(r.id));
      selectedSources.push({...r, selected_excerpt: excerpt});
      if (selectedSources.length >= MAX_SOURCE_ROWS || sourceTextRemaining <= 0) break;
    }
    if (!any) break;
  }
  const sourceBaselines = names.map(name => {
    const values = compRows.filter(r => nz(shortName(r.competitor_name)) === nz(name)
      && Number.isFinite(r.likes_count) && r.likes_count >= 0 && Number.isFinite(r.comments_count) && r.comments_count >= 0)
      .map(r => r.likes_count + r.comments_count);
    return {author:name, metric:'engagement_count', basis:'latest_observed_reactions_plus_comments',
      n:values.length, minimum_n:8, supported:values.length>=8, median:values.length>=8?medianOf(values):null,
      window_days:SOURCE_WINDOW_DAYS, age_comparability:'not_matched', impressions:'unknown'};
  });
  const packRows = selectedSources.map(r => ({
    id: String(r.id),
    competitor_name: r.competitor_name,
    post_date: dOnly(r.post_date),
    likes_count: r.likes_count === undefined ? null : r.likes_count,
    comments_count: r.comments_count === undefined ? null : r.comments_count,
    reposts_count: r.reposts_count === undefined ? null : r.reposts_count,
    linkedin_post_url: r.linkedin_post_url === undefined ? null : r.linkedin_post_url,
    post_text: r.selected_excerpt,
    format: r.post_type || null,
    text_coverage: String(r.post_text || '').length > r.selected_excerpt.length ? 'excerpt_truncated' : 'stored_text',
    post_topic: r.post_topic === undefined ? null : r.post_topic,
    hook_pattern: r.hook_pattern === undefined ? null : r.hook_pattern,
  }));
  const gateByUrl = {};
  const gateRefs = packRows.map(r => r.linkedin_post_url).filter(Boolean);
  for (let i=0;i<gateRefs.length;i+=25) {
    const refs = '(' + gateRefs.slice(i,i+25).map(u => '"' + u.replace(/"/g,'') + '"').join(',') + ')';
    const gates = await getJson('/competitor_gated_posts?select=post_ref,client_id,is_gated,cta_kind,gate_keyword,offer,confidence,why,judged_at,model,rubric_version&client_id=eq.' + enc(cid) + '&post_ref=in.' + enc(refs) + '&limit=25');
    for (const g of gates) if (g.client_id === cid && gateRefs.includes(g.post_ref)) gateByUrl[g.post_ref] = {is_gated:g.is_gated,cta_kind:g.cta_kind,gate_keyword:g.gate_keyword,offer:g.offer,confidence:g.confidence,why:g.why,judged_at:g.judged_at,model:g.model,rubric_version:g.rubric_version};
  }
  const evidenceItems = packRows.map(r => ({
    id:'competitor:' + r.id, native_id:r.id, kind:'competitor', client_id:cid,competitor_name:r.competitor_name,likes_count:r.likes_count,comments_count:r.comments_count,reposts_count:r.reposts_count,post_topic:r.post_topic,hook_pattern:r.hook_pattern,
    source_date:r.post_date, location:r.linkedin_post_url, url:r.linkedin_post_url, excerpt:r.post_text,
    source_group:sourceGroup(r.linkedin_post_url),format:r.format,gate:gateByUrl[r.linkedin_post_url] || null,
    table:cid === 'ivan' ? 'competitor_posts' : 'audn_competitor_posts',
    limitations:['Observed reactions/comments are not a performance forecast; ages and impressions are not matched.', r.text_coverage]
  }));
  for (const r of context.own_posts) {
    if ((r.client_id && r.client_id !== cid) || !r.post_social_id || !isStr(r.text)) continue;
    evidenceItems.push({id:'own_post:' + r.post_social_id,native_id:String(r.post_social_id),kind:'own_post',client_id:cid,source_date:dOnly(r.published_at),location:r.url || null,url:r.url || null,excerpt:r.text.slice(0,1800),table:'audn_writer_context.own_posts',format:r.format || null,limitations:['Own post text proves what was published, not that it succeeded. Only supplied eligible measurement can support performance claims.']});
  }
  for (const r of approvedSources) evidenceItems.push({id:(r.kind === 'buyer_question' ? 'buyer_question:' : 'founder:') + r.source_id,native_id:r.source_id,kind:r.kind === 'buyer_question' ? 'buyer_question' : 'founder',client_id:cid,source_date:dOnly(r.source_date || r.published_at),location:r.location,url:r.url || null,excerpt:r.excerpt,table:'audn_writer_context.sources',limitations:[...(r.restrictions || []),'Drafting permission is not publication approval.']});
  // Reuse stored public discovery only. No new scraping and no private mixed call bank.
  const PUBLIC_SOURCES = ['breaking_news','novelty','hacker_news','reddit_se','x_search','youtube_watch'];
  const leads = cid === 'ivan'
    ? await getJson('/lm_idea_candidates?select=id,source,raw_topic,normalized_topic,evidence,ingested_at&source=in.(' + PUBLIC_SOURCES.join(',') + ')&order=ingested_at.desc&limit=100')
    : await getJson('/client_ideas?select=id,client_id,source_label,source_ref,meta,created_at&client_id=eq.' + enc(cid) + '&order=created_at.desc&limit=100');
  let unsupportedLeads = 0;
  for (const r of leads) {
    const origin = cid === 'ivan' ? r.source : (r.meta || {}).source;
    if (!PUBLIC_SOURCES.includes(origin) || (cid !== 'ivan' && r.client_id !== cid)) { unsupportedLeads++; continue; }
    const evs = cid === 'ivan' ? r.evidence : (r.meta || {}).evidence;
    let included = false;
    for (const [idx,e] of (Array.isArray(evs) ? evs : []).entries()) {
      if (!e || (e.client_id && e.client_id !== cid) || (e.source && !PUBLIC_SOURCES.includes(e.source))) continue;
      const url = e.url || e.thread_url;
      const excerpt = e.excerpt || e.quote;
      if (!/^https?:\/\//.test(url || '') || !isStr(excerpt)) continue;
      const kind = ['breaking_news','novelty','hacker_news'].includes(origin) ? 'news' : 'trend';
      // These timestamps are nested source metadata, never idea creation/ingestion dates.
      const date = dOnly(e.published_at || e.shipped_at || e.source_date || e.created_at);
      evidenceItems.push({id:kind + ':' + r.id + ':' + idx,native_id:r.id,kind,source_origin:origin,client_id:cid,source_date:date,location:url,url,excerpt:excerpt.slice(0,1800),table:cid === 'ivan' ? 'lm_idea_candidates.evidence' : 'client_ideas.meta.evidence',limitations:['Stored public source excerpt, not independently verified in this run.','Discovery angle and generated interpretations are not factual evidence.',...(e.unverified_stats ? ['Source includes unverified statistics; do not repeat them as facts.'] : []),...(date ? [] : ['Source date unavailable; ineligible for timely slot.'])]});
      included = true;
    }
    if (!included) unsupportedLeads++;
  }
  // The same public source may be discovered in several idea rows or feeds.
  const sourceGroups = new Set();
  let duplicateEvidence = 0;
  for (let i=0;i<evidenceItems.length;) {
    const r = evidenceItems[i];
    r.source_group = sourceGroup(r.url) || r.id;
    if (sourceGroups.has(r.source_group)) { evidenceItems.splice(i,1); duplicateEvidence++; }
    else { sourceGroups.add(r.source_group); i++; }
  }
  const discoveryCandidates = evidenceItems.filter(r => ['news','trend'].includes(r.kind));
  const discoveryQueues = PUBLIC_SOURCES.map(origin => discoveryCandidates.filter(r => r.source_origin === origin));
  const discoverySelected = new Set();
  for (let round=0;discoverySelected.size<24;round++) {
    let found = false;
    for (const queue of discoveryQueues) {
      if (queue[round]) { discoverySelected.add(queue[round].id); found=true; }
      if (discoverySelected.size>=24) break;
    }
    if (!found) break;
  }
  for (let i=evidenceItems.length-1;i>=0;i--) if (['news','trend'].includes(evidenceItems[i].kind) && !discoverySelected.has(evidenceItems[i].id)) evidenceItems.splice(i,1);
  const rowById = {};
  for (const r of evidenceItems) rowById[r.id] = r;
  rec.pack_ids = evidenceItems.map(r => r.id);
  const research = {};
  const researchSelection = {};
  for (const table of ['client_research_insights','client_research_themes']) {
    const latest = await getJson('/' + table + '?select=run_id,created_at&client_id=eq.' + enc(cid) + '&order=created_at.desc&limit=1');
    const rows = latest.length ? await getJson('/' + table + '?select=*&client_id=eq.' + enc(cid) + '&run_id=eq.' + enc(latest[0].run_id) + '&limit=13') : [];
    researchSelection[table] = {fetched_n:rows.length,included_n:Math.min(12,rows.length),omitted_at_least:Math.max(0,rows.length-12),max_rows:12,exhaustive:rows.length<=12};
    research[table] = rows.filter(r => r.client_id === cid).slice(0,12).map(r => ({...r,freshness:fresh(dOnly(r.created_at)) ? 'recent_capture' : 'historical',limitation:'Generated research context, not primary evidence. Captured date is not event date. Recompute baselines from current roster rows.'}));
  }
  rec.coverage = {own_selection:ownSelection,measurement_selection:measurementSelection,research_selection:researchSelection,discovery_selection:{fetched_leads:leads.length,max_leads:100,eligible_distinct_sources:discoveryCandidates.length,included_n:discoverySelected.size,omitted_at_least:discoveryCandidates.length-discoverySelected.size,max_evidence_items:24,method:'round_robin_public_source_types_then_recent',exhaustive:leads.length<100 && discoveryCandidates.length===discoverySelected.size},recommendation_history:historyCoverage,kinds:Object.fromEntries(['competitor','own_post','founder','buyer_question','news','trend'].map(kind => [kind,{available:evidenceItems.filter(e => e.kind === kind).length,fresh:evidenceItems.filter(e => e.kind === kind && fresh(e.source_date)).length}])),unsupported_discovery_leads:unsupportedLeads,duplicate_evidence_omitted:duplicateEvidence,unavailable_sources:(context.sources || []).filter(x => !approvedSources.includes(x)).map(x => ({source_id:x.source_id,state:'unavailable'})),research_captures:Object.fromEntries(Object.entries(research).map(([k,v])=>[k,v.length ? {run_id:v[0].run_id,captured_at:v[0].created_at,freshness:v[0].freshness} : null]))};

  // already recommended: the lane's idea store plus this lane's open proposals
  const already = [];
  if (cid === 'ivan') {
    const lm = await getJson('/lm_idea_candidates?select=source_ref,raw_topic,raw_context&source=eq.audience_review&order=ingested_at.desc&limit=120');
    for (const r of lm) already.push({ source: 'idea', subject: String(r.raw_topic || '').slice(0, 400), source_ids: [] });
  } else {
    const ci = await getJson('/client_ideas?select=source_ref,hook,meta&client_id=eq.' + enc(cid) + '&source_ref=like.audn-rec:*&order=created_at.desc&limit=120');
    for (const r of ci) {
      const ev = (((r.meta || {}).audn) || {}).evidence || {};
      already.push({ source: 'idea', subject: String(r.hook || '').slice(0, 400), source_ids: Array.isArray(ev.source_ids) ? ev.source_ids : [] });
    }
  }
  for (const r of openRows) {
    const ev = (((r.context || {}).audn) || {}).evidence || {};
    already.push({ source: 'proposal', recommendation_id:r.id, subject: String(r.body || '').slice(0, 400), topic_key:(((r.context || {}).audn || {}).weekly || {}).topic_key || null, original_angle:((r.context || {}).audn || {}).original_angle || null, source_groups:((r.context || {}).source_rows || []).map(x => x.source_group || sourceGroup(x.url)).filter(Boolean), source_ids: Array.isArray(ev.source_ids) ? ev.source_ids : [] });
  }

  // ---- evidence path (D6/D7/D8): preview evidence:true, or this client is in the rollout
  // switch read above. content_evidence_pack is the service-only read from db/103; a fetch
  // failure here degrades to the legacy pack for this client (recorded on rec), never throws.
  let evidenceCandidates = [];
  let evidenceCandidatesForModel = [];
  if (evidenceActive) {
    try {
      const evidencePackRaw = await http({ method: 'POST', url: SB + '/rpc/content_evidence_pack', headers: HDR,
        body: { p_client_id: cid, p_week_start: WEEK_START }, json: true, timeout: 45000 });
      const built = buildEvidencePack({
        clientId: cid,
        weekStart: WEEK_START,
        studies: evidencePackRaw && evidencePackRaw.study ? [evidencePackRaw.study] : [],
        findings: (evidencePackRaw && Array.isArray(evidencePackRaw.findings)) ? evidencePackRaw.findings : [],
        ownResults: [],
        // Reuse the SAME permission-checked source list the legacy path already resolved (D4):
        // every entry here already cleared writer_eligible/state/consent above.
        clientFacts: approvedSources.map((s) => ({ source_id: s.source_id, permission: 'approved' })),
        // Must-fix 2: built from openRows (90 days of this client's rows, already read above),
        // never left empty -- otherwise a failed prior adaptation of this system's own output is
        // invisible to itself. source_finding_ids is the exact key a committed evidence-path row
        // persists (see context.evidence_package below), so a prior evidence-path row round-trips
        // straight into the next run's adaptation_history.
        previousTests: openRows.map((r) => ({
          recommendation_id: r.id,
          status: (((r.context || {}).weekly_decision) || {}).decision || 'proposed',
          week_start: ((((r.context || {}).audn) || {}).weekly || {}).week_start || null,
          source_finding_ids: (((r.context || {}).evidence_package) || {}).source_finding_ids || [],
        })).filter((t2) => t2.source_finding_ids.length),
        limit: EVIDENCE_POOL_LIMIT,
      });
      evidenceCandidates = built.candidates;
      rec.evidence_coverage = built.coverage;
      rec.evidence_missing_inputs = built.missingInputs;
      // Readable-source enrichment for the MODEL VIEW ONLY: content_evidence_pack's own posts
      // array (source_url, author_id, published_at) matched by canonical_source_id. Numbers
      // themselves are never taken from here -- only from the trusted candidate above -- this
      // just lets the model name the source winner it is citing.
      const postsById = new Map();
      for (const post of (evidencePackRaw && Array.isArray(evidencePackRaw.posts) ? evidencePackRaw.posts : [])) {
        if (post && post.canonical_source_id) postsById.set(String(post.canonical_source_id), post);
      }
      evidenceCandidatesForModel = evidenceCandidates.map((c) => ({
        draft_key: c.draft_key, objective: c.objective, proposed_angle: c.proposed_angle,
        test_metric: c.test_metric, comparison_rule: c.comparison_rule, observation_window: c.observation_window,
        needs_material: c.needs_material, limitations: c.limitations, label: c.label,
        experiment_reason: c.experiment_reason, adaptation_history: c.adaptation_history,
        source_summary: c.source_posts.map((sid) => {
          const post = postsById.get(String(sid));
          return post ? { source_post_id: sid, author_id: post.author_id || null, source_url: post.source_url || null, published_at: post.published_at || null } : { source_post_id: sid };
        }),
      }));
    } catch (e) {
      rec.evidence_fetch_error = String((e && e.message) || e).slice(0, 200);
    }
  }

  const pack = {
    ...context,
    client_id: cid,
    limit: t.limit,
    week_start: WEEK_START,
    cycle_id: CYCLE_ID,
    evidence_items: evidenceItems,
    evidence_candidates: evidenceCandidatesForModel,
    coverage: rec.coverage,
    market_research: research,
    roster: rosterOut,
    own_posts: context.own_posts.map(({text,...r}) => ({...r,evidence_id:'own_post:' + r.post_social_id})),
    measurement: compactMeasurement,
    source_baselines: sourceBaselines,
    source_selection: {candidate_n:compRows.length,included_n:packRows.length,omitted_n:compRows.length-packRows.length,method:'roster_round_robin_most_recent_first',text_budget_characters:SOURCE_TEXT_BUDGET,max_rows:MAX_SOURCE_ROWS,exhaustive:compRows.length===packRows.length},
    founder_sources: approvedSources.map(({excerpt,...r}) => ({...r,evidence_id:(r.kind === 'buyer_question' ? 'buyer_question:' : 'founder:') + r.source_id})),
    sources: [],
    already_recommended: already,
    generated_at: RUN_ISO,
    rules: {
      subject_ids: allowedSubjects,
      required_output: ['client_id','subject','buyer_relevance','original_angle','next_action'],
      own_performance: 'Use only supplied metric, eligible_n, target_age_days and capture basis; no claim if unavailable or below floor.',
      sources: 'Cite only evidence_items typed ids and exact source_date; founder_sources requires drafting consent. Market research and discovery angles are not primary evidence.',
      feedback: 'Use prior decision reasons and linked_results; a no-repeat list alone is not feedback.',
      approval: 'Client accept records intent; operator uses normal idea approval before generation/publication.'
    }
  };

  rec.coverage.source_selection = pack.source_selection;
  rec.coverage.input_characters = Object.fromEntries(Object.entries(pack).filter(([k]) => k !== 'coverage').map(([k,v]) => [k,JSON.stringify(v).length]));
  const modelPack = makeModelPack(pack);
  rec.coverage = modelPack.coverage;
  const modelIds = new Set(modelPack.evidence_items.map(r => r.id));
  for (const id of Object.keys(rowById)) if (!modelIds.has(id)) delete rowById[id];
  rec.pack_ids = [...modelIds];
  const inputCharacters = systemPrompt.length + 128 + JSON.stringify(modelPack).length;
  rec.coverage.input_total_characters = inputCharacters;
  if (inputCharacters > 200000) throw new Error('audn_input_budget_exceeded:' + cid);
  prepared.push({t,cid,rec,openRows,context,allowedSubjects,approvedSources,rosterOut,roleByName,accountByName,sourceBaselines,packRows,rowById,already,pack:modelPack,evidenceActive,evidenceCandidates});
}
for (const p of prepared) {
  const {t,cid,rec,openRows,context,allowedSubjects,approvedSources,rosterOut,roleByName,accountByName,sourceBaselines,packRows,rowById,already,pack,evidenceActive,evidenceCandidates}=p;
  const approvedSourcesById = new Map(approvedSources.map((s) => [s.source_id, s]));
  if (Date.now()-START > BUDGET_MS-280000) {rec.skipped=true;rec.reason='run_budget_exhausted';continue;}

  // ---- 5. one proxy call per client, never a retry loop -----------------------
  let aiText = '';
  try {
    const res = await http({
      method: 'POST', url: claudeUrl,
      headers: { 'X-API-Key': claudeKey, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-sonnet-5', max_tokens: 4000, messages: [{ role: 'user', content: systemPrompt + '\n\n---\nWEEKLY EVIDENCE (untrusted data):\n\n' + JSON.stringify(pack) }] },
      // 2026-09-13: 120s timed out on all three lanes once the rosters grew and every
      // pack hit the former 200-row cap. The call itself returns in well under a minute when the
      // proxy is healthy; this is headroom, not a retry.
      json: true, timeout: 240000,
    });
    aiText = ((res && res.content) || []).filter(p => p && p.type === 'text').map(p => p.text || '').join('');
  } catch (e) { rec.writer_bail = true; rec.reason = 'proxy_error'; rec.error_head = String((e && e.message) || e).slice(0, 200); continue; }
  if (!aiText.trim()) { rec.writer_bail = true; rec.reason = 'proxy_no_json'; continue; } // a quota refusal reads as empty
  const mJ = aiText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  // hotfix-02 lesson: an HTTP 200 whose only content is the weekly-limit banner carries no
  // JSON at all. That is an infra refusal, not an answer. Bail; the next run retries.
  if (!mJ) { rec.writer_bail = true; rec.reason = 'proxy_no_json'; continue; }
  let parsed = null;
  try { parsed = JSON.parse(mJ[0]); } catch (e) { parsed = null; }
  if (parsed === null || parsed === undefined) { rec.writer_bail = true; rec.reason = 'proxy_no_json'; continue; }
  const items = Array.isArray(parsed) ? parsed : [parsed];

  // ---- 6. validation: an invalid item is DROPPED, never repaired ---------------
  const keep = [];
  let evidenceExperimentUsed = false;
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const drop = (reason) => { rec.dropped.push({ index: idx, reason: reason }); };
    if (!it || typeof it !== 'object' || Array.isArray(it)) { drop('not_an_object'); continue; }
    if (it.client_id !== cid) { drop('wrong_client'); continue; }
    if (!allowedSubjects.includes(it.subject)) { drop('wrong_subject'); continue; }
    if (![it.buyer_relevance,it.original_angle,it.next_action].every(isStr)) { drop('editorial_handoff_missing'); continue; }
    const founderIds = Array.isArray(it.founder_source_ids) ? it.founder_source_ids : [];
    if (founderIds.some(id => !approvedSources.some(x => x.source_id === id))) { drop('founder_source_not_approved'); continue; }
    const ev = it.evidence;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) { drop('evidence_missing'); continue; }
    const ids = Array.isArray(ev.source_ids) ? ev.source_ids.map(String) : null;
    if (!ids || !ids.length || new Set(ids).size !== ids.length) { drop('source_ids_empty'); continue; }
    let unknownId = false;
    for (const id of ids) if (!rowById[id]) unknownId = true;
    if (unknownId) { drop('source_id_not_in_pack'); continue; }
    const cited = ids.map(id => rowById[id]);
    if (cited.filter(r => ['founder','buyer_question'].includes(r.kind)).some(r => !founderIds.includes(r.native_id)) || founderIds.some(id => !cited.some(r => r.native_id === id && ['founder','buyer_question'].includes(r.kind)))) { drop('founder_citation_mismatch'); continue; }
    const dates = Array.isArray(ev.source_dates) ? ev.source_dates : null;
    const want = cited.map(r => r.source_date);
    if (!dates || dates.length !== want.length || JSON.stringify(dates) !== JSON.stringify(want)) { drop('source_dates_mismatch'); continue; }
    if (ev.sample_n !== ids.length) { drop('sample_n_mismatch'); continue; }
    if (typeof ev.unknowns !== 'string') { drop('unknowns_missing'); continue; }
    if (!isStr(it.what_changed) || !isStr(it.why_it_matters) || !isStr(it.could_publish) || !isStr(it.proof_needed)) { drop('text_field_empty'); continue; }
    if (!isStr(it.title) || it.title.length > 80) { drop('title_invalid'); continue; }
    const accs = Array.isArray(it.roster_accounts) ? it.roster_accounts.map(String) : null;
    const competitorCited = cited.filter(r => r.kind === 'competitor');
    if (!accs || (competitorCited.length && !accs.length)) { drop('roster_accounts_empty'); continue; }
    if (!competitorCited.length && (accs.length || it.roster_role !== null)) { drop('unrelated_roster_claim'); continue; }
    if (competitorCited.length) {
      const roles = [...new Set(accs.map(a => roleByName[nz(a)]))];
      if (roles.includes(undefined)) { drop('roster_account_not_in_roster'); continue; }
      if (roles.length !== 1) { drop('roster_role_mixed'); continue; }
      if (String(it.roster_role) !== String(roles[0])) { drop('roster_role_mismatch'); continue; }
      if (competitorCited.some(r => !accs.some(a => accountByName[nz(a)] === accountByName[nz(r.competitor_name)]))) { drop('cited_author_not_in_roster_accounts'); continue; }
    }
    const weekly = it.weekly;
    if (!weekly || weekly.week_start !== WEEK_START || !['supported','timely','experiment'].includes(weekly.slot)
      || !['high','medium','low'].includes(weekly.evidence_confidence)
      || ![weekly.hook,weekly.intended_response,weekly.why_now,weekly.success_metric,weekly.confidence_reason,weekly.priority_reason,weekly.topic_key,it.format].every(isStr)
      || !Number.isInteger(weekly.rank) || weekly.rank < 1 || weekly.rank > t.limit) { drop('weekly_package_invalid'); continue; }
    if (!weekly.learning || !Array.isArray(weekly.learning.recommendation_ids) || !isStr(weekly.learning.explanation)
      || weekly.learning.recommendation_ids.some(id => !pack.previous_decisions_and_results.some(r => r.recommendation_id === id))) { drop('learning_reference_invalid'); continue; }
    if (weekly.slot === 'timely' && !cited.some(r => fresh(r.source_date))) { drop('timely_evidence_not_fresh'); continue; }
    const topic = nz(weekly.topic_key).replace(/[^a-z0-9]+/g,' ');
    if (keep.some(k => nz(k.item.weekly.topic_key).replace(/[^a-z0-9]+/g,' ') === topic || nz(k.item.original_angle) === nz(it.original_angle))
      || already.some(r => (r.topic_key && nz(r.topic_key).replace(/[^a-z0-9]+/g,' ') === topic) || (r.original_angle && nz(r.original_angle) === nz(it.original_angle)))) { drop('duplicate_topic'); continue; }
    const publicStories = cited.filter(r => ['news','trend'].includes(r.kind)).map(r => r.source_group);
    if (publicStories.some(group => keep.some(k => k.cited.some(r => r.source_group === group)) || already.some(r => (r.source_groups || []).includes(group)))) { drop('duplicate_source_story'); continue; }
    if (keep.some(k => k.item.weekly.rank === weekly.rank)) { drop('duplicate_rank'); continue; }
    if (!(it.asset_required === false || isStr(it.asset_required))) { drop('asset_required_invalid'); continue; }
    const texts = [it.what_changed, it.why_it_matters, it.could_publish, it.proof_needed,it.buyer_relevance,it.original_angle,it.next_action,weekly.hook,weekly.why_now,weekly.intended_response,weekly.success_metric,weekly.confidence_reason,weekly.priority_reason,weekly.learning.explanation];
    const prose = [...texts,it.title,ev.unknowns,typeof it.asset_required === 'string' ? it.asset_required : ''].join(' ').trim();
    if (prose.split(/\s+/).filter(Boolean).length > 250) { drop('package_word_budget_exceeded'); continue; }
    if (/\d+(?:\.\d+)?\s*%/.test(weekly.confidence_reason) || /\b(?:will|guaranteed to)\s+(?:increase|boost|generate|deliver|drive|convert|outperform|win)\b/i.test(texts.join(' '))) { drop('unsupported_forecast'); continue; }
    const lintBlob = nz(texts.join(' \n ') + ' \n ' + it.title);
    let badWord = null;
    for (const f of FORBIDDEN) if (lintBlob.indexOf(nz(f)) >= 0) { badWord = f; break; }
    if (badWord !== null) { drop('copy_lint:' + (badWord === '—' ? 'em_dash' : badWord.replace(/\s+/g, '_'))); continue; }
    const hay = cited.map(r => nz(r.excerpt)).concat(approvedSources.filter(x => founderIds.includes(x.source_id)).map(x => nz(x.excerpt))).join(' \n ');
    let badQuote = false;
    for (const s of texts) for (const span of quotedSpans(s)) if (hay.indexOf(nz(span)) < 0) badQuote = true;
    if (badQuote) { drop('quote_not_in_source'); continue; }
    // ---- evidence path validation (D6): only when this client's evidence path is active. The
    // model may reference at most one offered candidate per item, by its draft_key. Numbers are
    // NEVER trusted from the model -- the committed evidence_package is always copied from the
    // server-built candidate, never from model-echoed fields, so "numbers that differ from the
    // pack" cannot occur in what gets saved. What IS validated here is which candidate (if any)
    // the model is entitled to cite.
    let evidenceCandidate = null;
    if (evidenceActive && it.evidence_candidate_key !== undefined && it.evidence_candidate_key !== null) {
      const key = String(it.evidence_candidate_key);
      evidenceCandidate = (evidenceCandidates || []).find((c) => c.draft_key === key) || null;
      if (!evidenceCandidate) { drop('evidence_candidate_unknown'); continue; }
      if (evidenceCandidate.label === 'experiment' && evidenceExperimentUsed) { drop('evidence_candidate_second_experiment'); continue; }
      if (!isStr(evidenceCandidate.objective) || !isStr(evidenceCandidate.test_metric)) { drop('evidence_candidate_missing_objective'); continue; }
      // A model-echoed evidence_package, if present at all, must match the trusted candidate
      // exactly on every field it repeats -- it is optional and only ever cross-checked, never
      // the source of truth.
      if (it.evidence_package && typeof it.evidence_package === 'object' && !Array.isArray(it.evidence_package)) {
        const echoed = it.evidence_package;
        const echoedIds = Array.isArray(echoed.source_finding_ids) ? echoed.source_finding_ids : null;
        if (!echoedIds || JSON.stringify([...echoedIds].sort()) !== JSON.stringify([...evidenceCandidate.source_finding_ids].sort())) { drop('evidence_package_number_mismatch'); continue; }
        const echoedFacts = Array.isArray(echoed.client_fact_refs) ? echoed.client_fact_refs : [];
        if (echoedFacts.some((f) => !evidenceCandidate.client_fact_refs.includes(f))) { drop('evidence_package_unauthorized_client_fact'); continue; }
        if (echoed.objective !== undefined && echoed.objective !== evidenceCandidate.objective) { drop('evidence_package_number_mismatch'); continue; }
      }
      // Relevance-as-performance guard: an evidence_backed source is someone ELSE's post. Prose
      // may never phrase that source's lift as the client's own achieved result. This is a
      // heuristic first-person-achievement scan, not exhaustive; the second (model) review pass
      // named in the plan supplements it.
      if (evidenceCandidate.label === 'evidence_backed'
          && /\b(?:our|we)\s+(?:saw|achieved|got|generated|drove|delivered|hit)\b[^.]{0,80}\b(?:reach|engagement|likes|views|results?|impressions)\b/i.test(texts.join(' '))) {
        drop('evidence_package_relevance_as_performance'); continue;
      }
    }
    if (keep.length >= t.limit) { drop('over_limit'); continue; }
    if (evidenceCandidate && evidenceCandidate.label === 'experiment') evidenceExperimentUsed = true;
    keep.push({ item: it, cited: cited, evidenceCandidate });
  }

  // ---- 7. write: ops_drafts only ---------------------------------------------
  rec.coverage.requested = t.limit;
  rec.coverage.proposed = keep.length;
  rec.coverage.shortfall = t.limit - keep.length;
  if (!keep.length) {
    if (PREVIEW) rec.rows = [];
    if (items.length) { rec.reason = 'no_valid_candidates'; rec.writer_bail = true; continue; }
    rec.reason = 'no_supported_candidates';
    // A deliberate [] completes the week. Invalid/refused responses remain retryable.
    if (PREVIEW) continue;
  }
  keep.sort((a,b) => a.item.weekly.rank - b.item.weekly.rank);
  const rows = keep.map(k => {
    const it = k.item;
    const cited = k.cited;
    const authors = {};
    for (const r of cited.filter(r => r.kind === 'competitor')) authors[nz(shortName(r.competitor_name))] = true;
    let baseline = null;
    const authorKeys = Object.keys(authors);
    if (authorKeys.length === 1) {
      baseline = sourceBaselines.find(x => nz(shortName(x.author)) === authorKeys[0]) || null;

    }
    return {
      client_id: cid,
      kind: KIND,
      slack_channel: null,
      body: it.what_changed,
      context: {
        audn: {
          weekly: it.weekly,
          what_changed: it.what_changed,
          why_it_matters: it.why_it_matters,
          could_publish: it.could_publish,
          proof_needed: it.proof_needed,
          evidence: { source_ids: it.evidence.source_ids.map(String), source_dates: cited.map(r => r.source_date), sample_n: it.evidence.source_ids.length, unknowns: it.evidence.unknowns },
          roster_role: it.roster_role,
          roster_accounts: it.roster_accounts.map(a => accountByName[nz(a)] || String(a)),
          asset_required: it.asset_required === false ? false : String(it.asset_required),
          asset_state: it.asset_required === false ? 'none' : 'missing',
          pillar: (it.pillar === undefined || it.pillar === null || it.pillar === '') ? null : String(it.pillar),
          format: (it.format === undefined || it.format === null || it.format === '') ? null : String(it.format),
          title: it.title,
          subject: it.subject,
          buyer_relevance: it.buyer_relevance,
          original_angle: it.original_angle,
          next_action: it.next_action,
          founder_source_ids: Array.isArray(it.founder_source_ids) ? it.founder_source_ids : [],
        },
        source_rows: cited.map(r => ({ table:r.table,id:r.id,native_id:r.native_id,kind:r.kind,client_id:cid,author:r.competitor_name || null,date:r.source_date,url:r.url,location:r.location,excerpt:r.excerpt,source_group:r.source_group,format:r.format || null,gate:r.gate || null,limitations:r.limitations,reactions:r.likes_count ?? null,comments:r.comments_count ?? null,shares:r.reposts_count ?? null })),
        source_coverage: rec.coverage,
        author_baseline: baseline,
        proposed_at: RUN_ISO,
        cycle_id: CYCLE_ID,
        prompt: PROMPT_STAMP,
        provenance: 'production',
        context_schema: context.schema_version,
        evidence_cutoff: context.cutoff,
        client_brief_version: context.brief.version,
        feedback_ids: context.previous_decisions_and_results.map(x => x.recommendation_id),
        seed: null,
        published: null,
        // Evidence path only (D6): always copied from the server-built, already-validated
        // candidate -- never from model-echoed fields, so this can never carry a number the
        // pack did not produce. Absent entirely on every legacy row, exactly matching prior
        // behavior byte for byte when the evidence path is inactive.
        // F3 (audit): saved at context.evidence_package -- top level, sibling of audn -- which is
        // exactly where the writer's own history read (previousTests, above) and commitGuard
        // both look. client_fact_refs is never a bare id: each entry is the consent-checked
        // approved source's own kind plus a short human label, resolved here, never on screen as
        // a raw id. needs_material and experiment_reason are always/conditionally present so a
        // reader (or the SQL reader) never has to reconstruct them from other fields.
        ...(k.evidenceCandidate ? { evidence_package: {
          schema_version: k.evidenceCandidate.schema_version,
          source_finding_ids: k.evidenceCandidate.source_finding_ids,
          source_posts: k.evidenceCandidate.source_posts,
          client_fact_refs: k.evidenceCandidate.client_fact_refs.map((factId) => {
            const src = approvedSourcesById.get(factId);
            return { source_id: factId, kind: (src && src.kind) || null, label: clientFactLabel(src) };
          }),
          objective: k.evidenceCandidate.objective,
          test_metric: k.evidenceCandidate.test_metric,
          metric_id: k.evidenceCandidate.metric_id,
          comparison_rule: k.evidenceCandidate.comparison_rule,
          observation_window: k.evidenceCandidate.observation_window,
          adaptation_history: k.evidenceCandidate.adaptation_history,
          needs_material: k.evidenceCandidate.needs_material,
          limitations: k.evidenceCandidate.limitations,
          label: k.evidenceCandidate.label,
          ...(k.evidenceCandidate.label === 'experiment' ? { experiment_reason: k.evidenceCandidate.experiment_reason } : {}),
        } } : {}),
      },
    };
  });
  if (PREVIEW) { rec.rows = rows; rec.proposed = rows.length; continue; }
  // Defense in depth (D6): structurally this point is only reachable for evidence_package rows
  // when evidenceActive was true in live mode, which only happens for a rollout-named client --
  // but commitGuard is the one tested, explicit refusal, so it is asked here rather than trusted
  // implicitly. The earlier audn_writer_cycles lookup already refused a real duplicate cycle, so
  // existingCommits is empty here by construction; this call exists to fail loudly if that
  // invariant is ever broken upstream, not because a duplicate is expected in practice.
  if (rows.some((r) => r.context.evidence_package)) {
    const guard = commitGuard({ pack: { clientId: cid, weekStart: WEEK_START }, rolloutEnabled: evidenceRollout.clients.includes(cid), existingCommits: [] });
    if (!guard.allowed) { rec.writer_bail = true; rec.reason = 'evidence_commit_blocked:' + guard.reason; continue; }
  }
  const commit = await http({ method: 'POST', url: SB + '/rpc/audn_recommendation_commit', headers: HDR,
    body: { p_client_id: cid, p_cycle_id: CYCLE_ID, p_rows: rows, p_limit: t.limit, p_force_gap: FORCE_GAP }, json: true });
  if (!commit || commit.ok !== true) { rec.writer_bail = true; rec.reason = commit && commit.reason || 'commit_failed'; continue; }
  rec.proposed = commit.written;
  rec.already_committed = commit.already === true;
}

return [{ json: summary }];
