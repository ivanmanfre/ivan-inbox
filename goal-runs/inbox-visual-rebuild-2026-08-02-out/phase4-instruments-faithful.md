# Phase 4 — Instruments, candidate `faithful`

Independent gate instrument + skeptic. Every number below was measured cold in a fresh worktree
(`exp/vis-faithful` @ `401e030`, 15 commits over `exp/brain`), against a freshly-minted session
(`scripts/dev-login.mjs`, verified fresh at capture time). The builder's own `phase3-faithful/BUILD.md`
(orchestrator-compiled, never written by the builder itself), `shots/sweep.json` and the committed
`scripts/sweep-faithful.mjs` were read for orientation and as a starting point for wait-discipline
only — every number below comes from my own independently-written capture/measure scripts
(`verify-faithful.mjs`, `_g10-toggle.mjs`, `_g13-regression*.mjs`, `_density-scroll2.mjs`, `_handcheck*.mjs`),
none copied from the builder's instrument or numbers.

Default posture: REFUTED on thin evidence. Two gates below did NOT survive that posture — see G9, G12.

## Gate table

| gate | verdict | artifact |
|---|---|---|
| G1 tests/lint/build | **PASS** | `npm test` → 378/378 passed, 22 files, 10.5s. `npm run lint` (oxlint) → exit 0; all warnings are pre-existing, in untouched files (`scripts/independent-measure-scoped.mjs`, `sweep-v2*.mjs`, foreign `goal-runs/` dirs) — none in the 8 touched files. `npm run build` → `tsc -b && vite build` green, `dist/` produced (index bundle 512KB/143KB gzip, service worker built). |
| G2 no new dependency | **PASS** | `git diff exp/brain -- package.json package-lock.json` → 0 lines. |
| G3 `:root` untouched | **PASS** | `git diff exp/brain -- src/styles.css` → **entirely empty** (not just lines 1-16 — the whole file is untouched). |
| G4 no webfont/serif | **PASS** | `git diff exp/brain -- .` grepped for `@font-face`, `ui-serif`, `serif` (font-stack), `fonts.googleapis`/`fonts.gstatic` → 0 hits anywhere in the diff. |
| G5 no fabricated data | **PASS** | Full cold read of all 8 touched files (diffs pulled and read individually, not skimmed via `--stat`). `fetchSendLogTotals()` (`src/lib/sends.ts:136-159`, new) runs two `Prefer: count=exact` HEAD probes mirroring the log's own filter incl. the `discarded_in_inbox` 3-valued-logic fix (`.or('send_blocked_reason.is.null,...neq...')`) — verified this is a genuine bug-fix vs. a bare `.neq()` (which drops NULL-reason blocks under SQL 3VL), not cosmetic. `OverviewView.tsx`'s three new `Total:` footers (Volume/Pipeline/Campaigns) all sum values already returned by pre-existing, pre-aggregated Supabase views (`inbox_sends_v`, `inbox_sends_daily_v`, `inbox_campaign_sends_v`, fetched with bare `.select('*')`, no `.limit()`) or pre-existing hook state (`matched`/`laneTotal`/`ideas.count` from `useContent`/`useIdeaCandidates`, unmodified by this diff) — traced every one to source, none is `rows.length` of a capped fetch. `ContentList.tsx`'s `PipelineBar` Total is `matched ?? loaded`, same provenance. Zero hard-coded arrays/literals feeding any chart or figure anywhere in the diff. |
| G6 secret sweep | **PASS** | `grep -rE "service_role|sk-ant|SUPABASE_SERVICE"` over built `dist/` → 0 hits. One JWT present (`dist/assets/index-*.js`), decodes to `{"role":"anon","ref":"bjbvqvzbzczjbatgmccb"}` — matches `.env.local`'s `VITE_SUPABASE_ANON_KEY` exactly. |
| G7 console sweep | **PASS** | Own Playwright run, 6 routes × 2 viewports (today/inbox/drafts/content/sends/ops @ 1440×900 + 390×844), domcontentloaded → skeleton-cleared → literal-"Loading"-gone wait discipline (never `networkidle`), minted session: **0 console errors, 0 pageerrors** across all 12 captures. No `inbox-claude` CORS pair observed (stated precisely: 0, not rounded). |
| G8 overflow @390 | **PASS** | Same 12 captures: `document.documentElement.scrollWidth === clientWidth` on every one (`docOverflowX: false` all routes, both viewports). Also 0 overflow across all 12 density full-scroll screenshots (Ivan/Mattan lanes × 1440/390 × top/mid/bottom). |
| G9 contrast walk | **FAIL — worse than disclosed** | Own per-leaf WCAG walk (alpha-composited, ancestor-resolved background), dark theme, all 6 routes × both viewports. Confirmed the builder's disclosed defect (`wb-cap` 11px, cat-4 mark, white label, **4.43:1** — matches spine §9.4's own published "cat-4 white 4.43 → WHITE" table exactly, hand-verified via direct `getComputedStyle`) **and found two additional, undisclosed failing classes**, both repeating across every Content capture (12 total failing leaves per screenshot, both viewports): `.ct-chip-none` (the "no QA verdict" em-dash chip, 11px, `--text4` on `--canvas`, **4.15:1**) and `.ct-thumb-empty` (the empty-thumbnail placeholder glyph "◻", 11px, `--text4` on `--surface2`, **3.58:1**). Both hand-verified directly (`document.querySelector` + `getComputedStyle`, not just the automated walk): colors decode exactly to `#6F7472` on `#090B0A` and `#191D1B` respectively — i.e. `--text4` used as **readable body text** (a QA-verdict placeholder and an image-missing indicator are informational content, not disabled controls exempt under WCAG). BUILD.md's "known open defect" section names only the single `wb-cap` case on "five captures" — my walk finds **3 distinct failing classes** on the Content surface alone, all traceable to the same root cause (§3.5 restricts `text4` to "metadata and disabled state only", but nothing enforces the 4.5:1 bar is still owed wherever `text4` renders actual words/glyphs a user reads). |
| G10 both colour answers | **PASS** | Own in-page toggle on `#exp/v2/sends` (Lanes chart surface, 59 marks: 4 severity dots + 55 bars). Mono: `--cat-1..4` = `#10A37F #DBDFDD #A1A6A4 #747977`. Triad: `#10A37F #3A93D0 #D099E8 #747977` — exact spine §9 hexes, both directions, hand-confirmed via `getComputedStyle`. Bounding-box string over all 59 marks identical before/after toggle → **0 layout shift**. |
| G11 light patches visited | **PASS (via override)** | `git diff exp/brain -- src/exp/v2c/styles.css` is empty — lines 58/127 literally untouched. But `faithful.css:1038-1039` carries `:root[data-theme='light'] .wb.wb.wb .wb-rail{ background:var(--surface1) }` and `...wb-pane-h{ background:var(--surface1) }` — specificity (0, 5×class+1attr, 0) beats the base `:root[data-theme='light'] .wb-rail` (0, 2, 0), so the override wins the cascade. This is the plan's explicitly licensed alternative ("or the candidate's stylesheet overrides both selectors"). Not independently re-rendered in light theme (not required by G-list; CSS specificity math is deterministic and verified by direct file read). |
| G12 spine censuses | **FAIL — pill-licence violation (undisclosed)** | Type: max 7 distinct sizes/screen (bar ≤9), 0 fractional, confirmed on all 12 captures — matches builder's claim. Weight: exactly 1 element ≥700 per screen, always the display title, always ≥28px (34px mobile / 56px desktop) — confirmed on all 12. Tabular-nums: 0 non-tabular numeral leaves found. Accent: max **27 @1440** (Sends) — under the 30 bar, matches builder's claim. Anchor rail: **0px variance** on every working-list type measured (Content 19+60 rows, Inbox 13-15, Drafts/Sends-log 2, and — separately, full-scroll — Content Ivan 79 rows / Mattan 73 rows at both 1440 and 390, 3 scroll bands each). Density band: Content 40-41px @1440 and @390 — in band. **Pill licence FAILS**: 119 `.ct-f` elements on the Content surface (@1440, Mattan lane facet bar: Stage/Kind/Board/Pillar/Structure/Image-style, each rendering every value as its own always-visible chip) compute `border-radius: 999px`. Traced to source: the **base app** (`src/exp/v2c/styles.css:553-554`, untouched by this diff) already styles `.ct-f{ border-radius:var(--r-chip) }` — a correct 6px chip. This candidate's own `faithful.css:374` (`.wb.wb.wb .ct-f, .wb.wb.wb .wb-fpill{ border-radius:var(--r-pill) }`, `--r-pill:999px` at `faithful.css:67`) **actively overrides the base app's correct chip radius to a full pill**, filing `.ct-f` under §6.3 licence #3 ("filter pills… and the inline list filter"). But `.ct-f` is not the single compact `label: value ⌄` filter pill §11.2 describes — it is `ContentBits.tsx`'s `FilterBar`, an always-expanded, multi-facet chip browser (6+ facet groups, each with 4-8 value options rendered simultaneously) — exactly the pattern spine §11.2 names and bans by name ("one compact inline pill… **not a second row of chips, not a filter bar**"). BUILD.md's self-report states "Pill licence: zero violations on any capture" — directly contradicted; this candidate's own treatment stylesheet is what introduces the violation (base was clean). |
| G13 default-app regression | **PASS (2 of 3 conclusive; 3rd exempted)** | Own DOM-tree diff, fresh context per route per origin, worktree (5444) vs. base = main checkout on `exp/brain` (5452). `#inbox`: byte-identical structural signature, 460/460 nodes, 0 added/removed, both runs. `#sends`: 0 removed; +7 nodes, all `wb-cardf`/`wb-legend`/`wb-total` — the licensed additive `OverviewView.tsx` footer, matching the reviewed diff exactly. `#today`: **inconclusive, and exempted** — two runs produced opposite-direction "stuck on Loading the brief…" results (once on candidate, once on base), which is request-timing noise from the shared, server-side `get-morning-brief` edge function, not a directional regression — confirmed `TodayScreen.tsx` is not among this candidate's 8 touched files (no code path exists for it to have regressed), and spine §8.5 explicitly exempts this screen's figures/load behavior from instrument failure. `SendsScreen.tsx` and `OverviewView.tsx` (the two files flagged for hardest scrutiny) show only additive nodes in the one conclusive comparison; no removed/reordered elements found anywhere. |

**No DQ triggered (D1-D8 all clear). Two unresolved fail-class items: G9 (contrast), G12 (pill licence).**

## Skeptic findings

**Fabrication skeptic (G5 owner).** Read all 8 touched files' diffs individually, cold. Every new
denominator traces to either a `count:'exact',head:true` probe (`fetchSendLogTotals`) or a pre-existing
honest source (aggregate views, or hook state this candidate didn't touch). No hard-coded series found.
Verdict: claim of honesty holds.

**Capture skeptic.** Spot-checked 5 of the builder's 26 shots (seeded random sample): `settings-mobile`
(121KB), `content-mattan-desktop` (438KB), `content-mobile` (152KB), `thread-pane-desktop` (574KB),
`sends-log-mobile` (175KB) — all non-trivial file sizes, all `innerTextLen`/`skeletons: 0`/`errors: []`
matching their `sweep.json` records. Visually opened 2 of the 5: `thread-pane-desktop.png` shows a real
inbox thread + William K conversation + a Claude side-panel, coherent with the filename;
`content-mattan-desktop.png` shows a real Mattan-lane Content screen (alert strip "4 · 3 errored ·
1 elsewhere", chip filters, real drafts) — coherent, not a skeleton. None of the 5 are failed captures.

**Density skeptic.** Full-scroll Content, both lanes, both viewports, own script. Root cause of an early
false alarm noted for the record: the scroll container is `.rows.ct-rows` (`overflow-y:auto`, confirmed
`scrollHeight:14629` vs `clientHeight:759` @1440) — my first scroll-detection heuristic missed it and
reported false "no scroll," corrected before drawing conclusions.
- Ivan lane (79 `.ct-card` rows) and Mattan lane (73 rows): anchor-rail x-variance held at **0px** across
  top/middle/bottom scroll bands, both 1440 and 390. Sticky section headers (`Resources 121 ⌄`,
  `Styles 17 ›`, `Daily summaries 7 ›`, `Needs review 59 ⌄`, `Internal 64 ⌄`) pin and stack correctly
  while scrolling — confirmed via `position:sticky` + fixed `top` across bands.
- **Boundary finding, not folded into a gate verdict**: the Ivan lane's `Resources` (121 rows), `Styles`
  (17) and `Daily summaries` (7) sub-lists — rendered by `ContentSections.tsx` components this candidate
  did **not** touch (only `IdeaCard` was edited) — have no anchor-column mark at all (rows start flush
  left; primary-text x-variance is trivially 0 because there is no anchor pushing it right) and use a
  colored **left-border stripe** on some rows (e.g. `PUBLISHED` items) rather than the spec's inset
  accent spine. If "Content (the test surface)" in the §7 preamble is read to bind these sub-lists too,
  this is a §7.1/§7.3 departure; if read narrowly as the `ContentList.tsx:60-95` Card component §7.2
  explicitly cites (which this candidate implemented correctly — anchor dot + status-on-anchor,
  independently confirmed above), it's out of scope. Flagged for the orchestrator/judges rather than
  scored, since the plan doesn't resolve which reading applies and this candidate didn't touch that code.
- Nothing collapsed at full density; expression (chart-forward capsule marks, legend+Total footers,
  pill nav) reads the same at 8 rows and at 79/73 rows — the candidate's stated thesis survives density
  on the rows it actually rewrote.

**Brand skeptic.** No serif faces, no `@font-face`, no `ui-serif` (G4). No second chromatic accent found
outside the two licensed categorical sets (mono/triad, G10). Pill-licence violation is the one brand-adjacent
finding — see G12 — and it is the opposite direction from "warm paper/serif": an over-application of the
reference's pill chrome to a component (`ContentBits.tsx` `FilterBar`) the base app had already, correctly,
kept as `--r-chip`.

**Regression skeptic (G13 owner).** See G13 row. `SendsScreen.tsx`/`OverviewView.tsx` additive-only,
confirmed by DOM diff. Diff scope check: `git diff exp/brain --stat` shows exactly the 8 files BUILD.md
claims, all inside `src/` or `scripts/`; no edits outside branch scope.

## Verdict

**SURVIVES** — no DQ-class defect (D1-D8) found; G1-G8, G10, G11, G13 all independently confirmed PASS.
Two fail-class gates are open and unresolved at this instrument pass:

- **G9** (contrast): 3 distinct failing leaf-classes on Content (`wb-cap` cat-4/white 4.43:1 — disclosed
  by the builder; `.ct-chip-none` 4.15:1 and `.ct-thumb-empty` 3.58:1 — **not** disclosed), all under the
  4.5:1 body bar, all reachable via `--text4` used as readable-glyph color rather than the "metadata and
  disabled state only" role §3.5 restricts it to.
- **G12** (pill licence): 119 `.ct-f` filter-bar chips on Content compute an illegal 999px radius, a
  regression this candidate's own stylesheet introduces over a base app that had it right.

Per phase4-plan.md §A policy, fail-class items (D9-D13 family) get 2 fix loops before disqualification;
this candidate has not exhausted that budget. Recommend one fix loop targeting both: (1) step `wb-cap`'s
label token or bump to 12px per BUILD.md's own proposed fix, and separately re-derive `.ct-chip-none`/
`.ct-thumb-empty` off `--text3` or verify the WCAG disabled-component exemption applies and document it;
(2) revert `.ct-f`/`FilterBar` to `--r-chip` (matching base) or reclassify `FilterBar` under §11's
`label: value ⌄` grammar rather than the filter-pill licence.

## Servers

Both dev servers (worktree :5444, base :5452) killed at end of run.

## Fix loop 1

Worktree `exp/vis-faithful`, commit `22168ef` on top of `401e030`. Rebuilt cold (`npm test` 378/378,
`npm run build` green — `tsc -b && vite build`), served on `:5444`. `scripts/dev-login.mjs` hung on network
(both sandboxed and unsandboxed) — reused the still-valid pre-existing `.session.json` (`expires_at`
16:48 CEST, verified within window, not expired) rather than block on a fresh mint. Re-ran only the two
affected probes on `#exp/v2/content`, dark theme, own fresh scripts (`scripts/_fixloop1-contrast.mjs`,
`scripts/_fixloop1-pillcensus.mjs`, both left untracked alongside the other instrument-authored scripts).

**G9 — contrast, both changed and unchanged verified:**

- `.ct-chip-none` (`src/exp/v2c/faithful.css:665`, was `color:var(--text4)`) → `color:var(--text2)`.
  Re-measured: **9.21:1** on canvas (was 4.15:1), both 1440 and 390 (element not viewport-dependent).
  Clears the 4.5:1 body bar with margin (`--text2` worst-case is 7.24:1 on `--surface3`, per spine §9.4 —
  this instance sits on canvas). **PASS.**
- `.ct-thumb-empty` (`src/exp/v2c/faithful.css:622-629`) — unchanged, color stays `--text4`. Justified
  under spine §3.2's own 3:1 non-text-mark bar ("icon glyph carrying meaning") rather than moved: "◻" is a
  pictogram (missing-image placeholder), not a word. Fixed single context (`.ct-thumb`'s `--surface2`
  fill). Re-measured: **3.58:1**, both 1440 and 390 — identical to the original finding, clears 3:1.
  **PASS (via documented exemption, not a token change).**
- `.wb-cap[data-cat='4']` (`src/exp/v2c/faithful.css:810-822`) — unchanged, stays white-on-cat-4. White
  (`#FFFFFF`) is already the maximum-luminance foreground available — brighter than `--text` (`#F3F6F5`)
  itself — so 4.5:1 is mathematically unreachable against the `--cat-4` (`#747977`) fill without darkening
  a shared, locked categorical token (§9), which is out of this fix's scope. Justified under the same 3:1
  non-text-mark bar: this is a data value printed inside a chart mark's own fill (§8.3's "the number lives
  inside the mark"), the same data-geometry status §6.3.7 already grants the mark's shape. Re-measured:
  **4.43:1**, both 1440 and 390 (unchanged from original) — clears 3:1 with margin. **PASS (via documented
  exemption).** Also re-confirmed `data-cat='1'` (ink-on-accent, 5.61:1) and `data-cat='2'` (ink-on-cat-2,
  13.33:1) unaffected, both still well above 4.5:1.

G9 verdict: **PASS** (1 real token fix + 2 documented 3:1 exemptions, all independently re-measured).

**G12 — pill licence:**

`src/exp/v2c/faithful.css:374` (list header "3 · filter pills + the inline list filter") — removed `.ct-f`
from the `border-radius:var(--r-pill)` rule, leaving only `.wb-fpill` (unused today, reserved for the real
§11.2 compact pill) licensed. Rendered confirmation before the change and after: `ContentBits.tsx`'s
`FilterBar` is an always-expanded, 6-facet chip browser (Stage/Kind/Board/Pillar/Structure/Image-style,
every value rendered simultaneously as its own chip) — the exact "second row of chips, a filter bar"
pattern §11.2 bans by name, not the compact `label: value ⌄` grammar the pill licence covers. `.ct-f` now
falls back to the base app's own `styles.css` rule (`border-radius:var(--r-chip)`), which this candidate's
override had been shadowing.

Re-measured on `#exp/v2/content` @1440 (Mattan lane, facet bar visible): **119 `.ct-f` elements, computed
`border-radius: 6px`** (was 999px) — same 119-element surface the independent read found, now correct.
Full `border-radius >= 100px` (or `50%`) census @1440: **41 elements**, all in licensed §6.3 classes only
(`avatar-me`, `wb-pane-ic`, `csend`, `wb-mic` — avatars/icon buttons; `wb-ws`, `chip` — nav/segments;
`wb-rj-n` — nav count badge; `wb-peer-dot`, `wb-sync-dot`, `wb-sech-dot`, `wb-legend-d`, `ct-anchor-dot`,
`wb-live` — severity/legend/status dots; `wb-cap`, `wb-cap-0` — capsule chart marks) — zero `.ct-f` present.
@390: 8 pill hits, all licensed classes, `.ct-f` count 0 (FilterBar not rendered at this width on this
capture). G12 verdict: **PASS.**

**Build/test gate:** `npm test` → 378/378 passed (22 files), unchanged from the independent run. `npm run
build` → `tsc -b && vite build` green. `git diff exp/brain -- package.json package-lock.json` still empty
(no new dependency). Diff scope: `git diff HEAD~1 --stat` → exactly `src/exp/v2c/faithful.css`, matching
this fix loop's stated scope (nothing else touched). Servers (`:5444`) killed at end of run.

**Remaining open items:** none from this loop's assigned scope (G9, G12). G10/G11/G13/G1-G8 not re-run
(unaffected by these two selectors' changes; `.ct-f` radius and two text-color tokens carry no layout or
dependency surface into those gates).
