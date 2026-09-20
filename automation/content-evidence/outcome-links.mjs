// content-evidence / outcome-links.mjs
//
// The recommendation -> idea -> publication -> observation chain, expressed over the SMALLEST
// EXISTING storage this system already has. No new table is proposed here and none is needed.
//
// WHERE EACH LINK LIVES (discovered read-only, Phase 0 surfaces section C)
//
//   recommendation  public.ops_drafts (kind='audn_recommendation'), tenant column client_id.
//                   Today NOTHING ties one of these rows to a client_ideas row: in the single
//                   fully-traced production case (the RISE "Toby Waller" idea, client_ideas
//                   613abda6) zero ops_drafts rows reference it at all. The only existing field
//                   with documented capacity for a structured sub-key is ops_drafts.context
//                   (jsonb, already carrying author_baseline and source_coverage), so the
//                   recommendation side of the link is written there and nowhere else.
//
//   idea            public.client_ideas. Its EXISTING, currently-empty column reuse_of is the
//                   documented slot for exactly this join. Populating it upgrades
//                   idea -> publication from inferred to stored. No column is added.
//
//   publication     public.client_post_metrics (tenant column client_id) for a client lane, or
//                   public.own_posts for Ivan (which carries no tenant column at all, so its
//                   rows are only ever read through an explicitly bound client descriptor).
//
//   observation     public.post_audience_history, keyed on seat rather than client_id, joined by
//                   activity id (urn:li:activity:<id>). That match is exact identity, not a
//                   heuristic, so publication -> observation is the one link in the chain that is
//                   already stored today.
//
// WHAT THIS MODULE REFUSES TO DO
//
//   * It never writes. It PLANS writes (planLinkWrites) as explicit, additive patches, and it
//     refuses to plan one that would overwrite a link already stored, touch approval or dispatch
//     state, or cross a tenant. Existing unapproved rows stay unapproved and existing published
//     rows stay exactly as published.
//   * It never turns an inferred join into a stored one. A plan is only produced from evidence
//     the caller states explicitly; reconstructing a link from timing lives in outcomes.mjs and
//     stays labelled `inferred` there forever.
//   * A recommendation with no publication is PENDING, never a failed result. Its chain state is
//     `awaiting_publication`, the same word outcomes.mjs uses, so one vocabulary covers both.
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
// Where the links are stored
// ---------------------------------------------------------------------------

/**
 * The exact existing columns this chain uses. Named in one place so a release plan, a rollback
 * and a test all point at the same four slots and no code invents a fifth.
 */
export const LINK_STORAGE = Object.freeze({
  recommendation: Object.freeze({
    table: 'public.ops_drafts',
    tenant_column: 'client_id',
    selector: "kind = 'audn_recommendation'",
    link_path: ['context', 'audn', 'outcome_link'],
    note: 'context is jsonb and already carries structured sub-keys; no column is added',
  }),
  idea: Object.freeze({
    table: 'public.client_ideas',
    link_column: 'reuse_of',
    note: 'existing column, empty today, documented for exactly this join',
  }),
  publication: Object.freeze({
    client_table: 'public.client_post_metrics',
    ivan_table: 'public.own_posts',
    note: 'own_posts carries no tenant column; it is only read through a bound client descriptor',
  }),
  observation: Object.freeze({
    table: 'public.post_audience_history',
    tenant_column: 'seat',
    join: 'activity id, urn:li:activity:<id>',
    note: 'exact identity match, the one already-stored link in the chain',
  }),
});

export const LINK_CONTEXT_KEY = 'outcome_link';

/** Read the stored link out of an ops_drafts.context jsonb, or null when there is none. */
export function readRecommendationLink(context) {
  const link = context?.audn?.[LINK_CONTEXT_KEY];
  if (link === null || link === undefined) return null;
  if (typeof link !== 'object' || Array.isArray(link)) {
    fail('LINK_CONTEXT_MALFORMED',
      `ops_drafts.context.audn.${LINK_CONTEXT_KEY} must be an object when present`);
  }
  return link;
}

/**
 * Plan the two additive writes that turn this chain from inferred into stored. Returns patches;
 * it opens no connection and issues no statement.
 *
 * Refusals, all of them deliberate:
 *   * a foreign tenant on any row                        LINK_TENANT_MISMATCH
 *   * a link already stored with a different value       LINK_WOULD_OVERWRITE
 *   * any attempt to carry approval or dispatch state    LINK_TOUCHES_APPROVAL
 *
 * @param {object} args
 * @param {string} args.clientId
 * @param {object} args.recommendation  { recommendation_id, client_id?, context? }
 * @param {object} [args.idea]          { idea_id, client_id?, reuse_of? }
 * @param {string} args.publicationId
 * @param {string} [args.evidence]      why this link is asserted; required, never blank
 * @returns {{ writes: object[], already_linked: boolean }}
 */
export function planLinkWrites({
  clientId, recommendation, idea = null, publicationId, evidence,
} = {}) {
  requireClient(clientId, 'planLinkWrites');
  if (recommendation === null || typeof recommendation !== 'object') {
    fail('LINK_BAD_INPUT', 'planLinkWrites requires a recommendation row');
  }
  if (typeof publicationId !== 'string' || publicationId.trim() === '') {
    fail('LINK_BAD_INPUT', 'planLinkWrites requires an explicit publicationId');
  }
  if (typeof evidence !== 'string' || evidence.trim() === '') {
    fail('LINK_MISSING_EVIDENCE',
      'a stored link states why it is asserted; an unexplained join is an inferred one and belongs in outcomes.mjs');
  }
  for (const row of [recommendation, idea]) {
    if (row && row.client_id !== undefined && row.client_id !== null && row.client_id !== clientId) {
      fail('LINK_TENANT_MISMATCH',
        `row carries tenant ${JSON.stringify(row.client_id)} but the link context is ${JSON.stringify(clientId)}`);
    }
  }
  for (const field of ['approved_at', 'sent_at', 'published_at']) {
    if (Object.prototype.hasOwnProperty.call(recommendation, `set_${field}`)) {
      fail('LINK_TOUCHES_APPROVAL',
        `planLinkWrites never changes ${field}; approval and dispatch stay where the operator left them`);
    }
  }

  const writes = [];
  let alreadyLinked = false;

  const existing = readRecommendationLink(recommendation.context ?? null);
  if (existing !== null) {
    if (existing.publication_id !== publicationId) {
      fail('LINK_WOULD_OVERWRITE',
        `recommendation ${JSON.stringify(recommendation.recommendation_id)} already links to publication ${JSON.stringify(existing.publication_id)}`,
        { stored: existing.publication_id, proposed: publicationId });
    }
    alreadyLinked = true;
  } else {
    writes.push({
      table: LINK_STORAGE.recommendation.table,
      match: { client_id: clientId, id: recommendation.recommendation_id, kind: 'audn_recommendation' },
      jsonb_path: LINK_STORAGE.recommendation.link_path,
      value: {
        publication_id: publicationId,
        idea_id: idea?.idea_id ?? null,
        link_status: 'explicit',
        evidence: evidence.trim(),
      },
      mode: 'add_only',
      guard: `context->'audn'->'${LINK_CONTEXT_KEY}' is null`,
    });
  }

  if (idea !== null) {
    if (typeof idea.idea_id !== 'string' || idea.idea_id.trim() === '') {
      fail('LINK_BAD_INPUT', 'an idea row needs an idea_id');
    }
    const storedReuse = idea.reuse_of ?? null;
    if (storedReuse !== null && storedReuse !== publicationId) {
      fail('LINK_WOULD_OVERWRITE',
        `client_ideas ${JSON.stringify(idea.idea_id)} already reuses ${JSON.stringify(storedReuse)}`,
        { stored: storedReuse, proposed: publicationId });
    }
    if (storedReuse === null) {
      writes.push({
        table: LINK_STORAGE.idea.table,
        match: { client_id: clientId, id: idea.idea_id },
        column: LINK_STORAGE.idea.link_column,
        value: publicationId,
        mode: 'add_only',
        guard: `${LINK_STORAGE.idea.link_column} is null`,
      });
    } else {
      alreadyLinked = true;
    }
  }

  return { writes, already_linked: alreadyLinked && writes.length === 0 };
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
 * Walk one client's recommendation -> idea -> publication -> observation chain over stored links
 * only, and report, per recommendation:
 *
 *   state                'awaiting_publication' (pending, never a failure), 'measuring' (published,
 *                        no window answered yet) or 'evaluated' (at least one window answered)
 *   due_windows          keyed on publication age
 *   answered_windows     keyed on capture age
 *   missing_windows      due minus answered, so a gap is a stated gap rather than a zero
 *
 * @param {object} args
 * @param {string} args.clientId
 * @param {object[]} args.recommendations  { recommendation_id, client_id?, context? }
 * @param {object[]} [args.ideas]          { idea_id, client_id?, reuse_of? , recommendation_id? }
 * @param {object[]} args.publications     { publication_id, client_id?, published_at }
 * @param {object[]} args.observations     { publication_id, captured_at, metrics?, is_backfill?, is_lifetime? }
 * @param {string} args.cutoff
 */
export function buildOutcomeChain({
  clientId, recommendations, ideas = [], publications, observations, cutoff,
} = {}) {
  requireClient(clientId, 'buildOutcomeChain');
  for (const [name, list] of [['recommendations', recommendations], ['ideas', ideas],
    ['publications', publications], ['observations', observations]]) {
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
  const ideasByRecommendation = new Map();
  for (const idea of ideas) {
    if (idea.recommendation_id) ideasByRecommendation.set(idea.recommendation_id, idea);
  }
  const observationsByPublication = new Map();
  for (const obs of observations) {
    if (!observationsByPublication.has(obs.publication_id)) observationsByPublication.set(obs.publication_id, []);
    observationsByPublication.get(obs.publication_id).push(obs);
  }

  const chain = [];
  let evaluated = 0;

  for (const rec of recommendations) {
    const stored = readRecommendationLink(rec.context ?? null);
    const idea = ideasByRecommendation.get(rec.recommendation_id) ?? null;
    const publicationId = stored?.publication_id ?? idea?.reuse_of ?? null;
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
      recommendation_id: rec.recommendation_id,
      idea_id: idea?.idea_id ?? stored?.idea_id ?? null,
      publication_id: published ? publicationId : null,
      link_status: stored !== null ? (stored.link_status ?? 'explicit')
        : (idea?.reuse_of ? 'explicit' : null),
      state,
      published_at: published ? publishedIso : null,
      publication_age_days: published ? Math.floor((cutoffMs - publishedMs) / DAY_MS) : null,
      due_windows: due,
      answered_windows: answered,
      missing_windows: missing,
      captures,
      // A pending item is pending. It is never a failed test and never a zero result.
      pending_reason: state === 'awaiting_publication'
        ? (publicationId === null
          ? 'no stored link to a publication yet'
          : (publication === undefined
            ? 'the stored link names a publication this context has no record of'
            : 'the linked publication has not happened as of the cutoff'))
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
