# content-evidence — staged package 3 (Run-3-ready)

Staged under `OUT/staged/automation/content-evidence/` only. Nothing here is copied into Run 1,
the repaired worktree, or anything live. **Run 3 is the sole future integrator.**

This package is self-contained: no module here imports from `OUT/worktrees/ivan-inbox-repaired/**`
or any other production path. Where its vocabulary overlaps that worktree's `contracts.mjs`
(`limitations`, `validation_state`, named-error-with-`.code` classes), the overlap is by
convention, not by import — Run 3 is expected to reconcile the two when it integrates this package
into the real repo (see "Run 3 integration" below).

No network calls, no provider calls, no database access anywhere in this package or its tests.
Every test uses synthetic, public-safe fixtures — no private post bodies, no reactor identities,
no credentials, no real profile URLs.

## Modules

- **`patterns.mjs`** — `comparePatterns({ posts, labels, partition, policy })`. Within-author
  pattern-vs-comparator comparison on a same-metric `value`. Enforces: a chronological
  discovery/holdout split with a hard leak check, a `missing_comparator_population` /
  `no_qualifying_authors` / `below_minimum_authors` insufficiency ladder, unknown/unlabeled
  exclusion from both numerator and denominator (counted, never dropped), per-author results that
  are never pooled into one universal ranking (the one cross-author number is a **median** of
  per-author effects), leave-largest-author-out and leave-largest-post-out sensitivity, a
  `holdoutStatus` that can never be `blind` when `partition.exposure === 'retrospective'`, and a
  tenant check on both posts and labels.
- **`collect.mjs`** — `planCollection({ clientId, gaps, rateCard })` (a pure quote — never calls a
  provider; refuses with `COLLECT_MISSING_RATE` before `runCollection` could ever be reached) and
  `runCollection({ clientId, plan, budget, stateDir, outRoot, provider, now })` (disabled by
  default: `budget.approvedUsd` defaults to `0`, which is a real, checked stop — proven with a spy
  adapter asserting zero calls). Persists cursors and completion per author+collection unit,
  per-page completion, a request-fingerprint cache, and a version-2 request ledger to a JSON file
  written atomically (temp file + rename) under a caller-supplied `stateDir` that **must** resolve
  inside `outRoot`. A reservation is durable before dispatch. Unknown billing, an interrupted call,
  or an invalid response blocks all further dispatch pending reconciliation. A terminal response
  stops the remaining pages of that unit while retaining unrelated unit work for safe resume.
  Missing/old/malformed persisted ledger state is rejected rather than silently reset.
- **`report.mjs`** — `renderReport({ coverage, winners, controls, cost, methods })` → markdown.
  Recomputes every displayed count from the rows it is given and throws `REPORT_CORRUPTED_COUNT`
  when a supplied `summary` count disagrees with its own rows. Renders `null` as `"unknown"`, never
  `0`. Labels `isLegacy`/`reported_legacy` rows `"reported (legacy), not verified"`. Truncates any
  post-opening text to a 12-word fragment regardless of how much text the caller supplies.
- **`run.mjs`** — CLI with explicit `inventory`, `coverage`, `analyze`, `plan-collect`, `report`
  commands. `--client` is required and must be one of `ivan`, `risedtc`, `arch`. `--out` resolves
  against `--out-root` when relative (this repo's own root-relative convention) and **must**
  resolve inside `--out-root`; a path that escapes it (`../` traversal or an absolute path
  elsewhere) is refused with `RUN_OUT_OUTSIDE_ROOT` before any file is opened for writing. An
  unknown command prints usage and exits non-zero. `plan-collect` never touches a provider and
  always prints `approved_spend=0`. `main(argv, io)` returns an exit code (does not call
  `process.exit` itself) so tests drive it in-process; the bottom of the file calls
  `process.exit()` only when actually run as a script.

## Tests

`node --test` from this directory runs all four `*.test.mjs` files (52 tests total). See
`../../red.log` and `../../green.log` (i.e. `OUT/staged/red.log` / `OUT/staged/green.log`) for the
before/after transcripts: red was captured by temporarily removing the four implementation files
(genuine `ERR_MODULE_NOT_FOUND` failures across all four test files), green after restoring them.

Coverage highlights (see each `*.test.mjs` for the full list):

- `patterns.test.mjs` — the Package 3 plan fixture reproduced **verbatim** via
  `fixtures/pattern-recurrence-fixture.json`; a pooled effect that disappears within authors; one
  dominant source failing leave-largest-author-out; unknown/unlabeled posts changing the
  denominator; a chronological split leak; tenant mismatches on posts and on labels; all three
  `holdoutStatus` values including the retrospective-can-never-be-blind rule; every finding
  carrying a "descriptive, not causal" limitation.
- `collect.test.mjs` — missing rate refuses before any call; default and explicit zero budget stop
  before any provider call (spy count 0); per-page budget exhaustion mid-run; canonical-ID
  idempotency across duplicate pages; full and partial safe resume; the fingerprint cache serving a
  page without a call; a failed author not aborting the run; state path traversal/outside-OUT
  refusal; atomic, always-valid-JSON state; tenant checks.
- `report.test.mjs` — corrupted summary counts (coverage and winners) refuse to render; a correct
  summary renders cleanly; null-vs-zero rendering; legacy labeling; the 12-word truncation; missing
  sections render a plain message instead of crashing.
- `run.test.mjs` — missing/unknown `--client`; path-traversal and absolute-outside `--out`; a valid
  root-relative `--out`; unknown/absent command; `plan-collect`'s zero-provider, zero-spend
  guarantee; each command's file output, scoped to `--out` only.

## Run 3 integration (not performed by this package)

This package is staged, not wired. Before it can run against real data, Run 3 must, at minimum:

1. Decide whether `patterns.mjs`/`collect.mjs`/`report.mjs` keep their self-contained vocabulary or
   are refactored to import `contracts.mjs`'s `EvidenceValidationError`/`validateFinding` from the
   repaired worktree (current commit in `repair/FOUNDATION-HANDOFF.json`) — this package intentionally avoided that import so it
   could be staged without depending on worktree layout.
2. Write a real provider adapter satisfying `collect.mjs`'s `{ enforcesMaxChargeUsd: true,
   fetchPage({ clientId, authorId, unit, pageIndex, cursor, requestId, maxChargeUsd }) ->
   { clientId, items, costUsd, nextCursor, done, rateLimited? } }` interface. `enforcesMaxChargeUsd`
   is an explicit adapter attestation that the provider accepts and enforces `maxChargeUsd`; a rate
   estimate alone cannot authorize dispatch. The collector persists a version-2 request ledger
   reservation before every dispatch. Throws, malformed responses, foreign rows, and unverified
   charges enter `reconciliation_required` and are never automatically retried or completed. The adapter needs
   provider-specific enforcement evidence before any real use; a boolean is not proof. Actual
   spend includes only known reported charges (including a reported cap breach). Unknown charges
   remain unresolved ledger entries with their reserved maximum; `actualSpendUsd` alone is not a
   complete bill while any reservation is unresolved. This package has no live adapter and no paid
   collection approval. A later operator must reconcile against authoritative provider billing;
   resetting the ledger is not a recovery procedure.
2a. Target paths in the live repo: this package's four modules would land under the same
   `automation/content-evidence/` tree the repaired worktree already uses (see `contracts.mjs`,
   `methods.mjs`, `adapters.mjs`, `normalize.mjs`, `outcomes.mjs`, `import-study.mjs` there), so
   Run 3's integration is adding `patterns.mjs`, `collect.mjs`, `report.mjs`, `run.mjs` beside them
   — not a new directory.
3. Wire `run.mjs`'s `inventory`/`coverage` commands to the real adapters (`readMarketPosts`,
   `readOwnPosts`, etc.) instead of this package's flat-file JSON stand-in.
4. Reconcile `patterns.mjs`'s finding shape with `contracts.mjs`'s `PATTERN_FINDING_REQUIRED_FIELDS`
   (`comparator_ids`, `comparator_n`, `per_author_results`) — the field names already match, but
   `contracts.validateFinding` has not been run against this module's output in this run.

## Known limits

- `collect.mjs`'s state file stores full harvested items in one JSON object keyed by canonical id;
  for a large market study this should move to a proper store rather than a single JSON file, but
  is adequate for the synthetic/small-batch collection this package's tests model.
- `patterns.mjs` takes one `pattern` value per label row (one labeling dimension per call); testing
  multiple independent dimensions (opening mechanism, proof type, CTA, ...) means calling
  `comparePatterns` once per dimension with a separate `labels` array each time.
- `run.mjs`'s `inventory`/`coverage` commands are intentionally minimal (flat-file JSON in, JSON
  out) since this run has no DB/network access; they exist to make every listed CLI command real
  and testable, not to replace Package 1/2's adapters.
