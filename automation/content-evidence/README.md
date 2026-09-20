# content-evidence

The evidence trail behind the weekly content choices: what was collected, which exact posts beat
their own author's history, what the client can honestly say about it, which choices were made and
what happened after they were published.

Every number this package produces carries its source, its denominator, its formula and its
capture date, because a number without those is not evidence. Where a number is unknown it stays
null; a real zero stays zero.

This is integrated code in the repository, not a staged proposal. Nothing here calls a provider,
and nothing here writes to a database by itself.

## What is true of every module

- **One exact tenant, always.** Every entry point takes an explicit `clientId`. A row carrying a
  different tenant is an error, never a silent filter.
- **No network, no provider, no credential.** `collect.mjs` is the only module that could ever
  reach a provider and its approved budget defaults to `0`, which is a checked stop proven with a
  spy adapter asserting zero calls. There is no live adapter in this repository.
- **Synthetic fixtures only.** No test in this package contains a real post body, a reactor
  identity, a private profile URL or a credential. Private corpus text lives outside the repo and
  reaches the database directly.
- **A gap is stated, never padded.** An empty answer names the input it is missing.
- **Descriptive, never causal.** A post crossing its author's own baseline is a description of what
  happened. It is not evidence that the format caused the reach, and no module says otherwise.

## Modules

### The contract

- **`contracts.mjs`** — the frozen shapes. `validateManifest`, `validateFinding`,
  `validateEvidencePackage`, the vocabularies (`MANIFEST_STATES`, `FINDING_KINDS`,
  `AGE_COMPARABILITY`), `DEFAULT_POLICY`, `computeLift`, and the canonical sort and hash helpers.
  Its load-bearing rule: `validated` is a claim about arithmetic, not a workflow step, so a
  manifest may not call itself validated while it carries an unresolved numerical discrepancy.

### Reading a corpus

- **`normalize.mjs`** — `normalizeStudy`. Turns raw records into study posts, resolves identity by
  canonical source id, keeps repeat captures as observations of one post, and refuses a foreign
  tenant.
- **`adapters.mjs`** — the read side of the existing stores. Refuses untenanted `own_posts` unless
  the caller passes an explicit client descriptor, and requires the client bind on every read.
- **`import-study.mjs`** — `importStudy`, the pure preview: counts, hashes, exclusions with
  reasons, own controls held out of the market population. It is preview only by design; the
  applying import is `release/import-studies.mjs`.

### Computing

- **`methods.mjs`** — `computeOutliers`. The versioned market-outlier method
  (`content-evidence-methods-v2`): originals over a window, an author's own same-metric baseline,
  a minimum eligible baseline count, lift, and an explicit exclusion for every row that did not
  qualify. Blank metrics are unknown; an explicit `0` is a measured zero.
- **`patterns.mjs`** — `comparePatterns`. Within-author pattern versus comparator on one labelling
  dimension per call, with a chronological discovery and holdout split and a hard leak check, a
  named insufficiency ladder, per-author results that are never pooled into one universal ranking,
  and leave-largest-author-out and leave-largest-post-out sensitivity. `holdoutStatus` can never
  read `blind` for a retrospective partition.

### Outcomes

- **`outcomes.mjs`** — `joinTestOutcomes`. Connects recommendations to what was actually published
  and observed, and keeps `explicit` and `inferred` links permanently distinct. A recommendation
  with no publication is never performance. A lifetime or backfilled capture is never relabelled a
  seven-day standing reading.
- **`outcome-links.mjs`** — the recommendation -> idea -> publication chain, read (never written)
  from the one place it is already computed live: `public.audn_recommendation_links()`. No new
  storage: `adaptCanonicalLinkRow` reshapes its rows and `buildOutcomeChain` joins them against
  publications/observations for age and window math only. `client_ideas.reuse_of` is explicitly
  never touched here -- verified live to already carry an unrelated idea-reuse-staging feature on
  8 risedtc rows. Two ages stay two numbers: a window comes due on publication age and is answered
  only by a capture whose own age lands on it.
  `reviewMilestone({ weeksCompleted, evaluatedPosts })` is the LATER of six completed weeks and
  twelve evaluated posts, so it is true only when both are in.
  `reconcilePopulation({ opsDraftsRows, linkRows })` is the pure, SQL-free population reconciler:
  given every recommendation row and every canonical link row (or an equivalent synthetic
  fixture), it buckets each recommendation explicit/inferred/unresolved/withdrawn/ambiguous/
  excluded, tenant-scoped throughout (the join key is always the compound client_id +
  recommendation_id, so two clients reusing the same bare id never cross-link), and reports
  `one_to_many` (via `computeOneToMany`) and `real_chain` off the same rows. `outcomes/scripts/
  reconcile.mjs` fetches the two live row sets and calls this function unchanged; its own test
  file exercises it with a synthetic production-shaped fixture, with zero live dependency.

### Reporting and the CLI

- **`report.mjs`** — `renderReport`. Recomputes every displayed count from the rows it is given and
  refuses to render when a supplied summary disagrees with them. Renders `null` as `unknown`, never
  as `0`, and labels an unreconciled row as reported rather than verified.
- **`collect.mjs`** — `planCollection` (a pure quote that never calls a provider) and
  `runCollection` (disabled by default, durable reservations, per-unit cursors, safe resume).
- **`run.mjs`** — the CLI: `inventory`, `coverage`, `analyze`, `plan-collect`, `report`.
  `--client` is required, and an `--out` that escapes `--out-root` is refused before any file is
  opened.

### Release

- **`release/import-studies.mjs`** — imports one hash-verified methods-v2 market study into the
  db/103 tables. Dry run is the default; `--apply` writes one idempotent SQL transaction and
  executes nothing. The generated SQL carries post bodies, so `--out` must resolve outside this
  repository. The study's `descriptive_only` scope statement is preserved rather than translated:
  see the header of that file for exactly how the manifest state is decided from hashes.
- **`release/steps.mjs`** — the ordered live release as data: per object, its native identity,
  before-snapshot, compare-before-write guard, apply, readback and rollback.
- **`release/release.mjs`** and **`release/rollback.mjs`** — print that list forwards and
  backwards. Neither executes anything: each step has its own executor under its own
  authorization. The rollback leads with the one statement that returns every client to the legacy
  path with no schema change and no data loss.
- **`release/sql-tests.mjs`** — applies `db/103` and `db/104` to a throwaway in-process PGlite
  instance, twice, and runs both assertion files plus a control that must fail against a
  tenant-blind reader.

## Where the data lives

| Object | What it holds |
| --- | --- |
| `client_research_studies` | one study snapshot: manifest, window, cutoff, eligibility, exclusions, state |
| `client_research_study_posts` | the posts that study retained, their metrics, their exclusion reasons |
| `client_research_findings` | the computed findings, each with source ids, denominator and formula |
| `content_evidence_pack(client, week)` | db/103. The service read the weekly writer uses. |
| `operator_content_evidence(gate, client)` | db/104. The browser read behind the Strategy views. |
| `integration_config.weekly_evidence_selector_clients` | the per-client rollout switch; absent or `[]` means the legacy path for everyone |

`client_research_outliers` (db/102) stays exactly as it is and remains the presentation adapter for
the Markets block.

## Running the tests

```
node --test automation/content-evidence
node --test automation/content-evidence/release
node automation/content-evidence/release/sql-tests.mjs
```

The first two need nothing but Node. The third needs `@electric-sql/pglite` from `npm ci`; it is
in-memory and opens no socket.
