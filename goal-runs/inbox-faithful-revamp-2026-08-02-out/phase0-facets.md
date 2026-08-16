# Phase 0 — Content route filter/facet wall inventory

Scout run, branch `exp/vis-faithful`, worktree `wt-faithful`. Dev server localhost:5431 (already running,
untouched). Auth via `.session.json` injected through `addInitScript` (see trap below). Captured 2026-08-02.

Screenshots: `phase0-shots/facets-*.png` (this run only; the directory is shared with sibling scouts —
`dash-*`, `errhover-*`, `mobile-*`, `read-*`, `today-*` are other agents' output, not mine).

## Capture note — a real auth trap, logged so it isn't repeated

First attempt injected the session via `page.evaluate()` **after** `page.goto(BASE)`, then navigated to
`#exp/v2/content` with a second `goto`. Because that second `goto` only changes the hash, the browser does
an in-page navigation (no reload), so the Supabase client had already constructed itself anonymous before
the token was ever written to `localStorage`. Result: a fully-rendered, non-skeleton, "stable" page at
`bodyLen 39` — RLS's silent zero-row 200, exactly the failure mode the task brief warned about, and my own
settle-loop called it "stable" because it never grew. Fixed by moving the injection into
`page.addInitScript(...)` before the first navigation, so it runs before any app script on every load in the
context. Confirmed real data after the fix: `bodyLen 10411`, 130 Ivan-lane drafts loaded, matches the footer
figure "173 of 203 in the lane."

## 1 & 2 — Screenshots + per-facet inventory

Two lanes, two facet *walls* each (a primary post-lane wall the owner screenshotted, and a second,
structurally identical wall inside the Lead-magnet sub-lane below it — same component, same rules, easy to
miss on a quick look).

All facets are built by one generic function, never a hardcoded list:
`buildFacets<T>(rows, specs)` — `/private/tmp/.../wt-faithful/src/lib/contentFilters.ts:47-64`. It counts every
value of every spec across the currently-loaded rows, sorts by count desc, and **drops** a facet with 0
options or exactly 1 option that covers every row (a control with one side is decoration — same file, the
doc-comment above the function). This is why Mattan's lane is missing `Experiment` and `Evidence` that
Ivan's lane has: his loaded rows carry no `arm` value and no backfilled QA verdict, so those two facets
silently don't exist for him — not a bug, a property of the row set.

Selection/toggle/AND logic: `applyFilters()`, same file, lines 69-78. `FilterState = Record<string,string>`
(line 37) — one active value per facet key, so a facet is single-select by construction; multiple active
facets AND together.

### Facet source: `draftSpecs(lane)` — contentFilters.ts:119-178 (the PRIMARY post-lane wall)

| # | Label | Chips (Ivan / Mattan) | Example chips (Ivan, count) | Built at | DB column / jsonb path |
|---|---|---|---|---|---|
| 1 | Stage | 5 / 5 | Published 109, Archived 39, Needs review 19, Errors 4, Scheduled 2 | contentFilters.ts:121 | derived, `stageOf(d)` over `carousel_drafts.status` (content.ts) |
| 2 | Kind | 4 / 4 | single_image 86, text 73, carousel 13, video 1 | contentFilters.ts:122 | `carousel_drafts.type` |
| 3 | Board (Mattan lane only) | — / 2 | Internal 64, On Mattan's board 23 | contentFilters.ts:128-132 | `carousel_drafts.board_visible` (strict `=== true`; NULL never counts as visible) |
| 4 | Pillar | 5 / 2 | methodology 60, translator 39, teardown 19, personal 16, case_study 10 | contentFilters.ts:135 | `carousel_drafts.taxonomy->>'pillar'` (content.ts:1038, `taxonomyFields`) |
| 5 | Structure | 8 / 8 | HOT TAKE 11, TEARDOWN 9, CONFESSIONAL 7, DATA-LED 6, HOW-TO/DECLARATIVE 4, STORY 4, FRAMEWORK WALKTHROUGH 3, Methodology 2 | contentFilters.ts:140-147 | `taxonomy->>'structure_used'` OR a bare-string `taxonomy` column (content.ts:1042-1055), family-keyed via `previewKey('structure', k)` so it never collides with Image style's `before-after` |
| 6 | Image style | 7 / 3 | Concept Visual 71, Framework Diagram 24, Stat Card 21, Before/After 10, Brand Newsjack 3, Lifestyle Photo 1, Quote Card 1 | contentFilters.ts:148-156 | `taxonomy->>'image_style'`, family-keyed the same way |
| 7 | Hook | 14 / 10 | story_opener 19, data_led 18, specific_receipt 15, other 12, confessional 11, quote_cold_open 10, imperative_counter 4, story 4, universal_aspirational 2, contrarian/data/specificity 1 each | contentFilters.ts:157 | `taxonomy->>'hook_type'` — **two lanes spell the same concept differently** (`story` vs `story_opener`, `data` vs `data_led`) per the file's header comment, lines 7-16 |
| 8 | Source | 19 / 2 | Client Calls 31, Kyle call 30, Web Research 29, Breaking news 17, Reddit 8, Ivan call 7, News/HN 7, Client Call: Pro SWPPP 6, Competitor 5, lifestyle 5, quality-sweep-regen 5, Manual 3, Studio 3, manual 2, x_search 2, convergence-apply-test/Curator/qa-lane-repair-goalrun/youtube_watch 1 each | contentFilters.ts:158 | `taxonomy->>'source'` — **the single largest facet on Ivan's lane, 19 values** |
| 9 | Funnel | 3 / 3 | buyers 63, reach 52, trust 45 | contentFilters.ts:159 | `carousel_drafts.funnel_stage` (own column, not taxonomy) |
| 10 | Experiment | 2 / dropped (0 options) | text 29, text_image 17 | contentFilters.ts:160 | `taxonomy->'experiment'->>'arm'`, flattened (content.ts:1046-1068) |
| 11 | QA verdict | 6 / 4 | PASS 95, REWRITE_OK 32, QA_BLOCKED 10, FAIL 8, NEEDS_REGENERATE 5, APPROVE 3 | contentFilters.ts:161 | `carousel_drafts.qa->>'verdict'` (aliased `qa_verdict` in the select, content.ts:70) |
| 12 | QA score | 4 / 4 | Unscored 82, 60–79 48, 80+ 30, Under 60 13 | contentFilters.ts:97-102, 162 | `qa->>'score'` banded (never a raw numeric range — live rows carry both `82` and `74/90` string forms) |
| 13 | Image | 2 / 2 | Has image 104, No image 69 | contentFilters.ts:115-117, 163 | `carousel_drafts.image_urls` (array-length test) |
| 14 | Regenerated | 1 / 1 | Regenerated 10 | contentFilters.ts:165-168 | `qa->>'qa_regen_attempts'`, truthy-only (dropped when 0) |
| 15 | Evidence (backfilled) | 1 / dropped | Backfilled 57 | contentFilters.ts:170-174 | `qa->>'backfilled'` (string `'true'` compare) |

**Primary wall totals — Ivan:** 14 facets (`arm`/`backfilled` present), **81 chips**. **Mattan:** 13 facets
(`Board` added, `arm`/`backfilled` dropped — no qualifying rows), **50 chips**.

### Facet source: `RESOURCE_SPECS` — contentFilters.ts:209-214 (the SECOND wall, inside `ResourceLane`)

Renders in `ResourceLane`, `ContentSections.tsx:481-484`, over `lm_drafts_v2` rows (`Resource` type,
`src/lib/styles.ts:210-223`).

| Label | Chips (Ivan / Mattan) | Example (Ivan) | DB column |
|---|---|---|---|
| Status | 7 / 4 | published 40, pending 37, disqualified 31, review 9, complete 2, error 1 | `lm_drafts_v2.status` |
| Format | 13 / 4 | checklist 61, Guide 15, Interactive Assessment 12, Checklist 8, AI Kit 6, N8N Workflow 6 | `lm_drafts_v2.format` |
| Landing URL | 2 / 2 | No landing URL 114, Has landing URL 7 | `lm_drafts_v2.landing_url` (yes/no) |
| Resource URL | 2 / 2 | No resource URL 77, Has resource URL 44 | `lm_drafts_v2.resource_url` (yes/no) |

**LM wall totals — Ivan:** 4 facets, **24 chips**. **Mattan:** 4 facets, **12 chips**.

**Grand total, both walls, per lane:** Ivan **18 facets / 105 chips**. Mattan **17 facets / 62 chips**.
(There are two further, smaller `FilterBar` instances in the same route — the collapsed-by-default `Ideas`
section, `IDEA_SPECS` contentFilters.ts:182-192, 5 facets over `lm_idea_candidates`, and `StyleRoster`,
`styleSpecs()` contentFilters.ts:220-237, 3 facets over `content_prompts` — both closed by default so they
add 0px to the wall unless opened; not counted above.)

Rendering component for every one of these: `FilterBar`, `src/exp/v2c/ContentBits.tsx:87-138`. One `<div
className="ct-fg">` per facet (label + all its chips, `map` over `f.options`, **no cap, no "show more"**),
toggle logic lines 98-103 (delete-if-same, else set — this is what makes each facet single-select).

## 3 — The wall's measured size at 1440×900

Two states matter because Claude is docked by default at this width (`Shell.tsx:97-101`, "Claude is docked
from the start on a canvas that has room for it") and that narrows the list column, which changes how the
chips wrap:

**A. Default state (chat peer open, content column ≈ 620px wide)** — `facets-01-content-ivan-viewport.png`:
- Primary wall (`.ct-filters` #1): **806px** tall (measured rect top 633 → bottom 1439)
- LM-lane wall (`.ct-filters` #2): **262px** tall (1068 total − 806)
- Combined: **1068px**
- First actual content row (`.ct-card`) does not appear until **y = 1439** — i.e. **539px below the fold**
  of a 900px viewport. **0 draft rows are visible in the first screen.**

**B. Chat peer closed (solo layout, content column = 1240px wide)** — `facets-08-content-ivan-solo-viewport.png`:
- Primary wall: **390px** tall
- LM-lane wall: **166px** tall
- Combined: **556px**
- First card at **y = 1055** — still **155px below the fold**. Even at the widest the workbench ever gives
  this column, the wall alone still pushes every real row out of the first screen.

Rows scroller (`.rows.ct-rows`) begins at `top: 141` in both states (header + lane pills). So of the 759px
of vertical space between the header and the fold, state B spends 0 of it on an actual draft — it's alert
strip + pipeline chart + cadence line + the first ~267px of the 390px primary wall, then the wall keeps
going another 305px past the fold before section 02 (`Needs review`) even starts.

Mattan lane (narrow/default state, `facets-05/06`): 2 blocks, **684px** combined (primary wall ≈ 551px by
the same chip-count ratio, LM wall ≈ 133px — not independently re-measured, extrapolated from the 50:12
chip split; screenshot is the primary evidence).

**Caveat:** the height numbers above are chip-wrap-dependent, so they are a function of column width as much
as of facet count. The `faithful.css` sheet already carries scars from a prior wrap fix at 390px
(`faithful.css:952-970` — `.ct-fbar`, `.ct-fg` had to be given `flex-wrap:wrap` + `max-width:100%` because a
facet with 8+ options was overflowing the pane uncontained). The core problem is not the wrap CSS, it's the
sheer count of simultaneously-rendered options (105 chips, 18 groups) — no wrap fix shrinks that.

## 4 — Interaction behaviour

- **Single-select per facet, multi-facet AND**: confirmed by clicking `Stage: Published` then `Kind:
  single_image` — both stayed highlighted simultaneously (`facets-03-content-ivan-two-filters.png`), and
  `applyFilters` (contentFilters.ts:69-78) ANDs every entry in `FilterState`. Clicking the *same* chip again
  clears just that facet (`ContentBits.tsx:98-103`).
- **Does NOT survive a reload.** Set two filters, reloaded the page (full document reload, not hash-only):
  both chips came back unselected (`facets-04-content-ivan-after-reload.png`, confirmed programmatically —
  `document.querySelectorAll('.ct-f.on')` returned `[]` post-reload). This is deliberate, not a bug:
  `ContentList.tsx:663-667` — filter state resets on lane switch too, in-code comment: *"the two lanes spell
  the same ideas differently ('story' vs 'story_opener'), so a carried filter would silently hide rows."*
  `localStorage` keys before/after every filter interaction: only
  `sb-bjbvqvzbzczjbatgmccb-auth-token` — the app writes **no** filter-state key at all, confirming there is
  no persistence mechanism to find.
- **No search field** on the Content route — checked via `input[type="search"], input[placeholder*="earch"
  i]`, none found.
- **"Clear" affordance exists**, but only once ≥1 filter is active: `FilterBar`'s footnote line
  (`ContentBits.tsx:122-135`) prints `"N of M drafts shown"` + a `clear` link when `active.length > 0`, and a
  dedicated `FilteredEmpty` component (`ContentBits.tsx:143-151`) offers a second "Clear the filter" link
  when a filter zeroes the result set out — both call `setState({})`.
- **Active-state styling**: `.ct-f.on` (styles.css:557-558) is `background: var(--accent-soft); color:
  var(--accent)` in the base sheet — an accent-filled chip. `faithful.css:987-988` already overrides this
  to `background: var(--surface3); color: var(--text)` (no accent fill), which is a deliberate step toward
  spine §11.4 ("the active state of a filter is the value text, not a coloured fill... never `--accent` as a
  background") but the anatomy above it — one row of always-rendered option chips per facet — has not been
  touched.

## 5 — Other routes, quick filter-chrome check

Routes enumerated from `JOBS` / `Shell.tsx`'s `workSurface` switch (`Shell.tsx:301-337`): `inbox`, `drafts`,
`sends`, `content`, `ops`, `today`, `settings`.

| Route | Filter chrome | Anatomy |
|---|---|---|
| Inbox | `chips`: `All ·56`, `Ivan`, `Rise`, `Email` | single-select segmented chip row (`InboxScreen.tsx:56-63,139-144`), not the facet-wall pattern — one filter, one row, no counts-per-value wall |
| Drafts | none | no filter chrome at all (`DraftsScreen.tsx`) |
| Sends | `wb-fpill`: **"Range: 7d ⌄"** | **this is the conforming target anatomy already built and shipped** — `SendsScreen.tsx:284-310`, CSS `src/styles.css:711-723` (`wb-fpill`/`wb-fopt`, dropdown-on-click, one pill, label:value grammar, checkmark on the active option). Proof the target pattern is not hypothetical — it exists one screen over. |
| Ops | none | no filter chrome |
| Today | `chips`: `All`, `Ivan`, `Rise` | same single-select segmented-chip pattern as Inbox |
| Settings | n/a | no list |
| **Content** | 18 always-rendered facet groups / 105 chips across 2 stacked walls | the outlier — every other working list either has no filter, or one single-select chip row / one dropdown pill |

## 6 — Conformance to phase2-spine.md §11 (Filter contract)

Contract, `inbox-visual-rebuild-2026-08-02-out/phase2-spine.md` §11:
- §11.1 Overview surfaces → a row of `label: value ⌄` pills, `--r-pill`, 30/32px, `--surface2` fill, no
  border, label `--text3`/400, value `--text`/500, chevron 9px.
- §11.2 Working lists → **one compact inline pill** in the search-field row, 26px, same grammar. "Not a
  second row of chips, not a filter bar."
- §11.3 Same grammar everywhere — zero bespoke filter chrome.
- §11.4 Active state is the value text, never an accent fill.

Content's wall is presently a *third*, bespoke anatomy the contract does not name at all: N always-expanded
option rows with per-value counts, no dropdown, no collapse. `SendsScreen`'s `Range: 7d ⌄` pill is the
existing, already-shipped proof of what §11.2 looks like built.

Per-facet target anatomy recommendation (Stage / Kind / Pillar / Source / QA stay prominent per the run
spec — this section is read-only advice, no code touched):

| Facet | Recommended anatomy | Why |
|---|---|---|
| Stage | Working-list pill (§11.2), kept in the search-row | run-spec-protected; primary triage dimension, low cardinality (5) |
| Kind | Working-list pill | run-spec-protected; low cardinality (4) |
| Pillar | Working-list pill | run-spec-protected; editorial-strategy dimension, low-mid cardinality (5) |
| Source | Working-list pill, but flag for a search-inside-dropdown affordance | run-spec-protected, **highest cardinality of the protected set (19 values)** — a plain dropdown list of 19 is itself a mini version of the same wall; needs either grouping or a type-to-filter box inside the `wb-fmenu` |
| QA verdict | Working-list pill | run-spec-protected; low cardinality (4-6) |
| Structure | Demote into "All filters" | 8 options, secondary to the pillar/pipeline view; taxonomy-derived, changes shape as new styles are added |
| Image style | Demote into "All filters" | 3-7 options depending on lane; overlaps conceptually with Structure (family-keyed pair) |
| Hook | Demote into "All filters" | 10-14 options, and the lane-vocabulary mismatch (`story` vs `story_opener`) means this facet needs a merge/alias layer before it is presentable as a single pill anyway |
| Funnel | Demote into "All filters" | 3 options but a secondary lens on top of pipeline stage, not a triage axis |
| Experiment (arm) | Demote into "All filters" (or drop from the visible set entirely) | 0-2 options, frequently absent per buildFacets' own drop rule; an experiment-tracking facet, not an operator triage one |
| QA score | Demote into "All filters", OR fold into QA verdict as a sub-filter | 4 bands, redundant with QA verdict for most triage decisions |
| Image | Demote into "All filters" | binary yes/no, low information density as a standalone pill |
| Regenerated | Demote into "All filters" | binary, frequently 0-count (dropped) |
| Evidence (backfilled) | Demote into "All filters" | binary, frequently 0-count (dropped); historical/audit fact, not a triage fact |
| Board (Mattan only) | Keep prominent, but reconsider necessity | this is the lane's own *primary grouping* already (BOARD_GROUPS, ContentSections.tsx:517-528) — a facet duplicating the section structure the page already imposes is arguably redundant, not just over-prominent |
| RESOURCE_SPECS (Status/Format/Landing/Resource — the LM-lane's own wall) | Same treatment, its own compact pill row inside the Lead-magnet lane header | it's a structurally identical second wall the owner's screenshot likely didn't even scroll to; needs the same fix, separately, because it is a separate list with its own header (`ct-lane-h`, ContentSections.tsx:413-418) |

An "All filters" panel would collect the 9-10 demoted facets above behind one disclosure control (a `More
filters` pill matching the same §11.2 anatomy), which turns the wall from "18 groups / 105 chips always
rendered" into "5 prominent pills + 1 disclosure pill," matching what Sends already does for a
single-facet case and extending it to a multi-facet one.
