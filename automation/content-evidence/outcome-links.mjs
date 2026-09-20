// content-evidence / outcome-links.mjs
//
// The recommendation -> idea -> publication -> observation chain, read from the ONE place it is
// already computed live: public.audn_recommendation_links() (no arguments; discovered read-only,
// Run 4 Phase 3 step 1, `select pg_get_functiondef(p.oid) ... where proname=
// 'audn_recommendation_links'`). It already stamps the recommendation->idea half of this chain at
// idea-creation time (`client_ideas.source_ref like 'audn-rec:%'` for arch/risedtc,
// `lm_idea_candidates.source_ref like 'audn-rec:%'` for ivan -- Ivan's ideas live in a different
// table, exposed as `idea_table` on every row) and extends it through
// carousel_drafts/scheduled_posts to a published post id where one exists, plus any recorded
// client_board_actions decision. There is no separate write path this module needs to invent.
//
// A PRIOR VERSION OF THIS FILE INVENTED A SECOND, UNREAD LINK MECHANISM. Corrected here (Run 4
// Phase 3, mission section 7 / Run 3 FINAL-HANDOFF.md open item 5). That version wrote a
// synthetic key to `ops_drafts.context.audn.outcome_link` (a location nothing else reads) and, on
// the idea side, to `client_ideas.reuse_of` -- verified LIVE, read-only, to already hold populated
// data for a DIFFERENT feature: 8 risedtc rows carry `source_ref = 'reuse-<uuid>'` /
// `reuse_of = '<uuid>'` / `status = 'staged'`, an idea-reuse staging mechanism unrelated to audn
// recommendation outcomes. Writing an audn publication id into that column on any of those rows,
// or any future row, would silently repurpose a populated field -- forbidden by this run's
// AUTHORITY.md and by mission section 7 ("never repurpose a populated field"). This module now
// only READS the canonical function; it plans no write and defines no new storage.
//
// TWO AGES, NEVER ONE NUMBER
//
//   publication age  = (cutoff - published_at). How old the post is now. This is what makes a
//                     seven- or fourteen-day standing window DUE.
//   capture age      = (captured_at - published_at). How old the post was when we read it. This
//                     is what a reading actually measures.
//
//   A window is due on publication age. A window is answered only by a capture whose OWN age
//   lands on it. A fourteen-day window can be due for months with no fourteen-day reading in
//   hand, and a late lifetime capture never becomes one, however its raw age happens to land.

import { utcIso } from './contracts.mjs';

export class OutcomeLinkError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OutcomeLinkError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new OutcomeLinkError(code, message, details); };

// ---------------------------------------------------------------------------
// The review milestone
// ---------------------------------------------------------------------------

/**
 * Plan Package 6: "Register a first prospective checkpoint after six completed weeks or twelve
 * evaluated posts per client, WHICHEVER OCCURS LATER."
 *
 * Later-of, not either-of: the checkpoint is reached only when BOTH counts are in. Six weeks with
 * three evaluated posts is not the checkpoint, and twelve posts inside two weeks is not the
 * checkpoint either -- each on its own is the earlier of the two events.
 *
 * This is a review milestone, not a statistical adequacy guarantee. Reaching it authorizes a
 * review; it authorizes no claim about effectiveness.
 */
export const REVIEW_MILESTONE_WEEKS = 6;
export const REVIEW_MILESTONE_EVALUATED_POSTS = 12;

export function reviewMilestone({ weeksCompleted, evaluatedPosts } = {}) {
  const weeks = toCount(weeksCompleted);
  const posts = toCount(evaluatedPosts);
  return weeks >= REVIEW_MILESTONE_WEEKS && posts >= REVIEW_MILESTONE_EVALUATED_POSTS;
}

/**
 * The same rule with its reason attached, for a screen or a receipt. `reached` is exactly
 * reviewMilestone()'s answer; `remaining` says what each half is still short of, so "not yet" is
 * never a bare false.
 */
export function reviewMilestoneStatus({ clientId, weeksCompleted, evaluatedPosts } = {}) {
  requireClient(clientId, 'reviewMilestoneStatus');
  const weeks = toCount(weeksCompleted);
  const posts = toCount(evaluatedPosts);
  return {
    client_id: clientId,
    weeks_completed: weeks,
    evaluated_posts: posts,
    weeks_remaining: Math.max(0, REVIEW_MILESTONE_WEEKS - weeks),
    evaluated_posts_remaining: Math.max(0, REVIEW_MILESTONE_EVALUATED_POSTS - posts),
    reached: reviewMilestone({ weeksCompleted: weeks, evaluatedPosts: posts }),
    rule: 'the later of six completed weeks and twelve evaluated posts, per client',
  };
}

function toCount(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

// ---------------------------------------------------------------------------
// Where the link already lives (read-only; nothing here is a write target)
// ---------------------------------------------------------------------------

/**
 * The canonical, already-live source of this chain. Named in one place so a reconciliation
 * script, a contract doc and a test all point at the same function and no code invents a second
 * source of truth.
 */
export const CANONICAL_LINK_SOURCE = Object.freeze({
  function: 'public.audn_recommendation_links()',
  arguments: [],
  returns: Object.freeze([
    'client_id', 'recommendation_id', 'recommendation_ref', 'idea_table', 'idea_id',
    'idea_status', 'draft_id', 'published_post_social_id', 'link_state', 'decision',
    'decision_reason', 'decided_at', 'decision_source',
  ]),
  idea_table_by_client: Object.freeze({
    // recorded here as documentation of an already-live fact, not a rule this module enforces --
    // the function itself decides which table a given client_id's ideas live in.
    arch: 'client_ideas', risedtc: 'client_ideas', ivan: 'lm_idea_candidates',
  }),
  recommendation_ref_prefix: 'audn-rec:',
  never_used_for_this_chain: Object.freeze({
    'client_ideas.reuse_of': 'populated today by an unrelated idea-reuse-staging feature '
      + '(8 risedtc rows, source_ref=\'reuse-<uuid>\', status=\'staged\'); verified live, '
      + 'read-only, before this file was corrected -- never written or read here',
  }),
});

/**
 * Normalize one row of `audn_recommendation_links()` (or an equivalent local fixture in the same
 * shape) into the fields this module's chain builder needs. Read-only: it validates and reshapes,
 * it never writes anything back.
 *
 * @param {object} row  one row as the live function returns it
 * @returns {{recommendation_id, client_id, recommendation_ref, idea_table, idea_id, idea_status,
 *   draft_id, publication_id, link_state, decision, decision_reason, decided_at, decision_source}}
 */
export function adaptCanonicalLinkRow(row) {
  if (row === null || typeof row !== 'object') {
    fail('LINK_BAD_INPUT', 'adaptCanonicalLinkRow requires a row object');
  }
  if (typeof row.client_id !== 'string' || row.client_id.trim() === '') {
    fail('LINK_MISSING_CLIENT', 'a canonical link row requires client_id');
  }
  if (typeof row.recommendation_id !== 'string' || row.recommendation_id.trim() === '') {
    fail('LINK_BAD_INPUT', 'a canonical link row requires recommendation_id');
  }
  return {
    client_id: row.client_id,
    recommendation_id: row.recommendation_id,
    recommendation_ref: row.recommendation_ref ?? null,
    idea_table: row.idea_table ?? null,
    idea_id: row.idea_id ?? null,
    idea_status: row.idea_status ?? null,
    draft_id: row.draft_id ?? null,
    // the function's own column name for this is published_post_social_id; renamed here to the
    // vocabulary the rest of this chain (and buildOutcomeChain below) already uses.
    publication_id: row.published_post_social_id ?? null,
    link_state: row.link_state ?? null,
    decision: row.decision ?? null,
    decision_reason: row.decision_reason ?? null,
    decided_at: row.decided_at ?? null,
    decision_source: row.decision_source ?? null,
  };
}

// ---------------------------------------------------------------------------
// Two ages
// ---------------------------------------------------------------------------

export const STANDING_WINDOW_DAYS = Object.freeze([7, 14]);
export const STANDING_TOLERANCE_DAYS = 1;

const DAY_MS = 86400000;

/**
 * Which standing windows have come DUE for a publication, keyed on publication age alone.
 * A window is due when the post is at least that many days old as of the cutoff. Nothing about
 * what was captured enters this answer.
 */
export function dueWindows({ publishedAt, cutoff } = {}) {
  const publishedMs = parseMs(publishedAt);
  const cutoffMs = parseMs(cutoff);
  if (publishedMs === null || cutoffMs === null) return [];
  const ageDays = Math.floor((cutoffMs - publishedMs) / DAY_MS);
  if (ageDays < 0) return [];
  return STANDING_WINDOW_DAYS.filter((w) => ageDays >= w);
}

/**
 * Stamp one capture with its OWN age and the window it answers, if any. A backfilled or lifetime
 * capture answers no window: `window` is null and `age_matched` is false, whatever its raw age.
 */
export function stampCapture({ publishedAt, capturedAt, isBackfill = false, isLifetime = false } = {}) {
  const publishedMs = parseMs(publishedAt);
  const capturedMs = parseMs(capturedAt);
  const captureAgeDays = publishedMs !== null && capturedMs !== null
    ? Math.round((capturedMs - publishedMs) / DAY_MS)
    : null;
  const excluded = isBackfill === true || isLifetime === true;
  const window = (!excluded && captureAgeDays !== null && captureAgeDays >= 0)
    ? (STANDING_WINDOW_DAYS.find((w) => Math.abs(captureAgeDays - w) <= STANDING_TOLERANCE_DAYS) ?? null)
    : null;
  return {
    captured_at: utcIso(capturedAt),
    capture_age_days: captureAgeDays,
    window,
    age_matched: window !== null,
    is_backfill: isBackfill === true,
    is_lifetime: isLifetime === true,
  };
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

export const CHAIN_STATES = Object.freeze([
  'awaiting_publication', 'measuring', 'evaluated',
]);

/**
 * Walk one client's recommendation -> idea -> publication -> observation chain over rows already
 * shaped by `adaptCanonicalLinkRow` (i.e. straight off `audn_recommendation_links()`), joined
 * against publication/observation records for age and window math only -- the recommendation ->
 * idea link itself is taken exactly as the canonical function reports it; this function never
 * upgrades, invents or infers one.
 *
 * Per recommendation:
 *   state                'awaiting_publication' (pending, never a failure -- covers no idea yet,
 *                        an idea with no publication, and a decision-only orphan row with no
 *                        idea at all), 'measuring' (published, no window answered yet) or
 *                        'evaluated' (at least one window answered)
 *   due_windows          keyed on publication age
 *   answered_windows     keyed on capture age
 *   missing_windows      due minus answered, so a gap is a stated gap rather than a zero
 *
 * @param {object} args
 * @param {string} args.clientId
 * @param {object[]} args.canonicalRows   rows already passed through adaptCanonicalLinkRow
 * @param {object[]} args.publications    { publication_id, client_id?, published_at }
 * @param {object[]} [args.observations]  { publication_id, captured_at, metrics?, is_backfill?, is_lifetime? }
 * @param {string} args.cutoff
 */
export function buildOutcomeChain({
  clientId, canonicalRows, publications, observations = [], cutoff,
} = {}) {
  requireClient(clientId, 'buildOutcomeChain');
  for (const [name, list] of [['canonicalRows', canonicalRows], ['publications', publications],
    ['observations', observations]]) {
    if (!Array.isArray(list)) fail('LINK_BAD_INPUT', `${name} must be an array`);
    for (const row of list) {
      if (row && row.client_id !== undefined && row.client_id !== null && row.client_id !== clientId) {
        fail('LINK_TENANT_MISMATCH',
          `${name} row carries tenant ${JSON.stringify(row.client_id)} but the chain context is ${JSON.stringify(clientId)}`);
      }
    }
  }
  const cutoffIso = utcIso(cutoff);
  if (cutoffIso === null) fail('LINK_BAD_CUTOFF', 'a parseable cutoff is required');
  const cutoffMs = Date.parse(cutoffIso);

  const publicationsById = new Map(publications.map((p) => [p.publication_id, p]));
  const observationsByPublication = new Map();
  for (const obs of observations) {
    if (!observationsByPublication.has(obs.publication_id)) observationsByPublication.set(obs.publication_id, []);
    observationsByPublication.get(obs.publication_id).push(obs);
  }

  const chain = [];
  let evaluated = 0;

  for (const row of canonicalRows) {
    const publicationId = row.publication_id ?? null;
    const publication = publicationId === null ? undefined : publicationsById.get(publicationId);
    const publishedIso = publication ? utcIso(publication.published_at) : null;
    const publishedMs = publishedIso === null ? null : Date.parse(publishedIso);
    const published = publishedMs !== null && publishedMs <= cutoffMs;

    const captures = published
      ? (observationsByPublication.get(publicationId) ?? [])
        .filter((o) => {
          const ms = parseMs(o.captured_at);
          return ms !== null && ms <= cutoffMs && ms >= publishedMs;
        })
        .map((o) => ({
          ...stampCapture({
            publishedAt: publishedIso, capturedAt: o.captured_at,
            isBackfill: o.is_backfill === true, isLifetime: o.is_lifetime === true,
          }),
          metrics: o.metrics ?? null,
        }))
        .sort((a, b) => String(a.captured_at ?? '').localeCompare(String(b.captured_at ?? '')))
      : [];

    const due = published ? dueWindows({ publishedAt: publishedIso, cutoff: cutoffIso }) : [];
    const answered = [...new Set(captures.map((c) => c.window).filter((w) => w !== null))].sort((a, b) => a - b);
    const missing = due.filter((w) => !answered.includes(w));

    const state = !published
      ? 'awaiting_publication'
      : answered.length > 0 ? 'evaluated' : 'measuring';
    if (state === 'evaluated') evaluated += 1;

    chain.push({
      client_id: clientId,
      recommendation_id: row.recommendation_id,
      recommendation_ref: row.recommendation_ref,
      idea_table: row.idea_table,
      idea_id: row.idea_id,
      link_state: row.link_state,
      decision: row.decision,
      decision_reason: row.decision_reason,
      publication_id: published ? publicationId : null,
      state,
      published_at: published ? publishedIso : null,
      publication_age_days: published ? Math.floor((cutoffMs - publishedMs) / DAY_MS) : null,
      due_windows: due,
      answered_windows: answered,
      missing_windows: missing,
      captures,
      // A pending item is pending. It is never a failed test and never a zero result.
      pending_reason: state === 'awaiting_publication'
        ? (row.idea_id === null
          ? 'a decision is recorded with no idea ever created from this recommendation'
          : (publicationId === null
            ? `idea exists (${row.link_state ?? 'idea'}); no publication recorded yet`
            : (publication === undefined
              ? 'the canonical function names a published post id this context has no publication record of'
              : 'the linked publication has not happened as of the cutoff')))
        : null,
    });
  }

  return {
    client_id: clientId,
    cutoff: cutoffIso,
    chain,
    evaluated,
    awaiting_publication: chain.filter((c) => c.state === 'awaiting_publication').length,
    measuring: chain.filter((c) => c.state === 'measuring').length,
  };
}

// ---------------------------------------------------------------------------

function requireClient(clientId, fn) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    fail('LINK_MISSING_CLIENT', `${fn} requires an explicit clientId`);
  }
}

function parseMs(value) {
  const iso = utcIso(value);
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
