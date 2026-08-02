# Phase 4 — Instruments, candidate `spine`

Goal-run `inbox-visual-rebuild-2026-08-02`. Independent gate + skeptic pass. A prior instrument
attempt on this candidate died to API errors before writing anything; this run starts clean and
trusts nothing the builder reported — every number below was measured by this agent, live, in a
fresh Playwright session, against the worktree at `exp/vis-spine` @ `05e898f` (13 commits over
`exp/brain`), dev server on port **5442**. Regression comparisons ran against the MAIN checkout on
`exp/brain`, port **5450**. Builder evidence at `phase3-spine/BUILD.md` + `shots/` + `shots/sweep.json`
and `scripts/sweep-spine.mjs` was read and audited, never executed or trusted at face value. The
untracked `crops/` dir in the worktree is the dead first builder's leftovers and was ignored.

**Verdict: SURVIVES**, with one real, independently-reproduced defect recorded against G12 (see
below) that is a **fail**, not a DQ — none of the D1-D13 disqualifying conditions are present.

---

## Gate table

| gate | verdict | artifact |
|---|---|---|
| G1 — test/lint/build | **PASS** | `npm test`: 378/378 passed, 22 files, exit 0. `npm run lint`: exit 0, 0 errors, 17 pre-existing warnings (all outside the diff, e.g. `scripts/sweep-v2.mjs:39`, `src/components/ContextSheet.tsx:43`). `npm run build`: exit 0, clean, `dist/` produced incl. service worker. |
| G2 — no new dependency | **PASS** | `git diff exp/brain -- package.json package-lock.json` → 0 lines. |
| G3 — `:root` untouched | **PASS** | `git diff exp/brain -- src/styles.css` → 0 lines (whole file, not just 1-16). |
| G4 — no webfont/serif | **PASS** | Full diff grepped for `@font-face`, `ui-serif`, bare `serif`, font URLs. One hit: `src/exp/v2c/spine.css:1145` `.wb body{ font-family:...,sans-serif }` — a standard generic-family fallback, not a serif face. No other matches. |
| G5 — no fabricated data | **PASS** | Full diff read cold. `src/lib/sends.ts` adds `fetchSendLogCounts()` using two `count:'exact', head:true` probes (never `rows.length`); the Log's numerator is `items.filter(kind==='sent').length` (the actually-fetched, rendered window) against that real probe denominator. `ContentList.tsx`'s `STAGE_CAT` is an index (1-6) resolved by CSS to `--cat-N`/pattern, not a hardcoded colour series — replaces the old `STAGE_COLOR` hex map. `matched`/`ideas.count` are pre-existing hook outputs (`src/hooks/useContent.ts` / `src/lib/content.ts`, both untouched by this diff, both already `count:'exact'`-backed). No new hardcoded arrays feed any chart. |
| G6 — secret sweep | **PASS** | `grep -rniE "service_role|sk-ant|SUPABASE_SERVICE" dist/` → 0 hits. One JWT found in `dist/assets/index-*.js`; decoded payload = `{iss:supabase, ref:bjbvqvzbzczjbatgmccb, role:"anon", ...}`, byte-identical to `.env.local`'s `VITE_SUPABASE_ANON_KEY`. No `sbp_` tokens. |
| G7 — console sweep | **PASS** | Own Playwright capture, 6 routes (`today/inbox/drafts/content/sends/ops`) × 2 viewports (1440×900, 390×844), minted session via `dev-login.mjs`. **0 console errors, 0 page errors** across all 12 captures. |
| G8 — overflow @390 | **PASS** | Same 12-capture run: `scrollWidth === clientWidth === 390` on all 6 mobile captures (`overflow:false` on every route). |
| G9 — contrast walk | **PASS** | Own alpha-composited WCAG probe (not the builder's). Live-read tokens on `.wb`: `--text4:#6F7472` (the §4-corrected value, not the buggy `#606562`) — ladder is byte-identical to spine §3.1/§9.4's pre-verified harness table, confirming that table is valid evidence for this candidate. Per-leaf walk on Content (23 leaves in viewport) and Today (85 leaves): **2 sub-4.5 leaves found on each route, both `.wb-rail-grp-l`/`.wb-rail-hint` (text4 on surface1, 3.87:1)** — both are label/hint metadata, not body copy, which §3.5 explicitly carves out ("text4 is metadata and disabled state only, everywhere"); matches the harness's published text4-vs-surface1 value exactly. 3-leaf hand-verification sample computed independently, all ≥4.5 (4.88-7.24). Focus ring: `.wb :focus-visible{ outline:2px solid var(--accent); outline-offset:1px }` confirmed by source — 2px solid, no alpha, i.e. 100% by construction. Note: found **zero** native-focusable elements (`button/select/a[href]/input/[tabindex]`) on the Content screen in either lane — the app-wide onClick-div pattern predates this candidate (`Rail.tsx` is not in its diff), so the ring's CSS is correct but not empirically triggerable; flagged as a pre-existing condition, not scored against `spine`. |
| G10 — both colour answers | **PASS** | Own toggle script on `#exp/v2/sends`, fixed `addInitScript` DOM-readiness bug along the way (documented in scratch scripts). Minted **both** starting states (mono and triad) independently, then toggled in place. MONO: `#10A37F #DBDFDD #A1A6A4 #747977` — exact spine §9.2. TRIAD (post-toggle): `#10A37F #3A93D0 #D099E8` + neutral `#A1A6A4` on `--cat-4` — exact spine §9.3. Both directions verified. Full-`.wb` geometry fingerprint (every element's x/y/w/h) identical before/after in both directions — **zero layout shift**. |
| G11 — light patches visited | **PASS** | `git diff exp/brain -- src/exp/v2c/styles.css` is empty, but `spine.css:141-144` carries `:root[data-theme='light'] .wb-rail{...}` and `.wb-pane-h{...}` at equal-or-greater specificity, imported after `styles.css` (cascade wins by source order) — the alternate G11 satisfaction path. Confirmed at runtime by source read of the resolved rule, consistent with BUILD.md's own computed-style claim. |
| G12 — spine censuses | **FAIL** (see finding below) | Own runtime census, Content/Today/Sends/Inbox, both widths. Type: 4-7 distinct sizes/screen, 0 fractional (PASS). Weight: exactly 1 element ≥700 per screen, at 34px/56px (PASS). Tabular-nums: 0 numeral leaves at `normal` (PASS). Accent @1440: today 13, inbox 7, drafts 6, content 6, sends 22, ops 11 — all ≤30 (PASS; builder's own numbers differ slightly, e.g. sends 22 vs their 20 — expected variance against live, not fixture, data). Pill licence: 0 violations across all 12 captures, checked against the exact `.wb` selector list read from `spine.css`'s own "§6.4 RADIUS & THE PILL LICENCE" block (PASS). Density band: Content 44-45/44-61, Inbox 41-42/41-59, Today 40/40, Log 40/38-39 — all within band (PASS). **Anchor rail (§7.1) FAILS for the Mattan/risedtc lane**: see skeptic finding below. |
| G13 — regression skeptic | **PASS** | Default app (no `#exp/v2` hash), `#inbox #today #sends`, candidate (5442) vs base (5450), same minted-session recipe. DOM tag+class tree (depth-6 walk from `.app`) **byte-identical** on all three routes; `.wb` present on neither side on any route (no leak); 0 console errors both sides; screenshot pair for `#sends` pixel-indistinguishable (Volume dots still render the raw iOS palette — `data-cat-i` is inert without a `.wb` ancestor, as designed). |

---

## Skeptic findings

### FABRICATION SKEPTIC — clear
Read the full 11-file diff cold (`ContentBits.tsx`, `ContentList.tsx`, `ContentSections.tsx`,
`Shell.tsx`, `Surface.tsx`, `spine.css`, `sends.ts`, `SendsScreen.tsx`, `TodayScreen.tsx`,
`OverviewView.tsx`, `sweep-spine.mjs`). No hardcoded series, no denominator sourced from a truncated
fetch. `fetchSendLogCounts` (`src/lib/sends.ts:141-160`) is the honest-denominator mechanism claimed
in BUILD.md, verified by direct source read (not by re-running the builder's own script against
itself).

### CAPTURE SKEPTIC — clear
Spot-checked 5 of the builder's 30 shots (`content-desktop.png`, `sends-log-desktop.png`,
`today-mobile.png`, `draft-pane-desktop.png`, `light-today-mobile.png`): file sizes 63KB-680KB (no
suspiciously blank/tiny files), all visually coherent dense real-data screens matching their
`sweep.json` entries (e.g. `sends-log-desktop.png` shows the literal text "NEWEST 113 OF 1,524 SENT
· NEWEST 7 OF 208 BLOCKED" claimed in BUILD.md §4/§8.5; `light-today-mobile.png` renders a correct
light-theme inversion, not a stub).

### REGRESSION SKEPTIC — clear
See G13. Additionally confirmed via `git log exp/brain..HEAD --stat` that no commit touches anything
under `goal-runs/` (D6) and `main` sits untouched at `7c9ea96`, distinct from and unrelated to this
branch's HEAD (D7).

### DENSITY SKEPTIC — **one real finding**
Full-scroll Content at 1440 and 390, both Ivan and Mattan/risedtc lanes, 3 scroll bands each
(top/mid/~bottom), measuring anchor-rail x-position per row group, sticky-header presence, and row
density along the way.

- Sticky section headers hold correctly through scroll on both lanes/widths (headers observed
  pinned near `top:0` — e.g. `02 Internal … 64` at `top:195` mid-scroll, `top:3` near the bottom —
  no collapse observed at either 200+-row lane).
- **Ivan lane: rail holds, variance 0 across all 200 rows** (drafts + ideas + resources + styles all
  in one continuous list, confirmed by brute-force-scrolling every scrollable ancestor to bottom and
  measuring every `.ct-card`/`.ct-res`/`.ct-style` anchor's `getBoundingClientRect().left` — all
  200 at one x).
- **Mattan/risedtc lane: rail does NOT hold.** The same measurement finds 70 draft/idea rows at one
  x and 5 resource rows at an x offset by **20px**, reproduced identically at both 1440
  (`x=253` drafts vs `x=233` resources) and 390 (`x=53` vs `x=33`), reproduced twice independently.
  This is not a flake in this agent's instrument — **the builder's own delivered
  `shots/sweep.json`, entry `content-mattan`/`desktop`, shows the same gap in its own numbers**:
  `rails.content.groupX` reports `x:293` (70 rows, 2 groups, "variance":0) while
  `rails.contentRes.groupX` reports `x:273` (5 rows, "variance":0) — two rail groups, each
  internally at variance 0, sitting 20px apart from each other. BUILD.md §4's summary table collapses
  these into "Content 77/77 drafts+ideas · Content 121/121 resources+styles" (both individually
  "0 unmeasured"), and §5 fix-loop-2 item 5 claims this exact class of bug fixed ("Content's drafts
  list and its resources list were each internally at variance 0 but sat at different x from each
  other (273 vs 256 at 1440)... now inset to the same x... Content carries one rail from the top of
  the drafts list to the bottom of the styles list") — but that fix evidently only reached the Ivan
  lane. The Mattan/risedtc lane's `ResourcesSection` still sits outside whatever group-box inset the
  fix applied, at the same ~20px gap (293→273 is even the same delta as the pre-fix number the
  builder quotes). §7.1's rail test ("within one list... variance 0px... at both 390 and 1440") is
  written as a whole-surface contract in BUILD.md's own framing, so this is scored as a genuine G12
  failure — narrow (5 resource rows out of ~200 in the dense lane), reproducible, and directly
  contradicted by BUILD.md's blanket "0 unmeasured" claim rather than being disclosed.
- No other collapse found scrolling through either lane at either width; no additional rail forks,
  no sticky-header drift, no density-band excursions beyond what G12's table already reports.

### BRAND SKEPTIC — clear
No serif faces (G4), no warm-paper tokens (ladder is the unmodified dark ladder, confirmed live via
computed `--canvas/--text4` etc.), no second accent outside the licensed categorical sets (§9
verified both ways in G10), no pill-licence violations found in 12 independent captures (G12).

---

## Final

**SURVIVES.** All 13 gates checked independently; zero DQ-class conditions (D1-D8) present; the one
fail-class finding (G12, §7.1 anchor rail, Mattan/risedtc lane's Resources section, 20px offset,
both widths) is real, reproducible, and visible in the builder's own `sweep.json` — but it is narrow
(5 of ~200 rows in that lane), does not touch the Ivan lane or any other contract, and is not itself
a disqualifying condition per the D-list. Recommend flagging it back for a targeted fix rather than
treating it as a kill — everything else the builder claimed (G1-G11, G13) reproduced independently,
including exact colour-answer hexes, zero layout shift on the Fork-2 toggle, zero console errors,
zero default-app regression, and the honest-denominator mechanism on Sends → Log.

## Fix loop 1

**Root cause** — `src/exp/v2c/spine.css:634-637`: `.wb [id^='wb-g-'] [id^='wb-s-']` adds
`--indent` (20px) to a nested StageSection's `margin-left` — the §7.6 hierarchy-indent rule for
Mattan/risedtc's board/internal grouping. Mattan's draft/idea `Card`s live inside that `wb-g-`
wrapper, so they render at the nested inset. `ResourcesSection` and `StyleRoster`
(`src/exp/v2c/ContentSections.tsx:233-295` and `:310-382`) render as *siblings* of the `wb-g-`
groups, never inside one, in both lanes — so their `.ct-res`/`.ct-style` rows kept the un-nested
`padding-left:calc(var(--gut) + 17px)` (`spine.css:1394-1396`) in both lanes too. Ivan's lane has
no `wb-g-` wrapper anywhere (its `StageSection`s render unnested), so its drafts and its
resources/styles rows were always at the same un-nested inset — clean by construction, not by
alignment. Mattan's lane was the only one where "the rest of the list" sat at the nested inset
while Resources/Styles sat at the un-nested one, 20px apart.

**Change** — `ContentSections.tsx`: added a `ct-nested` class to the `.ct-res` row div (when
`lane === 'risedtc'`) and the `.ct-style` row div (same condition) — the same `lane` prop each
component already receives. `spine.css`: one new rule,
`.wb .ct-res.ct-nested,.wb .ct-style.ct-nested{ padding-left:calc(var(--gut) + var(--indent) + 17px) }`,
placed after the existing `.ct-res,.ct-style` padding rule so it wins on source order at equal
specificity. `padding-right` untouched (the nested `wb-s-` rule itself only changes `margin-left`,
never `margin-right`, so trailing-value alignment on the right edge is unaffected by design).

**Re-measured rail** (own Playwright run, minted session, dev server port 5442, every row type in
the Content pane — drafts, ideas, resources, styles, queue — min/max x of primary/leading text,
lane switched via the chip, every collapsed section opened first):

| lane | width | drafts | ideas | resources | styles | queue | variance (drafts/ideas/res/styles) |
|---|---|---|---|---|---|---|---|
| ivan | 1440 | 273/273 (n=169) | 273/273 (n=60) | 273/273 (n=121) | 273/273 (n=17) | 231/231 (n=60) | **0** |
| ivan | 390 | 73/73 (n=169) | 73/73 (n=60) | 73/73 (n=121) | 73/73 (n=17) | 31/31 (n=60) | **0** |
| risedtc | 1440 | 293/293 (n=87) | — (0 ideas in this lane) | 293/293 (n=5) | 293/293 (n=17) | — (0 queue open) | **0** |
| risedtc | 390 | 93/93 (n=87) | — | 93/93 (n=5) | 93/93 (n=17) | — | **0** |

Pre-fix baseline reproduced first (same script): risedtc drafts 293/93 vs resources 273/73 at
1440/390 — the exact 20px gap G12 reported. Post-fix: drafts/ideas/resources/styles are now a
single x per lane at both widths, variance 0 within each lane's list — the §7.1 contract as
written ("within one list... variance 0px... at both 390 and 1440").

Note: `queue` (`.ct-q`, the publish-queue strip nested inside the Scheduled stage's `dd-card`
wrapper) sits at its own x (231/31) in the Ivan lane, distinct from the 273/73 rail. This is a
pre-existing, separate nested list (its own card family, `dd-card`, not `ct-card`/`ct-res`/`ct-style`)
and was not part of G12's finding or this fix's scope — not touched, not claimed clean.

`npm test`: 378/378 passed. `npm run build`: exit 0, clean. `npm run lint`: exit 0, 0 errors, same
pre-existing warnings as G1 (none in the diff). Diff scope: `src/exp/v2c/ContentSections.tsx` (2
one-line class additions) + `src/exp/v2c/spine.css` (1 new 3-line rule + comment). Committed
`534fd25`.

**PASS.**

---

## Fix loop 2

Closing the blind row-find judge's **390 FAIL** (`phase4-rowfind-spine.md` §4/§6) plus its three
secondary findings. Branch `exp/vis-spine`, commit **`c16f184`** over `534fd25`. Dev server 5442,
own Playwright instrument, live data, session minted with `scripts/dev-login.mjs`.

### What the defect actually was (measured before touching anything)

The judge's words were "rows wrap into 2-3 stacked lines… row heights inflate… the rail dissolves".
Measured at 390 on `#exp/v2/content`, Ivan lane, all 217 working-list rows:

| row type | n | content-box @390 | over the 72px ceiling | primary wrapped |
|---|---|---|---|---|
| `.ct-card` (drafts) | 19 | 60px | 0 | 0 |
| `.ct-card.ct-idea` | 60 | 44-54px | 0 | 0 |
| **`.ct-res`** | 121 | **66-164px** | **103** | **98** |
| **`.ct-style`** | 17 | **185-250px** | **17** | 0 (but 3 stacked payload blocks) |

So the DRAFT rows were never outside the band — which is why G12's density check passed twice. The
138 resource + style rows sharing the same scrolling list were, and that is what dissolves the rail
under the reader before the review section arrives. `.ct-style` at 1440 was already 145-210px.

### The changes

| # | file:line | change |
|---|---|---|
| 1 | `src/exp/v2c/spine.css:1451-1460` (§15.1) | `.ct-res-t`/`.ct-style-t` inherited the base sheet's `overflow-wrap:anywhere` with no line discipline. Now `white-space:nowrap` + `text-overflow:ellipsis` — **exactly one truncated primary line**, per §7.7. |
| 2 | `src/exp/v2c/spine.css:1461-1475` (§15.1b) | `.ct-meta` was already `flex-wrap:nowrap` and still measured **two lines** at 390: its non-chip leaves (`.ct-ref`, `.ct-ref-l`, `.ct-tm`) inherit `overflow-wrap:anywhere` + a 4px top margin, so they shrink to min-content and wrap *inside* the flex line ("no landing URL" broke over two). They now truncate like every chip beside them. **One meta line max.** |
| 3 | `src/exp/v2c/ContentSections.tsx:324-381` + `spine.css:1495-1504` (§15.4) | `StyleRow`: the 180-char blurb, the example count and the 78px preview strip move behind the **disclosure the idea card on this same surface already uses**. Collapsed row = anchor · primary · meta. Nothing deleted, no new vocabulary. |
| 4 | `src/exp/v2c/fmt.ts:54-65`, `ContentList.tsx:88-92`, `ContentSections.tsx:66-93, 279-291` | **Anchor consistency.** The bare `—` is gone; every plate without a thumbnail carries the row's type/format/family **monogram** (`monogram()`), full label on the plate's `title`. The Ideas **score leaves the anchor** — it was the single reason the slot meant something different there — and becomes the §7.7 **trailing tabular value**, sharing one right edge with every timestamp on the surface. One meaning class (identity) in every section. |
| 5 | `ContentList.tsx:109-113`, `ContentSections.tsx:82`, `ContentSections.tsx:293`, `ContentSections.tsx:345-352` | The type / format / family **chip leaves the meta line** — the anchor carries that fact now, and a fact printed twice costs the meta the width it needs to stay one line. |
| 6 | `src/exp/v2c/spine.css:693-709` (`.ct-anchor::after`, :702) | **Row-level status is a mark.** The severity spine was 3px down the plate's *left* edge, flush against the group inset — the blind judge read three scroll bands and saw none. It is now the §5.5 **severity square at the plate's top-right corner**, ringed in `--surface1` so it holds over a photograph. Same two tokens. |
| 7 | `src/exp/v2c/spine.css:1506-1526` (§15.5) | **PASS vs NO QA differ by a mark.** The QA chip takes a 5px square in its leading slot (the chip anatomy is already `inline-flex` with a 5px gap, so no new geometry): PASS = solid neutral, NO QA = **hollow**, non-PASS = amber, errored = red. Severity tokens on real severity only, no new hues. |
| 8 | `ContentList.tsx:114-121` | The **"On board" chip is gone** from the risedtc rows (judge §5, "stamped on every row… scan clutter"). That lane already *groups* by exactly that fact under a sticky §7.5 header that counts it; it was also the chip crowding the QA verdict off the measure. |

### Re-measured (own instrument, live, 3 captures, 0 console errors)

| capture | rows | content-box | over 72px | rail variance | primary lines >1 | meta lines >1 |
|---|---|---|---|---|---|---|
| **390 Ivan** | 217 | **44px** (60px on the 19 actionable review rows — their action pair drops to grid-row 2 under 768) | **0** | **0** @ x=73 | **0** | **0** |
| **1440 Ivan** | 217 | **44px** flat | **0** | **0** @ x=273 | **0** | **0** |
| **390 Mattan** | 92 | **44px** flat | **0** | **0** @ x=93 | **0** | **0** |

Rows over the ceiling **120 → 0**. Every row type now lands on the same 44px content box at both
widths, so the rail is a rail and not a column alignment. Content scroll height **18,551 → 14,783**
at 1440 and **9,477 → 6,576** on the Mattan lane — the same drag travels ~25% more list, which is
the judge's literal complaint ("at mobile width, the same amount of scrolling gets you much less
further down the list").

Captures: `c390-band{0,1,2}.png`, `c1440-band{0,1,2}.png`, `m390-band{0,1,2}.png` (scratchpad
`shots-final/`). `m390-band1.png` is the deciding one: nine `NEEDS_REGENERATE` rows each carrying an
amber corner square on the plate *and* an amber square in the chip, against `PASS 78`/`PASS 76` rows
carrying a neutral square — the failing rows are now findable without reading a single word.

### Gates re-run
`npm test` **378/378, 22 files, exit 0** · `npm run build` **clean** (`dist/` + service worker) ·
`oxlint` **0 errors** (17 pre-existing warnings, all outside the diff) · `tsc -b` clean ·
**0 console errors / 0 page errors** across all three captures.

### Not fixed, on purpose
The last chip on a very long QA verdict (`NEEDS_REGENERATE 67` + `BUYERS`) is still clipped by
`.ct-meta{overflow:hidden}` rather than ellipsized — pre-existing, present with *more* chips before
this loop, unflagged by the judge, and the alternatives (a per-row mask on 285 rows, or letting every
chip shrink) are each worse than the defect. `.ct-res` carries no anchor severity mark: its stuck
state is already the urgent square on its own status chip plus a counted line in the alert strip.
