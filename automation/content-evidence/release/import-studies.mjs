// content-evidence / release / import-studies.mjs
//
// Imports one hash-verified methods-v2 market study into the db/103 tables
// (client_research_studies, client_research_study_posts, client_research_findings).
//
// DRY RUN IS THE DEFAULT. `--apply` is required to emit anything executable, and even then this
// module runs nothing itself: it hands a single SQL transaction to an explicit executor command
// the caller names. There is no credential in this file and no network client.
//
// ---------------------------------------------------------------------------------------------
// THE STATE QUESTION, ANSWERED ONCE, HERE
//
// The Run 2 studies carry `state: "descriptive_only"`. That word is not in the contract
// vocabulary (contracts.mjs MANIFEST_STATES, and the same five values as a CHECK constraint in
// db/103), and it is not a synonym for any of them, because it answers a different question:
//
//   `descriptive_only`  is about INTERPRETIVE SCOPE. It says these numbers describe what
//                       happened and support no causal or predictive claim.
//   the manifest state  is about ARITHMETIC. contracts.mjs says so in its own header: "validated
//                       is a claim about arithmetic, not a workflow step. A manifest may not call
//                       itself validated while it still carries an unresolved numerical
//                       discrepancy."
//
// So the scope statement is NOT thrown away and NOT translated. It is preserved where it belongs:
// every finding keeps `validation_state: 'computed'` (never 'validated'), every finding keeps
// `age_comparability: 'unknown'`, and the study's own five limitations ride into the manifest.
// The manifest state answers only the arithmetic question, and this module answers it from
// evidence rather than by assertion:
//
//   `needs_reconciliation`  the study declares an unresolved numerical discrepancy.
//   `validated`             BOTH hashes verify -- the posts file on disk hashes to the sha256 the
//                           study recorded for it, and the method module hashes to the
//                           method_sha256 the study recorded -- AND the study declares no
//                           unresolved discrepancy. The arithmetic is reproducible from named
//                           bytes by a named function; that is exactly what contracts.mjs's only
//                           bar for `validated` asks, and it permits this case.
//   `imported`              anything else, including any hash that does not verify. An
//                           unverifiable study is stored and inspectable and is never served:
//                           content_evidence_pack reads validated market studies only.
//
// The legacy 147-vs-153/140 RISE discrepancy belongs to the SEPTEMBER 19 study under the legacy
// method. It is not restated here: these are methods-v2 recomputations with their own formula,
// their own counts and their own method hash, and they do not inherit the older study's open
// question. Importing them never gives the legacy study a badge.
//
// ---------------------------------------------------------------------------------------------
// PRIVACY
//
// Post bodies go to the database and nowhere else. The generated SQL carries them, so the SQL is
// refused a destination inside the repository: `--out` must resolve outside the repo root. The
// dry-run summary prints counts and hashes only, never a post body, an author name or a URL.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashArray, hashObject, utcIso, validateManifest, validateFinding } from '../contracts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

export class StudyImportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'StudyImportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new StudyImportError(code, message, details); };

export const STUDY_KIND = 'market';
export const SCHEMA_VERSION = 1;
/** The source vocabulary this module knows how to read. */
export const SOURCE_STATE = 'descriptive_only';

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {string} args.sourceState              the study file's own `state`
 * @param {boolean} args.sourceHashVerified      posts file bytes hash to the recorded sha256
 * @param {boolean} args.methodHashVerified      method module bytes hash to the recorded sha256
 * @param {unknown[]} [args.unresolvedDiscrepancies]
 * @returns {{ state: string, reason: string }}
 */
export function mapManifestState({
  sourceState, sourceHashVerified, methodHashVerified, unresolvedDiscrepancies = [],
} = {}) {
  if (typeof sourceState !== 'string' || sourceState.trim() === '') {
    fail('IMPORT_UNKNOWN_SOURCE_STATE', 'the study must declare its own state');
  }
  const unresolved = Array.isArray(unresolvedDiscrepancies) ? unresolvedDiscrepancies.length : 1;
  if (unresolved > 0) {
    return { state: 'needs_reconciliation', reason: `${unresolved} numerical discrepancy/discrepancies are unresolved` };
  }
  if (sourceState !== SOURCE_STATE) {
    // A state this module was not written to read is never upgraded on a guess.
    return { state: 'imported', reason: `source state ${JSON.stringify(sourceState)} is outside this importer's vocabulary` };
  }
  if (sourceHashVerified === true && methodHashVerified === true) {
    return {
      state: 'validated',
      reason: 'the recorded source bytes and the recorded method module both hash as declared, so the arithmetic reproduces from named inputs and no discrepancy is open',
    };
  }
  return {
    state: 'imported',
    reason: 'a declared hash did not verify, so the arithmetic is not reproducible from named inputs and the study is stored unserved',
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Pure. Builds every row the import would write, plus the counts to compare against the study's
 * own summary. Opens nothing and writes nothing.
 *
 * @param {object} args
 * @param {string} args.clientId
 * @param {object} args.study            the parsed methods-v2 study file
 * @param {object[]} args.posts          the parsed joined posts file for that client
 * @param {boolean} args.sourceHashVerified
 * @param {boolean} args.methodHashVerified
 * @param {string} args.studySha256      sha256 of the study file bytes
 * @param {string} args.sourceSha256     sha256 of the posts file bytes
 * @param {string} args.methodSha256     sha256 of the method module bytes
 */
export function buildStudyImport({
  clientId, study, posts, sourceHashVerified, methodHashVerified,
  studySha256, sourceSha256, methodSha256,
} = {}) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    fail('IMPORT_MISSING_CLIENT', 'buildStudyImport requires an explicit clientId');
  }
  if (study === null || typeof study !== 'object') fail('IMPORT_BAD_STUDY', 'study must be an object');
  if (!Array.isArray(posts)) fail('IMPORT_BAD_POSTS', 'posts must be an array');
  if (study.client_id !== clientId) {
    fail('IMPORT_TENANT_MISMATCH',
      `study belongs to ${JSON.stringify(study.client_id)} but the import context is ${JSON.stringify(clientId)}`);
  }
  for (const post of posts) {
    if (post.client_id !== clientId) {
      fail('IMPORT_TENANT_MISMATCH',
        `a post row carries tenant ${JSON.stringify(post.client_id)} but the import context is ${JSON.stringify(clientId)}`);
    }
  }

  const studyId = study.study_id;
  if (typeof studyId !== 'string' || studyId.trim() === '') fail('IMPORT_BAD_STUDY', 'study_id is required');
  const cutoffIso = utcIso(study.cutoff);
  if (cutoffIso === null) fail('IMPORT_BAD_STUDY', 'the study must carry a parseable observation cutoff');

  const unresolved = Array.isArray(study.unresolved_discrepancies) ? study.unresolved_discrepancies : [];
  const mapped = mapManifestState({
    sourceState: study.state,
    sourceHashVerified, methodHashVerified,
    unresolvedDiscrepancies: unresolved,
  });

  // Own controls leave the market population before anything else is considered.
  const ownControlIds = new Set((study.own_control_exclusions ?? []).map((e) => e.post_id));
  const methodExcluded = new Map((study.excluded ?? []).map((e) => [e.post_id, e.reason ?? 'method_excluded']));

  const postRows = [];
  let marketCount = 0;
  let ownControlCount = 0;
  let excludedCount = 0;
  const excludedByReason = {};
  let windowFrom = null;
  let windowTo = null;

  for (const post of posts) {
    const id = typeof post.post_id === 'string' ? post.post_id.trim() : '';
    if (id === '') fail('IMPORT_BAD_POSTS', 'every post row needs a post_id to be its canonical identity');
    const publishedIso = utcIso(post.published_at);
    const capturedIso = utcIso(post.captured_at);
    const isOwnControl = ownControlIds.has(id);
    const methodReason = methodExcluded.get(id) ?? null;

    let population = 'market';
    let inclusion = 'included';
    let exclusionReason = null;
    if (isOwnControl) {
      population = 'own_control';
      inclusion = 'excluded';
      exclusionReason = 'own_control';
      ownControlCount += 1;
    } else if (methodReason !== null) {
      population = 'excluded';
      inclusion = 'excluded';
      exclusionReason = methodReason;
      excludedCount += 1;
    } else {
      marketCount += 1;
      if (publishedIso !== null) {
        if (windowFrom === null || publishedIso < windowFrom) windowFrom = publishedIso;
        if (windowTo === null || publishedIso > windowTo) windowTo = publishedIso;
      }
    }
    if (exclusionReason !== null) {
      excludedByReason[exclusionReason] = (excludedByReason[exclusionReason] ?? 0) + 1;
    }

    postRows.push({
      client_id: clientId,
      study_id: studyId,
      canonical_source_id: id,
      source_url: post._raw?.url ?? null,
      author_id: post.author_id ?? null,
      author_role: null,
      published_at: publishedIso,
      first_captured_at: capturedIso,
      last_captured_at: capturedIso,
      post_text: post._raw?.text ?? null,
      artifact_location: null,
      artifact_sha256: null,
      format_evidence: post._raw?.post_type ? { post_type: post._raw.post_type } : {},
      observed_metrics: pickMetrics(post),
      observations: capturedIso === null ? [] : [{ captured_at: capturedIso, metrics: pickMetrics(post) }],
      population,
      is_own_control: isOwnControl,
      inclusion,
      exclusion_reason: exclusionReason,
      // Every capture date in this corpus may be a snapshot/row-insert time, so no row claims to
      // be age comparable. The study says so in its own limitations; the column says so per row.
      age_comparability: 'unknown',
      content_sha256: sha256Hex(JSON.stringify([id, post._raw?.url ?? null, post.author_id ?? null, publishedIso, post._raw?.text ?? null])),
    });
  }

  const retainedIds = new Set(postRows.map((r) => r.canonical_source_id));
  const findingRows = [];
  for (const finding of study.findings ?? []) {
    if (finding.client_id !== clientId) {
      fail('IMPORT_TENANT_MISMATCH', `finding ${finding.finding_id} carries a foreign tenant`);
    }
    if (finding.study_id !== studyId) {
      fail('IMPORT_FINDING_STUDY_MISMATCH', `finding ${finding.finding_id} names study ${JSON.stringify(finding.study_id)}`);
    }
    const missing = (finding.source_ids ?? []).filter((sid) => !retainedIds.has(sid));
    if (missing.length > 0) {
      fail('IMPORT_FINDING_SOURCE_MISSING',
        `finding ${finding.finding_id} references source id(s) the corpus does not retain`, { count: missing.length });
    }
    // A finding whose source left the market population would be a market claim about a control.
    const sourcesInMarket = (finding.source_ids ?? []).every(
      (sid) => postRows.find((r) => r.canonical_source_id === sid)?.population === 'market');
    if (finding.kind === 'market' && !sourcesInMarket) {
      fail('IMPORT_FINDING_SOURCE_NOT_MARKET',
        `market finding ${finding.finding_id} points at a row that is not in the market population`);
    }
    validateFinding(finding, { clientId });
    findingRows.push({
      client_id: clientId,
      study_id: studyId,
      finding_id: finding.finding_id,
      kind: finding.kind,
      metric_id: finding.metric_id,
      observed_value: finding.observed_value ?? null,
      baseline_value: finding.baseline_value ?? null,
      baseline_n: finding.baseline_n ?? null,
      lift: finding.lift ?? null,
      formula: finding.formula,
      method_version: finding.method_version,
      source_ids: finding.source_ids,
      comparator_ids: null,
      comparator_n: null,
      per_author_results: null,
      sample_method: null,
      sample_size: null,
      unknown_count: null,
      class_definition: null,
      classifier_version: null,
      source_dates: finding.source_dates ?? {},
      capture_dates: finding.capture_dates ?? {},
      age_comparability: finding.age_comparability ?? 'unknown',
      // Nothing is dropped: the baseline the study floored and the floor it used are numbers, so
      // they are kept rather than rounded away into the lift.
      uncertainty: {
        baseline_raw_value: finding.baseline_raw_value ?? null,
        baseline_floor: finding.baseline_floor ?? null,
      },
      selection_method: study.policy?.id ?? null,
      limitations: finding.limitations ?? [],
      // The scope statement lands here and stays here. A reproduced measurement is `computed`;
      // nothing in this import promotes a finding to `validated`.
      validation_state: 'computed',
    });
  }

  // The author's display name has no column of its own in db/103 and this import adds none. The
  // study's manifest is the study's own metadata about its population, so the directory of the
  // authors it retained lives there and the reader looks a name up by author_id. Public names
  // already visible on the source URL; no private identity is added by this map.
  const authorDirectory = {};
  for (const post of posts) {
    const id = post.author_id ?? null;
    const name = typeof post.author_name === 'string' ? post.author_name.trim() : '';
    if (id !== null && name !== '' && authorDirectory[id] === undefined) authorDirectory[id] = name;
  }

  const rankedAuthors = (study.baselineCoverage ?? []).filter((a) => a.ranked === true).length;
  const totalAuthors = (study.baselineCoverage ?? []).length;
  const missingInputs = [];
  if (rankedAuthors < 20) {
    missingInputs.push(`only ${rankedAuthors} of ${totalAuthors} authors carry at least ${study.policy?.minimumN ?? 20} baseline posts`);
  }
  if (findingRows.length === 0) {
    missingInputs.push('no market finding cleared the screening policy');
  }
  if (findingRows.every((f) => f.age_comparability === 'unknown')) {
    missingInputs.push('capture ages are unmatched, so observed values are not age comparable');
  }
  const summaryEligible = study.summary?.eligible_posts ?? null;
  if (summaryEligible !== null && summaryEligible !== marketCount) {
    missingInputs.push(`the study counts ${summaryEligible} eligible posts while ${marketCount} rows enter the market population`);
  }

  const manifest = {
    schema_version: SCHEMA_VERSION,
    client_id: clientId,
    study_id: studyId,
    study_kind: STUDY_KIND,
    method_version: study.method_version,
    source_paths: [
      { path: study.source?.path ?? 'unknown', sha256: sourceSha256 },
      { path: `studies/${clientId}.json`, sha256: studySha256 },
    ],
    publication_window: { from: dayOf(windowFrom), to: dayOf(windowTo) },
    observation_cutoff: cutoffIso,
    metric_definitions: { [study.policy?.id ?? 'public_weighted']: study.findings?.[0]?.formula ?? 'likes + 3 * reposts' },
    // There is no versioned roster behind this corpus: it is a frozen file. Naming the file's own
    // identity is the honest answer, and it is never an invented roster version.
    roster_version: `frozen-corpus-${sourceSha256.slice(0, 12)}`,
    eligibility: study.policy ?? {},
    excluded_counts: excludedByReason,
    classifier_versions: [],
    unresolved_discrepancies: unresolved,
    state: mapped.state,
    // Kept verbatim from the study so the scope statement travels with the import.
    limitations: study.limitations ?? [],
    author_directory: authorDirectory,
    source_state: study.state,
    state_reason: mapped.reason,
    method_sha256: methodSha256,
  };
  validateManifest(manifest, { clientId });

  const studyRow = {
    client_id: clientId,
    study_id: studyId,
    study_kind: STUDY_KIND,
    method_version: study.method_version,
    state: mapped.state,
    schema_version: SCHEMA_VERSION,
    manifest,
    source_paths: manifest.source_paths,
    publication_window_from: manifest.publication_window.from,
    publication_window_to: manifest.publication_window.to,
    observation_cutoff: cutoffIso,
    metric_definitions: manifest.metric_definitions,
    roster_version: manifest.roster_version,
    eligibility: manifest.eligibility,
    excluded_counts: excludedByReason,
    classifier_versions: [],
    unresolved_discrepancies: unresolved,
    missing_inputs: missingInputs,
    content_sha256: studySha256,
  };

  const counts = {
    client_id: clientId,
    study_id: studyId,
    manifest_state: mapped.state,
    state_reason: mapped.reason,
    source_hash_verified: sourceHashVerified === true,
    method_hash_verified: methodHashVerified === true,
    post_rows: postRows.length,
    market_rows: marketCount,
    own_control_rows: ownControlCount,
    method_excluded_rows: excludedCount,
    finding_rows: findingRows.length,
    ranked_authors: rankedAuthors,
    total_authors: totalAuthors,
  };

  const comparison = compareToSummary(counts, study.summary ?? {});

  return {
    client_id: clientId,
    study_id: studyId,
    manifest,
    study_row: studyRow,
    post_rows: postRows,
    finding_rows: findingRows,
    counts,
    comparison,
    hashes: {
      study_file_sha256: studySha256,
      source_file_sha256: sourceSha256,
      method_sha256: methodSha256,
      post_rows_sha256: hashArray(postRows.map((r) => ({ id: r.canonical_source_id, sha: r.content_sha256 }))),
      finding_rows_sha256: hashArray(findingRows.map((r) => r.finding_id)),
      manifest_sha256: hashObject(manifest),
    },
  };
}

/**
 * Structural identity against the study's own summary. A mismatch is an error, not a note: the
 * rows and the receipt must describe the same corpus.
 */
export function compareToSummary(counts, summary) {
  const problems = [];
  const stored = summary.stored_posts ?? null;
  const ownControls = summary.own_control_posts_excluded ?? null;
  const findings = summary.findings ?? null;
  if (stored !== null && stored !== counts.post_rows) {
    problems.push(`study summary says ${stored} stored posts, the plan writes ${counts.post_rows} post rows`);
  }
  if (ownControls !== null && ownControls !== counts.own_control_rows) {
    problems.push(`study summary says ${ownControls} own control posts, the plan writes ${counts.own_control_rows}`);
  }
  if (stored !== null && ownControls !== null
      && counts.market_rows + counts.own_control_rows + counts.method_excluded_rows !== stored) {
    problems.push('market + own control + excluded rows do not add up to the stored post count');
  }
  if (findings !== null && findings !== counts.finding_rows) {
    problems.push(`study summary says ${findings} findings, the plan writes ${counts.finding_rows}`);
  }
  return {
    ok: problems.length === 0,
    problems,
    summary_eligible_posts: summary.eligible_posts ?? null,
    plan_market_rows: counts.market_rows,
  };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const BATCH = 200;

/**
 * One transaction. Every statement is an idempotent upsert keyed on the table's own primary key,
 * so applying it twice writes the same rows and changes nothing the second time.
 */
export function renderImportSql(plan) {
  const out = ['begin;'];
  out.push(insertStudy(plan.study_row));
  for (const batch of chunk(plan.post_rows, BATCH)) out.push(insertPosts(batch));
  for (const batch of chunk(plan.finding_rows, BATCH)) out.push(insertFindings(batch));
  out.push('commit;');
  return out.join('\n\n') + '\n';
}

function insertStudy(r) {
  return `insert into public.client_research_studies
  (client_id, study_id, study_kind, method_version, state, schema_version, manifest, source_paths,
   publication_window_from, publication_window_to, observation_cutoff, metric_definitions,
   roster_version, eligibility, excluded_counts, classifier_versions, unresolved_discrepancies,
   missing_inputs, content_sha256)
values (${[
    lit(r.client_id), lit(r.study_id), lit(r.study_kind), lit(r.method_version), lit(r.state),
    String(r.schema_version), jsonLit(r.manifest), jsonLit(r.source_paths),
    dateLit(r.publication_window_from), dateLit(r.publication_window_to), lit(r.observation_cutoff),
    jsonLit(r.metric_definitions), lit(r.roster_version), jsonLit(r.eligibility),
    jsonLit(r.excluded_counts), jsonLit(r.classifier_versions), jsonLit(r.unresolved_discrepancies),
    jsonLit(r.missing_inputs), lit(r.content_sha256),
  ].join(', ')})
on conflict (client_id, study_id) do update set
  study_kind = excluded.study_kind, method_version = excluded.method_version,
  state = excluded.state, schema_version = excluded.schema_version,
  manifest = excluded.manifest, source_paths = excluded.source_paths,
  publication_window_from = excluded.publication_window_from,
  publication_window_to = excluded.publication_window_to,
  observation_cutoff = excluded.observation_cutoff,
  metric_definitions = excluded.metric_definitions, roster_version = excluded.roster_version,
  eligibility = excluded.eligibility, excluded_counts = excluded.excluded_counts,
  classifier_versions = excluded.classifier_versions,
  unresolved_discrepancies = excluded.unresolved_discrepancies,
  missing_inputs = excluded.missing_inputs, content_sha256 = excluded.content_sha256,
  updated_at = now();`;
}

function insertPosts(rows) {
  const values = rows.map((r) => `(${[
    lit(r.client_id), lit(r.study_id), lit(r.canonical_source_id), lit(r.source_url),
    lit(r.author_id), lit(r.author_role), lit(r.published_at), lit(r.first_captured_at),
    lit(r.last_captured_at), lit(r.post_text), lit(r.artifact_location), lit(r.artifact_sha256),
    jsonLit(r.format_evidence), jsonLit(r.observed_metrics), jsonLit(r.observations),
    lit(r.population), boolLit(r.is_own_control), lit(r.inclusion), lit(r.exclusion_reason),
    lit(r.age_comparability), lit(r.content_sha256),
  ].join(', ')})`).join(',\n  ');
  return `insert into public.client_research_study_posts
  (client_id, study_id, canonical_source_id, source_url, author_id, author_role, published_at,
   first_captured_at, last_captured_at, post_text, artifact_location, artifact_sha256,
   format_evidence, observed_metrics, observations, population, is_own_control, inclusion,
   exclusion_reason, age_comparability, content_sha256)
values
  ${values}
on conflict (client_id, study_id, canonical_source_id) do update set
  source_url = excluded.source_url, author_id = excluded.author_id,
  author_role = excluded.author_role, published_at = excluded.published_at,
  first_captured_at = excluded.first_captured_at, last_captured_at = excluded.last_captured_at,
  post_text = excluded.post_text, format_evidence = excluded.format_evidence,
  observed_metrics = excluded.observed_metrics, observations = excluded.observations,
  population = excluded.population, is_own_control = excluded.is_own_control,
  inclusion = excluded.inclusion, exclusion_reason = excluded.exclusion_reason,
  age_comparability = excluded.age_comparability, content_sha256 = excluded.content_sha256;`;
}

function insertFindings(rows) {
  const values = rows.map((r) => `(${[
    lit(r.client_id), lit(r.study_id), lit(r.finding_id), lit(r.kind), lit(r.metric_id),
    numLit(r.observed_value), numLit(r.baseline_value), numLit(r.baseline_n), numLit(r.lift),
    lit(r.formula), lit(r.method_version), jsonLit(r.source_ids),
    jsonLit(r.source_dates), jsonLit(r.capture_dates), lit(r.age_comparability),
    jsonLit(r.uncertainty), lit(r.selection_method), jsonLit(r.limitations), lit(r.validation_state),
  ].join(', ')})`).join(',\n  ');
  return `insert into public.client_research_findings
  (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value, baseline_n,
   lift, formula, method_version, source_ids, source_dates, capture_dates, age_comparability,
   uncertainty, selection_method, limitations, validation_state)
values
  ${values}
on conflict (client_id, study_id, finding_id) do update set
  kind = excluded.kind, metric_id = excluded.metric_id,
  observed_value = excluded.observed_value, baseline_value = excluded.baseline_value,
  baseline_n = excluded.baseline_n, lift = excluded.lift, formula = excluded.formula,
  method_version = excluded.method_version, source_ids = excluded.source_ids,
  source_dates = excluded.source_dates, capture_dates = excluded.capture_dates,
  age_comparability = excluded.age_comparability, uncertainty = excluded.uncertainty,
  selection_method = excluded.selection_method, limitations = excluded.limitations,
  validation_state = excluded.validation_state;`;
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

export function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}
export function jsonLit(v) {
  if (v === null || v === undefined) return 'null';
  return `${lit(JSON.stringify(v))}::jsonb`;
}
export function numLit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail('IMPORT_NON_FINITE_NUMBER', `a non-finite number cannot be stored: ${JSON.stringify(v)}`);
  }
  return String(v);
}
export function boolLit(v) { return v === true ? 'true' : 'false'; }
function dateLit(v) { return v === null || v === undefined ? 'null' : `${lit(v)}::date`; }

// ---------------------------------------------------------------------------

function pickMetrics(post) {
  const m = {};
  for (const key of ['likes', 'comments', 'reposts']) {
    m[key] = typeof post[key] === 'number' && Number.isFinite(post[key]) ? post[key] : null;
  }
  return m;
}

function dayOf(iso) { return iso === null ? null : iso.slice(0, 10); }

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function sha256Hex(input) { return createHash('sha256').update(input, 'utf8').digest('hex'); }
export function sha256File(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `usage: node automation/content-evidence/release/import-studies.mjs \\
    --client <ivan|risedtc|arch> --study <study.json> --posts <posts.json> \\
    [--method <methods.mjs>] [--out <dir outside this repo>] [--apply]

  Dry run is the default and prints counts only. --apply additionally writes one SQL
  transaction to --out; it never executes it. Post bodies live in that SQL, so --out must
  resolve outside this repository.`;

export function main(argv, io = console) {
  const args = parseArgs(argv);
  if (args.help) { io.log(USAGE); return 0; }
  for (const required of ['client', 'study', 'posts']) {
    if (!args[required]) { io.error(`missing --${required}\n\n${USAGE}`); return 2; }
  }
  const methodPath = args.method ?? path.join(REPO_ROOT, 'automation/content-evidence/methods.mjs');

  let plan;
  try {
    const studyBytes = readFileSync(args.study, 'utf8');
    const study = JSON.parse(studyBytes);
    const posts = JSON.parse(readFileSync(args.posts, 'utf8'));
    const studySha256 = sha256File(args.study);
    const sourceSha256 = sha256File(args.posts);
    const methodSha256 = sha256File(methodPath);
    plan = buildStudyImport({
      clientId: args.client, study, posts,
      sourceHashVerified: sourceSha256 === study.source?.sha256,
      methodHashVerified: methodSha256 === study.method_sha256,
      studySha256, sourceSha256, methodSha256,
    });
  } catch (error) {
    io.error(`${error.code ?? 'IMPORT_FAILED'}: ${error.message}`);
    return 1;
  }

  io.log(JSON.stringify({ counts: plan.counts, comparison: plan.comparison, hashes: plan.hashes }, null, 2));
  if (!plan.comparison.ok) {
    io.error('the plan does not match the study summary:\n  ' + plan.comparison.problems.join('\n  '));
    return 1;
  }
  if (!args.apply) {
    io.log('dry run. Nothing was written. Re-run with --apply --out <dir outside this repo> to emit the transaction.');
    return 0;
  }
  if (!args.out) { io.error('--apply requires --out'); return 2; }
  const outDir = path.resolve(args.out);
  if (outDir === REPO_ROOT || outDir.startsWith(REPO_ROOT + path.sep)) {
    io.error(`IMPORT_OUT_INSIDE_REPO: ${outDir} is inside ${REPO_ROOT}; post bodies never enter the repository`);
    return 2;
  }
  mkdirSync(outDir, { recursive: true });
  const sqlPath = path.join(outDir, `import-${plan.client_id}.sql`);
  writeFileSync(sqlPath, renderImportSql(plan));
  io.log(`wrote ${sqlPath}. It is not executed by this tool; run it through the release step's own executor.`);
  return 0;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i += 1; }
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
