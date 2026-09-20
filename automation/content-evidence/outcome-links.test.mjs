// Tests for outcome-links.mjs. Every fixture is synthetic: no client post body, no reactor
// identity, no real profile URL, no credential.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reviewMilestone,
  reviewMilestoneStatus,
  REVIEW_MILESTONE_WEEKS,
  REVIEW_MILESTONE_EVALUATED_POSTS,
  planLinkWrites,
  readRecommendationLink,
  LINK_STORAGE,
  dueWindows,
  stampCapture,
  buildOutcomeChain,
  OutcomeLinkError,
} from './outcome-links.mjs';

// ---------------------------------------------------------------------------
// The review milestone: the LATER of the two, never the earlier.
// ---------------------------------------------------------------------------

test('six weeks alone is not the milestone', () => {
  assert.equal(reviewMilestone({ weeksCompleted: 6, evaluatedPosts: 3 }), false);
});

test('twelve posts alone is not the milestone', () => {
  assert.equal(reviewMilestone({ weeksCompleted: 2, evaluatedPosts: 12 }), false);
});

test('both counts in is the milestone', () => {
  assert.equal(reviewMilestone({ weeksCompleted: 6, evaluatedPosts: 12 }), true);
});

test('one short on either half is not the milestone', () => {
  assert.equal(reviewMilestone({ weeksCompleted: 5, evaluatedPosts: 12 }), false);
  assert.equal(reviewMilestone({ weeksCompleted: 6, evaluatedPosts: 11 }), false);
});

test('missing or nonsense counts read as zero, never as reached', () => {
  assert.equal(reviewMilestone(), false);
  assert.equal(reviewMilestone({}), false);
  assert.equal(reviewMilestone({ weeksCompleted: -4, evaluatedPosts: Number.NaN }), false);
});

test('the thresholds are the plan numbers', () => {
  assert.equal(REVIEW_MILESTONE_WEEKS, 6);
  assert.equal(REVIEW_MILESTONE_EVALUATED_POSTS, 12);
});

test('milestone status says what each half is still short of', () => {
  const s = reviewMilestoneStatus({ clientId: 'arch', weeksCompleted: 6, evaluatedPosts: 4 });
  assert.equal(s.reached, false);
  assert.equal(s.weeks_remaining, 0);
  assert.equal(s.evaluated_posts_remaining, 8);
  assert.equal(s.client_id, 'arch');
});

test('milestone status refuses an unbound tenant', () => {
  assert.throws(() => reviewMilestoneStatus({ weeksCompleted: 9, evaluatedPosts: 20 }),
    (e) => e instanceof OutcomeLinkError && e.code === 'LINK_MISSING_CLIENT');
});

// ---------------------------------------------------------------------------
// Where the link is stored
// ---------------------------------------------------------------------------

test('the link storage names existing columns only', () => {
  assert.equal(LINK_STORAGE.recommendation.table, 'public.ops_drafts');
  assert.deepEqual(LINK_STORAGE.recommendation.link_path, ['context', 'audn', 'outcome_link']);
  assert.equal(LINK_STORAGE.idea.link_column, 'reuse_of');
  assert.equal(LINK_STORAGE.observation.table, 'public.post_audience_history');
});

test('a context with no link reads as null, not as an empty object', () => {
  assert.equal(readRecommendationLink(null), null);
  assert.equal(readRecommendationLink({}), null);
  assert.equal(readRecommendationLink({ audn: {} }), null);
});

test('a malformed stored link is refused rather than coerced', () => {
  assert.throws(() => readRecommendationLink({ audn: { outcome_link: 'p1' } }),
    (e) => e.code === 'LINK_CONTEXT_MALFORMED');
});

// ---------------------------------------------------------------------------
// planLinkWrites
// ---------------------------------------------------------------------------

const rec = (over = {}) => ({ recommendation_id: 'r1', client_id: 'risedtc', context: { audn: {} }, ...over });

test('a fresh link plans exactly two additive writes', () => {
  const plan = planLinkWrites({
    clientId: 'risedtc',
    recommendation: rec(),
    idea: { idea_id: 'i1', client_id: 'risedtc', reuse_of: null },
    publicationId: 'p1',
    evidence: 'operator confirmed this draft became this post',
  });
  assert.equal(plan.writes.length, 2);
  assert.ok(plan.writes.every((w) => w.mode === 'add_only'));
  assert.equal(plan.writes[0].value.link_status, 'explicit');
  assert.equal(plan.writes[1].column, 'reuse_of');
  assert.equal(plan.writes[1].value, 'p1');
});

test('a link already stored to the same publication plans nothing', () => {
  const plan = planLinkWrites({
    clientId: 'risedtc',
    recommendation: rec({ context: { audn: { outcome_link: { publication_id: 'p1' } } } }),
    idea: { idea_id: 'i1', reuse_of: 'p1' },
    publicationId: 'p1',
    evidence: 'same link, replayed',
  });
  assert.deepEqual(plan.writes, []);
  assert.equal(plan.already_linked, true);
});

test('a different stored publication is never overwritten', () => {
  assert.throws(() => planLinkWrites({
    clientId: 'risedtc',
    recommendation: rec({ context: { audn: { outcome_link: { publication_id: 'p-old' } } } }),
    publicationId: 'p-new',
    evidence: 'a second opinion',
  }), (e) => e.code === 'LINK_WOULD_OVERWRITE');
});

test('a populated client_ideas.reuse_of is never overwritten either', () => {
  assert.throws(() => planLinkWrites({
    clientId: 'risedtc',
    recommendation: rec(),
    idea: { idea_id: 'i1', reuse_of: 'p-old' },
    publicationId: 'p-new',
    evidence: 'a second opinion',
  }), (e) => e.code === 'LINK_WOULD_OVERWRITE');
});

test('a foreign tenant row is refused', () => {
  assert.throws(() => planLinkWrites({
    clientId: 'risedtc',
    recommendation: rec({ client_id: 'arch' }),
    publicationId: 'p1',
    evidence: 'x',
  }), (e) => e.code === 'LINK_TENANT_MISMATCH');
});

test('a link with no stated evidence is refused', () => {
  assert.throws(() => planLinkWrites({
    clientId: 'risedtc', recommendation: rec(), publicationId: 'p1', evidence: '   ',
  }), (e) => e.code === 'LINK_MISSING_EVIDENCE');
});

test('approval and dispatch state can never ride along on a link write', () => {
  assert.throws(() => planLinkWrites({
    clientId: 'risedtc',
    recommendation: rec({ set_approved_at: '2026-09-20T00:00:00Z' }),
    publicationId: 'p1',
    evidence: 'x',
  }), (e) => e.code === 'LINK_TOUCHES_APPROVAL');
  assert.throws(() => planLinkWrites({
    clientId: 'risedtc',
    recommendation: rec({ set_sent_at: '2026-09-20T00:00:00Z' }),
    publicationId: 'p1',
    evidence: 'x',
  }), (e) => e.code === 'LINK_TOUCHES_APPROVAL');
});

test('every planned write carries a guard that makes a replay a no-op', () => {
  const plan = planLinkWrites({
    clientId: 'ivan',
    recommendation: { recommendation_id: 'r9', context: null },
    idea: { idea_id: 'i9' },
    publicationId: 'p9',
    evidence: 'operator confirmed',
  });
  assert.ok(plan.writes.every((w) => typeof w.guard === 'string' && w.guard.includes('is null')));
});

// ---------------------------------------------------------------------------
// Two ages
// ---------------------------------------------------------------------------

test('a window comes due on publication age alone', () => {
  assert.deepEqual(dueWindows({ publishedAt: '2026-09-01T00:00:00Z', cutoff: '2026-09-05T00:00:00Z' }), []);
  assert.deepEqual(dueWindows({ publishedAt: '2026-09-01T00:00:00Z', cutoff: '2026-09-08T00:00:00Z' }), [7]);
  assert.deepEqual(dueWindows({ publishedAt: '2026-09-01T00:00:00Z', cutoff: '2026-09-20T00:00:00Z' }), [7, 14]);
});

test('an unpublished or unparseable date makes no window due', () => {
  assert.deepEqual(dueWindows({ publishedAt: null, cutoff: '2026-09-20T00:00:00Z' }), []);
  assert.deepEqual(dueWindows({ publishedAt: '2026-09-25T00:00:00Z', cutoff: '2026-09-20T00:00:00Z' }), []);
});

test('a capture answers a window on its own age', () => {
  const c = stampCapture({ publishedAt: '2026-09-01T00:00:00Z', capturedAt: '2026-09-08T00:00:00Z' });
  assert.equal(c.capture_age_days, 7);
  assert.equal(c.window, 7);
  assert.equal(c.age_matched, true);
});

test('a lifetime capture answers no window however its age lands', () => {
  const c = stampCapture({
    publishedAt: '2026-09-01T00:00:00Z', capturedAt: '2026-09-08T00:00:00Z', isLifetime: true,
  });
  assert.equal(c.capture_age_days, 7);
  assert.equal(c.window, null);
  assert.equal(c.age_matched, false);
});

test('a premature capture answers no window', () => {
  const c = stampCapture({ publishedAt: '2026-09-01T00:00:00Z', capturedAt: '2026-09-03T00:00:00Z' });
  assert.equal(c.capture_age_days, 2);
  assert.equal(c.window, null);
});

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

test('a recommendation with no stored link is pending, never a failure', () => {
  const r = buildOutcomeChain({
    clientId: 'arch',
    recommendations: [{ recommendation_id: 'r1', context: { audn: {} } }],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.equal(r.evaluated, 0);
  assert.equal(r.awaiting_publication, 1);
  assert.match(r.chain[0].pending_reason, /no stored link/);
});

test('a stored link to an unpublished post stays awaiting_publication', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    recommendations: [{ recommendation_id: 'r1', context: { audn: { outcome_link: { publication_id: 'p1' } } } }],
    publications: [{ publication_id: 'p1', published_at: '2026-10-01T00:00:00Z' }],
    observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.equal(r.chain[0].publication_id, null);
});

test('a published post with no answered window is measuring, and says which window is missing', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    recommendations: [{ recommendation_id: 'r1', context: { audn: { outcome_link: { publication_id: 'p1' } } } }],
    publications: [{ publication_id: 'p1', published_at: '2026-09-01T00:00:00Z' }],
    observations: [{ publication_id: 'p1', captured_at: '2026-09-03T00:00:00Z', metrics: { likes: 2 } }],
    cutoff: '2026-09-20T00:00:00Z',
  });
  const c = r.chain[0];
  assert.equal(c.state, 'measuring');
  assert.deepEqual(c.due_windows, [7, 14]);
  assert.deepEqual(c.answered_windows, []);
  assert.deepEqual(c.missing_windows, [7, 14]);
  assert.equal(c.captures[0].capture_age_days, 2);
});

test('an answered window evaluates the test and leaves the other window stated as missing', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    recommendations: [{ recommendation_id: 'r1', context: { audn: { outcome_link: { publication_id: 'p1' } } } }],
    publications: [{ publication_id: 'p1', published_at: '2026-09-01T00:00:00Z' }],
    observations: [
      { publication_id: 'p1', captured_at: '2026-09-08T00:00:00Z', metrics: { likes: 9 } },
      { publication_id: 'p1', captured_at: '2026-09-19T00:00:00Z', metrics: { likes: 40 }, is_lifetime: true },
    ],
    cutoff: '2026-09-20T00:00:00Z',
  });
  const c = r.chain[0];
  assert.equal(c.state, 'evaluated');
  assert.deepEqual(c.answered_windows, [7]);
  assert.deepEqual(c.missing_windows, [14]);
  assert.equal(c.publication_age_days, 19);
  assert.equal(r.evaluated, 1);
  const lifetime = c.captures.find((x) => x.is_lifetime);
  assert.equal(lifetime.age_matched, false);
});

test('client_ideas.reuse_of alone carries the link when no context key was written', () => {
  const r = buildOutcomeChain({
    clientId: 'risedtc',
    recommendations: [{ recommendation_id: 'r1', context: null }],
    ideas: [{ idea_id: 'i1', recommendation_id: 'r1', reuse_of: 'p1' }],
    publications: [{ publication_id: 'p1', published_at: '2026-09-01T00:00:00Z' }],
    observations: [{ publication_id: 'p1', captured_at: '2026-09-15T00:00:00Z' }],
    cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].link_status, 'explicit');
  assert.equal(r.chain[0].idea_id, 'i1');
  assert.deepEqual(r.chain[0].answered_windows, [14]);
});

test('a capture recorded before publication never counts', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    recommendations: [{ recommendation_id: 'r1', context: { audn: { outcome_link: { publication_id: 'p1' } } } }],
    publications: [{ publication_id: 'p1', published_at: '2026-09-10T00:00:00Z' }],
    observations: [{ publication_id: 'p1', captured_at: '2026-09-01T00:00:00Z' }],
    cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].captures.length, 0);
  assert.equal(r.chain[0].state, 'measuring');
});

test('a foreign tenant anywhere in the chain inputs is refused', () => {
  assert.throws(() => buildOutcomeChain({
    clientId: 'ivan',
    recommendations: [{ recommendation_id: 'r1', client_id: 'arch' }],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  }), (e) => e.code === 'LINK_TENANT_MISMATCH');
});

test('a link naming a publication this context does not hold stays pending with a stated reason', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    recommendations: [{ recommendation_id: 'r1', context: { audn: { outcome_link: { publication_id: 'p-gone' } } } }],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.match(r.chain[0].pending_reason, /no record of/);
});
