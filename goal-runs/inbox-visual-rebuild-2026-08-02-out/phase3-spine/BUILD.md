# Candidate `spine` — build note

Goal-run `inbox-visual-rebuild-2026-08-02`. Branch `exp/vis-spine` off `exp/brain` @ `17e3cfb`.
Worktree: session scratchpad `wt-spine`. 14 commits. `package.json` / `package-lock.json` byte-identical
to base (`git diff exp/brain..HEAD -- package.json package-lock.json` is empty). `src/styles.css` diff is
**0 lines** — `:root` is not edited, not retoned, not extended (D1).

---

## 1 · Thesis, and where it sits on the axis

**Restraint-first precision.** The shared spine executed at maximum discipline: the prior run's
`instrument` austerity — hairlines, rationed accent, tabular numerals, de-bordered rows, the ticked
section ruler, sticky instrument-face headers, one choreographed beat — re-grounded on the **dark**
ladder. Reference moves are admitted only where they buy density or scannability. Expression is
concentrated in exactly two places per surface: the **display title** (M1) and **one hero figure**.
Charts are Geist-grade — hairline track, solid fill, **square ends**, explicit labels — not
capsule-flamboyant. `--r-hero` collapses into `--r-card`; this candidate never draws 24px.

Declared position on the **expressive ↔ restrained** axis: far restrained. Judge it against that.

The named risk of this thesis is scoring "clean" and "anonymous" at once. §6 answers it with three
choices a generic admin template does not make.

---

## 2 · Token choices inside the spine's ranges

| token | value | why this value |
|---|---|---|
| ladder | §3.1 adopted **verbatim** | The harness in §9.4 already proved this ladder; re-deriving would spend the run's budget re-earning a result the spine hands over. `--text4` takes the §4 correction `#6F7472`, not the published `#606562`, which fails 3:1 on surface2/3. No re-derivation, so no re-run of `phase2-colour-harness.py` is owed — the pasted table in spine §9.4 **is** this candidate's contrast evidence, unmodified. |
| `--fs-display` | 34 / 44 / 56, stepped by media query | Measured at 390 → `34px`, at 1440 → `56px` (sweep field `fsDisplay`). No `clamp()`: it emits fractional computed sizes and destroys the census. |
| `--fw-display` | 700, and it is the only weight ≥700 anywhere | Measured: **exactly one** ≥700 element per screen on all 30 captures, at 34px (390) or 56px (1440). |
| `--r-chip` / `--r-ctl` / `--r-card` | 6 / 10 / 18 | as specified |
| `--r-hero` | **18px — collapsed into `--r-card`** | Licensed by spine §13. A second card radius is a second class of card, and this build has one class of card. |
| `--anchor-w` / `--anchor-gap` | 28 / 12 | as specified |
| `--sech-h` | 32px, opaque `--surface1` | The count above the rows is only true if the header is still there when you have scrolled. |
| `--gut` | 16px | one gutter, every surface |
| MONO `--cat-1..4` | `#10A37F` `#DBDFDD` `#A1A6A4` `#747977` | exact spine §9.2 hexes, asserted at runtime |
| TRIAD `--cat-1..3` | `#10A37F` `#3A93D0` `#D099E8` | exact spine §9.3 hexes, asserted at runtime. `--cat-3` is **not** harmonised back down — its lifted L is the only separation a dichromat can use. TRIAD adds a neutral `--cat-4` (`#A1A6A4`) because the app has a four-series chart and TRIAD derives three; a fourth *hue* would break the maximin solution. |

Light theme is the same ladder inverted, declared once. It is functional and legible; it is not the
thesis (§12). Verified: at `data-theme='light'`, `.wb-rail` and `.wb-pane-h` both compute
`rgb(255,255,255)` = the light `--surface1`, i.e. the two hard-coded rgba patches at
`src/exp/v2c/styles.css:58` and `:127` are **visited and neutralised** (D13 cleared, measured, field
`lightPatch`).

Bridge (§1.4): `--bg` resolves to `#090B0A` dark / `#F7F8F7` light, `--blue` resolves to `#AEB2B0`
dark / `#525855` light — the undeclared second accent is retired to neutral on every capture.

---

## 3 · Per-surface changes

**Scoping.** One treatment stylesheet, `src/exp/v2c/spine.css` (1,416 lines), imported after
`./styles.css` in `Shell.tsx`. Every declaration is under `.wb`. The one licensed structural edit
(§1.7) is `Shell.tsx:208` — the 390 first-paint skeleton now carries `.wb`, so a cold mobile load no
longer shows the iOS `:root` palette for its first seconds.

**Content** (`ContentList.tsx`, `ContentBits.tsx`, `ContentSections.tsx`) — the surface the run is won on.
- **Anchor rail**: every row is `grid-template-columns: 28px minmax(0,1fr) auto` (a fourth column at
  ≥768 so a review row's action pair rides the timestamp's line instead of adding a second band).
- **The status stopped floating.** It is now (a) an inset spine on the anchor plate keyed by
  `data-sev`, and (b) chip position #1 in a `flex-wrap:nowrap` lead slot that can never reflow. QA is
  first because "which of these 88 is failing" is the question this surface is opened to answer.
- **A PASS carries no mark.** The absence is the pass. That is what keeps failures the only thing the
  eye catches down a 285-row column, and it is why the accent census on Content is **4–6**, not 30.
- Six stage hexes (two of which, `#0A84FF` and `#FFD60A`, collided with the severity vocabulary)
  replaced by a categorical **index** `STAGE_CAT`, resolved to `--cat-N` by the treatment and to a
  **pattern** past the fourth series.
- Filters: one line, `label: value ⌄`, active facets sorted to the front so a filter that is currently
  hiding rows can never be the one scrolled out of view. Thirteen facets wrapped over five rows cost
  280px above the first row of a 285-row list; on one scrolling line they cost 30px.
- The alert strip's 35 non-draft lines became **rows in one ruled sheet**, ellipsized to one line, and
  the strip opens collapsed.
- Idea rows share the draft rows' anchor geometry, so one rail runs the whole surface.
- Resource and style rows (121 of them) were brought onto that same rail — see §5, fix loop 1.

**Today** (`TodayScreen.tsx`) — restyled only; zones 01–03 bind to the opaque `get-morning-brief` edge
fn and its figures are not verifiable client-side (§8.5 last bullet). Two additive attributes:
`data-tier` on the masthead stack segment and its legend dot, so the third tier — a literal `#0A84FF`
hard-coded in the segment map — is neutralised by name rather than by a colour edit. The 42px inline
avatar was pulled to the 28px anchor so Today runs one rail, not two 14px apart.

**Sends** (`SendsScreen.tsx`, `lib/sends.ts`, `kpi/OverviewView.tsx`) — §8.5 honesty.
- New `fetchSendLogCounts()` issues two `count:'exact', head:true` probes and the Log prints
  **"NEWEST 113 OF 1,524 SENT · NEWEST 7 OF 208 BLOCKED"** above its legend. Nothing is derived from
  `rows.length` of a truncated fetch. Verified in the capture's own innerText (§4).
- The log's kind chip became the row's **fixed-width anchor** (66px). A chip that sizes to `CONN·BLANK`
  vs `DM` put every name at a different x — the exact defect §7.1 exists to kill.
- The four channel dots on Volume were categorical encoding painted from the raw iOS palette:
  Connections wore the retired second accent and **Emails wore severity amber**. They now bind to
  `--cat-N` by lane index (§5.4 — severity is never category).

**Ops / Inbox / Drafts / Settings / detail panes** — the shared vocabulary only: group-carries-the-boundary
rows, the one section-header face, chip anatomy, the radius family, motion deletion.

**Zero hard-coded series were added.** Every diff hunk that touches a chart replaces a literal hex with
an index or a token. No new dependency, no webfont, no `@font-face`, no `ui-serif`. `dist/` contains the
Supabase **anon** key only (decoded `role: "anon"`), which is baked in by the base app's own Vite config
and is public by design; zero `service_role`, zero `sbp_` (D8 clear — stated precisely, not rounded).

---

## 4 · Self-instrument — what it measures and what it returned

`scripts/sweep-spine.mjs`, 30 captures. Wait logic is fixed, never `networkidle` (the app holds an open
realtime WebSocket and can never satisfy it): **domcontentloaded → skeletons cleared + rail stamp ≠ "not
loaded" + a terminal render exists → every literal "Loading" cleared → innerText stable across three
1.2s samples → settle**.

### The three instrument fixes this session

1. **Inset-shadow detection for the selection spine.** The drop-shadow sweep skips `inset` by design
   (§3.4 is about *drop* shadows), so it could never confirm the one inset shadow the spine *requires*.
   Added a walk that parses every inset shadow plus a `selected` probe over
   `.ct-card.wb-card-on, .r.active, .wb-rj.on, .wb-peer.on`, asserting `inset · 2px · rgb(16,163,127)`,
   a background that is not accent-derived, and no *drawn* border. It immediately caught a real defect
   (§5). It also needed a second correction of its own: a 1px `rgba(0,0,0,0)` edge is reserved geometry,
   not a separation device, and failing it reported a defect on a boundary that draws nothing.
2. **`data-cat` toggle timing.** Previously the attribute was set by `page.evaluate` *after* settle, so
   the crop and the assertion shared one moment and the zero-shift comparison ran on a 400-element
   prefix after 120ms — inside the motion window. Now: the answer is set in an init script **before
   first paint** (so the crop is what that answer actually renders), and the zero-layout-shift test is a
   separate timed round trip — full geometry of **every** element under `.wb`, two animation frames,
   then 320ms (longer than `--dur-beat`). Both answers' `--cat-*` are asserted against the spine's
   exact hexes in both directions.
3. **Per-group anchor rail.** The old rail took one primary selector per list and silently dropped
   every row whose primary carries a different class, then reported variance 0 for a rail that visibly
   forked. It now takes a selector **list**, reports `rows` vs `measured` vs `unmeasured`, and prints
   the x of each group so an unmeasured row type cannot hide inside a passing number.

Two more gates were added when the re-run exposed what they were hiding:

4. **Literal-`Loading` gate.** Today at 1440 had been capturing with zones 01 and 03 reading
   "Loading the brief…" — **896 chars** of innerText against 3,039 at 390 — while every existing gate
   was green, and the rail and density instruments returned `null` because the rows did not exist yet.
   Post-fix: **3,404**. A crop that says "Loading" is a failed capture, exactly like a skeleton crop.
5. **innerText-settled gate.** One capture returned **19,422** chars for a surface that measures
   **28,569** — Content's resource and style lists land on their own fetches after gates 1 and 2 are
   green, and nothing in the report said so. Three stable samples now required. All 30 captures are
   reproducible to the character.

`scripts/_probe.mjs` and `scripts/_quick.mjs` were **deleted rather than committed**. Both were ad-hoc
capture/census scripts with their own weaker wait logic, and a second instrument that disagrees with
the first is the precise failure this session spent its budget fixing. Their capability is inside
`sweep-spine.mjs`. The intermediate `crops/` runs stay untracked in the scratch worktree; the delivered
evidence is `shots/` + `shots/sweep.json` in the main checkout, which is what a judge reads.

### Final numbers — all 30 captures

| §  | contract | result |
|---|---|---|
| 1.4 | bridge declared | `--bg` `#090B0A` / `#F7F8F7`; `--blue` `#AEB2B0` / `#525855` — never `#000000`, never blue |
| 1.5 | two light patches visited | light `.wb-rail` + `.wb-pane-h` = `rgb(255,255,255)` = `--surface1` |
| 1.7 | 390 first paint carries `.wb` | `Shell.tsx:208` `'app wb'` |
| 2.2 | ≤9 computed sizes/screen, zero fractional | **4–7 sizes** per screen; **0 fractional** on all 30 |
| 2.3 | display stepped | `34px` @390, `56px` @1440 |
| 2.4 | ≤1 element ≥700, and it is ≥28px | **exactly 1** per screen, at 34px or 56px (0 on the mobile draft pane, which carries no title) |
| 2.6 | tabular-nums everywhere | **0** numeral leaves at `normal`, all 30 |
| 5.6 | ≤30 accent elements @1440 | **max 20** (Sends Overview); Content **6**, Today 12, Log 6, Settings 1 |
| 6.4 | pill licence | **0** violations, all 30 (baseline defect was 58) |
| 7.1 | anchor rail x-variance 0 per list | **0.00** on every list at both widths, **0 unmeasured rows**: Content 77/77 drafts+ideas · Content 121/121 resources+styles · Inbox 15/15 · Today 6/6 · Log 120/120 |
| 7.7 | trailing values share a right edge | worst in-group **0.00** (Content, Inbox) |
| 7.8 | density band 40–60 @1440, ≤72 @390 | @1440: Content 44–45 · Today 40–59 · Inbox 41–42 · Log 40–40. @390: Content 44–61 · Today 40–59 · Inbox 41–42 · Log 38–38 |
| 3.4 | zero drop shadows on resting surfaces | **0**, all 30 |
| 10.4 | motion deleted on the 50×/day paths | **0** transform/size/shadow transitions on rails, segments, rows, panes |
| 9 | both answers ship, zero layout shift | mono↔triad both directions on Content (2,432 els), Sends (368), Today (263) — **zero shift**; `catHex: exact` in all 12 assertions |
| 12 D9 | console errors from `src/` | **0** across all 30 captures. The known unarmed `inbox-claude` broker CORS pair did not fire on any captured surface, so the count is a true zero rather than a zero-with-an-exception |
| 12 D10 | horizontal overflow @390 | **false** on all 30; `scrollWidth == clientWidth` |
| — | text clipped mid-glyph | **0** (two found and fixed: the idea score and the funnel stage label) |
| gates | `npm test` / `npm run lint` / `npm run build` | 378 tests / 22 files pass · **0 lint errors** (warnings only, all pre-existing) · build clean |

### Captures — paths and innerText evidence

All under `goal-runs/inbox-visual-rebuild-2026-08-02-out/phase3-spine/shots/` (main checkout), with the
full per-capture measurement in `shots/sweep.json`.

| capture | innerText |
|---|---|
| `content-desktop.png` (1440, dark) | 28,569 |
| `content-mobile.png` (390, dark) | 28,190 |
| `today-desktop.png` (1440, dark) | 3,404 |
| `today-mobile.png` (390, dark) | 3,040 |
| `sends-desktop.png` (Overview, 1440, dark) | 1,825 |
| `sends-mobile.png` (Overview, 390, dark) | 1,469 |
| `cat-mono-sends-desktop.png` / `cat-triad-sends-desktop.png` | 1,825 / 1,825 — **byte-different PNGs**, identical text and identical geometry |
| `cat-mono-content-desktop.png` / `cat-triad-content-desktop.png` | 28,569 / 28,569 — byte-different PNGs |
| `sends-log-desktop.png` | 44,844, containing `NEWEST 113 OF 1,524 SENT · NEWEST 7 OF 208 BLOCKED` |
| `content-mattan`, `sends-lanes`, `inbox`, `ops`, `drafts`, `settings`, `draft-pane`, `thread-pane`, `light-content`, `light-today` | see `sweep.json` |

Minimum innerText across all 30 is **294** (Ops at 390, whose queue is genuinely clear). Session minted
with `node scripts/dev-login.mjs` before the run; no capture shows the login screen
(`loginVisible: false`, all 30) and none shows a skeleton (`skeletons: 0`, all 30).

`cat-mono-today` and `cat-triad-today` are byte-identical, and that is correct, not a bug: Today's
masthead stack is a **severity** breakdown (urgent / to approve / going out), not a categorical series,
and §5.4 forbids reusing severity as category encoding. Today therefore consumes no `--cat-*`. The fork
is demonstrated on the two surfaces that carry real categorical series — Sends Volume and Content's
pipeline stack.

---

## 5 · What the re-run found, and the two fix loops

**Loop 1** — four defects, every one of them invisible to the previous instrument:

1. `.wb-rj-peer.on` wore **three** separation devices at once (hairline box + surface shift +
   selection spine). §3.3: one boundary, one device. The box went; the spine is the app-wide
   "where am I" mark and the surface shift is the app-wide hover.
2. **Content had two rails, not one.** 121 resource and style rows forked off it: a resource with no
   cover image dropped its leading slot entirely and started **40px** left of one that had a cover,
   and a style row had no leading slot at all — it led with a variable-width family chip, so its title
   landed at a different x on every row. Both now ride the same three-column grid; the leading slot is
   **reserved whether or not there is a mark to put in it**, and the style row's title was hoisted out
   of the meta line onto its own. A rail you can only see on rows that happen to carry a thumbnail is
   not a rail.
3. **Today ran two rails 14px apart** — unread rows take a 42px avatar from an inline `size` prop that
   no stylesheet can outrank without `!important`, while queue rows take the 28px anchor.
4. **The send log sat outside the density band at both ends**: 38px of content at 1440 (floor 40) and
   78px at 390 (ceiling 72), because the name and its client chip wrapped onto a second and third line.

**Loop 2** — three:

5. Content's drafts list and its resources list were each internally at variance 0 but sat at
   **different x from each other** (273 vs 256 at 1440). The resource/style run is now inset to the
   same x as a row inside a group box, so Content carries one rail from the top of the drafts list to
   the bottom of the styles list.
6. The funnel's stage label was being cut mid-glyph at 390 rather than ellipsized.
7. **The four channel dots on Sends Volume were categorical encoding in the raw iOS palette** —
   Connections on the retired second accent `#0A84FF`, **Emails on severity amber `#FF9F0A`**. A channel
   was wearing the colour that means "attention". Bound to `--cat-N` by lane index; the sparkline bars
   deliberately stay one neutral ink (see §7).

Everything above is fixed and re-measured. Nothing found is open.

---

## 6 · The three anti-template choices

A generic admin template would not make any of these, and each is a design argument rather than a
budget trim.

1. **A PASS carries no mark.** Every dashboard in this class prints a green "PASS" pill on every
   passing row, which means 285 rows of reassurance and no ranking. Here the QA chip on a pass is a
   plain hairline box, the anchor spine is *absent*, and only `attention` (QA did not return a literal
   PASS) and `urgent` (the row errored) draw anything. The absence is the pass. This is what makes the
   accent census on the densest surface in the app **6 at 1440**, and it is why the eye finds the 12
   failing rows in a 285-row column instead of scanning 285 identical green pills.

2. **Severity is a hard square; category is a circle.** Every reference in the set draws both as the
   same dot, so a colour-blind read cannot tell a warning from a series. Splitting the *shape* by
   meaning class means severity and category are separable without hue at all — which is the same
   argument §9.3's lightness lift makes for TRIAD, applied to marks instead of fills. No admin template
   ships two dot geometries.

3. **The section rule is a ruler, not a line.** The header's rule is a hairline **ticked every 8px**
   (`repeating-linear-gradient` over a 1px baseline), so the header draws the grid its own type rides
   on and the 8px rhythm becomes a visible instrument face rather than a spacing convention you have to
   take on faith. Paired with the row-level restraint, it is what stops "clean" from reading as
   "anonymous": there is one deliberate texture in the app, it appears on every section head, and it is
   made of the measurement system rather than of decoration.

---

## 7 · Deliberate departures, with reasons

- **`--r-hero` collapsed into `--r-card`; 24px is never drawn.** Licensed by spine §13. A second card
  radius is a second class of card; this build has one.
- **Charts have square ends, not capsules.** The reference wins on chrome and loses here: a capsule end
  lies about where a value stops. Capsule geometry is licensed by §6.3.7 and declined.
- **No M16 dotted leaders, no M17 sparklines beyond the ones already in the data.** Both optional under
  §13; both are texture this thesis has already spent on the ticked rule.
- **Sparkline bars stay one neutral ink (`--cat-3`) in all four Volume tiles** even though the dot beside
  them is now categorical. The label plus the dot identify the channel; the bars are magnitude. Painting
  four sparklines four colours would put `--cat-1` (which *is* the accent under MONO) on ~56 bars and
  blow the §5.6 budget on decoration.
- **The row-level Approve is not a filled accent slab.** Eighteen identical green buttons down a review
  queue rank nothing — §5.5's "one severity mark per run, not per row", applied to actions. Accent marks
  the place you *commit*, which is the draft pane; the peer pane keeps the filled primary. In the row,
  hierarchy is fill-vs-no-fill, not hue.
- **Selection is `--surface2` + the inset accent spine.** §7.4 says selection is "never both a spine and
  a fill"; this build reads *fill* as a **chromatic** fill — a background shift to `--surface2` is the
  same neutral device §7.4 itself assigns to hover, and the instrument asserts the selected element's
  background is never accent-derived and that it draws no border. Stated plainly because it is the one
  clause in §7 where this build takes a reading rather than a value.
- **The idea score is rounded in the anchor.** A two-decimal composite ("68.32") was being cut mid-glyph
  inside a 28px slot. The mark carries the value at the resolution the mark can hold; the exact value is
  on the `title` attribute. Nothing is invented and nothing is clipped.
- **Content's `.ct-topic` is hidden.** It repeated the title on four of five rows and cost a line of
  height on a 285-row surface.
- **Port.** Phase 3 assigns `5432`; a local Postgres owns that port on this machine, so the dev server
  and every capture ran on **`15432`**, the predecessor's convention. No other assignment changed.

---

## 8 · DQ list, stated

| # | rule | status |
|---|---|---|
| D1 | `:root` in `src/styles.css:1-16` edited | clear — diff is 0 lines |
| D2 | fabricated data / denominator from a truncated `rows.length` | clear — no hard-coded series added; Log denominators come from `count:'exact', head:true` probes |
| D3 | new dependency / webfont / `@font-face` | clear — lockfile byte-identical; system sans only |
| D4 | `ui-serif` | clear — absent |
| D5 | warm-paper / serif editorial | clear — dark ladder, system sans |
| D6 | `git add -A` | clear — every commit staged explicit paths |
| D7 | push to `main` | clear — nothing pushed; `main` and `exp/brain` untouched |
| D8 | secret in `dist/` | clear — anon key only (`role: "anon"`, public by design, baked by the base Vite config); no `service_role`, no `sbp_` |
| D9 | console error from `src/` | clear — 0 across 30 captures |
| D10 | horizontal overflow @390 | clear — 0 |
| D11 | AA body contrast on dark | clear — ladder adopted verbatim with the §4 `text4` correction; spine §9.4 table is the evidence |
| D12 | only one colour answer | clear — both ship, both asserted to the exact hexes, zero layout shift |
| D13 | the two v2c light patches unvisited | clear — measured `rgb(255,255,255)` |

**Not run by this build, by design:** §7.9, the three-second row-find on Content at 390 and 1440. It
requires a judge who has not seen the build, and a self-administered timing would be worthless. Both
captures are in `shots/`.

---

## 9 · Commits

```
e4bcb2a  the four channel dots are categorical, so they bind to --cat-N
40b40cd  instrument gate 3 — a capture 9k chars short of the same surface is a failed capture
e69b909  funnel stage label ellipsizes instead of clipping
2764759  one rail from the drafts list to the styles list; instrument stops failing a transparent border
1a349af  fix loop 1 — one rail across resource/style/Today rows, log row inside the density band,
         peer nav loses its third separation device
ed1531c  instrument fixes — literal-Loading gate, per-group rail with unmeasured-row count,
         inset selection-spine probe, cat hexes asserted before paint
43c5133  sticky headers actually stick; review rows collapse to one band
b9ebb77  alert strip opens collapsed; filter is one line; footer states the honest denominator
e549473  one rail across every row type; Today's third tier de-blued
e35beb3  Sends Log states its own denominators from count=exact head probes
3f4deb8  census closure — type/weight leaks, accent cuts, density band, rail group
66197df  Content anchor rail, anchored status, chart-card footer, filter grammar
2769af8  treatment stylesheet + bridge tokens, both colour answers, licensed first-paint class
```

Plus one commit removing `scripts/_quick.mjs`: an ad-hoc capture script whose wait logic disagreed with
the instrument's, which is the defect the instrument exists to fix.
