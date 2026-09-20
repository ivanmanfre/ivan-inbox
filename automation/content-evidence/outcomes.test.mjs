// Outcomes tests. Synthetic fixtures only: no private corpus text, no reactor identity, no
// client receipt. Modeled directly on the real trace this goal-run performed against
// OUTPUT/parent-checks/own-outcome-trace-risedtc.json's Toby Waller adaptation chain: a
// recommendation (idea) with an EXPLICIT link to its source and only an INFERRED link to what
// was actually published, because no stored key joins the idea row to the metrics row.
import test from 'node:test';
import assert from 'node:assert/strict';

import { joinTestOutcomes } from './outcomes.mjs';

// Bumped past the backfill/7-day fixtures below (2026-09-24) now that cutoff enforcement is real:
// those fixtures test age_matched/backfill logic, not cutoff logic, so they must stay eligible.
// Cutoff-specific behavior gets its own explicit `cutoff` override per test, mirroring the audit's
// exact dates (2026-09-20 cutoff / 2026-10-01 publish / 2026-10-08 capture).
const CUTOFF = '2026-10-01T00:00:00.000Z';

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

test('a null approved_at means no approval recorded in THIS source -- never a claim that it was never approved anywhere', () => {
  const r = run({
    recommendations: [recommendation({ approved_at: null })],
    publications: [publication({ reuse_of: 'idea-1' })],
  });
  assert.equal(r.tests[0].approval_status, 'not_recorded');
  assert.equal(r.tests[0].approved_at, null);
  assert.ok(!('shipped_without_approval' in r.tests[0]), 'the old overclaiming key must not survive');
});

test('an approved recommendation that published on schedule records approval_status: recorded', () => {
  const r = run({
    recommendations: [recommendation({ approved_at: '2026-09-06T00:00:00Z' })],
    publications: [publication({ reuse_of: 'idea-1' })],
  });
  assert.equal(r.tests[0].approval_status, 'recorded');
  assert.equal(r.tests[0].approved_at, '2026-09-06T00:00:00.000Z');
});

test('approval_status and link_status are independent fields -- a recorded approval on an INFERRED link is never conflated with a verified join', () => {
  const r = run({
    recommendations: [recommendation({ approved_at: '2026-09-06T00:00:00Z', reuse_of: null })],
    publications: [publication({ reuse_of: null })], // no stored key either side -> inferred match
  });
  assert.equal(r.tests[0].link_status, 'inferred');
  assert.equal(r.tests[0].approval_status, 'recorded');
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

// ---------------------------------------------------------------------------
// Audit counterexamples (out/content-evidence-01-independent-check-2026-09-20/CODE-AUDIT.md,
// code-counterexamples.mjs/.log): P1 findings 1 and 2.
// ---------------------------------------------------------------------------

test('a FOREIGN tenant ideaLinks row is refused exactly like a foreign recommendation/publication/observation, not silently joined', () => {
  // Audit counterexample: clientId ivan, link {client_id:'arch', recommendation_id:'r1', publication_id:'ghost'}.
  assert.throws(() => joinTestOutcomes({
    clientId: 'ivan',
    recommendations: [{ client_id: 'ivan', recommendation_id: 'r1', approved_at: null }],
    ideaLinks: [{ client_id: 'arch', recommendation_id: 'r1', publication_id: 'ghost' }],
    publications: [],
    observations: [],
    cutoff: '2026-09-20',
  }), /tenant/i);
});

test('a SAME-client link to a publication_id that does not exist is kept unresolved, never a fabricated evaluated test with published_at:null', () => {
  const r = joinTestOutcomes({
    clientId: 'ivan',
    recommendations: [{ client_id: 'ivan', recommendation_id: 'r1', approved_at: null }],
    ideaLinks: [{ client_id: 'ivan', recommendation_id: 'r1', publication_id: 'ghost' }],
    publications: [],
    observations: [],
    cutoff: '2026-09-20',
  });
  assert.equal(r.tests.length, 0);
  assert.equal(r.evaluated, 0);
  assert.ok(!r.tests.some((t) => t.publication_id === 'ghost'));
  assert.ok(r.unresolvedLinks.some((u) => u.recommendation_id === 'r1' && /publication/i.test(u.reason)));
});

test('the exact audit FUTURE_OUTCOME counterexample: cutoff 2026-09-20, publication 2026-10-01, capture 2026-10-08 -- never evaluated', () => {
  // Audit counterexample verbatim: an explicit reuse_of link (no dangling/tenant issue here), only
  // the cutoff freeze was broken (old code reported evaluated:1, age_matched:true, capture_age_days:7).
  const r = joinTestOutcomes({
    clientId: 'ivan',
    recommendations: [{ client_id: 'ivan', recommendation_id: 'r1', approved_at: null }],
    ideaLinks: [],
    publications: [{ client_id: 'ivan', publication_id: 'p1', reuse_of: 'r1', published_at: '2026-10-01' }],
    observations: [{ client_id: 'ivan', publication_id: 'p1', captured_at: '2026-10-08', metrics: { impressions: 100 } }],
    cutoff: '2026-09-20',
  });
  assert.equal(r.evaluated, 0);
  assert.equal(r.tests.length, 1);
  assert.equal(r.tests[0].state, 'awaiting_publication');
  assert.equal(r.tests[0].observations[0].eligible, false);
  assert.equal(r.tests[0].observations[0].age_matched, false, 'future data is never labelled age_matched');
  assert.ok(r.tests[0].excluded.length > 0);
});

test('a future CAPTURE of an otherwise eligible PAST publication is excluded, and the publication stays measuring (not evaluated)', () => {
  const r = run({
    cutoff: '2026-09-20T00:00:00Z',
    recommendations: [recommendation({ recommendation_id: 'idea-1' })],
    publications: [publication({ reuse_of: 'idea-1', published_at: '2026-09-01T00:00:00Z' })], // past, eligible publication
    observations: [observation({ captured_at: '2026-10-08T00:00:00Z' })], // future capture
  });
  assert.equal(r.evaluated, 0);
  assert.equal(r.tests[0].state, 'measuring');
  assert.equal(r.tests[0].observations[0].eligible, false);
  assert.ok(r.tests[0].excluded.some((e) => e.reason === 'observation_after_cutoff'));
});

test('an invalid/missing publication date never counts as valid publication evidence', () => {
  const r = run({
    cutoff: '2026-09-20T00:00:00Z',
    recommendations: [recommendation({ recommendation_id: 'idea-1' })],
    publications: [publication({ reuse_of: 'idea-1', published_at: 'not-a-real-date' })],
    observations: [observation({ captured_at: '2026-09-10T00:00:00Z' })],
  });
  assert.equal(r.evaluated, 0);
  assert.equal(r.tests[0].state, 'awaiting_publication');
});

test('an observation captured before its own publication is excluded, never treated as a valid outcome', () => {
  const r = run({
    cutoff: '2026-09-20T00:00:00Z',
    recommendations: [recommendation({ recommendation_id: 'idea-1' })],
    publications: [publication({ reuse_of: 'idea-1', published_at: '2026-09-10T00:00:00Z' })],
    observations: [observation({ captured_at: '2026-09-05T00:00:00Z' })], // before publish
  });
  assert.equal(r.evaluated, 0);
  assert.equal(r.tests[0].state, 'measuring');
  assert.ok(r.tests[0].excluded.some((e) => e.reason === 'captured_before_publication'));
});

test('a valid past publication with at least one eligible observation is, and only then is, evaluated', () => {
  const r = run({
    cutoff: '2026-09-20T00:00:00Z',
    recommendations: [recommendation({ recommendation_id: 'idea-1' })],
    publications: [publication({ reuse_of: 'idea-1', published_at: '2026-09-01T00:00:00Z' })],
    observations: [observation({ captured_at: '2026-09-08T00:00:00Z' })], // 7 days, eligible
  });
  assert.equal(r.evaluated, 1);
  assert.equal(r.tests[0].state, 'evaluated');
  assert.equal(r.tests[0].observations[0].eligible, true);
});

test('a source_ref inference requires one unambiguous publication within the documented one-hour target-time window', () => {
  const r = run({
    recommendations: [recommendation({ source_ref: 'same-source', target_publish_at: '2026-09-19T12:00:00Z' })],
    publications: [publication({ source_ref: 'same-source', published_at: '2026-01-01T00:00:00Z', reuse_of: null })],
    observations: [observation({ captured_at: '2026-01-08T00:00:00Z' })],
  });
  assert.equal(r.evaluated, 0);
  assert.equal(r.tests.length, 0);
  assert.ok(r.due.some((x) => x.recommendation_id === 'idea-1'));
});

test('ambiguous source_ref candidates stay unevaluated instead of selecting the first publication', () => {
  const r = run({
    recommendations: [recommendation({ source_ref: 'same-source', target_publish_at: '2026-09-17T14:00:00Z' })],
    publications: [
      publication({ publication_id: 'pub-1', source_ref: 'same-source', reuse_of: null, published_at: '2026-09-17T14:00:00Z' }),
      publication({ publication_id: 'pub-2', source_ref: 'same-source', reuse_of: null, published_at: '2026-09-17T14:20:00Z' }),
    ],
  });
  assert.equal(r.evaluated, 0);
  assert.equal(r.tests.length, 0);
  assert.ok(r.due.some((x) => x.recommendation_id === 'idea-1'));
});
