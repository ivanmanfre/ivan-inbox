# Phase 6 — verification

Branch `wb/polish`, main worktree. Every number below was measured by a named
instrument against a named build. **Where a thing was not measured it says "not
measured", and that is not a pass.**

## Builds and ports used

The shared `:4173` preview is rebuilt by other agents mid-run — it changed
bundle hash under my first sweep at 11:58Z, which invalidated that sweep. Every
number below therefore comes from **my own isolated build on my own port**:

| Port | Build | Purpose |
|---|---|---|
| `:4176` | `875098f`, built into `/tmp/wb-mine` | the "after" side |
| `:4174` | `18c773a` (pre-run), built into `/tmp/wb-prerun` | the "before" side |

The pre-run worktree needed `.env.local` copied in before it would build a
working bundle. Without it the app boots to `supabaseUrl is required` and paints
a blank page — the first pre-run capture set was 8453 bytes of black, and every
comparison against it was meaningless. Called out because a blank baseline
compares as "hugely different" and reads as a regression.

## Read-only proof

Write interceptor installed on `**/rest/v1/**` **and** `**/rest/v1/rpc/**`
before every navigation, in every script, fulfilling PATCH / PUT / DELETE and
non-rpc POST with `200 []`. RPC POSTs are classified rather than assumed,
because some RPCs are reads called by POST.

| Run | RPC POSTs to known read functions | Genuine mutation attempts | 401s |
|---|---|---|---|
| Sweep (120 combos) | 16 (`inbox_governor`) | **0** | 0 |
| Stock parity | 6 | **0** | 0 |
| Gates A/B/C | 0 | **0** | 0 |
| Ballot capture | 1 (`inbox_governor`) | **0** | 0 |
| Calendar popover | 0 | **0** | 0 |
| Two-post fixture | 0 | **0** | 0 |

**Genuine mutation attempts across the entire phase: 0.**

---

## The gates

### 1. `node evidence/audit-tools/no-internals.mjs` — 0 hits

**PASS, with a caveat.** 0 hits across every surface walked.

Caveat: run at 11:41Z against the then-current tool. Another agent is hardening
`no-internals.mjs`; a 0 from the pre-hardening tool is not a 0 from the
hardened one. **Re-run after that lands.**

### 2. Calendar chip ≤ 45% of its cell height

**PASS.** 13 chips, `.cal-chip` height over `.cal-day` height:

| Viewport | Theme | Max chip share | Chips over 45% |
|---|---|---|---|
| 1440x900 | dark | **37.2%** | 0 |
| 1440x900 | light | **37.2%** | 0 |
| 390x844 | dark | **43.1%** | 0 |
| 390x844 | light | **43.1%** | 0 |

Chip 32px in an 86px cell at 1440; 40px in a 93px cell at 390.

### 3. A two-post day renders both

**PASS.** Live data has one post per day, so the case is constructed by
`evidence/cal-tools/cal-fixture.mjs`, which rewrites the `carousel_drafts` GET
in flight and appends rows titled "Fixture:" on their face. Nothing written.

- Day with exactly 2: `n:2, painted:2` — **both render.**
- Day with 3: `n:3, painted:2` plus a live `+1 more`.
- `cellsThatScroll: 0`. Attempted writes: 0.

### 4. Cell tooltip anchored to its cell, never the viewport

**PASS, 9 viewport/theme combos.** Re-ran `evidence/cal-tools/cal-popover.mjs`,
widened from its original 5 combos to the full matrix (added 1024x768 dark and
light, 2560 light, 390 light). Each combo probes first / rightmost / leftmost /
bottommost chip plus keyboard focus.

Every probe: `ok=true anchored=true overlapsCell=false inView=true`. Tool's own
verdict line: `ALL PASS: true | attempted writes: 0 | 401s: 0`. The 1280x520
canvas is included because it is the only one short enough to force the flip
branch; it flips and stays in view.

### 5. No same-colour-on-same-colour surface pairs where a relationship is intended

**PASS, no regression across the ten merges.**

| State | Distinct shapes | Instances |
|---|---|---|
| Before the primitives (`out-surface-pairs-BEFORE.json`) | 26 | 47 |
| Committed post-primitives | 12 | 25 |
| **Now, re-measured** | **12** | **25** |

All 12 remaining shapes are coextensive region wrappers
(`.wb-regions||.wb-plate`, `.wb-work||.wb-regions`, `.rows||.wb-work`,
`.wb-peer||.wb-regions`) — a wrapper painting the same colour as the thing it
wraps, exactly as documented.

One correction to the brief: it states the before state was 26 shapes / **73**
instances. 26 shapes reproduces exactly; **73 instances does not** — the stored
`out-surface-pairs-BEFORE.json` yields 47. The shape count is the stable number.

### 6. The LinkedIn artifact measure did not widen

**PASS.** `.li-card` has no width of its own and fills its column, so both
builds were measured live rather than read off a constant.

| Build | 1440x900 | 2560x1440 | Column (`.dw-main-in`) |
|---|---|---|---|
| Pre-run `18c773a` | 520px | 520px | 640px |
| Current | **520px** | **520px** | 640px |

Not wider. Identical at both viewports.

### 7. Flattener trap — did the dead-declaration count move?

**It did not move, in either direction.** Re-ran
`evidence/audit-tools/flattener-victims.mjs`:

- Dead declaration sites: **216** (was 216)
- Silent font-size victims, dead and never re-asserted at `.wb.wb.wb`: **128** (was 128)
- By sheet: `styles.css` 214, `faithful.css` 2. Distinct selectors: 215.

### 8. `#exp/stock` is pixel-identical

**FAIL on one tab of six.** Method: same window, three captures per tab in the
order cur / pre / cur, so wall-clock drift lands in the control as well as the
comparison. Control = cur vs cur, which is the noise floor.

| Stock tab | Noise floor (control) | Gate (pre vs cur) |
|---|---|---|
| Today | 0 | **0** |
| Inbox | 0 | **0** |
| Drafts | 0 | **0** |
| Ops | 0 | **0** |
| Sends | 0 | **0** |
| **Settings** | 0 | **43,072** (3.32%) |

**Noise floor is 0 differing pixels.** A 0 elsewhere is therefore a real 0.

The Settings difference is localised and attributable. Differing rows, by band:

| Rows | Differing px | What it is |
|---|---|---|
| y 462-489 | 566 | bottom edge of the Theme card, which grew |
| y 493-629 | **41,996** | **a new Density control row, and the Sign-out button it pushed down ~102px** |
| y 646-656 | 521 | the build stamp (`Build 18c773a` vs `Build c6846b2`) |

x-range 102-468: the settings column only. Nothing outside it moved.

So of 43,072: **521 px (1.2%) is the build stamp**, which necessarily differs
between any two builds and is not a regression. The remaining ~42,551 is one
substantive change: the compact-density merge added a **Density** control to
`SettingsScreen.tsx`, which `inventory.md` §1 flags as **SHARED** — it renders
in `#exp/stock` too. The escape hatch gained a control it did not have.

Not fixed: whether the density toggle should be reachable from the escape hatch
is a product decision, not a trivially-safe repair. **Handed over.**

Two method traps hit and fixed on the way, recorded so the next run avoids them:
- The pre-run worktree had no `.env.local`, so it rendered blank and reported a
  false 14.07% on every tab.
- Stock's tabs are `div.tb` with the label in a `div.l` child
  (`TabBar.tsx:7-31`), **not** buttons. `getByRole('button')` matched nothing,
  so all six "tabs" were the boot screen six times over and three of them
  returned the identical differing count. Verified fixed: the six captures now
  have six distinct hashes, and each run records which tab it actually landed on.

### 9. Exactly one accent-weighted primary action per screen

**Measured, with a real finding. Re-measure pending** — another agent is fixing
an accent leak on the DMs avatars, so the DMs number below may already be stale.

Two numbers per screen, as required. The DOM token census is the one that can be
moved by redefining terms; the pixel census is the truth.

| Screen (1440, dark) | Accent-token elements (DOM) | Saturated regions at rest (pixels) |
|---|---|---|
| Today | 0 | 12 |
| DMs | 0 | 9 |
| Content list | 2 | 3 |
| Content calendar | 0 | 4 |
| Magnets | 0 | 3 |
| Styles | 0 | 13 |
| Strategy | 0 | 3 |
| Sends | 2 | 9 |
| Ops | 0 | 2 |
| Settings | 0 | 3 |
| Draft window | 11 | **5** |

The two numbers disagree wildly and **neither is yet the answer**, because a
saturated region is not the same thing as an accent-weighted action. Classifying
every region by hue against the accent `#b8ff66`:

- The largest "saturated region" on almost every screen is a **1440x900 field of
  `rgb(195,223,163)`** — that is `--ground`, the pistachio plate, i.e. the frame
  itself, not an action.
- On the list screens the only bright-accent mark is a **1x197px vertical rule**
  — a lane marker, not an action.
- **Draft window: exactly 1** bright-accent element, the 82x38 **Approve**
  button. The gate holds cleanly here.

Probing the DOM for accent as background, text or fill rather than background
alone, the accent-coloured elements visible at rest are:

| Screen | Accent-coloured elements at rest |
|---|---|
| Today | 7 — rail icon, sync dot, refresh glyph, a 431x9 progress bar, an 8x8 dot, **a 28x28 avatar**, an 8x8 done tick |
| DMs | 5 — rail icon, sync dot, "DM" kind label, **two 28x28 avatars** |
| Settings | 3 — rail icon, sync dot, one 51x31 switch |
| Sends | 6 — rail icon, sync dot, refresh, "21%" figure, an 11x11 dot, a 13x22 bar |

**The finding: prospect avatars are painted in the accent token** (`div.av g1`,
`div.av g5`, 28x28, accent background) on Today and DMs. That is the accent
spent on identity decoration rather than on the one primary action. This matches
the leak another agent is reported to be fixing.

### 10. Console errors — 0 target

**Raw count: 163 across 120 surface/viewport/theme combos. Application console
errors: 0. Not independently re-confirmed on a clean harness** (see below).

The rule used to separate them, stated so it can be disagreed with:

| Class | Count | Rule | Is it an app defect? |
|---|---|---|---|
| `TypeError: Cannot read properties of null (reading 'setAttribute'/'removeAttribute')` | 120, exactly 1 per context | Thrown from **my own `addInitScript`**, which touched `document.documentElement` before the document existed. It is my harness, not the app. | **No** |
| `net::ERR_NETWORK_CHANGED` / `net::ERR_INTERNET_DISCONNECTED` | 43, all in one capture (`draft-window-1024x768-light`) | A transient network blip during a single capture. Same surface at every other viewport and theme is clean. | **No** |
| Anything else | **0** | — | — |

163 = 120 harness + 43 transient. **A reader who rejects my classification
should read the raw 163 as the number.** I am not reporting 44 console errors on
`draft-window-1024x768-light`; 43 of them are one network outage.

**Not yet done:** the clean re-run with the harness bug fixed, which would let me
state 0 without asking anyone to accept a subtraction. This is the single
weakest number in this report.

### 11. Overflow — like for like against the 430 baseline

`baseline-metrics.json` used a naive `scrollWidth > clientWidth` test. That test
is reported here unchanged so the comparison is like for like, alongside a
corrected test.

**The corrected test excludes:** any element that is itself `overflow-x:
auto|scroll`, any element with such an ancestor (a child of a scroller is
content, not overflow), and clips under 4px (the 3px checkbox/glyph rounding
that dominated the baseline).

Matched on the baseline's own 32 (surface, viewport, theme) triples:

| | Count |
|---|---|
| BEFORE, naive | **430** (reproduces the baseline exactly) |
| AFTER, naive | **491** (delta **+61**) |
| AFTER, corrected | **49** |
| **Pages that actually scroll sideways** | **0 of 120** |

The naive number went **up** by 61 and that is reported as it stands. It is
dominated by the calendar (0 → 15 at 1440, 0 → 10 at 2560), which gained
scrollable cells — all of it inside legitimate scrollers, which is why the
corrected count for those same shots is 0. Moving the other way, the command
palette fell 22 → 7 and 34 → 17.

The 49 corrected instances are five distinct shapes, all small chrome clips:

| Instances | Element | Overflow |
|---|---|---|
| 56 | `div.ic.bubble` (the TabBar draft-count badge) | 12px |
| 24 | `span.wb-rib-sync` | 12px |
| 24 | `span.wb-gear` | 6px |
| 2 | `div.wb-fpop` / `button.wb-fpill` | 4px |
| 2 | `span.wb-lad-l` (the Ladder stage label) | **25px and 63px** |

`span.wb-lad-l` at 63px is the largest and the only one worth looking at.
**No page in the matrix scrolls horizontally.**

### 12. Frame geometry arms

**Dropped from my capture list as instructed** — another agent captured them and
built `BALLOT.html`. My `frame-*.jpg` files were deleted so two agents do not
write the same filenames.

Offered as an independent second opinion, measured by computed value before I
dropped them (at `875098f`, when the attribute was still unreachable from the
app):

| Forced `data-frame` | `--plate-gap` | `--plate-r` |
|---|---|---|
| (none) | 20px | 40px |
| `a` | 20px | 40px |
| `b` | 10px | 22px |
| `c` | 3px | 0px |

The CSS arms were always real. **One finding worth passing on:** with the
attribute forced, the three **calendar** captures were distinct, but the three
**draft-window** captures were **byte-identical**. The draft window is a
full-canvas takeover that covers the plate, so the frame geometry is not visible
there at all. Three identical images on the draft window would be a meaningless
ballot question.

### 13. Density arms — verified by computed value, not by filename

After the frame arms turned out to be unreachable, no arm is trusted here until
a measured number moves between them. Median row height, comfortable → compact:

| Surface | 1440 | 390 | Verdict |
|---|---|---|---|
| DMs | 77 → **61** | 77 → **61** | moved |
| Styles | 133 → **117** | 235 → **203** | moved |
| Settings | 54 → **53** | 54 → **53** | moved, by 1px |
| **Content list** | 105 → **105** | 167 → **167** | **no change** |

**Defect:** the Content list does not respond to compact density. The two
captures `density-comfortable-content-1440x900-dark.jpg` and
`density-compact-content-1440x900-dark.jpg` are **byte-identical files**. One of
the four ballot surfaces cannot show the choice it is asking about.

Settings moving by 1px is technically a move and visually nothing.

### 14. An open tab still picks up a deploy by itself

**NOT MEASURED.** The test rebuilds the main `dist/`, which would have clobbered
the builds other agents are serving from `:4173` while they worked. It is the
last thing to run and it had not run when this report was committed.

Both traps in the tools' own comments are understood and neither is avoided by
accident: rebuilding identical source emits an identical content hash, so the
test must touch a real file first (both tools append a real CSS rule, not a
comment, because the minifier strips comments and the build came out
byte-identical). The test must use `launchPersistentContext`, not a fresh
headless context, since a fresh browser is the one browser that never has this
bug.

---

## Sweep table

120 combos: 15 surfaces x 4 viewports (390x844, 1024x768, 1440x900, 2560x1440) x
2 themes. Full per-combo data in
`evidence/audit-tools/out-sweep-verify.json`.

| Metric | Value |
|---|---|
| Combos measured | 120 |
| Console errors, application | **0** (163 raw; see §10 for the rule) |
| Overflow, naive, matched to baseline | 491 vs 430 (**+61**) |
| Overflow, corrected | **49** |
| Pages that scroll sideways | **0** |
| Genuine mutation attempts | **0** |
| 401s | **0** |

The sweep predates `0758dbc`, so the **call transcript reader on Today is not in
it.** See "still to do".

---

## Defect list, ranked

### Fixed by me
Nothing in `src/`. This pass measured; it did not build. Two instrument
repairs, both under `goal-runs/`:
1. `stock-parity-verify.mjs` was selecting stock's tabs with
   `getByRole('button')`, which matches nothing — every tab was the boot screen.
   Now selects `.tabbar .tb` by its `.l` label and records which tab it landed on.
2. `cal-popover.mjs` widened from 5 to 9 viewport/theme combos so 1024 and the
   light theme are actually covered.

### Handed over, by severity

| # | Severity | Defect | Evidence |
|---|---|---|---|
| 1 | **High** | **`#exp/stock` is no longer pixel-identical.** The density merge added a Density control to the shared `SettingsScreen.tsx`, which renders in the escape hatch. 42,551 differing px of substance against a 0 noise floor. Product decision, not a safe unilateral fix. | §8 |
| 2 | **High** | **The Content list ignores compact density.** The two ballot captures are byte-identical files. A ballot arm that cannot show its own difference. | §13 |
| 3 | **Medium** | **Prospect avatars are painted in the accent token** on Today and DMs (`div.av`, 28x28, accent background), spending the primary-action colour on identity decoration. Reportedly already being fixed. | §9 |
| 4 | **Medium** | **The draft window cannot display the frame arms at all** — the takeover covers the plate, and all three forced arms produced byte-identical captures. Asking a human to pick frame geometry there is a question with no visible difference. | §12 |
| 5 | **Low** | `span.wb-lad-l` (Ladder stage label) overflows its box by up to **63px** — the largest genuine overflow in the matrix. No page scrolls sideways as a result. | §11 |
| 6 | **Low** | 128 silent font-size victims remain dead and never re-asserted. Unchanged by this run, but unchanged is not fixed. | §7 |
| 7 | **Housekeeping** | A 0-byte untracked `prove.json` sits at the repo root, left by an earlier phase. Not deleted, since deletion is irreversible and gains nothing. | `git status` |

### Still to do (explicitly not measured)

1. **Service-worker deploy pickup** (§14) — must run last, alone.
2. **Clean console-error re-run** with the harness bug fixed, so 0 is stated
   rather than subtracted (§10).
3. **Today's call transcript reader** (`43efa56`, `0758dbc`) — a new surface,
   added after the sweep ran, not in the matrix.
4. **`no-internals.mjs` re-run** once the hardened version lands (§1).
5. **DMs accent re-measure** once the avatar leak fix lands (§9).
