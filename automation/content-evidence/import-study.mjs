// content-evidence / import-study.mjs
//
// Idempotent import of one validated study snapshot. PREVIEW ONLY in this package: the migration
// that creates the destination tables has not been applied to any database, so `apply: true` is
// refused rather than silently doing nothing. A preview is a pure function of the records handed
// in, which is what makes idempotency provable without a database at all.
//
// The identity rules, which are the whole point of the module:
//
//   * A post IS its canonical source id. Two captures of the same id are two OBSERVATIONS of one
//     post -- the later capture appends, it never replaces, and it never moves the publication
//     date.
//   * Identical public text is not identity. Two genuinely distinct posts (different canonical
//     ids and URLs) stay two posts however similar their words are.
//   * A tenant's records belong to that tenant. A foreign client_id is an error, not a filter.
//   * Private own-control posts (a lane's own posts inside a market corpus) are held out of the
//     market population and counted separately. They may never enter a market denominator or an
//     author ranking.
//
// Every excluded row keeps its reason. A count with no reason is not a receipt.

import {
  hashArray,
  hashObject,
  utcIso,
  validateManifest,
  validateFinding,
} from './contracts.mjs';

/** This package ships preview only. Applying is a later package with an applied migration. */
export const PREVIEW_ONLY = true;

export class ImportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new ImportError(code, message, details); };

export const EXCLUSION_REASONS = Object.freeze([
  'missing_canonical_id',
  'own_control',
  'reshare',
  'selftest',
  'observation_after_cutoff',
  'duplicate_source_url',
  'published_after_cutoff',
]);

/**
 * @param {object} args
 * @param {string} args.clientId              explicit tenant; there is no default
 * @param {object} args.manifest              study manifest, validated before anything is read
 * @param {object[]} args.records             normalized study records (see adapters.mjs shape)
 * @param {object[]} [args.findings]          computed findings that belong to this snapshot
 * @param {string} [args.cutoff]              observation cutoff; defaults to manifest.observation_cutoff
 * @param {{posts?: object[], findings?: object[]}} [args.existing]  what the destination already holds
 * @param {boolean} [args.apply=false]        preview is the default and the only reachable mode
 * @returns {object} preview with counts, posts, own_controls, excluded, hashes, newIdentities
 */
export function importStudy({
  clientId,
  manifest,
  records = [],
  findings = [],
  cutoff,
  existing = {},
  apply = false,
} = {}) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    fail('IMPORT_MISSING_CLIENT', 'importStudy requires an explicit clientId');
  }
  if (apply !== false) {
    fail('IMPORT_APPLY_NOT_AUTHORIZED',
      'importStudy ships preview only in this package: the content-evidence migration has not been applied, so there is nothing to write to. Re-run with apply omitted.');
  }

  validateManifest(manifest, { clientId });
  const studyId = manifest.study_id;

  const cutoffIso = utcIso(cutoff ?? manifest.observation_cutoff);
  if (cutoffIso === null) {
    fail('IMPORT_MISSING_CUTOFF', 'an observation cutoff is required to exclude future observations');
  }
  const cutoffMs = Date.parse(cutoffIso);

  if (!Array.isArray(records)) fail('IMPORT_BAD_RECORDS', 'records must be an array');

  const existingPosts = Array.isArray(existing.posts) ? existing.posts : [];
  const existingFindings = Array.isArray(existing.findings) ? existing.findings : [];
  const existingPostIds = new Set(existingPosts.map((p) => p.canonical_source_id));
  const existingFindingIds = new Set(existingFindings.map((f) => f.finding_id));

  /** @type {Map<string, object>} canonical_source_id -> post */
  const posts = new Map();
  const ownControls = new Map();
  const excluded = [];
  const urlOwner = new Map(); // normalized source_url -> canonical_source_id that claimed it
  let observations = 0;

  for (const raw of records) {
    if (raw === null || typeof raw !== 'object') {
      fail('IMPORT_BAD_RECORDS', 'every record must be an object');
    }
    // Tenancy first. A foreign row is never quietly filtered away: a study that contains another
    // tenant's post is a broken snapshot, and the import says so.
    if (raw.client_id !== undefined && raw.client_id !== null && raw.client_id !== clientId) {
      fail('IMPORT_TENANT_MISMATCH',
        `record ${JSON.stringify(raw.canonical_source_id ?? raw.source_url ?? '(unidentified)')} carries tenant ${JSON.stringify(raw.client_id)} but the import context is ${JSON.stringify(clientId)}`);
    }

    const id = typeof raw.canonical_source_id === 'string' ? raw.canonical_source_id.trim() : '';
    if (id === '') {
      excluded.push(exclusion(raw, '', 'missing_canonical_id'));
      continue;
    }

    // Own controls leave the market population here, before any dedup or metric is considered.
    if (raw.is_own_control === true) {
      appendObservation(ownControls, id, raw, clientId, studyId);
      excluded.push(exclusion(raw, id, 'own_control'));
      continue;
    }
    if (raw.is_selftest === true) {
      excluded.push(exclusion(raw, id, 'selftest'));
      continue;
    }
    if (raw.is_reshare === true) {
      excluded.push(exclusion(raw, id, 'reshare'));
      continue;
    }

    const capturedIso = utcIso(raw.captured_at ?? raw?.capture_dates?.captured_at);
    if (capturedIso !== null && Date.parse(capturedIso) > cutoffMs) {
      excluded.push(exclusion(raw, id, 'observation_after_cutoff'));
      continue;
    }
    const publishedIso = utcIso(raw.published_at ?? raw?.source_dates?.published_at);
    if (publishedIso !== null && Date.parse(publishedIso) > cutoffMs) {
      excluded.push(exclusion(raw, id, 'published_after_cutoff'));
      continue;
    }

    // A duplicate URL under a DIFFERENT canonical id is an identity conflict, not a second post.
    // The same id arriving twice on the same URL is the ordinary repeat-capture case below.
    const urlKey = normalizeUrl(raw.source_url);
    if (urlKey !== null) {
      const owner = urlOwner.get(urlKey);
      if (owner !== undefined && owner !== id) {
        excluded.push(exclusion(raw, id, 'duplicate_source_url'));
        continue;
      }
      urlOwner.set(urlKey, id);
    }

    appendObservation(posts, id, raw, clientId, studyId);
    observations += 1;
  }

  // Findings must point at sources the snapshot actually retains. A finding about a row that was
  // excluded is a claim with no recoverable source.
  const knownSourceIds = new Set([...posts.keys(), ...ownControls.keys()]);
  const findingsToInsert = [];
  let findingsAlreadyPresent = 0;
  for (const finding of findings) {
    validateFinding(finding, { clientId });
    if (finding.study_id !== studyId) {
      fail('IMPORT_FINDING_STUDY_MISMATCH',
        `finding ${finding.finding_id} belongs to study ${JSON.stringify(finding.study_id)} but the import is ${JSON.stringify(studyId)}`);
    }
    const missing = finding.source_ids.filter((sid) => !knownSourceIds.has(sid));
    if (missing.length > 0) {
      fail('IMPORT_FINDING_SOURCE_MISSING',
        `finding ${finding.finding_id} references source id(s) the study does not retain: ${missing.join(', ')}`,
        { missing });
    }
    if (existingFindingIds.has(finding.finding_id)) findingsAlreadyPresent += 1;
    else findingsToInsert.push(finding);
  }

  const postList = [...posts.values()].sort(byId);
  const controlList = [...ownControls.values()].sort(byId);
  const newIdentities = postList
    .filter((p) => !existingPostIds.has(p.canonical_source_id))
    .map((p) => p.canonical_source_id);
  const alreadyPresent = postList.length - newIdentities.length;

  return {
    mode: 'preview',
    apply: false,
    client_id: clientId,
    study_id: studyId,
    state: manifest.state,
    observation_cutoff: cutoffIso,
    counts: {
      posts_to_insert: newIdentities.length,
      posts_already_present: alreadyPresent,
      observations_to_insert: observations,
      findings_to_insert: findingsToInsert.length,
      findings_already_present: findingsAlreadyPresent,
      excluded: excluded.length,
      own_controls: controlList.length,
    },
    posts: postList,
    own_controls: controlList,
    excluded: excluded.sort(byExcluded),
    newIdentities,
    findings_to_insert: findingsToInsert,
    hashes: {
      manifest_sha256: hashObject(manifest),
      posts_sha256: hashArray(postList),
      own_controls_sha256: hashArray(controlList),
      findings_sha256: hashArray(findings),
      excluded_sha256: hashArray(excluded),
      study_sha256: hashObject({
        manifest_sha256: hashObject(manifest),
        posts_sha256: hashArray(postList),
        own_controls_sha256: hashArray(controlList),
        findings_sha256: hashArray(findings),
      }),
    },
  };
}

/**
 * First capture creates the post and fixes its publication identity. Every later capture of the
 * same id appends an observation and leaves the publication date exactly where it was.
 */
function appendObservation(map, id, raw, clientId, studyId) {
  const capturedIso = utcIso(raw.captured_at ?? raw?.capture_dates?.captured_at);
  const publishedIso = utcIso(raw.published_at ?? raw?.source_dates?.published_at);
  const observation = {
    captured_at: capturedIso,
    metrics: raw.metrics ?? null,
  };

  let post = map.get(id);
  if (post === undefined) {
    post = {
      client_id: clientId,
      study_id: studyId,
      canonical_source_id: id,
      source_url: raw.source_url ?? null,
      author_id: raw.author_id ?? null,
      author_role: raw.author_role ?? null,
      // Publication identity. Set once, from the first capture that knows it. A later capture
      // may FILL a null (we learned the date) but may never CHANGE a known one.
      source_dates: { published_at: publishedIso },
      capture_dates: { first_captured_at: capturedIso, last_captured_at: capturedIso },
      text: raw.text ?? null,
      format_evidence: raw.format_evidence ?? null,
      is_own_control: raw.is_own_control === true,
      observations: [observation],
    };
    post.content_sha256 = hashObject({
      canonical_source_id: id,
      source_url: post.source_url,
      author_id: post.author_id,
      published_at: post.source_dates.published_at,
      text: post.text,
    });
    map.set(id, post);
    return;
  }

  if (post.source_dates.published_at === null && publishedIso !== null) {
    post.source_dates.published_at = publishedIso;
    post.content_sha256 = hashObject({
      canonical_source_id: id,
      source_url: post.source_url,
      author_id: post.author_id,
      published_at: publishedIso,
      text: post.text,
    });
  }
  post.observations.push(observation);
  post.observations.sort((a, b) => String(a.captured_at ?? '').localeCompare(String(b.captured_at ?? '')));
  const stamps = post.observations.map((o) => o.captured_at).filter((v) => v !== null).sort();
  post.capture_dates.first_captured_at = stamps[0] ?? null;
  post.capture_dates.last_captured_at = stamps[stamps.length - 1] ?? null;
}

function exclusion(raw, id, reason) {
  return {
    canonical_source_id: id,
    source_url: raw.source_url ?? null,
    author_id: raw.author_id ?? null,
    reason,
  };
}

function normalizeUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  return url.trim().toLowerCase().replace(/\?.*$/, '').replace(/\/+$/, '');
}

const byId = (a, b) => a.canonical_source_id.localeCompare(b.canonical_source_id);
const byExcluded = (a, b) =>
  a.canonical_source_id.localeCompare(b.canonical_source_id) || a.reason.localeCompare(b.reason);
