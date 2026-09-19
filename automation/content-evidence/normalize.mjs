// content-evidence / normalize.mjs
//
// normalizeStudy: turns a raw batch of harvested/read records into a study's canonical post
// population -- one entry per real-world post, lineage-tracked observations, tenant enforced,
// private controls held out of the public/market population. It never reads a store and never
// computes a metric; contracts.mjs owns validation of the manifest shape, this module owns
// identity.
//
// The identity rules (mirrored from and kept consistent with import-study.mjs's own rules, since
// both modules exist to answer the same question -- "is this the same post?" -- from slightly
// different callers):
//
//   * A post IS its canonical source id. Two captures of the same id are two OBSERVATIONS of one
//     post: the later capture appends, it never replaces, and it never moves the publication date.
//   * Identical public text is not identity. Two genuinely distinct posts (different canonical
//     ids and URLs) stay two posts however similar their words are.
//   * A tenant's records belong to that tenant. A foreign client_id is refused, never filtered.
//   * Private own-control posts (a lane's own posts inside a market corpus) are held out of the
//     public population and counted separately, with a reason. They never enter a market
//     denominator or an author ranking.
//   * A canonical id that later disagrees with itself (a different author_id, say) is a named
//     identityConflict, not a silent overwrite.
//
// Every excluded row keeps its reason. A count with no reason is not a receipt.

import { validateManifest, utcIso, hashObject, EvidenceValidationError } from './contracts.mjs';

export class NormalizeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'NormalizeError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new NormalizeError(code, message, details); };

export const EXCLUSION_REASONS = Object.freeze([
  'missing_canonical_id',
  'own_control',
  'reshare',
  'selftest',
  'observation_after_cutoff',
  'duplicate_source_url',
]);

/**
 * @param {object} args
 * @param {string} args.clientId    explicit tenant; there is no default
 * @param {string} args.studyId     the study this batch belongs to
 * @param {object[]} args.records   raw records. Accepts either the plan's minimal shape
 *                                  ({ client_id, id, url, ... }) or the richer adapters.mjs shape
 *                                  ({ client_id, canonical_source_id, source_url, metrics, ... }).
 * @param {object} args.manifest    study manifest; validated via contracts.mjs before anything else
 * @returns {{ posts: object[], excluded: object[], identityConflicts: object[], manifest: object }}
 */
export function normalizeStudy({ clientId, studyId, records, manifest } = {}) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    fail('NORMALIZE_MISSING_CLIENT', 'normalizeStudy requires an explicit clientId; there is no default tenant');
  }
  if (typeof studyId !== 'string' || studyId.trim() === '') {
    fail('NORMALIZE_MISSING_STUDY', 'normalizeStudy requires an explicit studyId');
  }
  if (!Array.isArray(records)) {
    fail('NORMALIZE_BAD_RECORDS', 'records must be an array');
  }

  // contracts.mjs enforces the manifest shape AND that manifest.client_id matches clientId. Its
  // error message contains "tenant", satisfying a caller checking /tenant/ against a MANIFEST
  // mismatch. A RECORD-level foreign tenant is checked separately below, per-record, because a
  // manifest can be perfectly scoped to risedtc while one smuggled record still claims 'arch'.
  try {
    validateManifest(manifest, { clientId });
  } catch (err) {
    if (err instanceof EvidenceValidationError) throw err; // preserve code/message, incl. "tenant"
    throw err;
  }

  const cutoffIso = utcIso(manifest.observation_cutoff);
  const cutoffMs = cutoffIso === null ? null : Date.parse(cutoffIso);

  /** @type {Map<string, object>} canonical_source_id -> post */
  const posts = new Map();
  const excluded = [];
  const identityConflicts = [];
  const urlOwner = new Map(); // normalized source_url -> canonical_source_id that claimed it

  for (const raw of records) {
    if (raw === null || typeof raw !== 'object') {
      fail('NORMALIZE_BAD_RECORDS', 'every record must be an object');
    }

    // Tenancy first, and fatal: a study snapshot that contains another tenant's post is a broken
    // snapshot, not a filtering opportunity. Fail the whole batch rather than silently drop it.
    if (raw.client_id !== undefined && raw.client_id !== null && raw.client_id !== clientId) {
      fail('NORMALIZE_TENANT_MISMATCH',
        `record ${JSON.stringify(idOf(raw) ?? urlOf(raw) ?? '(unidentified)')} carries tenant ${JSON.stringify(raw.client_id)} but the normalize context is ${JSON.stringify(clientId)}`,
        { recordClientId: raw.client_id, clientId });
    }

    // Accept either the plan's minimal fixture shape (id/url) or the adapters.mjs shape
    // (canonical_source_id/source_url). Neither is invented here -- if a caller gave neither,
    // the record has no identity.
    const rawId = idOf(raw);
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    const sourceUrl = urlOf(raw) ?? null;

    if (id === '') {
      excluded.push(exclusionRow(raw, rawId ?? '', sourceUrl, 'missing_canonical_id'));
      continue;
    }
    if (raw.is_selftest === true) {
      excluded.push(exclusionRow(raw, id, sourceUrl, 'selftest'));
      continue;
    }
    if (raw.is_reshare === true) {
      excluded.push(exclusionRow(raw, id, sourceUrl, 'reshare'));
      continue;
    }
    if (raw.is_own_control === true) {
      excluded.push(exclusionRow(raw, id, sourceUrl, 'own_control'));
      continue;
    }

    const capturedIso = utcIso(raw.captured_at ?? raw?.capture_dates?.captured_at);
    if (cutoffMs !== null && capturedIso !== null && Date.parse(capturedIso) > cutoffMs) {
      excluded.push(exclusionRow(raw, id, sourceUrl, 'observation_after_cutoff'));
      continue;
    }

    // A duplicate URL under a DIFFERENT canonical id is an identity conflict at the URL level,
    // not a second post. The same id arriving twice on the same URL is the ordinary
    // repeat-capture case, handled by appendObservation below.
    const urlKey = normalizeUrl(sourceUrl);
    if (urlKey !== null) {
      const owner = urlOwner.get(urlKey);
      if (owner !== undefined && owner !== id) {
        excluded.push(exclusionRow(raw, id, sourceUrl, 'duplicate_source_url'));
        continue;
      }
      urlOwner.set(urlKey, id);
    }

    appendObservation(posts, identityConflicts, id, sourceUrl, raw, clientId, studyId);
  }

  return {
    posts: [...posts.values()].sort(byId),
    excluded: excluded.sort(byExcluded),
    identityConflicts,
    manifest,
  };
}

// ---------------------------------------------------------------------------

function idOf(raw) {
  if (typeof raw.canonical_source_id === 'string') return raw.canonical_source_id;
  if (raw.canonical_source_id !== undefined && raw.canonical_source_id !== null) return String(raw.canonical_source_id);
  if (typeof raw.id === 'string') return raw.id;
  if (raw.id !== undefined && raw.id !== null) return String(raw.id);
  return null;
}

function urlOf(raw) {
  if (typeof raw.source_url === 'string' && raw.source_url !== '') return raw.source_url;
  if (typeof raw.url === 'string' && raw.url !== '') return raw.url;
  return null;
}

/**
 * First capture creates the post and fixes its publication identity. Every later capture of the
 * same id appends an observation; a later capture may FILL a null publication date (we learned
 * it) but may never CHANGE one already known. A later capture whose author_id disagrees with the
 * first is recorded as an identity conflict rather than silently overwriting.
 */
function appendObservation(map, identityConflicts, id, sourceUrl, raw, clientId, studyId) {
  const capturedIso = utcIso(raw.captured_at ?? raw?.capture_dates?.captured_at);
  const publishedIso = utcIso(raw.published_at ?? raw?.source_dates?.published_at);
  const metrics = normalizeMetrics(raw.metrics ?? raw.metric ?? null);
  const observation = { captured_at: capturedIso, metrics };

  let post = map.get(id);
  if (post === undefined) {
    post = {
      client_id: clientId,
      study_id: studyId,
      canonical_source_id: id,
      source_url: sourceUrl,
      author_id: raw.author_id ?? null,
      author_role: raw.author_role ?? null,
      source_dates: { published_at: publishedIso },
      capture_dates: { first_captured_at: capturedIso, last_captured_at: capturedIso },
      text: raw.text ?? null,
      format_evidence: raw.format_evidence ?? null,
      is_own_control: false,
      observations: [observation],
    };
    post.content_sha256 = contentHash(post);
    map.set(id, post);
    return;
  }

  // Identity conflicts: the same canonical id later disagreeing about who wrote it, or which URL
  // it lives at. Both are recorded, neither silently wins.
  if (raw.author_id !== undefined && raw.author_id !== null && post.author_id !== null
      && raw.author_id !== post.author_id) {
    identityConflicts.push({
      canonical_source_id: id, field: 'author_id',
      first_value: post.author_id, conflicting_value: raw.author_id,
    });
  }
  if (sourceUrl !== null && post.source_url !== null && sourceUrl !== post.source_url) {
    identityConflicts.push({
      canonical_source_id: id, field: 'source_url',
      first_value: post.source_url, conflicting_value: sourceUrl,
    });
  }

  if (post.source_dates.published_at === null && publishedIso !== null) {
    post.source_dates.published_at = publishedIso;
    post.content_sha256 = contentHash(post);
  }
  post.observations.push(observation);
  post.observations.sort((a, b) => String(a.captured_at ?? '').localeCompare(String(b.captured_at ?? '')));
  const stamps = post.observations.map((o) => o.captured_at).filter((v) => v !== null).sort();
  post.capture_dates.first_captured_at = stamps[0] ?? null;
  post.capture_dates.last_captured_at = stamps[stamps.length - 1] ?? null;
}

function contentHash(post) {
  return hashObject({
    canonical_source_id: post.canonical_source_id,
    source_url: post.source_url,
    author_id: post.author_id,
    published_at: post.source_dates.published_at,
    text: post.text,
  });
}

/** null/undefined metrics field stays null (unknown, not zero); a real 0 stays 0. */
function normalizeMetrics(metrics) {
  if (metrics === null || typeof metrics !== 'object') return null;
  const out = {};
  for (const key of Object.keys(metrics)) {
    const v = metrics[key];
    out[key] = v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  }
  return out;
}

function exclusionRow(raw, id, sourceUrl, reason) {
  return {
    canonical_source_id: id,
    source_url: sourceUrl,
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
  String(a.canonical_source_id).localeCompare(String(b.canonical_source_id)) || a.reason.localeCompare(b.reason);
