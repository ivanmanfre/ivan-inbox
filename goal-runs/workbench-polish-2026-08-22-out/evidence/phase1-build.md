# PHASE 1 BUILD — the system primitives, as shipped

One new sheet, `src/exp/v2c/wbsys.css`, imported LAST in `Shell.tsx:71` (after
`wb2026.css`). Nothing was deleted from `faithful.css`. Every value below is a
`getComputedStyle` read out of a real browser at 1440x900 against the production
build at `http://localhost:4173/`, in both themes. The scripts are
`evidence/audit-tools/system-proof.mjs` (new) and `surface-pairs.mjs`
(pre-existing, re-run unchanged).

---

## 0 · THE TRAP, VERIFIED BEFORE A LINE WAS WRITTEN

| what | file:line | rule |
|---|---|---|
| the flattener | `src/exp/v2c/faithful.css:181` | `.wb.wb, .wb.wb *{ font-size:var(--fs-body); font-weight:400; letter-spacing:0; line-height:1.6 }` |
| font-family flatten | `src/exp/v2c/faithful.css:190` | `.wb.wb *{ font-family:inherit }` |
| first `.wb.wb.wb` re-assertion | `src/exp/v2c/faithful.css:123` | `font-variant-numeric` on form controls |

`.wb.wb` is 0-2-0 and `wbsys.css` is imported after `faithful.css`, so a
two-class selector would tie and lose on nothing but would be beaten by every
`.wb.wb.wb` rule already in the sheet. **Every component selector in
`wbsys.css` carries three `.wb` classes.** Because the flattener hits `*`, every
type declaration is restated on the leaf AND on its descendants
(`.wbb, .wbb *` / `.wbkv-k, .wbkv-k *`), or a `<span>` inside a button renders
at 16px. Token blocks are the deliberate exception at `.wb` (0-1-0): they must
tie `faithful.css:33` and win on source order.

This trap fired once during the build and was caught by the proof script, not by
looking: see §1's light-theme alias note.

---

## 1 · THE ELEVATION LADDER

### Dark (the spec's table verbatim)

| token | value | L | step to previous |
|---|---|---|---|
| `--e0` | `rgb(12,12,11)` | 0.0037 | - |
| `--e1` | `rgb(20,20,20)` | 0.0070 | 1.06:1 |
| `--e2` | `rgb(28,28,28)` | 0.0116 | 1.08:1 |
| `--e3` | `rgb(39,39,39)` | 0.0203 | 1.14:1 |
| `--e4` | `rgb(50,50,50)` | 0.0319 | 1.17:1 |

For scale: the app's existing `surface1 -> surface2` step measures 1.148:1, so
the `e2 -> e3` step a chip now takes is the same size as a step the app already
ships and reads fine.

### Light (CORRECTED — see the two measurements below)

| token | value | L |
|---|---|---|
| `--e0` | `rgb(244,244,240)` | 0.9023 |
| `--e1` | `rgb(230,230,224)` | 0.7880 |
| `--e2` | `rgb(255,255,255)` | 1.0000 |
| `--e3` | `rgb(234,234,228)` | 0.8194 |
| `--e4` | `rgb(255,255,255)` | 1.0000 |

**Correction 1 — light `--e2` and `--e3` cannot both be `#FFFFFF`.** The spec's
light column gives both as white, separated by a hairline. That is border-only
depth, the exact defect this phase removes: a chip on a card would be pure white
on pure white. The light ladder instead runs elevation as a tint away from the
white card, which is the direction the app's own light theme already runs
(`surface1 #FFFFFF -> surface2 #EFEFED -> surface3 #E3E3E0`).

**Correction 2 — the ground has to clear the raised tint.** With the spec's
`--e0 #F7F7F4` and a raised tint near `#EFEFEB`, a sticky section header on the
plate would differ from the plate by dL 0.002 and be invisible. `--e0` moved to
`#F4F4F0` and the raised tint to `#EAEAE4`; every adjacent pair now clears
dL 0.08.

### Aliases and the inversion check

`--canvas -> --e0`, `--surface1 -> --e2`, `--surface2 -> --e3`, both themes.
Measured signs, which must not flip against what ships today:

| relationship | today | after |
|---|---|---|
| canvas vs surface1, dark | child lighter | child lighter |
| canvas vs surface1, light | child lighter | child lighter |
| surface1 vs surface2, dark | child lighter | child lighter |
| surface1 vs surface2, light | child darker | child darker |

**Correction 3 — `--surface3` is NOT aliased onto `--e4`, and must not be.**
Static count across the three sheets: 83 readers, of which **35 are `border`,
`box-shadow` or `outline` declarations** and 48 are backgrounds. It is not an
elevation level in this codebase, it is the edge-and-track colour
(`border:1px solid var(--surface3)` appears 16 times in `wb2026.css` alone, and
it paints every progress track, meter bar and status dot in `styles.css`). In
the light theme `--e4` is `#FFFFFF`; aliasing would set 35 border and shadow
declarations to white, most of them drawn on a white `--e2` card, and every one
of those edges would vanish. That is exactly the "got lighter when it should
have got darker" regression the brief names.

**The trap firing, caught by the proof and not by eye.** The first cut declared
the aliases only at `.wb` (0-1-0). `faithful.css:161` declares the light palette
at `:root[data-theme='light'] .wb` (0-2-1), which wins regardless of import
order, so the computed read came back `--canvas rgb(247,247,245)` and
`--surface2 rgb(239,239,237)`: the ladder was live in dark and dead in light.
The aliases are now restated inside the light block.

`--hairline` drops from solid `rgb(48,48,48)` (L 0.0296, brighter than two of
the three surfaces it separated) to `rgba(255,255,255,.07)` in dark and
`rgba(0,0,0,.09)` in light.

---

## 2 · THE RADIUS SCALE

`--r-xs:6px --r-ctl:10px --r-card:14px --r-pill:999px`, with the legacy names
retargeted rather than the ~200 declarations rewritten: `--r-chip -> --r-xs`
(was 8px), `--r-hero -> --r-card` (was 20px). `faithful.css:91`'s
`--r-sm:var(--r-ctl); --r-md:var(--r-card); --r-lg:var(--r-hero)` chain
re-resolves on its own because custom properties resolve at use time
(12 -> 10, 20 -> 14, 20 -> 14). `--plate-r` untouched: it is a ballot arm.

Live census across six surfaces, distinct computed `border-radius` values:

| before | after |
|---|---|
| 6, 8, 10, 12, 16, 20, 40, 999 (8 values) | 4, 6, 10, 14, 40, 999 (6 values) |

Four literals could not be retargeted through tokens because they are written as
`px` in `src/styles.css`, the stock shell's sheet, which may not be touched.
They are pulled onto the scale from `wbsys.css` scoped under `.wb`:
`.td-card` / `.td-tile` / `.td-lanes` 16px -> `--r-card` (x5), `.pushbar` 12px
-> `--r-ctl` (x1).

Two survivors, judged and declined:

- `.wb-selmark` 4px (x11, `wb2026.css:186`) is a 14px-square selection checkbox.
  At 6px a 14px square reads as a circle, and a circle is a RADIO. That is a
  semantics regression traded for scale purity.
- `.li-card` 10px / `.li-btn` 8px (`styles.css:1197,1266`) are the LinkedIn
  preview, which imitates an external surface down to `#0a66c2` and `#fff`. It
  is not this app's chrome and must not join this app's scale. (Not present on
  the six census surfaces, hence absent from the table above.)

---

## 3 · THE CONTROL

Computed, dark. Padding and radius are **identical across all four variants**;
only fill, colour and the one inset differ.

| | height | padding | radius | size/leading | weight | fill | label | shadow |
|---|---|---|---|---|---|---|---|---|
| `.wbb-primary` | 32 | 0 14px | 10px | 13/13 | 500 | `rgb(184,255,102)` | `rgb(23,23,23)` | 1px inset top |
| `.wbb-secondary` | 32 | 0 14px | 10px | 13/13 | 500 | `--e3` | `--text` | none |
| `.wbb-quiet` | 32 | 0 14px | 10px | 13/13 | 500 | transparent | `--text2` | none |
| `.wbb-danger` | 32 | 0 14px | 10px | 13/13 | 500 | transparent | `--sev-danger` | none |
| `.wbb-sm` | 26 | 0 10px | 10px | 12/12 | 500 | (variant's) | (variant's) | (variant's) |
| `.wbb-lg` | 38 | 0 18px | 10px | 14/14 | 500 | (variant's) | (variant's) | (variant's) |
| `[disabled]` | 32 | 0 14px | 10px | 13/13 | 500 | `--e2` | `--text4` | none |

`:hover`, `:active`, `:focus-visible` and `:disabled` are declared for all four.
Hit target is 32px on pointer and 44px under `@media (pointer:coarse)`, expanded
with a transparent `::after` rather than by growing the 26px small variant.

**Correction 4 — the primary's label is `--ink`, not `--e0`.** `--e0` in the
light theme is `#F4F4F0`, which on the lime fill measures **1.08:1**. `--ink`
`#171717` is the codebase's existing contract for the label on a filled accent
mark and measures **14.96:1** in both themes, because the accent is the same hex
in both.

**Correction 5 — the focus ring is `--accent-ui`, not raw `--accent`.** Lime
`#B8FF66` on the light `--e2 #FFFFFF` measures **1.40:1** and fails the 3:1
floor for a non-text indicator. `--accent-ui` resolves to the accent in dark and
to `#5A8A00` (4.14:1 on white) in light. `faithful.css:411`'s claim that the
100% ring "clears at 4.85:1 worst case" was measured on the dark ladder only.
The rule also restates `border-radius:var(--r-ctl)`, because the global
`.wb.wb.wb :focus-visible` sets `border-radius:var(--r-chip)` on whatever it
lands on and would snap a focused control from 10px to 6px.

**Correction 6 — `--sev-danger` is a new token, split by theme.** `--sev-urgent`
`#FF453A` measures 3.41:1 on white and fails AA for a 13px label. Light gets
`#C4271C` (5.75:1 on `--e2`, 4.76:1 on `--e3`); dark keeps `#FF453A` at 5.00:1.

---

## 4 · THE METADATA PATTERN

Computed, both themes: `display:grid`, `grid-template-columns:minmax(84px,26%)
1fr`, `column-gap:16px`, `row-gap:6px`, `align-items:baseline`.
`.wbkv-k` 13px / weight 400 / `--text3` / `text-transform:none` /
`letter-spacing:normal`. `.wbkv-v` 14px / weight 450 / `--text` /
`font-variant-numeric:tabular-nums`. `border-top-width:0px` and
`background-color:rgba(0,0,0,0)` on both: no box, no border, no fill.

A `--hairline` rule appears between rows only past four rows, detected with
`.wbkv:has(> :nth-child(9))` (child 9 is the first cell of row 5).

---

## 5 · MOTION

| what | property | duration | easing |
|---|---|---|---|
| controls | `background-color, color` | 120ms | `ease-out` |
| overlays | `opacity, transform` | 260ms | `var(--spring)` |
| a row committing | `background-color` | 200ms | `ease-out` |

Never `all`, never a layout property. Computed read on `.wbb`:
`transition-property: background-color, color` — nothing else is transitioned.

**The spring, adopted mid-run from the Wispr calibration.** `--spring` is the
sampled `linear()` curve extracted from Wispr Flow's shipped bundle. Computed
read confirms it resolves and applies: the overlay probe reports
`linear(0 0%, 0.005 0.9%, 0.019 1.8%, ... 1 100%)` on both `opacity` and
`transform` at 0.26s.

**`linear()` support, as asked.** `CSS.supports('transition-timing-function',
'linear(0, 1)')` returns **true** in the Chromium this app is driven in.
Baseline is Chrome 113+, Safari 17.2+, Firefox 112+. An older engine treats the
whole declaration as invalid and silently drops to `ease`, losing the duration
with it, so `--spring` is declared as `cubic-bezier(.16,1,.3,1)` at `.wb` and
**upgraded inside `@supports (transition-timing-function:linear(0,1))`**. Both
engines get a deliberate value; neither gets a browser default.

`@media (prefers-reduced-motion: reduce)` collapse verified in a Playwright
context with `reducedMotion: 'reduce'`: `transition-duration: 0s`,
`animation-duration: 0s`, `matchMedia` matches.

### Shadows, under the revised rule

| token | value | used on |
|---|---|---|
| `--sh-card` | `0 2px 8px rgba(0,0,0,.08)` | `.dd-card`, `.td-card`, `.td-tile`, `.td-lanes`, `.td-mast` |
| `--sh-drag` | `0 2px 8px rgba(0,0,0,.12)` | `.cal-chip-drag`, `.cal-chip:active` |
| `--sh-over` | `0 10px 24px rgba(0,0,0,.12)` | `--e4-shadow`, `.wbs-overlay`, `.wb-plate` |

Nothing exceeds 12% alpha; computed read confirms `rgba(0,0,0,0.12)` as the
heaviest value anywhere. The shipped `.wb-plate` shadow was
`0 24px 60px -20px rgba(0,0,0,.5)`, **four times the cap**, and that is the
alpha that bleeds onto `--ground #C5E1A5`. Under the original rule it was
deleted outright; under the revised rule it is capped instead, sitting on top of
a lightness step that is already enormous. Deliberately NOT applied to
`.cal-day`: forty-two shadowed cells in a grid is texture, not depth.

`.dd-card .dd-card` gets its step and **no** second shadow: two stacked shadows
is the stack the rule bans.

---

## 6 · THE COLLISION WORKLIST

`out-surface-pairs.json` did not exist when this phase started, so it was
generated by running `surface-pairs.mjs` unchanged against the branch before any
of the above landed. That file is the before-state.

| | before | after |
|---|---|---|
| distinct SAME shapes | **26** | **12** |
| SAME instances, all screens | **73** | **25** |
| distinct child/parent pairs walked | 189 | 176 |

**Zero remaining SAME pairs where an object relationship is intended.**

### Fixed (14 shapes)

| shape | before | after |
|---|---|---|
| `div.cal-chip` on `div.cal-day` | both `rgb(31,31,31)`, r 12px | chip `--e3` `rgb(39,39,39)` r 6px, cell `--e2` `rgb(28,28,28)` |
| `div.cal-chip.cal-chip-lock` on `div.cal-day` | same | same fix |
| `div.cal-chip.cal-chip-lock.cal-chip-queue` on `div.cal-day` | same | same fix |
| `div.cal-chip.cal-chip-lock` on `div.cal-day.cal-day-out` | same | same fix |
| `div.cal-day.cal-day-empty` | transparent + `inset 0 0 0 1px` ring | `--e1` `rgb(20,20,20)`, ring dropped |
| `div.dd-card` in `div.dd-card` | both `rgb(31,31,31)`, nothing between | inner `--e3`, r `--r-ctl` |
| `div.ct-cmd` on `div.rows.ct-rows` | both canvas, no separator | `--e2` |
| `div.ct-tabs` on `div.rows.ct-rows` | both canvas + 1px border | `--e2`, border deleted |
| `div.wb-sech-strip` on `div.rows.ct-rows` / `div.rows.ops-rows` | both canvas, nothing | `--e2` |
| `div.wb-sech` on `div.wb-sech-strip` | both canvas + top/bottom 1px | `--e3`, both borders deleted |
| `button.wb-sech.tap` on `div.wb-sech-strip` | both canvas + top/bottom 1px | `--e3`, both borders deleted |
| `div.ops-sechdr` on `div.rows.ops-rows` | both canvas + top/bottom 1px | `--e2`, both borders deleted |
| `div.wb-pane-h.slim` on `div.wb-peer.wb-peer-thread.on` | both canvas + bottom 1px | `--e2`, border deleted |
| `img.ct-thumb` on `div.ct-anchor` | both `rgb(42,42,41)` | thumb `--e1` (it is a loading well) |

Plus two found in passing and fixed:

- **`button.cal-chip-t` computed `border: 2px outset rgb(0,0,0)`** on all four
  sides. That is the user-agent default button border; no rule in any sheet sets
  it. It was invisible only because black `outset` on `#1F1F1F` is nearly the
  same colour, and it would have appeared as a 2px bevel the moment the chip
  lightened, which is the exact artefact this phase removes. `border:0` added.
- **`div.td-zh` on `section.td-zone`, a pair that did not exist before.**
  `.td-zh` is grouped with `.wb-sech` in `faithful.css:655` but, unlike the
  others, sits inside a painted `section.td-zone` rather than on the bare list.
  At `--e2` it landed on an `--e2` parent. Fixed to `--e3` inside a zone. This
  is why the audit is re-run rather than the starting worklist trusted.

### Judged not-a-bug (12 shapes, all that remain)

Every one is a **coextensive structural region wrapper**: same colour as its
parent because it IS the same surface, occupying 93-100% of the parent's box,
with no object relationship intended, and — after this phase — carrying no
border either, so none of them is a border-only-depth case any more.

| shape | geometry vs parent |
|---|---|
| `div.wb-regions.peers-0` on `div.wb-plate` | 1184x860 in 1400x860 |
| `div.wb-regions.peers-1` on `div.wb-plate` | 1184x860 |
| `div.wb-work.wide.wb-solo` on `div.wb-regions.peers-0` | 1184x860, identical |
| `div.wb-work.wide` on `div.wb-regions.peers-0` | 1184x860, identical |
| `div.wb-work.list` on `div.wb-regions.peers-1` | 592x860, a column split |
| `div.wb-peer.wb-peer-thread.on` on `div.wb-regions.peers-1` | 592x860, a column split |
| `div.rows.ct-rows` on `div.wb-work.wide.wb-solo` | 1184x854 in 1184x860 |
| `div.rows` on `div.wb-work.wide.wb-solo` | 1184x797 |
| `div.rows.ops-rows` on `div.wb-work.wide` | 1184x798 |
| `div.rows.td-rows` on `div.wb-work.wide` | 1184x780 |
| `div.rows.settings` on `div.wb-work.wide` | 1184x798 |
| `div.rows` on `div.wb-work.list` | 591x753 |

**Correction 7, and it is the one I most want on the record.** The brief named
`div.rows.ct-rows` as a must-fix and said to replace its border with a step. The
step went to the **other half of the pair**, and here is the measurement that
forced it. `.rows` is the scroll container. `--e1` is where the spec puts a
scroll well, so receding `.rows` to `--e1` is the literal reading. But the
calendar's chain is `.rows.ct-rows -> .cal (transparent) -> .cal-day`, so
`.cal-day` currently sits **1.15:1** above its container (`--e0 -> --e2`).
Receding `.rows` to `--e1` makes that **1.08:1** — and it does the same to every
card in the app, since `.dd-card`, `.td-card` and `.ct-card` all sit on `.rows`.
That trades a measurable loss on the single most important surface in the phase
for a container-on-container pair nobody perceives. So instead: the sticky
chrome that sits ON the list (`.ct-cmd`, `.ct-tabs`, `.wb-sech-strip`,
`.ops-sechdr`, `.wb-pane-h`) took `--e2`, the `.wb-sech` pill inside took
`--e3`, their borders were deleted, and `faithful.css:2293`'s
`.rows{ border-top:1px solid var(--hairline) }` was deleted as now-redundant.
The border-only depth is gone; the card contrast is untouched.

---

## 7 · CONTRAST, MEASURED IN BOTH THEMES

Every text/background pair the system creates. Minimum 4.5:1 (all of these are
small text; none of the system's text is large-scale).

| pair | dark | light |
|---|---|---|
| `--text` on `--e1` | 18.42 | 14.83 |
| `--text` on `--e2` | 17.05 | 18.58 |
| `--text` on `--e3` | 14.94 | 15.39 |
| `--text` on `--e4` | 12.82 | 18.58 |
| `--text2` on `--e2` | 10.08 | 10.88 |
| `--text2` on `--e3` | 8.83 | 9.01 |
| `--text3` on `--e1` | 6.07 | 5.35 |
| `--text3` on `--e2` | 5.62 | 6.70 |
| `--text3` on `--e3` | **4.92** | 5.55 |
| `.wbb-primary` label on fill | 14.96 | 14.96 |
| `.wbb-secondary` label on fill | 14.94 | 15.39 |
| `.wbb-quiet` label on `--e2` | 10.08 | 10.88 |
| `.wbb-danger` label on `--e2` | 5.00 | 5.75 |
| `.wbkv-k` on `--e2` | 5.62 | 6.70 |
| `.wbkv-v` on `--e2` | 17.05 | 18.58 |

**Worst case: 4.92:1 dark, 5.35:1 light. Zero failures.**

Non-text indicators: the focus ring at `--accent-ui` measures 4.14:1 on the
light `--e2` against a 3.0 floor (raw lime would have been 1.40:1).

---

## 8 · GATES

- `npm run build` (which runs `tsc -b`): clean.
- `npm test`: **906 passing, 1 failing** — `src/lib/calendarItems.test.ts:295`,
  the known pre-existing failure. Unchanged from the baseline.
- `#exp/stock`: **provably untouched.** Static check — every selector in
  `wbsys.css` contains `.wb` (zero exceptions). Live check on the stock route —
  `document.querySelectorAll('.wb').length === 0`, and zero rules from this
  sheet are even present in `document.styleSheets` there, because `wbsys.css` is
  imported only by `src/exp/v2c/Shell.tsx` and that chunk does not load on the
  stock route.
- `--ground: #C5E1A5` unchanged. `--plate-r` / `--plate-gap` unchanged.
- No new runtime dependency. The spring is pure CSS.
- No prospect-facing copy, no database, no n8n.

## 9 · THE BALLOT ARM IS LEFT CHEAP TO TEST

Wispr's warm off-white ink `#deddd7` on a lifted `#1a1a1a` ground is the
orchestrator's ballot arm and is NOT built here. Nothing in `wbsys.css`
hardcodes a ground or an ink: every surface reads `--e0`..`--e4` and every label
reads `--text` / `--text2` / `--text3`, so testing that arm later is a five-line
override of one token block.

## 10 · ARTEFACTS

- `src/exp/v2c/wbsys.css` — the sheet.
- `src/exp/v2c/Shell.tsx:71` — the import.
- `evidence/audit-tools/system-proof.mjs` — the computed-style proof, both
  themes plus a reduced-motion context.
- `evidence/audit-tools/out-system-proof.json` / `.txt` — its output.
- `evidence/audit-tools/out-surface-pairs.json` — the AFTER state.
- `evidence/audit-tools/out-surface-pairs-BEFORE.json` — the BEFORE state, kept
  because the script writes to a fixed filename and the after-run overwrites it.
- `after/p1-*.png` — calendar, calendar-light, content, ops, today, today-light,
  stock.
