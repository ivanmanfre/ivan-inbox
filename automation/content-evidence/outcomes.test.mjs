// Outcomes tests. Synthetic fixtures only: no private corpus text, no reactor identity, no
// client receipt. Modeled directly on the real trace this goal-run performed against
// OUTPUT/parent-checks/own-outcome-trace-risedtc.json's Toby Waller adaptation chain: a
// recommendation (idea) with an EXPLICIT link to its source and only an INFERRED link to what
// was actually published, because no stored key joins the idea row to the metrics row.
import test from 'node:test';
import assert from 'node:assert/strict';

import { joinTestOutcomes } from './outcomes.mjs';

const CUTOFF = '2026-09-19T13:30:03.523Z';

function recommendation(over = {}) {
  return {
    client_id: 'risedtc',
    recommendation_id: 'idea-1',
    source_ref: 'https://www.linkedin.com/posts/source-1',
    approved_at: '2026-09-06T00:00:00Z',
    target_publish_at: '2026-09-17T14:00:00Z',
    created_at: '2026-09-06T00:00:00Z',
    reuse_of: null, // the stored forward-link a publication may carry back to this recommendation
    ...over,
  };
}

function publication(over = {}) {
  return {
    client_id: 'risedtc',
    publication_id: 'pub-1',
    source_ref: 'https://www.linkedin.com/posts/source-1', // what the post's own idea link (if any) points at
    reuse_of: null, // publication's own stored back-reference to a recommendation_id, when present
    published_at: '2026-09-17T14:00:24Z',
    ...over,
  };
}

function observation(over = {}) {
  return {
    client_id: 'risedtc',
    publication_id: 'pub-1',
    captured_at: '2026-09-19T13:30:03.523Z',
    metrics: { impressions: 224, reactions: 0, comments: 1, profile_views: 0 },
    ...over,
  };
}

function run(over = {}) {
  return joinTestOutcomes({
    clientId: 'risedtc',
    recommendations: [recommendation()],
    ideaLinks: [],
    publications: [publication()],
    observations: [observation()],
    cutoff: CUTOFF,
    ...over,
  });
}

test('an explicit stored link (publication.reuse_of matches the recommendation id) resolves as explicit', () => {
  const r = run({
    recommendations: [recommendation({ recommendation_id: 'idea-1' })],
    publications: [publication({ reuse_of: 'idea-1' })],
  });
  assert.equal(r.tests.length, 1);
  assert.equal(r.tests[0].link_status, 'explicit');
  assert.equal(r.tests[0].recommendation_id, 'idea-1');
  assert.equal(r.tests[0].publication_id, 'pub-1');
});

test('no stored key at all -- matching only by target time and source_ref -- resolves as inferred, never as verified', () => {
  // Mirrors the real Toby Waller case: reuse_of empty on both sides, only heuristic evidence.
  const r = run({
    recommendations: [recommendation({ recommendation_id: 'idea-1', reuse_of: null, target_publish_at: '2026-09-17T14:00:00Z' })],
    publications: [publication({ reuse_of: null, published_at: '2026-09-17T14:00:24Z' })],
  });
  assert.equal(r.tests.length, 1);
  assert.equal(r.tests[0].link_status, 'inferred');
  assert.ok(r.tests[0].limitations.some((l) => /inferred|inference/i.test(l)));
});

test('an inferred link is never upgraded to explicit just because the timing matches closely', () => {
  const r = run({
    recommendations: [recommendation({ target_publish_at: '2026-09-17T14:00:00Z' })],
    publications: [publication({ published_at: '2026-09-17T14:00:00.001Z' })], // matches to the millisecond
  });
  assert.equal(r.tests[0].link_status, 'inferred');
});

test('a recommendation shipped without approval is flagged, not silently treated as a clean test', () => {
  const r = run({
    recommendations: [recommendation({ approved_at: null })],
    publications: [publication({ reuse_of: 'idea-1' })],
  });
  assert.equal(r.tests[0].shipped_without_approval, true);
});

test('an approved recommendation that published on schedule is not flagged for approval', () => {
  const r = run({
    recommendations: [recommendation({ approved_at: '2026-09-06T00:00:00Z' })],
    publications: [publication({ reuse_of: 'idea-1' })],
  });
  assert.equal(r.tests[0].shipped_without_approval, false);
});

test('an unpublished approval is never performance: a recommendation with no matching publication yields no test, only a due/unresolved entry', () => {
  const r = run({
    recommendations: [recommendation({ recommendation_id: 'idea-2', source_ref: 'https://x/no-pub', target_publish_at: '2026-09-01T00:00:00Z' })],
    publications: [], // nothing published at all
    observations: [],
  });
  assert.equal(r.tests.length, 0);
  assert.ok(r.due.some((d) => d.recommendation_id === 'idea-2'));
});

test('capture_age_days and age_matched are stamped on every observation, using a 7-day standing window', () => {
  const r = run(); // observed 2 days after publish (2026-09-17 -> 2026-09-19)
  assert.equal(r.tests[0].observations[0].capture_age_days, 2);
  assert.ok(r.tests[0].observations[0].age_matched === false); // not a 7-day standing observation
});

test('a lifetime/backfilled capture is never relabelled a seven-day observation, even at a plausible age', () => {
  const r = run({
    observations: [observation({ captured_at: '2026-09-24T14:00:24Z', is_backfill: true })], // 7 days later, but flagged backfill
  });
  assert.equal(r.tests[0].observations[0].age_matched, false);
  assert.equal(r.tests[0].observations[0].capture_age_days, 7);
});

test('an observation at exactly 7 days, not flagged backfill, is age_matched', () => {
  const r = run({
    observations: [observation({ captured_at: '2026-09-24T14:00:24Z' })],
  });
  assert.equal(r.tests[0].observations[0].age_matched, true);
});

test('market/source lift never appears beside a client post as an achieved result -- outcomes carries no lift field', () => {
  const r = run();
  assert.ok(!('lift' in r.tests[0]));
  assert.ok(!('baseline_value' in r.tests[0]));
});

test('a source with an explicit ideaLinks row is preferred over an inferred match', () => {
  const r = run({
    recommendations: [recommendation({ recommendation_id: 'idea-1' })],
    ideaLinks: [{ client_id: 'risedtc', recommendation_id: 'idea-1', publication_id: 'pub-1', stored: true }],
    publications: [publication({ reuse_of: null })], // publication itself has no back-reference
  });
  assert.equal(r.tests[0].link_status, 'explicit');
});

test('a foreign tenant recommendation is refused, not silently filtered', () => {
  assert.throws(() => run({ recommendations: [recommendation({ client_id: 'arch' })] }), /tenant/i);
});

test('evaluated and due counts are exact and mutually exclusive', () => {
  const r = run({
    recommendations: [
      recommendation({ recommendation_id: 'idea-1' }), // publishes -> evaluated
      recommendation({ recommendation_id: 'idea-2', source_ref: 'https://x/2', target_publish_at: '2026-09-01T00:00:00Z' }), // no publication -> due
    ],
    publications: [publication({ reuse_of: 'idea-1' })],
  });
  assert.equal(r.evaluated, 1);
  assert.equal(r.due.length, 1);
});
