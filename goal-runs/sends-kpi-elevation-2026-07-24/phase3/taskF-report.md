# Task F — frontend accuracy pack — report

Branch: `feat/sends-kpi-elevation`. Scope: `src/` only (never touched `db/`).

## What changed
- **src/lib/kpis.ts**
  - `GovernorRow.accept_rate` → `number | null` (null = cohort still empty, never a false 0).
  - Added optional v2 fields: `cohort?`, `accepted?`, `gov_used?`, `gov_cap?`, `cohort_opens_at?` (all absent on the legacy RPC).
  - `laneLabel`: added `harvest → 'Harvested'`.
  - New pure fn `governorEnforcementGap(used, cap, gov_used, gov_cap)` → true only when the shared enforcement counter is maxed (`gov_used >= gov_cap`) but this client is under it (`used < gov_used`); null enforcement fields → false (legacy-safe).
- **src/lib/kpis.test.ts** — TDD: added `laneLabel('harvest')` case + 4 `governorEnforcementGap` cases (positive, under-cap, self-accounts-for-all, and the three null permutations). Written failing first, then implemented.
- **src/lib/sends.ts**
  - `CampaignSend` gained optional `sent_7d?`, `sent_30d?`, `last_sent?`; `sent` is now documented as all-time (= `sent_total` in view mode).
  - `fetchCampaignSends` now tries `inbox_campaign_sends_v` first (server-side full-population aggregate, dodges the 1000-row PostgREST cap); on error/absent view it silently falls back to the renamed private `fetchCampaignSendsLegacy` (the old by-name client-side count). Client filter on coalesced `client_id` stays client-side in both paths.
- **src/screens/kpi/OverviewView.tsx**
  - Acceptance caption swapped to: *"Share of notes sent in each window that got accepted. Recent sends are still maturing — this rate only rises."*
  - GovGauge accept line → `cohort accept (3-18d): {accept_rate}%`; when `accept_rate == null` → `cohort: not enough data yet` (+ ` (opens ~MM-DD)` when `cohort_opens_at` present, via a TZ-safe `shortDate` slice). Added amber enforcement line `governor counter {gov_used}/{gov_cap} (shared) — cold sends gated` gated on `governorEnforcementGap(...)`.
  - Campaigns block: renders a muted `7d {n}` secondary number (new `.ov-td-sub`) when a row carries `sent_7d` (view mode only).
- **src/screens/SendsScreen.tsx** — Log view: one muted caption at the top of the list: *"Connection notes shown were accepted by the API with the note attached."*
- **src/styles.css** — added `.log-note` (muted 12px) and `.ov-td-sub` (muted 12px) classes.

## Test / build / lint
- `npx vitest run` → **38 passed (4 files)**.
- `npm run build` (`tsc -b && vite build`) → **clean, built in ~0.5s**.
- `npm run lint` (`oxlint`) → **0 errors**; only 3 pre-existing warnings in files I did not touch (ConfirmSheet, ContextSheet, ThreadScreen).

## Rendered verification (pre-apply)
- Dev server: `http://localhost:4321/ivan-inbox/`. Injected minted session, Sends → Overview, Ivan chip. Desktop 1280w.
- Screenshot: `/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/719688d6-6609-48c7-9161-61c2ec6a606d/scratchpad/ov-taskF-ivan-desktop.png` (+ `ov-taskF-ivan-log.png`).
- Confirmed rendered: new acceptance caption; governor line `cap 50 · cohort accept (3-18d): 16.6%`; log caption present; campaigns rendered via legacy fallback.
- **Console:** the only 4xx is `404 …/rest/v1/inbox_campaign_sends_v?select=*` — the expected fallback probe for the not-yet-applied view (silent fallback fires, campaigns still render). No JS errors, no pageerrors.
- **Pass condition (pre-apply):** enforcement line ABSENT (RPC lacks `gov_used`/`gov_cap` until SQL applies), `sent_7d` secondary ABSENT (legacy fetch has no 7d), governor `accept_rate` returned by legacy RPC as 16.6% so the cohort label shows a number rather than the null copy — all as documented. That absence set is the pass.

## Deviations
- None functional. Screenshot was run from a temp copy of the script inside `scripts/` (deleted after) because Playwright resolves from the project `node_modules`; the scratchpad copy of the script remains at `.../scratchpad/shot-taskF.mjs`. No non-`src/` files committed.
