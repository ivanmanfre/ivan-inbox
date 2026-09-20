// Tests for outcome-links.mjs. Every fixture is synthetic: no client post body, no reactor
// identity, no real profile URL, no credential. Row shapes mirror the LIVE columns of
// public.audn_recommendation_links(), verified read-only via
// `select pg_get_functiondef(p.oid) ... where proname='audn_recommendation_links'`
// (Run 4 Phase 3 step 1).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reviewMilestone,
  reviewMilestoneStatus,
  REVIEW_MILESTONE_WEEKS,
  REVIEW_MILESTONE_EVALUATED_POSTS,
  CANONICAL_LINK_SOURCE,
  adaptCanonicalLinkRow,
  adaptUnlinkedRecommendation,
  UNLINKED_ROW_REASON,
  dueWindows,
  stampCapture,
  buildOutcomeChain,
  OutcomeLinkError,
  isDeployTestArtifact,
  computeOneToMany,
  reconcilePopulation,
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
// Where the link already lives, and where it is never written
// ---------------------------------------------------------------------------

test('the canonical source names the live function, not an invented table', () => {
  assert.equal(CANONICAL_LINK_SOURCE.function, 'public.audn_recommendation_links()');
  assert.deepEqual(CANONICAL_LINK_SOURCE.arguments, []);
  assert.ok(CANONICAL_LINK_SOURCE.returns.includes('published_post_social_id'));
  assert.ok(CANONICAL_LINK_SOURCE.returns.includes('idea_table'));
});

test('reuse_of is documented as off-limits, never as a storage slot this module uses', () => {
  assert.ok('client_ideas.reuse_of' in CANONICAL_LINK_SOURCE.never_used_for_this_chain);
});

test('adaptCanonicalLinkRow reshapes the live column name to publication_id', () => {
  const link = adaptCanonicalLinkRow({
    client_id: 'risedtc', recommendation_id: 'r1', recommendation_ref: 'audn-rec:r1',
    idea_table: 'client_ideas', idea_id: 'i1', idea_status: 'staged', draft_id: null,
    published_post_social_id: null, link_state: 'idea', decision: null, decision_reason: null,
    decided_at: null, decision_source: null,
  });
  assert.equal(link.publication_id, null);
  assert.equal(link.idea_table, 'client_ideas');
  assert.equal(link.link_state, 'idea');
});

test('adaptCanonicalLinkRow refuses a row with no client_id or recommendation_id', () => {
  assert.throws(() => adaptCanonicalLinkRow({ recommendation_id: 'r1' }),
    (e) => e.code === 'LINK_MISSING_CLIENT');
  assert.throws(() => adaptCanonicalLinkRow({ client_id: 'ivan' }),
    (e) => e.code === 'LINK_BAD_INPUT');
  assert.throws(() => adaptCanonicalLinkRow(null),
    (e) => e.code === 'LINK_BAD_INPUT');
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

const row = (over = {}) => adaptCanonicalLinkRow({
  client_id: 'arch', recommendation_id: 'r1', recommendation_ref: 'audn-rec:r1',
  idea_table: 'client_ideas', idea_id: 'i1', idea_status: 'staged', draft_id: null,
  published_post_social_id: null, link_state: 'idea', decision: null, decision_reason: null,
  decided_at: null, decision_source: null, ...over,
});

test('a recommendation-only decision, no idea at all, is pending, never a failure', () => {
  const r = buildOutcomeChain({
    clientId: 'arch',
    canonicalRows: [row({
      idea_table: null, idea_id: null, idea_status: null, link_state: 'recommended',
      decision: 'deferred', decision_reason: 'deploy test, excluded from learning metrics',
    })],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.equal(r.evaluated, 0);
  assert.equal(r.awaiting_publication, 1);
  assert.match(r.chain[0].pending_reason, /no idea ever created/);
});

test('an idea with no publication stays awaiting_publication, and says which stage it reached', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    canonicalRows: [row({ client_id: 'ivan', idea_table: 'lm_idea_candidates', link_state: 'drafted' })],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.equal(r.chain[0].publication_id, null);
  assert.match(r.chain[0].pending_reason, /drafted/);
});

test('a drafted idea (draft_id set, no publication yet) stays awaiting_publication and names the drafted stage', () => {
  const r = buildOutcomeChain({
    clientId: 'arch',
    canonicalRows: [row({ draft_id: 'd1', link_state: 'drafted' })],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.equal(r.chain[0].publication_id, null);
  assert.match(r.chain[0].pending_reason, /idea exists \(drafted\)/);
});

test('a stored link to an unpublished post stays awaiting_publication', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    canonicalRows: [row({ client_id: 'ivan', published_post_social_id: 'p1', link_state: 'published' })],
    publications: [{ publication_id: 'p1', published_at: '2026-10-01T00:00:00Z' }],
    observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.equal(r.chain[0].publication_id, null);
});

test('a published post with no answered window is measuring, and says which window is missing', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    canonicalRows: [row({ client_id: 'ivan', published_post_social_id: 'p1', link_state: 'published' })],
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
    canonicalRows: [row({ client_id: 'ivan', published_post_social_id: 'p1', link_state: 'published' })],
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

test('a lone fourteen-day capture evaluates the test and leaves seven-day stated as missing', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    canonicalRows: [row({ client_id: 'ivan', published_post_social_id: 'p1', link_state: 'published' })],
    publications: [{ publication_id: 'p1', published_at: '2026-09-01T00:00:00Z' }],
    observations: [{ publication_id: 'p1', captured_at: '2026-09-15T00:00:00Z', metrics: { likes: 20 } }],
    cutoff: '2026-09-20T00:00:00Z',
  });
  const c = r.chain[0];
  assert.equal(c.state, 'evaluated');
  assert.deepEqual(c.due_windows, [7, 14]);
  assert.deepEqual(c.answered_windows, [14]);
  assert.deepEqual(c.missing_windows, [7]);
  assert.equal(c.captures[0].capture_age_days, 14);
});

test('a capture recorded before publication never counts', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    canonicalRows: [row({ client_id: 'ivan', published_post_social_id: 'p1', link_state: 'published' })],
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
    canonicalRows: [row({ client_id: 'arch' })],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  }), (e) => e.code === 'LINK_TENANT_MISMATCH');
});

test('a recommendation with no live link row at all is pending, distinct from a decided-but-idea-less one', () => {
  const stub = adaptUnlinkedRecommendation({ clientId: 'risedtc', recommendationId: 'r-undecided' });
  const r = buildOutcomeChain({
    clientId: 'risedtc', canonicalRows: [stub], publications: [], observations: [],
    cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.match(r.chain[0].pending_reason, new RegExp(UNLINKED_ROW_REASON));
});

test('adaptUnlinkedRecommendation refuses a missing recommendationId', () => {
  assert.throws(() => adaptUnlinkedRecommendation({ clientId: 'ivan' }),
    (e) => e.code === 'LINK_BAD_INPUT');
});

test('a named published post id this context does not hold stays pending with a stated reason', () => {
  const r = buildOutcomeChain({
    clientId: 'ivan',
    canonicalRows: [row({ client_id: 'ivan', published_post_social_id: 'p-gone', link_state: 'published' })],
    publications: [], observations: [], cutoff: '2026-09-20T00:00:00Z',
  });
  assert.equal(r.chain[0].state, 'awaiting_publication');
  assert.match(r.chain[0].pending_reason, /no publication record of/);
});

// ---------------------------------------------------------------------------
// Population reconciliation: a local, production-shaped schema/fixture. Every row below is
// shaped exactly like public.audn_recommendation_links() and ops_drafts (Run 4 continuation
// Phase 3 step 3) -- synthetic ids, zero live dependency, zero client post body. Each control is
// mutation-proven: flipping the classification it checks (e.g. swapping which bucket a row lands
// in, or which id a publication attaches to) makes the assertion fail.
// ---------------------------------------------------------------------------

test('isDeployTestArtifact matches only the live deploy-test wording, never a generic deferral', () => {
  assert.equal(isDeployTestArtifact('deploy test, excluded from learning metrics'), true);
  assert.equal(isDeployTestArtifact('EXCLUDED FROM LEARNING METRICS (deploy)'), true);
  assert.equal(isDeployTestArtifact('client asked to wait'), false);
  assert.equal(isDeployTestArtifact(null), false);
  assert.equal(isDeployTestArtifact(undefined), false);
});

test('computeOneToMany groups by (client_id, recommendation_id) and ignores single-publication rows', () => {
  const links = [
    { client_id: 'ivan', recommendation_id: 'r1', publication_id: 'p1' },
    { client_id: 'ivan', recommendation_id: 'r1', publication_id: 'p2' },
    { client_id: 'ivan', recommendation_id: 'r2', publication_id: 'p3' },
    { client_id: 'arch', recommendation_id: 'r1', publication_id: 'p9' },
  ];
  const oneToMany = computeOneToMany(links);
  assert.equal(oneToMany.length, 1);
  assert.equal(oneToMany[0].recommendation_id, 'r1');
  assert.deepEqual([...oneToMany[0].publication_ids].sort(), ['p1', 'p2']);
});

test('computeOneToMany ignores links with no publication_id', () => {
  const links = [
    { client_id: 'ivan', recommendation_id: 'r1', publication_id: null },
    { client_id: 'ivan', recommendation_id: 'r1', publication_id: undefined },
  ];
  assert.deepEqual(computeOneToMany(links), []);
});

const opsRow = (client_id, id, created_at = '2026-09-13T00:00:00Z') => ({ client_id, recommendation_id: id, created_at });
const linkRow = (over = {}) => ({
  client_id: 'ivan', recommendation_id: 'r1', recommendation_ref: 'audn-rec:r1', idea_table: 'lm_idea_candidates',
  idea_id: null, idea_status: null, draft_id: null, published_post_social_id: null, link_state: null,
  decision: null, decision_reason: null, decided_at: null, decision_source: null, ...over,
});

test('reconcilePopulation: explicit (idea_id present) is bucketed explicit, never inferred', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1')],
    linkRows: [linkRow({ client_id: 'arch', idea_id: 'i1', link_state: 'idea' })],
  });
  assert.deepEqual(r.buckets, { explicit: 1, inferred: 0, unresolved: 0, withdrawn: 0, ambiguous: 0, excluded: 0 });
  assert.equal(r.population.recommendations_total, 1);
});

test('reconcilePopulation: draft (idea_id + draft_id, no publication) still counts explicit', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1')],
    linkRows: [linkRow({ client_id: 'arch', idea_id: 'i1', draft_id: 'd1', link_state: 'drafted' })],
  });
  assert.equal(r.buckets.explicit, 1);
  assert.equal(r.links[0].draft_id, 'd1');
  assert.equal(r.links[0].publication_id, null);
});

test('reconcilePopulation: a published post feeds real_chain.present and stays bucketed explicit', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1')],
    linkRows: [linkRow({ client_id: 'arch', idea_id: 'i1', draft_id: 'd1', published_post_social_id: 'p1', link_state: 'published' })],
  });
  assert.equal(r.buckets.explicit, 1);
  assert.equal(r.real_chain.present, true);
  assert.equal(r.real_chain.example.publication_id, 'p1');
  assert.equal(r.real_chain.example.recommendation_id, 'r1');
});

test('reconcilePopulation: withdrawn covers both a rejected and a deferred no-idea decision', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1'), opsRow('arch', 'r2')],
    linkRows: [
      linkRow({ client_id: 'arch', recommendation_id: 'r1', decision: 'rejected', decision_reason: 'not a fit' }),
      linkRow({ client_id: 'arch', recommendation_id: 'r2', decision: 'deferred', decision_reason: 'revisit next quarter' }),
    ],
  });
  assert.equal(r.buckets.withdrawn, 2);
  assert.equal(r.buckets.explicit, 0);
});

test('reconcilePopulation: a recorded deploy-test decision_reason is excluded, never withdrawn or explicit', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1')],
    linkRows: [linkRow({ client_id: 'arch', recommendation_id: 'r1', decision: 'deferred', decision_reason: 'deploy test, excluded from learning metrics' })],
  });
  assert.deepEqual(r.buckets, { explicit: 0, inferred: 0, unresolved: 0, withdrawn: 0, ambiguous: 0, excluded: 1 });
  assert.equal(r.excluded_rows[0].id, 'arch:r1');
  assert.equal(r.excluded_rows[0].reason, 'deploy test, excluded from learning metrics');
});

test('reconcilePopulation: an ops_drafts row with no live link row at all is unresolved, never dropped', () => {
  const r = reconcilePopulation({ opsDraftsRows: [opsRow('ivan', 'r-new')], linkRows: [] });
  assert.equal(r.buckets.unresolved, 1);
  assert.equal(r.unresolved_rows[0].id, 'ivan:r-new');
  assert.equal(r.unresolved_rows[0].reason, UNLINKED_ROW_REASON);
});

test('reconcilePopulation: two live link rows racing for one key are ambiguous, and never silently pick one', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1')],
    linkRows: [
      linkRow({ client_id: 'arch', recommendation_id: 'r1', idea_id: 'i1' }),
      linkRow({ client_id: 'arch', recommendation_id: 'r1', idea_id: 'i2' }),
    ],
  });
  assert.deepEqual(r.buckets, { explicit: 0, inferred: 0, unresolved: 0, withdrawn: 0, ambiguous: 1, excluded: 0 });
  assert.equal(r.links.length, 0);
});

test('reconcilePopulation: a live decision row with no matching ops_drafts parent is an orphan, outside the population', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1')],
    linkRows: [
      linkRow({ client_id: 'arch', recommendation_id: 'r1', idea_id: 'i1' }),
      linkRow({ client_id: 'arch', recommendation_id: 'r-gone', decision: 'deferred', decision_reason: 'deploy test, excluded from learning metrics' }),
    ],
  });
  assert.equal(r.population.recommendations_total, 1);
  assert.equal(r.buckets.explicit, 1);
  assert.equal(r.link_rows_outside_population.length, 1);
  assert.equal(r.link_rows_outside_population[0].id, 'arch:r-gone');
  assert.equal(r.orphan_link_rows, r.link_rows_outside_population);
});

test('reconcilePopulation: cross-tenant id collision -- two clients reusing the same bare recommendation id never cross-link', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('arch', 'r1'), opsRow('risedtc', 'r1')],
    linkRows: [
      linkRow({ client_id: 'arch', recommendation_id: 'r1', idea_id: 'idea-arch' }),
      linkRow({ client_id: 'risedtc', recommendation_id: 'r1', decision: 'rejected', decision_reason: 'not now' }),
    ],
  });
  assert.equal(r.population.recommendations_total, 2);
  assert.equal(r.buckets.explicit, 1);
  assert.equal(r.buckets.withdrawn, 1);
  assert.equal(r.buckets.ambiguous, 0);
  const archLink = r.links.find((l) => l.client_id === 'arch');
  const risedtcLink = r.links.find((l) => l.client_id === 'risedtc');
  assert.equal(archLink.idea_id, 'idea-arch');
  assert.equal(risedtcLink.idea_id, null);
  assert.equal(risedtcLink.decision, 'rejected');
});

test('reconcilePopulation: bucket sum always equals the population, or the function refuses to return a receipt', () => {
  const r = reconcilePopulation({
    opsDraftsRows: [opsRow('ivan', 'r1'), opsRow('ivan', 'r2'), opsRow('ivan', 'r3')],
    linkRows: [
      linkRow({ client_id: 'ivan', recommendation_id: 'r1', idea_id: 'i1' }),
      linkRow({ client_id: 'ivan', recommendation_id: 'r2', decision: 'deferred', decision_reason: 'deploy test, excluded from learning metrics' }),
    ],
  });
  const sum = Object.values(r.buckets).reduce((a, b) => a + b, 0);
  assert.equal(sum, r.population.recommendations_total);
  assert.equal(r.buckets.unresolved, 1); // r3, no link row at all
});

test('reconcilePopulation refuses malformed input rather than guessing a shape', () => {
  assert.throws(() => reconcilePopulation({ opsDraftsRows: null, linkRows: [] }), (e) => e.code === 'LINK_BAD_INPUT');
  assert.throws(() => reconcilePopulation({ opsDraftsRows: [], linkRows: null }), (e) => e.code === 'LINK_BAD_INPUT');
});

// ---------------------------------------------------------------------------
// End to end: one recommendation carried from idea through a one-to-many publication, joined to
// buildOutcomeChain's window math -- the full "carries a recommendation through idea, draft,
// published post, 7-day and 14-day observation, one-to-many publication" continuation in one
// synthetic, production-shaped fixture.
// ---------------------------------------------------------------------------

test('end to end: idea -> draft -> published -> both windows answered, and a republish is caught as one-to-many', () => {
  const opsDraftsRows = [opsRow('risedtc', 'r1', '2026-08-01T00:00:00Z')];
  const originalLink = linkRow({
    client_id: 'risedtc', recommendation_id: 'r1', idea_id: 'idea-1', draft_id: 'draft-1',
    published_post_social_id: 'post-1', link_state: 'published',
  });
  const recon = reconcilePopulation({ opsDraftsRows, linkRows: [originalLink] });
  assert.equal(recon.buckets.explicit, 1);
  assert.equal(recon.real_chain.present, true);
  assert.equal(recon.real_chain.example.publication_id, 'post-1');

  // A republish of the same recommendation (a corrected post) is a second, distinct link row for
  // the same key: reconcilePopulation classes that as ambiguous (two rows racing for one key),
  // which is the correct, non-silent outcome for THIS reconciliation. one_to_many is exercised
  // directly here on a `links[]` shape that already carries both publication ids for one key, the
  // shape a caller gets after resolving which of two racing rows is current.
  const bothLinks = [
    adaptCanonicalLinkRow(originalLink),
    adaptCanonicalLinkRow({ ...originalLink, published_post_social_id: 'post-1-corrected' }),
  ];
  const oneToMany = computeOneToMany(bothLinks);
  assert.equal(oneToMany.length, 1);
  assert.deepEqual([...oneToMany[0].publication_ids].sort(), ['post-1', 'post-1-corrected']);

  // Now walk the chain through window math: due at 7 and 14 days, both answered.
  const chain = buildOutcomeChain({
    clientId: 'risedtc',
    canonicalRows: [adaptCanonicalLinkRow(originalLink)],
    publications: [{ publication_id: 'post-1', published_at: '2026-09-01T00:00:00Z' }],
    observations: [
      { publication_id: 'post-1', captured_at: '2026-09-08T00:00:00Z', metrics: { likes: 12 } },
      { publication_id: 'post-1', captured_at: '2026-09-15T00:00:00Z', metrics: { likes: 30 } },
    ],
    cutoff: '2026-09-20T00:00:00Z',
  });
  const c = chain.chain[0];
  assert.equal(c.state, 'evaluated');
  assert.deepEqual(c.answered_windows, [7, 14]);
  assert.deepEqual(c.missing_windows, []);
});
