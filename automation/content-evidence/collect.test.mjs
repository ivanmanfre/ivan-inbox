// Collection planner/executor tests. Synthetic fixtures only. No network, no real provider --
// every test here uses a fake/spy adapter injected as `provider`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { planCollection, runCollection, CollectError } from './collect.mjs';

// A scratch OUT root, isolated per test file run, so writes never touch anything outside a
// throwaway directory and never collide with the real staged OUT tree.
function makeOutRoot() {
  return mkdtempSync(path.join(tmpdir(), 'content-evidence-collect-test-'));
}

function makeSpy(impl) {
  const calls = [];
  const fetchPage = async (args) => {
    calls.push(args);
    const result = await impl(args);
    if (!result || typeof result !== 'object') return result;
    return {
      ...result,
      clientId: result.clientId ?? args.clientId,
      items: Array.isArray(result.items)
        ? result.items.map((item) => ({ ...item, client_id: item.client_id ?? args.clientId }))
        : result.items,
    };
  };
  return { fetchPage, calls, enforcesMaxChargeUsd: true };
}

const RATE_CARD = { author_page: 0.02 };

// ---------------------------------------------------------------------------
// planCollection: missing rate refuses before any call
// ---------------------------------------------------------------------------
test('planCollection refuses a gap with no rate card entry, before any provider exists', () => {
  assert.throws(
    () => planCollection({
      clientId: 'ivan',
      gaps: [{ authorId: 'alice', unit: 'video_minute', missingPages: 2 }],
      rateCard: RATE_CARD, // has no 'video_minute' entry
    }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_MISSING_RATE',
  );
});

test('planCollection produces a page-by-page quote with a total estimated cost', () => {
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [
      { authorId: 'alice', unit: 'author_page', missingPages: 2 },
      { authorId: 'bob', unit: 'author_page', missingPages: 1 },
    ],
    rateCard: RATE_CARD,
  });
  assert.equal(plan.pages.length, 3);
  assert.equal(plan.totalEstimatedCostUsd, 0.06);
});

// ---------------------------------------------------------------------------
// Default zero spend stops before any provider adapter call
// ---------------------------------------------------------------------------
test('default budget (no explicit budget) stops before any provider call', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }],
    rateCard: RATE_CARD,
  });
  const spy = makeSpy(() => { throw new Error('provider must never be called at zero budget'); });

  const { state, providerCalls, stopped } = await runCollection({
    clientId: 'ivan', plan, stateDir: outRoot, outRoot, provider: spy,
  });

  assert.equal(spy.calls.length, 0, 'the spy adapter must never be invoked');
  assert.equal(providerCalls, 0);
  assert.equal(stopped, 'budget_exhausted');
  assert.equal(state.status, 'budget_exhausted');
});

test('an explicit zero budget also stops before any provider call', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }],
    rateCard: RATE_CARD,
  });
  const spy = makeSpy(() => { throw new Error('must not be called'); });
  const { providerCalls } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 0 }, stateDir: outRoot, outRoot, provider: spy,
  });
  assert.equal(providerCalls, 0);
  assert.equal(spy.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Per-page budget check: stop before buying an unaffordable next page
// ---------------------------------------------------------------------------
test('budget exhaustion stops mid-run, before the unaffordable page is bought', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 3 }], // 3 pages @ 0.02 = 0.06
    rateCard: RATE_CARD,
  });
  const spy = makeSpy(({ pageIndex }) => ({
    items: [{ canonical_source_id: `alice-${pageIndex}` }],
    costUsd: 0.02, nextCursor: `cursor-${pageIndex + 1}`, done: pageIndex === 2,
  }));

  const { state, providerCalls, stopped } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 0.045 }, stateDir: outRoot, outRoot, provider: spy,
  });

  // Only pages 0 and 1 are affordable (0.02 + 0.02 = 0.04 <= 0.045); page 2 would bring total to
  // 0.06 > 0.045, so it must be refused before any call for it is made.
  assert.equal(spy.calls.length, 2);
  assert.equal(providerCalls, 2);
  assert.equal(stopped, 'budget_exhausted');
  assert.equal(state.status, 'budget_exhausted');
  assert.ok(Math.abs(state.actualSpendUsd - 0.04) < 1e-9);
  assert.equal(state.completedPageKeys.length, 2);
});

// ---------------------------------------------------------------------------
// Canonical-ID idempotency
// ---------------------------------------------------------------------------
test('duplicate canonical ids across pages are never double-counted or double-written', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 2 }],
    rateCard: RATE_CARD,
  });
  const spy = makeSpy(({ pageIndex }) => ({
    // Both pages report the SAME canonical id (e.g. a provider that re-lists overlapping windows).
    items: [{ canonical_source_id: 'alice-post-1', seenOnPage: pageIndex }],
    costUsd: 0.02, nextCursor: `cursor-${pageIndex + 1}`, done: pageIndex === 1,
  }));

  const { state } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy,
  });

  assert.equal(Object.keys(state.items).length, 1);
  assert.equal(state.items['alice-post-1'].seenOnPage, 0, 'the FIRST write wins; a later duplicate never overwrites it');
});

// ---------------------------------------------------------------------------
// Safe resume: never re-request a completed paid page
// ---------------------------------------------------------------------------
test('a resumed run never re-fetches a page already marked complete', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 2 }],
    rateCard: RATE_CARD,
  });
  const firstSpy = makeSpy(({ pageIndex }) => ({
    items: [{ canonical_source_id: `alice-${pageIndex}` }],
    costUsd: 0.02, nextCursor: `cursor-${pageIndex + 1}`, done: pageIndex === 1,
  }));
  const first = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: firstSpy,
  });
  assert.equal(firstSpy.calls.length, 2);
  assert.equal(first.state.status, 'completed');

  const secondSpy = makeSpy(() => { throw new Error('must never be called: both pages are already complete'); });
  const second = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: secondSpy,
  });
  assert.equal(secondSpy.calls.length, 0);
  assert.equal(second.providerCalls, 0);
  assert.equal(second.state.status, 'completed');
  assert.equal(Object.keys(second.state.items).length, 2);
});

test('partial resume: pages already completed are skipped, only the remaining page is fetched', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 2 }],
    rateCard: RATE_CARD,
  });

  // Pre-seed state as if page 0 already completed in an earlier process.
  writeFileSync(path.join(outRoot, 'ivan.collect-state.json'), JSON.stringify({
    stateVersion: 2, clientId: 'ivan', status: 'idle',
    cursorByUnit: { 'alice:author_page': 'cursor-1' },
    completedUnits: [],
    completedPageKeys: ['alice:author_page:0'],
    cacheByFingerprint: {},
    items: { 'alice-0': { canonical_source_id: 'alice-0' } },
    actualSpendUsd: 0,
    failures: [], costUnreported: [], requestLedger: [],
    updatedAt: '2026-09-19T00:00:00.000Z',
  }, null, 2), 'utf8');

  const spy = makeSpy(({ authorId, pageIndex, cursor }) => {
    assert.equal(pageIndex, 1, 'only the remaining page should ever be requested');
    assert.equal(cursor, 'cursor-1', 'the resumed cursor must be honoured');
    return { items: [{ canonical_source_id: 'alice-1' }], costUsd: 0.02, nextCursor: null, done: true };
  });

  const { state, providerCalls } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy,
  });
  assert.equal(providerCalls, 1);
  assert.equal(spy.calls.length, 1);
  assert.equal(Object.keys(state.items).length, 2);
  assert.ok(state.completedUnits.includes('alice:author_page'));
});

// ---------------------------------------------------------------------------
// Source-hash cache: same request fingerprint + cursor already stored -> served from cache
// ---------------------------------------------------------------------------
test('a page with an already-cached fingerprint is served from cache without a provider call', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }],
    rateCard: RATE_CARD,
  });

  // First run populates the real fingerprint under cacheByFingerprint via the real algorithm.
  const firstSpy = makeSpy(() => ({ items: [{ canonical_source_id: 'alice-0' }], costUsd: 0.02, nextCursor: null, done: true }));
  const first = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: firstSpy });
  assert.equal(firstSpy.calls.length, 1);

  // Simulate a state file that lost its page-level completion bookkeeping but KEPT the fingerprint
  // cache (e.g. a caller re-planned the same page under fresh bookkeeping). The cache alone must
  // still prevent a second call.
  const resetState = { ...first.state, completedPageKeys: [], completedUnits: [] };
  writeFileSync(path.join(outRoot, 'ivan.collect-state.json'), JSON.stringify(resetState, null, 2), 'utf8');

  const secondSpy = makeSpy(() => { throw new Error('must never be called: fingerprint cache hit'); });
  const second = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: secondSpy });
  assert.equal(secondSpy.calls.length, 0);
  assert.equal(second.providerCalls, 0);
  assert.ok(second.state.completedPageKeys.includes('alice:author_page:0'));
});

// ---------------------------------------------------------------------------
// A failed author never restarts or aborts the whole paid run
// ---------------------------------------------------------------------------
test('a thrown request requires reconciliation and does not dispatch another potentially paid request', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [
      { authorId: 'alice', unit: 'author_page', missingPages: 1 },
      { authorId: 'bob', unit: 'author_page', missingPages: 1 },
    ],
    rateCard: RATE_CARD,
  });
  const spy = makeSpy(({ authorId }) => {
    if (authorId === 'alice') throw new Error('simulated provider failure for alice');
    return { items: [{ canonical_source_id: 'bob-0' }], costUsd: 0.02, nextCursor: null, done: true };
  });

  const { state, providerCalls, providerAttempts } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy,
  });

  // N-2 (Sol review): providerAttempts counts every invocation (both authors are attempted, one
  // failure does not abort the run); providerCalls counts only the ones that returned a result
  // (a purchase) -- alice's failed attempt is not a call for that counter's purpose.
  assert.equal(providerAttempts, 1, 'the uncertain request blocks further paid dispatches');
  assert.equal(providerCalls, 0);
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].authorId, 'alice');
  assert.ok(!state.completedUnits.includes('alice:author_page'));
  assert.ok(!state.completedUnits.includes('bob:author_page'));
  assert.ok(!state.items['bob-0']);
  assert.equal(state.status, 'reconciliation_required');
});

// ---------------------------------------------------------------------------
// State path must resolve inside OUT
// ---------------------------------------------------------------------------
test('a stateDir outside outRoot is refused before any file is written, and before any call', async () => {
  const outRoot = makeOutRoot();
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'content-evidence-outside-'));
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }],
    rateCard: RATE_CARD,
  });
  const spy = makeSpy(() => { throw new Error('must never be called'); });

  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outsideDir, outRoot, provider: spy }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_STATE_OUTSIDE_OUT',
  );
  assert.equal(spy.calls.length, 0);
  assert.ok(!existsSync(path.join(outsideDir, 'ivan.collect-state.json')));
});

test('path traversal out of outRoot via stateDir is refused', async () => {
  const outRoot = makeOutRoot();
  const traversal = path.join(outRoot, '..', 'escaped');
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }],
    rateCard: RATE_CARD,
  });
  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, stateDir: traversal, outRoot }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_STATE_OUTSIDE_OUT',
  );
});

// ---------------------------------------------------------------------------
// State is written atomically and is always valid JSON
// ---------------------------------------------------------------------------
test('the persisted state file is valid, parseable JSON after a run', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }],
    rateCard: RATE_CARD,
  });
  const spy = makeSpy(() => ({ items: [{ canonical_source_id: 'alice-0' }], costUsd: 0.02, nextCursor: null, done: true }));
  await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy });
  const statePath = path.join(outRoot, 'ivan.collect-state.json');
  assert.ok(existsSync(statePath));
  const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(parsed.clientId, 'ivan');
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------
test('runCollection refuses a plan for a different client', async () => {
  const outRoot = makeOutRoot();
  const plan = planCollection({ clientId: 'ivan', gaps: [], rateCard: RATE_CARD });
  await assert.rejects(
    runCollection({ clientId: 'arch', plan, stateDir: outRoot, outRoot }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_TENANT_MISMATCH',
  );
});

test('an unregistered client is refused', () => {
  assert.throws(
    () => planCollection({ clientId: 'not-a-real-client', gaps: [], rateCard: RATE_CARD }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_UNKNOWN_CLIENT',
  );
});

// ---------------------------------------------------------------------------
// MF-1 (Sol review): symlink escape. A lexical path.resolve containment check accepts a symlink
// that lives inside outRoot but points outside it. The fix must realpath the longest EXISTING
// prefix of both the target and outRoot before comparing, and separately refuse when the exact
// final path component is itself an existing symlink.
// ---------------------------------------------------------------------------

test('MF-1(a): a directory symlink inside outRoot pointing outside is refused as stateDir, nothing written anywhere', async () => {
  const outRoot = makeOutRoot();
  const outsideTarget = mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-outside-'));
  const linkPath = path.join(outRoot, 'escape-link');
  symlinkSync(outsideTarget, linkPath, 'dir'); // a symlink INSIDE outRoot pointing OUTSIDE it

  const plan = planCollection({ clientId: 'ivan', gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }], rateCard: RATE_CARD });
  const spy = makeSpy(() => { throw new Error('must never be called: the escape must be refused before any call'); });

  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: linkPath, outRoot, provider: spy }),
    (err) => err instanceof CollectError && /OUTSIDE_OUT|SYMLINK/.test(err.code),
  );
  assert.equal(spy.calls.length, 0);
  // Nothing landed in the real external directory the symlink points to...
  assert.deepEqual(readdirSync(outsideTarget), []);
  // ...and nothing was written inside outRoot either (not even through the link).
  assert.deepEqual(readdirSync(linkPath), []);
});

test('MF-1: the exact state file path already existing as a symlink is refused, even with a plain stateDir', async () => {
  const outRoot = makeOutRoot();
  const victim = path.join(mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-victim-')), 'victim.json');
  writeFileSync(victim, JSON.stringify({ untouched: true }), 'utf8');
  symlinkSync(victim, path.join(outRoot, 'ivan.collect-state.json'), 'file'); // exact leaf is a symlink

  const plan = planCollection({ clientId: 'ivan', gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }], rateCard: RATE_CARD });
  const spy = makeSpy(() => { throw new Error('must never be called'); });

  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy }),
    (err) => err instanceof CollectError && /SYMLINK/.test(err.code),
  );
  assert.equal(spy.calls.length, 0);
  assert.equal(JSON.parse(readFileSync(victim, 'utf8')).untouched, true, 'the victim file must be untouched');
});

test('MF-1(c): an outRoot itself reached through a symlink still works (macOS /tmp -> /private/tmp shape)', async () => {
  const realOutRoot = mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-real-'));
  const linkRoot = path.join(mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-linkparent-')), 'out-root-link');
  symlinkSync(realOutRoot, linkRoot, 'dir'); // linkRoot is a symlink TO realOutRoot, not inside it

  const plan = planCollection({ clientId: 'ivan', gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 1 }], rateCard: RATE_CARD });
  const spy = makeSpy(() => ({ items: [{ canonical_source_id: 'alice-0' }], costUsd: 0.02, nextCursor: null, done: true }));

  const { state, providerCalls } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: linkRoot, outRoot: linkRoot, provider: spy,
  });
  assert.equal(providerCalls, 1);
  assert.equal(state.status, 'completed');
  // The state file must actually exist at the REAL location (realpath-equivalent to linkRoot).
  assert.ok(existsSync(path.join(realOutRoot, 'ivan.collect-state.json')));
});

// ---------------------------------------------------------------------------
// Astra final audit, finding 1: the spend cap is not enforced when cost is unreported.
// "missing-becomes-zero" in the spend ledger -- an absent/NaN/string/negative costUsd must never
// silently add 0 (or a negative number) to actualSpendUsd, and a corrupted stored spend must never
// be trusted. One test per audit table row, plus state-corruption / malformed-counter cases and
// budget-value validation.
// ---------------------------------------------------------------------------

function fourPageCostPlan(costPerPage = 1) {
  return planCollection({
    clientId: 'ivan',
    gaps: [{ authorId: 'alice', unit: 'author_page', missingPages: 4 }],
    rateCard: { author_page: costPerPage },
  });
}

test('audit row 1 (control): cap 2.50, 4 pages @ 1.00, cost reported correctly -> 2 calls, budget_exhausted', async () => {
  const outRoot = makeOutRoot();
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => ({ items: [], costUsd: 1, nextCursor: null, done: false }));
  const { providerCalls, stopped, state } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 2.5 }, stateDir: outRoot, outRoot, provider: spy,
  });
  assert.equal(providerCalls, 2);
  assert.equal(stopped, 'budget_exhausted');
  assert.equal(state.actualSpendUsd, 2);
});

test('audit row 2: provider omits costUsd -> fails closed, charges the estimate, stops, page never re-bought', async () => {
  const outRoot = makeOutRoot();
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => ({ items: [{ canonical_source_id: 'alice-x' }], nextCursor: 'c1', done: false })); // no costUsd at all
  const { providerCalls, stopped, state } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 2.5 }, stateDir: outRoot, outRoot, provider: spy,
  });
  assert.equal(providerCalls, 1, 'must stop after the first unreported-cost page, not spend blindly through all 4');
  assert.equal(stopped, 'reconciliation_required');
  assert.equal(state.status, 'reconciliation_required');
  assert.equal(state.actualSpendUsd, 0, 'unknown charges are not guessed into actual spend');
  assert.equal(state.costUnreported.length, 1);
  assert.equal(state.costUnreported[0].maxChargeUsd, 1);
  assert.equal(state.completedPageKeys.length, 0, 'an uncertain response cannot complete a page');
  assert.ok(!state.items['alice-x']);

  // Resume: only the EXACT purchased-with-unknown-cost page (pageIndex 0) must never be
  // re-requested; pages 1-3 were never bought and remain legitimately fetchable once resumed.
  const resumeSpy = makeSpy(({ pageIndex }) => {
    if (pageIndex === 0) throw new Error('must never be called: page 0 already purchased-with-unknown-cost');
    return { items: [], costUsd: 1, nextCursor: null, done: pageIndex === 3 };
  });
  const resume = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 2.5 }, stateDir: outRoot, outRoot, provider: resumeSpy });
  assert.ok(!resumeSpy.calls.some((c) => c.pageIndex === 0), 'page 0 must never be re-bought');
  assert.equal(resume.stopped, 'reconciliation_required');
  assert.equal(resumeSpy.calls.length, 0);
});

test('audit row 3a: costUsd is NaN -> fails closed the same way as a missing cost', async () => {
  const outRoot = makeOutRoot();
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => ({ items: [], costUsd: NaN, nextCursor: null, done: false }));
  const { providerCalls, stopped, state } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 2.5 }, stateDir: outRoot, outRoot, provider: spy,
  });
  assert.equal(providerCalls, 1);
  assert.equal(stopped, 'reconciliation_required');
  assert.equal(state.actualSpendUsd, 0);
});

test('audit row 3b: costUsd is a string ("1") -> fails closed the same way as a missing cost', async () => {
  const outRoot = makeOutRoot();
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => ({ items: [], costUsd: '1', nextCursor: null, done: false }));
  const { providerCalls, stopped, state } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 2.5 }, stateDir: outRoot, outRoot, provider: spy,
  });
  assert.equal(providerCalls, 1);
  assert.equal(stopped, 'reconciliation_required');
  assert.equal(state.actualSpendUsd, 0, 'a string costUsd is not trusted');
});

test('audit row 4: DEFAULT zero budget with a stored spend of "abc" -> COLLECT_STATE_CORRUPT, 0 calls', async () => {
  const outRoot = makeOutRoot();
  writeFileSync(path.join(outRoot, 'ivan.collect-state.json'), JSON.stringify({
    clientId: 'ivan', status: 'idle', cursorByAuthor: {}, completedAuthors: [], completedPageKeys: [],
    cacheByFingerprint: {}, items: {}, actualSpendUsd: 'abc', failures: [], updatedAt: null,
  }), 'utf8');
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => { throw new Error('must never be called'); });
  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, stateDir: outRoot, outRoot, provider: spy }), // default budget
    (err) => err instanceof CollectError && err.code === 'COLLECT_STATE_CORRUPT',
  );
  assert.equal(spy.calls.length, 0);
});

test('audit row 5: DEFAULT zero budget with a stored spend of -10 -> COLLECT_STATE_CORRUPT, 0 calls', async () => {
  const outRoot = makeOutRoot();
  writeFileSync(path.join(outRoot, 'ivan.collect-state.json'), JSON.stringify({
    clientId: 'ivan', status: 'idle', cursorByAuthor: {}, completedAuthors: [], completedPageKeys: [],
    cacheByFingerprint: {}, items: {}, actualSpendUsd: -10, failures: [], updatedAt: null,
  }), 'utf8');
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => { throw new Error('must never be called'); });
  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, stateDir: outRoot, outRoot, provider: spy }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_STATE_CORRUPT',
  );
  assert.equal(spy.calls.length, 0);
});

test('audit row 6: cap 1.00, provider reports cost -5 -> refused; charges the estimate, never a negative stored spend', async () => {
  const outRoot = makeOutRoot();
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => ({ items: [], costUsd: -5, nextCursor: null, done: false }));
  const { providerCalls, stopped, state } = await runCollection({
    clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy,
  });
  assert.equal(providerCalls, 1, 'must stop after the first bad-cost page, not spend through all 4');
  assert.equal(stopped, 'reconciliation_required');
  assert.equal(state.actualSpendUsd, 0, 'unknown cost is never guessed into actual spend');
  assert.ok(state.actualSpendUsd >= 0, 'stored spend must never go negative');

  // A fresh default-budget run afterward must still make 0 calls -- the corrupted-ledger-then-leak
  // shape the audit demonstrated (negative spend -> next default run still calls the provider).
  const nextSpy = makeSpy(() => { throw new Error('must never be called: default budget is exhausted/zero'); });
  const next = await runCollection({ clientId: 'ivan', plan, stateDir: outRoot, outRoot, provider: nextSpy });
  assert.equal(nextSpy.calls.length, 0);
  assert.equal(next.stopped, 'reconciliation_required');
});

test('a malformed stored counter (completedPageKeys as a string) is rejected as COLLECT_STATE_CORRUPT, 0 calls', async () => {
  const outRoot = makeOutRoot();
  writeFileSync(path.join(outRoot, 'ivan.collect-state.json'), JSON.stringify({
    clientId: 'ivan', status: 'idle', cursorByAuthor: {}, completedAuthors: [], completedPageKeys: 'not-an-array',
    cacheByFingerprint: {}, items: {}, actualSpendUsd: 0, failures: [], updatedAt: null,
  }), 'utf8');
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => { throw new Error('must never be called'); });
  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 10 }, stateDir: outRoot, outRoot, provider: spy }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_STATE_CORRUPT',
  );
  assert.equal(spy.calls.length, 0);
});

test('budget.approvedUsd negative is refused before any file is touched or any call made', async () => {
  const outRoot = makeOutRoot();
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => { throw new Error('must never be called'); });
  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: -1 }, stateDir: outRoot, outRoot, provider: spy }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_BAD_BUDGET',
  );
  assert.equal(spy.calls.length, 0);
  assert.ok(!existsSync(path.join(outRoot, 'ivan.collect-state.json')));
});

test('budget.approvedUsd = NaN is refused before any file is touched or any call made', async () => {
  const outRoot = makeOutRoot();
  const plan = fourPageCostPlan(1);
  const spy = makeSpy(() => { throw new Error('must never be called'); });
  await assert.rejects(
    runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: NaN }, stateDir: outRoot, outRoot, provider: spy }),
    (err) => err instanceof CollectError && err.code === 'COLLECT_BAD_BUDGET',
  );
  assert.equal(spy.calls.length, 0);
  assert.ok(!existsSync(path.join(outRoot, 'ivan.collect-state.json')));
});

test('an unproven provider cap is refused before dispatch', async () => {
  const outRoot = makeOutRoot(); const plan = fourPageCostPlan(1); let calls = 0;
  await assert.rejects(runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot,
    provider: { fetchPage: async () => { calls += 1; return {}; } } }), (err) => err.code === 'COLLECT_UNENFORCEABLE_CHARGE_CAP');
  assert.equal(calls, 0);
});

test('a thrown request is durably reserved and never automatically retried', async () => {
  const outRoot = makeOutRoot(); const plan = fourPageCostPlan(1); const first = makeSpy(() => { throw new Error('timeout'); });
  const result = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: first });
  assert.equal(result.stopped, 'reconciliation_required');
  assert.equal(result.state.requestLedger[0].status, 'reconciliation_required');
  const second = makeSpy(() => ({ items: [], costUsd: 1 }));
  const resumed = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: second });
  assert.equal(resumed.stopped, 'reconciliation_required'); assert.equal(second.calls.length, 0);
});

test('invalid or foreign returned items never complete a page', async () => {
  const outRoot = makeOutRoot(); const plan = fourPageCostPlan(1);
  const provider = { enforcesMaxChargeUsd: true, fetchPage: async () => ({ clientId: 'ivan', items: [{ canonical_source_id: 'x', client_id: 'arch' }], costUsd: 1 }) };
  await assert.rejects(runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider }), (err) => err.code === 'COLLECT_BAD_PROVIDER_RESULT');
  const state = JSON.parse(readFileSync(path.join(outRoot, 'ivan.collect-state.json'), 'utf8'));
  assert.equal(state.completedPageKeys.length, 0); assert.equal(state.requestLedger[0].status, 'reconciliation_required');
});

test('page identity includes the collection unit', async () => {
  const outRoot = makeOutRoot(); const plan = planCollection({ clientId: 'ivan', gaps: [{ authorId: 'a', unit: 'one', missingPages: 1 }, { authorId: 'a', unit: 'two', missingPages: 1 }], rateCard: { one: 1, two: 1 } });
  const spy = makeSpy(({ unit }) => ({ items: [{ canonical_source_id: unit }], costUsd: 1, done: false }));
  const result = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 2 }, stateDir: outRoot, outRoot, provider: spy });
  assert.equal(spy.calls.length, 2); assert.deepEqual(result.state.completedPageKeys.sort(), ['a:one:0', 'a:two:0']);
});

test('done stops only its unit and sibling units resume with separate cursors', async () => {
  const outRoot = makeOutRoot(); const plan = planCollection({ clientId: 'ivan', gaps: [{ authorId: 'a', unit: 'first', missingPages: 2 }, { authorId: 'a', unit: 'second', missingPages: 1 }], rateCard: { first: 1, second: 1 } });
  const spy = makeSpy(({ unit, pageIndex, cursor }) => ({ items: [{ canonical_source_id: `${unit}-${pageIndex}` }], costUsd: 1, done: unit === 'first', nextCursor: `${unit}-cursor` }));
  const result = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 2 }, stateDir: outRoot, outRoot, provider: spy });
  assert.deepEqual(spy.calls.map((x) => [x.unit, x.pageIndex, x.cursor]), [['first', 0, null], ['second', 0, null]]);
  assert.equal(result.state.actualSpendUsd, 2); assert.ok(result.state.completedUnits.includes('a:first'));
});

test('state missing version or ledger is fail-closed before any call', async () => {
  const outRoot = makeOutRoot(); const plan = fourPageCostPlan(1);
  await runCollection({ clientId: 'ivan', plan, stateDir: outRoot, outRoot });
  const stored = JSON.parse(readFileSync(path.join(outRoot, 'ivan.collect-state.json'), 'utf8')); delete stored.requestLedger;
  writeFileSync(path.join(outRoot, 'ivan.collect-state.json'), JSON.stringify(stored)); const spy = makeSpy(() => ({ items: [], costUsd: 1 }));
  await assert.rejects(runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy }), (err) => err.code === 'COLLECT_STATE_CORRUPT'); assert.equal(spy.calls.length, 0);
});

test('known over-cap cost is recorded exactly and blocks resume', async () => {
  const outRoot = makeOutRoot(); const plan = fourPageCostPlan(1); const spy = makeSpy(() => ({ items: [], costUsd: 3 }));
  const result = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 1 }, stateDir: outRoot, outRoot, provider: spy });
  assert.equal(result.state.actualSpendUsd, 3); assert.equal(result.state.requestLedger[0].status, 'breach');
  const next = makeSpy(() => ({ items: [], costUsd: 1 })); const resumed = await runCollection({ clientId: 'ivan', plan, budget: { approvedUsd: 10 }, stateDir: outRoot, outRoot, provider: next });
  assert.equal(resumed.stopped, 'reconciliation_required'); assert.equal(next.calls.length, 0);
});
