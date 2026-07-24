# Phase 0 — Scope + Surface Inventory

Run started 2026-07-24. Branch `feat/sends-kpi-elevation` created off `main` @ `b395ade` (origin/main SHA recorded in `origin-main-sha-at-start.txt`). Mutation tier **T2 born-dead**: no merge, no push to main.

## Central risk
Silently degrading a working, live-data dashboard or the already-applied SQL views. Neutralized by:
1. All work on `feat/sends-kpi-elevation`; `main` untouched (DoD proves `git log origin/main` unchanged).
2. Every changed number re-verified against a hand-computed raw SELECT over the full population (not a subagent summary).
3. SQL ships as new `db/*.sql` files + consolidated idempotent paste block — operator applies; the run cannot (no exec_sql RPC).
4. Live service key lives ONLY in the session scratchpad (`sb-service.key`), fetched via Management API at runtime — never written into any repo file.

## Credentials (runtime-resolved, verified live)
- Service key → scratchpad `sb-service.key` (smoke-tested: `inbox_accept_v` + `inbox_governor` both 200 with real rows).
- Anon key + URL in `.env.local` (app runtime).
- Session mint for screenshots: `node scripts/dev-login.mjs` → `.session.json`.

## Surface inventory (grep-verified, per metric: compute → render)

| # | Metric | SQL source | Fetch/compute | Render | `all` aggregation path |
|---|---|---|---|---|---|
| 1 | Volume (4 channels) | `db/003` `inbox_sends_v` + `inbox_sends_daily_v` (90d) | `sends.ts` `fetchSends`/`fetchSendsDaily`/`buildLanes` (:235-278), `laneCount` in OverviewView (:70-80, 90d = client-side daily sum) | `OverviewView` Block 1 KpiRow; also SendsScreen lanes segment | `buildLanes` `inClient` sends.ts:240; OverviewView:63 |
| 2 | Acceptance | `db/005` `inbox_accept_v` (trailing windows) | `kpis.ts` `fetchAccept` + `acceptRate` | Block 2 Engagement (7d/30d only — **ignores timeframe selector**) | OverviewView:109 sum over filtered rows |
| 3 | Scan opens | `db/007` `inbox_scan_opens_v` (definer; 4-hop token join) | `kpis.ts` `fetchScanOpens` | Block 2 Engagement | OverviewView:113 |
| 4 | Governor | `db/008` `inbox_governor()` (sender_health ×2 + integration_config) | `kpis.ts` `fetchGovernor`, `governorHeadroomPct` | Block 3 GovGauge (stacked; desktop right half empty on single-person) | OverviewView:196 targets array |
| 5 | Pipeline/runway | `db/006` `lane_of()` + `inbox_pipeline_v` | `kpis.ts` `fetchPipeline`, `runwayDays`; dailyRate calc OverviewView:229-237 (`max(avg7, govDaily)`) | Block 4 Pipeline | OverviewView:219, 234 |
| 6 | Campaigns | none — client-side over `inbox_messages_v` (4000-row window) + `outreach_campaigns` | `sends.ts` `fetchCampaignSends` (:180-218, dedup + coalesce filter) | Block 5 Campaigns | sends.ts:210 |
| 7 | Send log (note text) | `db/001` `inbox_messages_v` | `sends.ts` `fetchSendLog`/`buildSendLog` | SendsScreen log segment (shows `message_text` for every CONN) | sends.ts:125 |
| 8 | Desktop layout | — | — | `App.tsx:102` `.dt-full`; `styles.css` `.ov-*` + `@media (min-width:1000px)` | — |
| 9 | Timeframe selector | — | SendsScreen state → OverviewView prop | drives Block 1 only | — |
| 10 | Tests | — | `src/lib/kpis.test.ts` (6), `sends` pure fns | — | — |

## Findings register for Phase 1 (each gets a researcher + a named skeptic)
- **F1 Cohort-lag acceptance** — `inbox_accept_v` counts accepts-in-window / sends-in-window (trailing), can exceed 100%; currently only captioned. Live now: ivan 12/41 7d.
- **F2 Campaigns window** — `fetchCampaignSends` counts within a recent 4000-row fetch, not all-time; phantom-duplicate burst consumes window.
- **F3 Scan-open attribution** — prove ivan-skew with the real `scans.prospect_token` null-rate per open-bearing slug (join gap vs true distribution).
- **F4 Lane bucketing** — 4 "Warm"-named engagement/profile-view campaigns bucketed Engager; confirm vs operator model (engager = engagers of that account's own content).
- **F5 Governor desktop UI** — empty right half; → Phase 2 tournament surface, not an accuracy gate.
- **F6 (NEW, operator-reported mid-run)** — Send log shows a note body for EVERY connection, but LinkedIn caps invite notes; operator wants "connection sent without note" when no note went out. Investigate: does `outreach_messages` (or the sender workflow) record whether the note was actually attached? Check UniPile response handling in the Connection-Sender n8n workflow + sample the named prospects (Betta Carrano, Jennifer Malouf, Amar Behura… sent ~2026-07-24).
- **F7 (NEW, surfaced by Phase-0 smoke test)** — Governor cross-checks: (a) Rise `accept_rate=0.0` from sender_health vs `inbox_accept_v` risedtc 3/57 = 5.3%; (b) sender_health Rise `cap=35` vs `integration_config.risedtc_connect_weekly_cap=100`; (c) Ivan `accept_rate 16.6%` vs accept view 29.3% (7d) — determine which instrument is authoritative for each surface and label the UI honestly.

## Operator context (NOT defects)
- Ivan raised his weekly cap intentionally; `used>cap` (98/50) is correct live state — display must inform, never clamp.
- Acceptance block ignoring the timeframe selector is a Phase-2 UX candidate, not an accuracy defect.

## REUSE pointers
`db/NOTES-kpi-verification.md` (canonical schema facts), spec + plan under `docs/superpowers/`, `.superpowers/sdd/progress.md` ledger from the build run.
