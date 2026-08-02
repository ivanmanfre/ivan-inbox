# Phase 4 — Instruments, candidate `split`

Independent gate instrument + skeptic. Every number below was measured cold, in a fresh worktree
(`exp/vis-split` @ `bf9be2f`, 8 commits over `exp/brain`), against a freshly-minted session
(`scripts/dev-login.mjs`, expiry checked before each run). The builder's own `phase3-split/BUILD.md`,
`verify.txt` and `shots/report.json` were read for orientation only — no number below is copied from
them; each gate re-derives its own evidence with its own script (all left in
`src/exp/v2c/../scripts/gate-*.mjs` in the worktree, or in the scratchpad).

Default posture: REFUTED on thin evidence. Nothing here was thin — see per-gate artifacts.

## Gate table

| gate | verdict | artifact |
|---|---|---|
| G1 tests/lint/build | **PASS** | `npm test` → 378/378 passed, 22 files. `npm run lint` (oxlint) → exit 0, 17 warnings, **none in the 14 touched files** (all in untouched files / foreign `goal-runs/` dirs — checked by name against `git diff --stat`). `npm run build` → `tsc -b && vite build` green, `dist/` produced. |
| G2 no new dependency | **PASS** | `git diff exp/brain -- package.json package-lock.json` → 0 lines. |
| G3 `:root` untouched | **PASS** | `git diff exp/brain -- src/styles.css` → empty. |
| G4 no webfont/serif | **PASS** | `git diff` grep for `@font-face`/`ui-serif`/`serif` → one hit, `sans-serif` as the terminal fallback in the system font stack (`-apple-system,...,sans-serif`) — not a serif addition. |
| G5 no fabricated data | **PASS** | Full cold read of all 14 touched files (not just `sends.ts`). `fetchSendLogTotals()` (`src/lib/sends.ts`) runs two `Prefer: count=exact` head probes with filters identical to the log's own (incl. the `discarded_in_inbox` exclusion) — numerator and denominator can't disagree by construction. `Foot`/legend totals in `OverviewView.tsx` sum already-fetched rows (`laneCount`, `counts.reduce`), never a new literal. Zero hard-coded arrays found. |
| G6 secret sweep | **PASS** | `grep -rlE "service_role|sk-ant|SUPABASE_SERVICE"` on built `dist/` → 0 hits. The one JWT present decodes to `{"role":"anon","ref":"bjbvqvzbzczjbatgmccb"}`, matching `.env.local`'s public `VITE_SUPABASE_ANON_KEY`. |
| G7 console sweep | **PASS** | Own Playwright capture, 6 routes × 2 viewports (today/sends/inbox/drafts/ops/content, 1440+390), fixed-wait logic (domcontentloaded → 0 skeletons → no "Loading the brief" → terminal render), minted session: **0 console errors, 0 pageerrors** across all 12 captures. Re-confirmed on the 6 additional contrast-walk captures and the 4 density-scroll captures. |
| G8 overflow @390 | **PASS** | Same run: `scrollWidth === clientWidth` (docOverflow=false) on all 12 captures and on all mobile density-scroll checks (Ivan/Mattan lanes, 3 scroll bands each). |
| G9 contrast walk | **PASS** (2 non-issues resolved) | Own per-leaf WCAG walk (alpha-composited, ancestor-resolved background), dark theme, ~1,700 leaves across 6 routes: only 2 "failing" classes surfaced — `td-zmark done` checkmark glyph (3.20:1) and `ct-plate-e` empty-thumb glyph (3.26:1). Both are non-text icon glyphs under spine §3.2's 3:1 mark bar, not the 4.5:1 body-text bar, and both clear 3:1. **Zero genuine body-text failures.** |
| G10 both colour answers | **PASS** | Own in-page toggle on `#exp/v2c/sends`: `--cat-1..4` = `#10A37F #DBDFDD #A1A6A4 #747977` (mono) / `#10A37F #3A93D0 #D099E8 #747977` (triad) — exact spine §9 hexes, both directions. Rect-hash over 413 elements identical before/after/back → **0 layout shift**. |
| G11 light patches visited | **PASS** | `git diff exp/brain -- src/exp/v2c/styles.css` is empty (lines 58/127 untouched there), but `split.css` carries higher-specificity overrides (`:root[data-theme='light'] .app.wb .wb-rail` / `.wb-pane-h`, specificity 0,5,0 vs v2c's 0,3,0). Confirmed live: rendered light-theme `.wb-rail`/`.wb-pane-h` both compute `background-color: rgb(242,244,243)` = `--surface1`, not v2c's translucent `rgba(249,249,249,.94)`. |
| G12 spine censuses | **PASS** | Own census, same 12 captures: type sizes ≤7/screen (bar ≤9), 0 fractional. Weight: ≤1 element ≥700/screen, always the 34px/56px display title (never <28px). Tabular-nums: 0 violations. Accent: max 28 @1440 (Sends), bar ≤30. Pill licence: all **176 distinct pill-radius element classes** (unfiltered — I classified every one myself, not the builder's regex) map onto §6.3's 7 licensed categories (avatars, nav/switcher segments, filter pills, nav count badges, legend/severity dots, capsule chart bars/gauges) — 0 rows/cards/inputs/status-chips at 999px. Anchor rail: x-variance 0px on Content (19 rows default, 167 with all sections expanded) and Inbox (13–16 rows), both widths. |
| G13 default-app regression | **PASS** | Own DOM-tree diff, fresh context per route per origin, worktree (5443) vs base = main checkout on `exp/brain` (5451): `#inbox` byte-identical (11,942 nodes, tree string equal). `#today`: identical node count (200=200), 6 differing lines are all `td-cat-*` marker classes **added** to existing spans. `#sends`: identical node count (327=327), 31 differing lines are all `sev-ok`/`ov-cat-*`/`ov-catcard-*` marker classes **added** to existing elements. Zero elements added, removed, or reordered anywhere. Confirms "shared-screen edits are additive-only." (An earlier same-page-reused-across-hashes run produced noisy false diffs from live-data drift and stale hash-routing state; the fresh-context-per-route rerun above is the one that stands.) |

**No DQ triggered. No unresolved fail-class item.**

## Skeptic findings

**Fabrication skeptic.** Full diff read, all 14 touched files, cold (not the builder's own denominator
claims). `fetchSendLogTotals` (`src/lib/sends.ts:136-159`) — two `count:'exact', head:true` PostgREST
probes, filters mirrored from the log's own query including the `discarded_in_inbox` exclusion, so
numerator/denominator can't structurally disagree. `Foot` component totals (`OverviewView.tsx`) are sums
of already-rendered rows, not new literals. No hard-coded series found anywhere in the diff. Verdict:
claim of honesty holds.

**Capture skeptic.** Spot-checked 5 of the builder's 25 shots: `content-desktop.png` (432KB, dense ideas
list w/ score-in-anchor, matches claimed 26,500 innerText), `today-desktop.png` (359KB, 56px display
title + masthead), `inbox-desktop.png` (427KB, real threads incl. a phishing-blocked one), and the
mono/triad pair (`cat-mono-sends-desktop.png` 310,803B / `cat-triad-sends-desktop.png` 308,686B) — visually
identical layout, only the DMs sparkline colour differs (hatch-green → solid blue), matching the claimed
"0 geometry changes" toggle. None are skeleton crops; all read as real, loaded, non-fabricated captures.

**Density skeptic.** Full-scroll Content, both lanes, both viewports, own script.
- Ivan lane: 19 rows rendered by default (only "Needs review" open); with Ideas/Published/Archived
  also expanded, **167 rows** in DOM. Anchor-rail x-variance held at **0px** across 3 scroll bands
  at 1440 and at 390.
- Mattan lane: 70 rows, variance 0px at both widths, all 3 bands.
- Sticky-header stress test: scrolled 150/800/1600px **inside** the 109-row Published section's own
  6,138px row range — its `06 Published 43/109` header stayed pinned at a constant `top` (133px,
  identical across all three offsets), opaque background, confirming §7.5's "position:sticky" holds
  under real density, not just at 8 rows. Nothing collapsed; no overflow at 390 at any scroll position.

**Brand skeptic.** No serif faces, no `@font-face` (see G4). Ladder hexes match the spine's published
table exactly (no re-derivation attempted, none needed). Rogue-hue census: 0 on all 12 captures — the
app's formerly-undeclared iOS blue (`#0A84FF` on Today's "going out" segment) is gone, replaced by
`--cat-3`. Pill-licence: 0 violations (see G12, full manual classification of all 176 pill-radius classes).

**Regression skeptic (G13 owner).** See G13 row. Additionally: `git diff exp/brain --stat` touches
exactly 14 files, all under `src/screens/`, `src/exp/v2c/`, `src/lib/`, `scripts/` — no personal-site,
n8n, or sibling-candidate-worktree files touched. Branch is 8 commits ahead of `exp/brain`, working tree
clean, no `git add -A` residue, no push to `main` attempted.

**Seam observation (for judges, not a gate).** Today (`wb-ov`, expressive) and Content (`wb-wl`,
monastic) do share the visible spine, verified in source and render, not just asserted in prose:
1. **Type scale** — both censused at ≤7 distinct computed sizes, same 7-token set.
2. **Header face** — Content's `SectionHead`/`.wb-sech` and Today's own `ZoneHead`/`.td-zh` are
   *different components* but `split.css` groups their selectors under shared rules
   (`.wb-sech-t,.td-zt,.ov-h,.grouphdr{...}`, `.wb-sech,.td-zh{...}` etc.) so they render one visual
   object (index · label · rule · count · severity mark) from two class namespaces.
3. **Radius family** — both draw from the same `--r-chip/--r-ctl/--r-card` tokens (confirmed via the
   G12 pill-licence classification, which found no surface-specific radius set).
4. **Filter grammar** — `SelectPill` is imported directly from `ContentBits.tsx` into `SendsScreen.tsx`;
   it's the same component and the same `.wb-fpill` class in both places, not a lookalike.

This is a real shared-spine finding: the two classes read as one system under inspection, not two apps
wearing the same ladder. Whether that's *felt* as one app is a judge call (seat 4), not a gate.

## Final line

**SURVIVES.** All 13 gates PASS on independently-reproduced evidence; no DQ; the two apparent contrast
"failures" resolve to icon-glyph marks that clear the correct (3:1) bar; the one alarming regression
signal (`#sends` showing an empty default-app render) traced to a capture-timing artifact in my first
regression script, not a code defect — the properly-waited rerun shows additive-only parity.

Servers killed (ports 5443, 5451) at end of run. Worktree left in place at
`/private/tmp/claude-501/.../scratchpad/wt-split` on `exp/vis-split`, working tree clean.

## Fix loop (row-find)

Blind row-find judge FAILED Content at both widths. Closed on `exp/vis-split` @ `9d7441e`
(9th commit over `exp/brain`), fresh session minted (`scripts/dev-login.mjs`; the prior
`.session.json` had expired at 14:49Z), served on 5443, killed at end of run.

**Findings → changes.** Nothing below adds a hue, a chrome element or a chip style. Chips stay
6px grey; the DOT carries the signal.

| finding | change | file:line |
|---|---|---|
| "no row carries a colour/shape status mark" — round 1 spent status as a **3px inset spine** on the plate's left edge; measured it was there and correctly tinted, seen it was nothing (a 3px sliver under a 28px thumb, flush against the group boundary) | status is now a **9px corner dot** overhanging the plate's bottom-right with a 2px ring of the row surface, so it reads on a photo plate and a glyph plate alike, at one x on every row of every family. Four values, all existing tokens (`--sev-urgent` / `--sev-attention` / `--sev-clear` / `--hairline-strong`); ring follows hover/selection so the dot never sits in a hole of the wrong grey | `src/exp/v2c/split.css:1140-1152` |
| "thumbnails appear on only some rows so the rail is partial" — measured **7/11 rows per band with NO anchor at all** | one shared `<Anchor>` primitive: thumb plate, or the same-size glyph plate, **never an empty slot** | `src/exp/v2c/Surface.tsx:125`; drafts `ContentList.tsx:118`; ideas `ContentSections.tsx:79`; resources `ContentSections.tsx:314` |
| Ideas: score slot rendered only when `composite_score !== null`, so an unscored idea collapsed the 44px slot | slot always drawn, at `--anchor-w` like every other family; plate carries the score to the nearest point, the **exact** score stays on the row as chip #1 (nothing is rounded away — it is rendered twice at two densities) | `ContentSections.tsx:79-90`; `split.css:1127`, `:1364` |
| "the score-number anchor encodes nothing" | the score plate now carries the same corner dot as every other anchor | `split.css:1140` |
| Resources: 121 floating cards, optional cover ⇒ two left margins; wrapping meta ⇒ **92px @1440, 116px @390** vs §7.8's 40-60 / ≤72; §7.3 inverted on the densest list on the surface | rebuilt as the pipeline's own ruled row — one `wb-group` boundary, anchor + one truncated primary + one nowrap meta line, links pinned ahead of the free text so they can never be what gets clipped | `ContentSections.tsx:305-330`; `split.css:1543-1584` |
| "at 390 deep-lane rows become pure stacked text" | same row anatomy at 390; `.ct-trail` stays on one row and `format` (also a filter facet) drops | `split.css:1579-1583` |
| §5.5 — severity per RUN, not per row | `runMixed` / `runSev`, one place, out of the caller's hands: a run at ONE state takes the neutral rule and the **header that counts them** carries the mark; a MIXED run is where the per-row dot earns its place | `src/exp/v2c/anchor.ts:1-25`; drafts `ContentList.tsx:239`, `:293`; resources `ContentSections.tsx:270-281` |

**The judgment call, in the data.** 60 Ideas rows are all at `reviewing` — one state, so all
neutral. 19 drafts split 12 clear / 7 neutral. Resources is genuinely mixed — **80 neutral · 7
live · 34 at a terminal status with no `landing_url`** — so dots are spent there *and* the header
reads `RESOURCES 34 / 121 ●urgent`. That is the difference between finding a row and painting 121
identical dots. `resourceState` scores only what the row proves (`isStuckResource`, and a live
`landing_url`); no other status in `lm_drafts_v2` is graded, because the watcher that owns the
table is not readable from this app.

**Numbers (own script, `scripts/rowfind-split.mjs` + `scripts/rowfind-census.mjs`, fresh session, dark, 4 captures × 3 bands).**

| measure | before | after |
|---|---|---|
| empty anchor slots, per band | 7 / 11 / 11 @1440 · 4 / 8 / 9 @390 | **0 everywhere** |
| anchor-rail x-variance | n/a (no rail) | **0px**, both widths, every band (`railXs` single-valued: 233 @1440, 33 @390) |
| row content-box height @1440 | 54–92 | **54–58** (band 40–60) |
| row content-box height @390 | 54–**116** | **54–62** (band ≤72) |
| rows carrying a non-neutral mark, Mattan top @1440 | 0 visible | 4 clear · 1 attention · 2 neutral |
| mixed Resources band @1440 | — | 17 rows, 10 neutral / 1 clear / **6 urgent**, variance 0px, all 56px |
| console errors · pageerrors · `docOverflow` | — | **0 · 0 · false** on all captures |
| §5.6 accent census, Content @1440 (ceiling 30) | 11 | **6** |
| §6.4 elements ≥100px radius | — | 17 classes, **all on §6.3's licence** (the dot is a pseudo-element severity dot, §6.3.6) |
| `npm test` · `npm run build` · `npm run lint` | — | **378/378** · green · 0 new warnings in touched files (the one `Surface.tsx` fast-refresh warning is pre-existing `relAge`; `runMixed`/`runSev` were moved to `anchor.ts` rather than add two more) |

Captures: `scratchpad/rowfind-before/` and `scratchpad/rowfind-after/` — `1440-Ivan-b0/b045/b09`,
`390-Ivan-b0/b045/b09`, `1440-mattan-top-Mattan-b0`, `390-mattan-top-Mattan-b0`,
`1440-Ivan-resources-mixed`.

Server killed (5443). Worktree clean on `exp/vis-split`; the six foreign `gate-*-split.mjs`
scripts from the instrument run were left untracked (no `git add -A`).
