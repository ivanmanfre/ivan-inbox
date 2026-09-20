// content-evidence (staged, Run-3-ready) / collect.mjs
//
// A DISABLED-BY-DEFAULT collection planner and executor. This module never talks to a real
// provider -- it only defines the interface a provider adapter must satisfy (`fetchPage`) and
// accepts one as an injected dependency, so every test here runs against a fake/spy, never a
// network call. Self-contained on purpose (see patterns.mjs's header): no import from any
// repaired/production module.
//
// The budget rule is the whole point of this file, straight from the spec's Collection and
// freshness section: "Default new external spend is zero... Refuse an unaffordable next page
// before buying it... Never restart a paid full harvest on a retry."
//
//   * planCollection() only ever produces a QUOTE. It never calls a provider and never spends
//     anything; a gap whose unit has no rate-card entry makes the whole plan un-quotable and
//     throws before runCollection could ever be reached.
//   * runCollection() defaults to budget.approvedUsd = 0, which is a real, checked stop -- with
//     that default (or any exhausted budget) it returns without EVER calling provider.fetchPage,
//     provably so with a spy adapter (assert its call count is 0).
//   * Every remaining page is priced BEFORE it is bought: if the next page's estimated cost
//     exceeds what remains of the approved budget, the whole run stops there (state:
//     budget_exhausted) rather than skip ahead to a cheaper later page out of order.
//   * State (cursor per author, which pages are done, a fingerprint cache, completed authors,
//     collected items keyed by canonical id, actual spend, failures) is the only thing this module
//     persists, and it is written atomically (write to a temp file, then rename) so a crash mid
//     write never leaves a torn JSON file behind. The directory it writes to is a caller-supplied
//     path that MUST resolve inside the given outRoot -- anything else is a refusal, before the
//     state file is read or written at all.
//   * That containment check is symlink-safe (Sol review MF-1, fixed here): a LEXICAL path.resolve
//     comparison passes a symlink that lives inside outRoot but points somewhere else entirely, so
//     the containment check instead realpaths the longest EXISTING prefix of both the target and
//     outRoot (an ancestor symlink -- e.g. macOS /tmp -> /private/tmp -- is followed transparently
//     and still counts as contained) and separately refuses outright when the exact final state-file
//     path is itself an existing symlink, whichever direction it points, since trusting that link's
//     target would leave a TOCTOU window between the check and the write that follows it.
//   * A page already recorded complete (by its own fingerprint) is never re-requested, even across
//     process restarts; a page whose provider call fails is recorded as a failure and its AUTHOR's
//     remaining pages are skipped for this run (the cursor past that point is unknown), but every
//     OTHER author's planned pages still proceed -- one failed author never restarts or aborts the
//     whole paid run.
//   * providerAttempts counts every provider.fetchPage() call this run made, whether it succeeded
//     or threw; providerCalls counts only the ones that returned a result. Actual spend is read
//     from state.actualSpendUsd (provider-reported cost), never inferred from either counter.
//   * Astra final audit, finding 1 (fixed here): a page whose reported costUsd is not a finite
//     number >= 0 (absent, NaN, a string, or negative) is never silently treated as 0 -- that is
//     the exact "missing-becomes-zero" shape that let 4 pages get bought on a 2.50 cap while the
//     ledger recorded 0 spent, and let a provider-reported -5 write a negative stored spend that
//     then made a LATER default-budget run touch the provider again. Instead: charge the page's
//     ESTIMATED cost from the rate card as a conservative floor (so the cap still binds even
//     without a trustworthy reported cost), record the page complete so it is never re-bought (its
//     returned items are real; only the cost figure was untrustworthy), and STOP the run with
//     `stopped`/`state.status` set to COST_UNREPORTED_STATUS rather than continuing to spend on an
//     unreliable cost signal. Separately, loadState() rejects a corrupted stored ledger outright
//     (COLLECT_STATE_CORRUPT: non-numeric/NaN/negative actualSpendUsd, or any malformed counter/
//     collection field) before the caller's budget check and before any provider call -- trusting a
//     tampered-or-corrupted "0" would be the same defect one level up. budget.approvedUsd itself is
//     validated the same way: an explicit negative or NaN value is refused, never silently defaulted.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const REGISTERED_CLIENTS = Object.freeze(['ivan', 'risedtc', 'arch']);

// The stop/status value used when a page's reported cost cannot be trusted (see the fix note
// above). Exported so a caller/test can compare against the exact same string this module uses,
// rather than a hand-typed copy drifting out of sync.
export const COST_UNREPORTED_STATUS = 'COLLECT_COST_UNREPORTED';

export class CollectError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CollectError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new CollectError(code, message, details); };

// ---------------------------------------------------------------------------
// planCollection: a quote, never a call
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {string} args.clientId
 * @param {object[]} args.gaps      [{ authorId, unit?, missingPages }]
 * @param {object} args.rateCard    { [unit]: costUsdPerPage }
 * @returns {{ clientId: string, pages: object[], totalEstimatedCostUsd: number }}
 */
export function planCollection({ clientId, gaps, rateCard } = {}) {
  requireClientId(clientId, 'planCollection');
  if (!Array.isArray(gaps)) fail('COLLECT_BAD_GAPS', 'gaps must be an array');
  if (!isObject(rateCard)) fail('COLLECT_BAD_RATE_CARD', 'rateCard must be an object of unit -> usd-per-page');

  const missingRates = [];
  const pages = [];
  for (const gap of gaps) {
    if (!isObject(gap) || typeof gap.authorId !== 'string' || gap.authorId.trim() === '') {
      fail('COLLECT_BAD_GAPS', 'every gap needs a non-empty authorId');
    }
    const unit = typeof gap.unit === 'string' && gap.unit.trim() !== '' ? gap.unit : 'author_page';
    const pageCount = Number.isFinite(gap.missingPages) ? Math.max(0, Math.trunc(gap.missingPages)) : 0;
    if (pageCount === 0) continue; // nothing to plan for this author/unit
    const rate = rateCard[unit];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
      missingRates.push({ authorId: gap.authorId, unit });
      continue;
    }
    for (let i = 0; i < pageCount; i += 1) {
      // The unit is part of identity: two collection units for one author can both have page 0.
      pages.push({ authorId: gap.authorId, pageIndex: i, unit, pageKey: `${gap.authorId}:${unit}:${i}`, estimatedCostUsd: rate });
    }
  }

  // A gap this rate card cannot price makes the WHOLE plan un-quotable -- refused before runCollection
  // could ever be reached, so an ungoverned page never slips through with an implicit cost of 0.
  if (missingRates.length > 0) {
    fail('COLLECT_MISSING_RATE',
      `no rate card entry for: ${missingRates.map((m) => `${m.authorId}:${m.unit}`).join(', ')}; cannot quote a cost ceiling`,
      { missingRates });
  }

  const totalEstimatedCostUsd = pages.reduce((sum, p) => sum + p.estimatedCostUsd, 0);
  return Object.freeze({
    clientId,
    pages: Object.freeze(pages.map((p) => Object.freeze(p))),
    totalEstimatedCostUsd,
  });
}

// ---------------------------------------------------------------------------
// runCollection: budget-gated, resumable, idempotent execution against an injected provider
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {string} args.clientId
 * @param {object} args.plan        the object returned by planCollection, for the same clientId
 * @param {{approvedUsd?: number}} [args.budget]   defaults to { approvedUsd: 0 } -- a real stop
 * @param {string} args.stateDir    directory for the persisted state file; MUST resolve inside outRoot
 * @param {string} args.outRoot     the OUT root the state file must resolve inside
 * @param {{fetchPage: Function}} [args.provider]  only required when a page cannot be served from
 *   cache/skip and the budget allows a genuine call. `fetchPage({ clientId, authorId, pageIndex,
 *   cursor }) -> { items, costUsd, nextCursor, done, rateLimited? }` (may return a Promise).
 * @param {() => string} [args.now]
 * @returns {Promise<{ state: object, providerCalls: number, providerAttempts: number, stopped: string|null }>}
 *   `providerCalls` counts fetchPage() invocations that RETURNED a result (a purchase); a page
 *   whose call throws is NOT a call for this counter's purpose. `providerAttempts` counts every
 *   invocation, success or failure. Neither counter is a cost figure -- read `state.actualSpendUsd`
 *   (provider-reported cost, accumulated only on a returned result) for actual spend.
 */
export async function runCollection({ clientId, plan, budget = {}, stateDir, outRoot, provider, now = () => new Date().toISOString() } = {}) {
  requireClientId(clientId, 'runCollection');
  if (!isObject(plan) || !Array.isArray(plan.pages)) {
    fail('COLLECT_BAD_PLAN', 'plan must be the object returned by planCollection');
  }
  if (plan.clientId !== clientId) {
    fail('COLLECT_TENANT_MISMATCH', `plan belongs to ${JSON.stringify(plan.clientId)}, not ${JSON.stringify(clientId)}`);
  }
  if (!isObject(budget)) fail('COLLECT_BAD_BUDGET', 'budget must be an object');
  // approvedUsd is OMITTED -> the documented default of 0 (a real, checked stop). An EXPLICIT
  // value that is not a finite number >= 0 (NaN, a string, negative) is refused outright rather
  // than silently coerced to 0 -- Astra final audit finding 1: a budget value this module cannot
  // trust must never be treated as if it meant "no money", only as a caller error.
  let approvedUsd = 0;
  if (budget.approvedUsd !== undefined) {
    if (typeof budget.approvedUsd !== 'number' || !Number.isFinite(budget.approvedUsd) || budget.approvedUsd < 0) {
      fail('COLLECT_BAD_BUDGET', `budget.approvedUsd must be a finite number >= 0, got ${JSON.stringify(budget.approvedUsd)}`);
    }
    approvedUsd = budget.approvedUsd;
  }

  // Resolved and checked BEFORE any state file is read or written, and before any provider call.
  const statePath = resolveStatePath({ outRoot, stateDir, clientId });
  const state = loadState(statePath, clientId);

  if (state.requestLedger.some((entry) => entry.status === 'reserved' || entry.status === 'reconciliation_required' || entry.status === 'breach')) {
    state.status = 'reconciliation_required';
    state.updatedAt = now();
    saveStateAtomic(statePath, state);
    return { state, providerCalls: 0, providerAttempts: 0, stopped: 'reconciliation_required' };
  }

  let providerCalls = 0; // successful fetchPage() invocations only (a purchase)
  let providerAttempts = 0; // every fetchPage() invocation, success or failure
  let stopped = null;

  const remainingAtStart = approvedUsd - state.actualSpendUsd;
  if (remainingAtStart <= 0) {
    state.status = 'budget_exhausted';
    state.updatedAt = now();
    saveStateAtomic(statePath, state);
    return { state, providerCalls: 0, providerAttempts: 0, stopped: 'budget_exhausted' };
  }

  // A cursor and completion belong to an author+unit, never merely an author.
  const byUnit = new Map();
  for (const page of plan.pages) {
    const unitKey = `${page.authorId}:${page.unit}`;
    if (!byUnit.has(unitKey)) byUnit.set(unitKey, []);
    byUnit.get(unitKey).push(page);
  }

  collectionLoop:
  for (const [unitKey, pages] of byUnit) {
    const { authorId, unit } = pages[0];
    if (state.completedUnits.includes(unitKey)) continue;

    for (const page of pages) {
      const pageKey = page.pageKey ?? `${authorId}:${page.unit ?? 'author_page'}:${page.pageIndex}`;
      if (state.completedPageKeys.includes(pageKey)) continue; // never re-request a completed paid page

      const cursor = state.cursorByUnit[unitKey] ?? null;
      const fp = fingerprint({ clientId, authorId, unit: page.unit, pageIndex: page.pageIndex, cursor });

      let result;
      let costUnreportedThisPage = false;
      if (Object.prototype.hasOwnProperty.call(state.cacheByFingerprint, fp)) {
        // Same request fingerprint + cursor already stored: served from cache, no provider call.
        result = state.cacheByFingerprint[fp];
      } else {
        const remaining = approvedUsd - state.actualSpendUsd;
        // max(estimated, 0): a page cannot be allowed to look "free or profitable" and slip past
        // the check because of a negative or otherwise malformed rate-card estimate.
        const estimated = Number.isFinite(page.estimatedCostUsd) ? Math.max(page.estimatedCostUsd, 0) : Infinity;
        if (estimated > remaining) {
          stopped = 'budget_exhausted';
          break collectionLoop;
        }
        if (!provider || typeof provider.fetchPage !== 'function') {
          fail('COLLECT_MISSING_PROVIDER', 'runCollection needs a provider.fetchPage(...) adapter to fetch an uncached, affordable page');
        }
        // An estimate cannot impose a hard ceiling. The injected adapter must explicitly attest
        // that it enforces maxChargeUsd before dispatch; an untrusted/malicious adapter remains
        // outside this module's ability to control, so it is never represented as enforced.
        if (provider.enforcesMaxChargeUsd !== true) {
          fail('COLLECT_UNENFORCEABLE_CHARGE_CAP', 'provider must explicitly enforce maxChargeUsd before a paid request is dispatched');
        }
        const reservation = { pageKey, fingerprint: fp, authorId, unit: page.unit, pageIndex: page.pageIndex, maxChargeUsd: estimated, status: 'reserved', reservedAt: now() };
        state.requestLedger.push(reservation);
        state.updatedAt = now();
        saveStateAtomic(statePath, state); // durable before the potentially chargeable dispatch
        providerAttempts += 1; // every invocation, whether it succeeds or fails
        try {
          // eslint-disable-next-line no-await-in-loop
          result = await provider.fetchPage({ clientId, authorId, unit: page.unit, pageIndex: page.pageIndex, cursor, requestId: fp, maxChargeUsd: estimated });
        } catch (err) {
          reservation.status = 'reconciliation_required';
          reservation.error = String(err && err.message ? err.message : err);
          reservation.updatedAt = now();
          state.failures.push({ authorId, pageIndex: page.pageIndex, pageKey, message: reservation.error, at: now() });
          state.status = 'reconciliation_required';
          state.updatedAt = now();
          saveStateAtomic(statePath, state);
          return { state, providerCalls, providerAttempts, stopped: 'reconciliation_required' };
        }
        if (!validProviderResult(result, clientId)) {
          reservation.status = 'reconciliation_required';
          reservation.error = 'invalid_provider_result';
          reservation.updatedAt = now();
          state.status = 'reconciliation_required'; state.updatedAt = now(); saveStateAtomic(statePath, state);
          fail('COLLECT_BAD_PROVIDER_RESULT', `provider.fetchPage returned an invalid or foreign result for ${pageKey}`);
        }
        providerCalls += 1; // a purchase: fetchPage returned a result

        const reportedCost = result.costUsd;
        const costIsTrustworthy = typeof reportedCost === 'number' && Number.isFinite(reportedCost) && reportedCost >= 0;
        if (costIsTrustworthy && reportedCost <= estimated) {
          state.actualSpendUsd += reportedCost;
          state.cacheByFingerprint[fp] = result;
          reservation.status = 'settled'; reservation.actualCostUsd = reportedCost; reservation.updatedAt = now();
        } else {
          // Never put a guessed estimate in actual spend. A known over-cap charge is recorded
          // exactly; a missing/invalid charge remains an unresolved exposure.
          if (costIsTrustworthy) {
            state.actualSpendUsd += reportedCost;
            reservation.status = 'breach'; reservation.actualCostUsd = reportedCost;
          } else {
            reservation.status = 'reconciliation_required';
          }
          reservation.updatedAt = now();
          state.costUnreported.push({
            authorId, pageIndex: page.pageIndex,
            reportedCostUsd: reportedCost === undefined ? null : reportedCost,
            maxChargeUsd: estimated, at: now(),
          });
          // Retain neither cache nor completion for a response whose charge cannot be reconciled.
          costUnreportedThisPage = true;
        }
      }

      if (costUnreportedThisPage) {
        state.status = 'reconciliation_required';
        state.updatedAt = now();
        saveStateAtomic(statePath, state);
        return { state, providerCalls, providerAttempts, stopped: 'reconciliation_required' };
      }

      // Canonical-ID idempotency: merge by id, never double-count or double-write. Applies alike
      // to a cache hit, a normally-priced success, and a cost-unreported page (its items are real).
      for (const item of Array.isArray(result.items) ? result.items : []) {
        const id = item && (item.canonical_source_id ?? item.id);
        if (typeof id !== 'string' || id === '') continue;
        if (!Object.prototype.hasOwnProperty.call(state.items, id)) state.items[id] = item;
      }
      state.cursorByUnit[unitKey] = result.nextCursor ?? null;
      state.completedPageKeys.push(pageKey); // recorded purchased -- never re-bought, cost-unreported or not
      state.updatedAt = now();
      saveStateAtomic(statePath, state);

      if (costUnreportedThisPage) {
        state.status = COST_UNREPORTED_STATUS;
        stopped = COST_UNREPORTED_STATUS;
        break collectionLoop;
      }
      if (result.rateLimited === true) {
        stopped = 'rate_limited';
        break collectionLoop;
      }
      if (result.done === true) {
        state.completedUnits.push(unitKey);
        break; // provider says this unit has no later pages; do not buy planned surplus pages
      }
    }
  }

  const allSatisfied = plan.pages.every((p) => state.completedPageKeys.includes(p.pageKey) || state.completedUnits.includes(`${p.authorId}:${p.unit}`));
  state.status = stopped ?? (allSatisfied ? 'completed' : 'incomplete');
  state.updatedAt = now();
  saveStateAtomic(statePath, state);

  return { state, providerCalls, providerAttempts, stopped };
}

// ---------------------------------------------------------------------------
// State: atomic, tenant-checked, resolved strictly inside outRoot (symlink-safe: MF-1 fix)
// ---------------------------------------------------------------------------

function resolveStatePath({ outRoot, stateDir, clientId }) {
  if (typeof outRoot !== 'string' || outRoot.trim() === '') {
    fail('COLLECT_MISSING_OUT_ROOT', 'runCollection requires an explicit outRoot');
  }
  if (typeof stateDir !== 'string' || stateDir.trim() === '') {
    fail('COLLECT_MISSING_STATE_DIR', 'runCollection requires an explicit stateDir');
  }
  const resolvedDir = path.resolve(stateDir);
  const lexicalStatePath = path.join(resolvedDir, `${clientId}.collect-state.json`);

  // Refuse outright if the exact file we are about to read/write already exists as a symlink,
  // whichever direction it points -- trusting it would leave a TOCTOU window between this check
  // and the write that follows. This is independent of, and stricter than, the containment check.
  if (isSymlinkPath(lexicalStatePath)) {
    fail('COLLECT_STATE_PATH_IS_SYMLINK',
      `state path ${lexicalStatePath} already exists as a symlink; refusing to read or write through it`);
  }

  // Symlink-safe containment: realpath the longest EXISTING prefix of both stateDir and outRoot
  // (so an ancestor symlink, e.g. macOS /tmp -> /private/tmp, is followed transparently and still
  // counts as contained) rather than comparing the lexical path.resolve() strings, which a symlink
  // living inside outRoot but pointing elsewhere would pass.
  const realRoot = realpathOfLongestExistingPrefix(outRoot);
  const realTarget = realpathOfLongestExistingPrefix(lexicalStatePath);
  const inside = realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
  if (!inside) {
    fail('COLLECT_STATE_OUTSIDE_OUT',
      `stateDir ${JSON.stringify(resolvedDir)} resolves (via realpath) to ${realTarget}, which is outside outRoot ${JSON.stringify(outRoot)} (real: ${realRoot})`);
  }
  return lexicalStatePath;
}

// ---------------------------------------------------------------------------
// Symlink-safe path helpers (exported so run.mjs's --out containment check reuses the same logic)
// ---------------------------------------------------------------------------

/** True when `p` exists and is itself a symlink (including a broken one); false if it doesn't exist at all. */
export function isSymlinkPath(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Resolves the REAL path of the longest prefix of `p` that actually exists on disk (via lstat, so
 * a symlink counts as "existing" even if what it points to does not), then rejoins any remaining,
 * not-yet-created path segments lexically. This means:
 *   - an ancestor symlink anywhere in an EXISTING prefix (e.g. macOS /tmp -> /private/tmp) is
 *     followed and its target is what gets compared for containment;
 *   - a symlinked directory inside outRoot that points outside it resolves to that OUTSIDE real
 *     location, so a containment check against it correctly fails;
 *   - a path whose final component does not exist yet (the normal case for a file this module is
 *     about to create) still resolves correctly, because only the EXISTING prefix is realpath'd.
 */
export function realpathOfLongestExistingPrefix(p) {
  let current = path.resolve(p);
  const suffix = [];
  while (!existsAsLstat(current)) {
    const parent = path.dirname(current);
    if (parent === current) break; // reached the filesystem root without finding anything existing
    suffix.unshift(path.basename(current));
    current = parent;
  }
  const real = realpathSync(current);
  return suffix.length > 0 ? path.join(real, ...suffix) : real;
}

function existsAsLstat(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function loadState(statePath, clientId) {
  if (!existsSync(statePath)) return freshState(clientId);
  const raw = readFileSync(statePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail('COLLECT_STATE_CORRUPT', `state file ${statePath} is not valid JSON: ${err.message}`);
  }
  if (!isObject(parsed)) {
    fail('COLLECT_STATE_CORRUPT', `state file ${statePath} must contain a JSON object`);
  }
  if (parsed.clientId !== clientId) {
    fail('COLLECT_STATE_TENANT_MISMATCH', `state file ${statePath} belongs to ${JSON.stringify(parsed.clientId)}, not ${JSON.stringify(clientId)}`);
  }
  validateStoredState(statePath, parsed);
  return {
    ...freshState(clientId),
    ...parsed,
  };
}

/**
 * Astra final audit, finding 1: a corrupted stored ledger is refused OUTRIGHT here, before the
 * caller's budget check and before any provider call -- a non-numeric/NaN/negative stored spend
 * (or any malformed counter/collection field) is exactly the missing-becomes-zero defect one level
 * up in the ledger, and trusting it (e.g. treating "abc" as if it meant 0 already spent) would
 * silently reopen the budget the corrupted value was supposed to be tracking.
 */
function validateStoredState(statePath, parsed) {
  const required = ['stateVersion', 'clientId', 'status', 'cursorByUnit', 'completedUnits', 'completedPageKeys', 'cacheByFingerprint', 'items', 'actualSpendUsd', 'failures', 'costUnreported', 'requestLedger', 'updatedAt'];
  for (const field of required) if (!(field in parsed)) fail('COLLECT_STATE_CORRUPT', `state file ${statePath} is missing required ${field}`);
  if (parsed.stateVersion !== 2) fail('COLLECT_STATE_CORRUPT', `state file ${statePath} has unsupported stateVersion`);
  if (!('actualSpendUsd' in parsed)) {
    fail('COLLECT_STATE_CORRUPT', `state file ${statePath} is missing actualSpendUsd; spend cannot be reconstructed safely`);
  }
  {
    const v = parsed.actualSpendUsd;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      fail('COLLECT_STATE_CORRUPT',
        `state file ${statePath} has a corrupt actualSpendUsd (${JSON.stringify(v)}); expected a finite number >= 0`);
    }
  }
  for (const field of ['completedUnits', 'completedPageKeys', 'failures', 'costUnreported', 'requestLedger']) {
    if (!Array.isArray(parsed[field])) {
      fail('COLLECT_STATE_CORRUPT', `state file ${statePath} has a corrupt ${field} (expected an array)`);
    }
  }
  for (const field of ['cursorByUnit', 'cacheByFingerprint', 'items']) {
    if (!isObject(parsed[field])) {
    fail('COLLECT_STATE_CORRUPT', `state file ${statePath} has a corrupt ${field} (expected an object)`);
    }
  }
  const knownStatuses = new Set(['settled', 'reserved', 'reconciliation_required', 'breach']);
  let settledSpend = 0;
  for (const entry of parsed.requestLedger) {
    if (!isObject(entry) || typeof entry.pageKey !== 'string' || typeof entry.fingerprint !== 'string' || typeof entry.authorId !== 'string' || typeof entry.unit !== 'string' || !Number.isInteger(entry.pageIndex) || !isFiniteNonnegative(entry.maxChargeUsd) || !knownStatuses.has(entry.status)) {
      fail('COLLECT_STATE_CORRUPT', `state file ${statePath} has malformed request ledger entry`);
    }
    if ((entry.status === 'settled' || entry.status === 'breach')) {
      if (!isFiniteNonnegative(entry.actualCostUsd)) fail('COLLECT_STATE_CORRUPT', `state file ${statePath} has a settled ledger entry without actualCostUsd`);
      settledSpend += entry.actualCostUsd;
    } else if ('actualCostUsd' in entry) fail('COLLECT_STATE_CORRUPT', `state file ${statePath} has unresolved ledger entry with actualCostUsd`);
  }
  if (Math.abs(settledSpend - parsed.actualSpendUsd) > 1e-9) fail('COLLECT_STATE_CORRUPT', `state file ${statePath} actualSpendUsd does not match settled ledger entries`);
}

function freshState(clientId) {
  return {
    stateVersion: 2,
    clientId,
    status: 'idle',
    cursorByUnit: {},
    completedUnits: [],
    completedPageKeys: [],
    cacheByFingerprint: {},
    items: {}, // canonical_source_id -> item, idempotent merge
    actualSpendUsd: 0,
    failures: [],
    costUnreported: [], // pages purchased but charged their rate-card ESTIMATE, not a trusted reported cost
    requestLedger: [], // durable reservation/settlement record for every potentially chargeable request
    updatedAt: null,
  };
}

function saveStateAtomic(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmpPath, statePath); // atomic on the same filesystem: never a torn/partial state file
}

function fingerprint(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function validProviderResult(result, clientId) {
  if (!isObject(result) || result.clientId !== clientId || !Array.isArray(result.items)) return false;
  return result.items.every((item) => {
    const id = item && (item.canonical_source_id ?? item.id);
    return isObject(item) && item.client_id === clientId && typeof id === 'string' && id.trim() !== '';
  });
}
function isFiniteNonnegative(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function requireClientId(clientId, caller) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    fail('COLLECT_MISSING_CLIENT', `${caller} requires an explicit clientId; there is no default tenant`);
  }
  if (!REGISTERED_CLIENTS.includes(clientId)) {
    fail('COLLECT_UNKNOWN_CLIENT', `${caller} refuses ${JSON.stringify(clientId)}: not in the registry [${REGISTERED_CLIENTS.join(', ')}]`);
  }
  return clientId;
}

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
