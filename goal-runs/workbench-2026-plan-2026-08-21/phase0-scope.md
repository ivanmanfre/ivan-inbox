# Phase 0 — scope, central risk, surface inventory

Branch: **`wb/2026-readability`** (off `main` @ `685ccbf`, with `fix/ops-label-manual-invite` merged in as `e94efc0`).

## Baseline gates, re-measured at launch (not trusted from the mission file)

| gate | mission said | measured now | note |
|---|---|---|---|
| `npm run build` | failing at `685ccbf` | **green** | only after merging the `OPS_LABEL` fix. Confirmed: the live site's last deploy failed, `main` alone still does not build. |
| `npm test` | 827/828 | **827 passed / 1 failed, 42 files** | the failure is `calendarItems.test.ts > "passing no queue is the old behaviour exactly"`. Pre-existing, out of scope, must not grow. |
| `npm run lint` | warnings in `goal-runs/` only | same | no `src/` warnings. |

## Central risk and how this run neutralises it

`faithful.css:174` flattens every descendant (`.wb.wb, .wb.wb *` → `--fs-body` / 400 / `line-height:20px`) and re-asserts seven tiers at `.wb.wb.wb` (1,164 occurrences, 29 `!important`). **A rule written with one class silently loses its type and renders at body size.** This exact defect shipped before: a declared 15px/1.6 artifact rendered 13px/20px.

Neutralisation, enforced on every phase:

1. Every selector added in this run carries `.wb.wb.wb`.
2. New CSS goes in **`src/exp/v2c/wb2026.css`**, imported last in `Shell.tsx:64`, with one section per pass. Four workstreams therefore never edit one cascade at once, and the type ramp stays defined in exactly one place.
3. No phase is done until `getComputedStyle` on the real element, in a real authed browser, at every viewport, agrees with the declaration. Source declarations are not evidence.

## Instruments built for this run

- `tools/refresh.mjs` — Supabase session refresh (tokens rotate; never run two concurrently).
- `tools/measure.mjs` — the sweep: 9 lanes × 4 viewports × theme, computed-style census, glyph-true `ch` measurement (canvas `measureText('0')`, because the 0.5em assumption overstates grotesk measure by ~1.22× and would have had us "fixing" blocks that were already inside the cap), overflow with scroller-parent exclusion, control heights, screenshots.
- `tools/probe.mjs` — single-question DOM probes with tab/click drive-through.

**All three run against the LOCAL preview of this branch (`localhost:4173`), never the live site.** The live site is whatever Ivan last deployed and can prove nothing about this work. Every one carries the write interceptor: PATCH / PUT / DELETE / non-rpc POST are fulfilled locally and counted. **Attempted writes so far: 0.**

## Surface inventory (built by search, not memory)

**9 lanes → components** (`Shell.tsx`): today → `screens/TodayScreen.tsx` · dms → `v2c/DmsSurface.tsx` · content → `v2c/ContentList.tsx` · magnets → `v2c/MagnetsList.tsx` · styles → `v2c/StylesList.tsx` · strategy → `v2c/StrategyView.tsx` · sends → `screens/SendsScreen.tsx` · ops → `v2c/OpsBoard.tsx` · settings → `screens/SettingsScreen.tsx`.

**3 canvases** (`layout.ts:30`): mobile <1000px, desktop ≥1000px, wide ≥1320px. Tested at 390 / 1024 / 1440 / 2560.

**Takeovers**: `Takeover.tsx` (Escape closes, guarded against fields) wrapping the draft window (`DraftPane.tsx`) and `MagnetWindow.tsx`. Inspector tabs live at `DraftPane.tsx:1287-1405`: `qa` · `art` (conditional) · `src` (conditional) · `log` · `meta`.

**Peers**: thread peer (`ThreadPeer.tsx`), Claude pane (`ChatPane.tsx`), context sheet over the thread. Max 2 peers, wide canvas only (`layout.ts:108`).

**Content lane**: 9 stage tabs, live counts measured — `Ideas 79 · Needs review 1 · Generating 0 · Approved 0 · Scheduled 1 · Published 113 · Errors 46 · Archived 88 · Other 3`. Two views (Flow / Calendar). Three client lanes (Ivan `client_id NULL` / Mattan `risedtc` / Davorin `arch`). Filters sheet at `FilterRow.tsx:127`.

**DMs**: client filters, search, DM HISTORY expander (`DmHistory.tsx:36-109`, state persisted via `useSectionState('dms.history')`).

**Keyboard today**: `⌘D` voice (`Shell.tsx:224`) · `j`/`k` queue walk (`DraftPane.tsx:958-968`, `MagnetWindow.tsx:325`) · `Escape` close (`Takeover.tsx:42`, `FilterRow.tsx:55`). Slash palette: `ChatPane.tsx:140` `matchCommands`.

**Control**: `#exp/stock` (`exp/index.tsx:32-42`) renders the pre-revamp shell from `src/styles.css`. **`src/styles.css` is therefore off-limits to this run** and stock must render identically at the end.

## Two mission claims corrected by measurement

The mission is the instruction set, not a data source. Two of its inherited assertions did not survive a live check, and the corrected version is what the phases build on:

1. **"Every content row already carries a checkbox with nothing to do."** FALSE. A DOM probe for `input[type=checkbox]`, `[role=checkbox]` and any `[class*=check]` returns **0 elements** on every content lane at every viewport, and `ContentList.tsx`'s `Card` renders no such control. Phase 4 therefore **builds** row selection; it does not wire an existing affordance. Scope grows by one component, and the bulk bar has to introduce its own selection model.

2. **"DMs wastes ~65% of a 2560 plate."** Directionally right, wrongly measured, and my own first instrument repeated the error: counting element hit-tests reported 96% "painted" because a row container spans the pane whether or not it carries a word. Measuring the actual glyph area (`Range.getClientRects`) instead: at 2560 the Content lane's text covers **3%** of a 2,304px work area (703 body characters) and DMs covers **8%** (1,382 characters). The diagnosis holds and is worse than stated. **Caveat carried forward:** this instrument over-reports on horizontally scrolling tables (Errors tab at 1440 returns 103%), so it is only read on non-scrolling surfaces.

## Rendered baseline census (dark, `phase0-baseline/metrics.json`)

Type combos carrying the page mass, `size/line-height/weight = characters`:

`14/21/400 = 48,760` · `14/20/400 = 25,698` · `13/18/400 = 14,295` · `13/19.5/400 = 6,083` · `14/22/500 = 5,604` · `14/20/500 = 4,836` · `11/16/600 = 3,090` · `13/20/400` · `13/20/500` · `16/22/500` · `11/20/400` · `13/18.9/400` · `11/20/600` — **25 distinct combinations** across the sampled top-tens alone.

Prose past the 70ch cap, worst first (glyph-true): `.wb-strat-note` **329ch** · `.ops-pipe-l` **277ch** · `.ov-note` **276ch** · `.wb-strat-p` **262ch** · `.ct-title` **244ch** · `.ct-ex` **189ch**. Strategy at 1440 carries 21 over-measure blocks; Ops 16; Today 14; Styles 18.

Sub-32px controls: Today **37**, Strategy **40** at every viewport (dismiss ✕ at 20px ×20, "open the scan ↗" at 20px ×12, ↑/↓ steppers at 30px).

Console errors: **0**. Real overflow: **0**. Both themes swept; light-theme baseline at 1440 stored in `phase0-baseline-light/`.

## Waivers located and protected

- **9px Sends KPI tile labels below 480px** — `faithful.css:2321-2324` (`.ov-tile-lbl` inside `@media (max-width:480px)`). Load-bearing: GOVERNOR is one unbreakable word and drops a step to fit its column.
- **10 / 10.5px client-board chips** — `styles.css:432` (`.ov-badge`), `:441` (`.ov-tile-lbl`), `:595` (`.td-big-c`), `:639` (`.sa-sev`), `:309` (`.log-chip`), `.wb-workhead-l` at `v2c/styles.css:109`.
- Also protected as chrome, not text: `.wb-mockchip` 9px (`v2c/styles.css:151`), `.wb-code-l` 9px (`:327`), `.ct-thumb-empty` 9px (`:204`).

Any blanket type raise that moves these is a defect, not a win.
