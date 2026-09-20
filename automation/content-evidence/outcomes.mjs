// content-evidence / outcomes.mjs
//
// joinTestOutcomes: connects a client's own recommendations (ideas) to what actually got
// published and observed, WITHOUT inventing a link the data does not carry.
//
// Modeled directly on this goal-run's own trace of the RISE "Toby Waller adaptation" chain
// (see OUTPUT/parent-checks/own-outcome-trace-risedtc.json and OUTPUT/02-own-results/): a
// recommendation had an EXPLICIT stored link to its SOURCE (client_ideas.source_ref = the exact
// source URL) but only an INFERRED link to what was PUBLISHED (no stored key -- reuse_of empty on
// both sides -- only publish-time-matches-target-to-the-minute and title-carries-the-copied-shape
// as circumstantial evidence). That distinction is this module's whole reason to exist:
//
//   * link_status 'explicit'  -- a stored key (reuse_of / an explicit ideaLinks row) joins the
//                                recommendation to the publication. This is a verified link.
//   * link_status 'inferred'  -- no stored key; the join is reconstructed from timing/identity
//                                heuristics only. NEVER presented as a verified link.
//   * a recommendation with NO matching publication at all is never "performance" -- it goes to
//     `due` (if its target_publish_at has passed) or is left out of `tests` entirely.
//   * an unapproved recommendation that shipped anyway is flagged (shipped_without_approval),
//     never silently absorbed into a clean test.
//   * every observation carries capture_age_days and an explicit age_matched flag. A lifetime or
//     backfilled capture is NEVER relabelled a seven-day (or fourteen-day) standing observation,
//     even when its raw age happens to land on 7 -- the is_backfill/is_lifetime flag wins.
//   * this module never computes or reports a market lift/baseline -- that is methods.mjs's job
//     on a SOURCE population. A source's lift and a client's own post are never merged in one
//     record here.

import { utcIso } from './contracts.mjs';

export class OutcomesError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OutcomesError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new OutcomesError(code, message, details); };

// A capture is "age_matched" only when it lands ON (within tolerance of) one of the canonical
// standing checkpoints -- seven days or fourteen days after publication -- never merely because
// it is EARLY (a 2-day capture is premature, not a seven-day reading) or because it happens to
// land near one by coincidence on a much later single lifetime capture. Confirmed against the
// real RISE trace: a 2-day capture and a 17-day capture were BOTH age_matched: false.
const STANDING_CHECKPOINTS_DAYS = [7, 14];
const STANDING_TOLERANCE_DAYS = 1;
const INFERRED_LINK_TOLERANCE_MS = 3600000;

/**
 * @param {object} args
 * @param {string} args.clientId
 * @param {object[]} args.recommendations  { recommendation_id, source_ref, approved_at,
 *                                            target_publish_at, created_at, reuse_of? }
 * @param {object[]} [args.ideaLinks]      explicit stored joins: { recommendation_id, publication_id }
 * @param {object[]} args.publications     { publication_id, source_ref?, reuse_of?, published_at }
 * @param {object[]} args.observations     { publication_id, captured_at, metrics, is_backfill?, is_lifetime? }
 * @param {string} args.cutoff             ISO cutoff; a recommendation past its target with no
 *                                         publication by cutoff is "due"
 * @returns {{ tests: object[], unresolvedLinks: object[], due: object[], evaluated: number }}
 *   Each `tests[i]` carries a `state` of 'awaiting_publication' (no valid-as-of-cutoff publication
 *   evidence yet), 'measuring' (valid publication, no eligible observation yet) or 'evaluated'
 *   (valid publication + >=1 eligible observation). `evaluated` (top-level) counts only tests in
 *   state 'evaluated'. Each `tests[i].excluded` lists {kind, id, reason} for every observation or
 *   publication that could not count as evidence (future/invalid dates, capture-before-publish). A
 *   same-client link to a nonexistent publication_id never produces a test -- it lands in
 *   `unresolvedLinks` instead. `approval_status` ('recorded' | 'not_recorded') replaces the old
 *   shipped_without_approval overclaim; it is separate from `link_status` (explicit vs inferred).
 */
export function joinTestOutcomes({
  clientId, recommendations, ideaLinks = [], publications, observations, cutoff,
} = {}) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    fail('OUTCOMES_MISSING_CLIENT', 'joinTestOutcomes requires an explicit clientId');
  }
  if (!Array.isArray(recommendations)) fail('OUTCOMES_BAD_INPUT', 'recommendations must be an array');
  if (!Array.isArray(ideaLinks)) fail('OUTCOMES_BAD_INPUT', 'ideaLinks must be an array');
  if (!Array.isArray(publications)) fail('OUTCOMES_BAD_INPUT', 'publications must be an array');
  if (!Array.isArray(observations)) fail('OUTCOMES_BAD_INPUT', 'observations must be an array');
  const cutoffIso = utcIso(cutoff);
  if (cutoffIso === null) fail('OUTCOMES_BAD_CUTOFF', 'a parseable cutoff is required');
  const cutoffMs = Date.parse(cutoffIso);

  // ideaLinks is a tenant-scoped input exactly like recommendations/publications/observations --
  // a foreign client_id here (audit P1 finding 1) is refused the same way as anywhere else, never
  // silently joined because the row happens to be a link rather than a recommendation.
  for (const list of [recommendations, ideaLinks, publications, observations]) {
    for (const row of list) {
      if (row.client_id !== undefined && row.client_id !== null && row.client_id !== clientId) {
        throw new OutcomesError('OUTCOMES_TENANT_MISMATCH',
          `row carries tenant ${JSON.stringify(row.client_id)} but the join context is ${JSON.stringify(clientId)}`);
      }
    }
  }

  const explicitByRecommendation = new Map(); // recommendation_id -> publication_id, from ideaLinks
  for (const link of ideaLinks) {
    explicitByRecommendation.set(link.recommendation_id, link.publication_id);
  }

  const publicationsById = new Map(publications.map((p) => [p.publication_id, p]));
  const observationsByPublication = new Map();
  for (const obs of observations) {
    if (!observationsByPublication.has(obs.publication_id)) observationsByPublication.set(obs.publication_id, []);
    observationsByPublication.get(obs.publication_id).push(obs);
  }

  const tests = [];
  const due = [];
  const unresolvedLinks = [];

  for (const rec of recommendations) {
    const { publicationId, linkStatus } = resolveLink(rec, publications, explicitByRecommendation);

    if (publicationId === null) {
      // No publication at all. Never "performance". Due if the target has passed.
      const targetMs = rec.target_publish_at ? Date.parse(utcIso(rec.target_publish_at) ?? '') : NaN;
      if (!Number.isNaN(targetMs) && targetMs <= cutoffMs) {
        due.push({
          client_id: clientId,
          recommendation_id: rec.recommendation_id,
          source_ref: rec.source_ref ?? null,
          target_publish_at: utcIso(rec.target_publish_at),
          approved_at: utcIso(rec.approved_at),
          reason: 'target_publish_at has passed with no matching publication',
        });
      } else {
        unresolvedLinks.push({
          client_id: clientId, recommendation_id: rec.recommendation_id,
          reason: 'no publication and target date not yet due',
        });
      }
      continue;
    }

    const publication = publicationsById.get(publicationId);
    if (publication === undefined) {
      // A stored link (explicit or inferred -- inferred can never dangle since it only ever
      // matches an id already present in `publications`) points at a publication_id this join
      // context has no record of. This is NOT "performance": no test is fabricated, no
      // published_at:null stands in for evidence. Kept unresolved, same as a recommendation with
      // no link at all.
      unresolvedLinks.push({
        client_id: clientId,
        recommendation_id: rec.recommendation_id,
        publication_id: publicationId,
        reason: `linked publication_id ${JSON.stringify(publicationId)} has no matching publication record`,
      });
      continue;
    }

    const rawObservations = observationsByPublication.get(publicationId) ?? [];
    const publishedIso = utcIso(publication.published_at);
    const publishedMs = publishedIso ? Date.parse(publishedIso) : NaN;
    // Valid publication evidence requires a parseable published_at that has actually happened as
    // of the cutoff -- a future or unparseable publication date is never "evidence", it is a
    // publication still awaited.
    const publicationValid = !Number.isNaN(publishedMs) && publishedMs <= cutoffMs;

    const excludedItems = [];
    const stampedObservations = rawObservations.map((obs) => {
      const capturedIso = utcIso(obs.captured_at);
      const capturedMs = capturedIso ? Date.parse(capturedIso) : NaN;

      let excludeReason = null;
      if (Number.isNaN(capturedMs)) {
        excludeReason = 'invalid_or_missing_capture_date';
      } else if (capturedMs > cutoffMs) {
        excludeReason = 'observation_after_cutoff';
      } else if (!publicationValid) {
        excludeReason = Number.isNaN(publishedMs) ? 'invalid_or_missing_publication_date' : 'publication_after_cutoff';
      } else if (capturedMs < publishedMs) {
        excludeReason = 'captured_before_publication';
      }
      const eligible = excludeReason === null;

      const ageDays = !Number.isNaN(publishedMs) && !Number.isNaN(capturedMs)
        ? Math.round((capturedMs - publishedMs) / 86400000)
        : null;
      const isBackfillOrLifetime = obs.is_backfill === true || obs.is_lifetime === true;
      // Future data is never labelled age_matched, even when its raw age happens to land on a
      // standing checkpoint (audit P1 finding 2) -- ineligibility wins over a coincidental match.
      const ageMatched = eligible && !isBackfillOrLifetime && ageDays !== null
        && STANDING_CHECKPOINTS_DAYS.some((cp) => Math.abs(ageDays - cp) <= STANDING_TOLERANCE_DAYS);

      if (!eligible) {
        excludedItems.push({ kind: 'observation', id: capturedIso, reason: excludeReason });
      }

      return {
        captured_at: capturedIso,
        capture_age_days: ageDays,
        age_matched: ageMatched,
        is_backfill: obs.is_backfill === true,
        is_lifetime: obs.is_lifetime === true,
        metrics: obs.metrics ?? null,
        eligible,
      };
    });

    if (!publicationValid) {
      excludedItems.push({
        kind: 'publication', id: publicationId,
        reason: Number.isNaN(publishedMs) ? 'invalid_or_missing_publication_date' : 'publication_after_cutoff',
      });
    }

    const hasEligibleObservation = stampedObservations.some((o) => o.eligible);
    // A test counts as evaluated only with valid publication evidence AND >=1 eligible observed
    // outcome. A valid publication with no eligible observation yet is still being measured, not
    // evaluated; a publication that has not (as of cutoff) actually happened is awaiting_publication.
    const state = !publicationValid
      ? 'awaiting_publication'
      : hasEligibleObservation ? 'evaluated' : 'measuring';

    tests.push({
      client_id: clientId,
      recommendation_id: rec.recommendation_id,
      publication_id: publicationId,
      link_status: linkStatus,
      source_ref: rec.source_ref ?? null,
      approved_at: utcIso(rec.approved_at),
      // A null/absent approved_at means "no approval recorded in THIS source" -- it is never
      // evidence that no authorization exists elsewhere (audit P2 finding). approval_status
      // replaces the old shipped_without_approval overclaim; link_status (above) already carries
      // the separate explicit-vs-inferred provenance question.
      approval_status: (rec.approved_at === null || rec.approved_at === undefined) ? 'not_recorded' : 'recorded',
      target_publish_at: utcIso(rec.target_publish_at),
      published_at: publishedIso,
      state,
      observations: stampedObservations,
      excluded: excludedItems,
      limitations: linkStatus === 'inferred'
        ? ['this recommendation-to-publication link is INFERRED (no stored key); it is circumstantial (timing/title match), never a verified join']
        : [],
    });
  }

  return { tests, unresolvedLinks, due, evaluated: tests.filter((t) => t.state === 'evaluated').length };
}

// ---------------------------------------------------------------------------

function resolveLink(rec, publications, explicitByRecommendation) {
  // 1. An explicit ideaLinks row is the strongest evidence: a stored join table entry.
  const explicitId = explicitByRecommendation.get(rec.recommendation_id);
  if (explicitId !== undefined) {
    return { publicationId: explicitId, linkStatus: 'explicit' };
  }
  // 2. A publication carrying reuse_of === this recommendation_id is also a stored key, just
  //    stored on the other side of the relationship.
  const byReuseOf = publications.find((p) => p.reuse_of === rec.recommendation_id);
  if (byReuseOf !== undefined) {
    return { publicationId: byReuseOf.publication_id, linkStatus: 'explicit' };
  }
  // 3. No stored key anywhere. An inferred link needs BOTH identity (the same source_ref) and
  // one unambiguous close target-time candidate. Source_ref alone is not a publication key.
  //    this is exactly the real Toby Waller case: reuse_of empty on both sides, only heuristic
  //    evidence (publish time matches target to the minute, title carries the copied shape).
  //    This NEVER upgrades to 'explicit', however close the match.
  if (rec.source_ref && rec.target_publish_at) {
    const targetMs = Date.parse(utcIso(rec.target_publish_at) ?? '');
    if (!Number.isNaN(targetMs)) {
      const candidates = publications.filter((p) => {
        const pubMs = Date.parse(p.published_at ?? '');
        return p.source_ref === rec.source_ref && !Number.isNaN(pubMs)
          && Math.abs(pubMs - targetMs) < INFERRED_LINK_TOLERANCE_MS;
      });
      if (candidates.length === 1) return { publicationId: candidates[0].publication_id, linkStatus: 'inferred' };
    }
  }
  return { publicationId: null, linkStatus: null };
}
