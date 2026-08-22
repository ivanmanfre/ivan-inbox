# Draft window, candidate A - fix it in place

Branch `polish/dwa`, worktree `/Users/ivanmanfredi/Desktop/ivan-inbox-pw-dwa`.
Surface: `#exp/v2/content`, a draft opened.
Ivan: *"this section looks like an internal tool ui not polished at all"*, inside
*"this still looks like a 2013 design"* and *"it doesn't need to change a lot"*.

**The bet.** The three regions do not move: queue rail left, artifact centre,
inspector right. Everything below is elevation, hierarchy, spacing rhythm,
control weight, the metadata pattern, type roles, motion, and where the accent
is spent. Nothing was rearranged that was not measured as broken.

## What is on disk

| file | what it is |
|---|---|
| `src/exp/v2c/dwsys.css` | new, 640 lines. Every selector carries three `.wb` and lives inside `.dw`. Composes wbsys.css's `--e0..--e4`, `--r-*`, `.wbb`, `--spring`, `--sh-*`. No parallel primitives. |
| `src/exp/v2c/DraftPane.tsx` | the action row's two tiers, the stage wrapper, the tab indicator, "Details", the identifier disclosure, the schedule panel's move into the bar |
| `src/exp/v2c/Register.tsx` | the rubric leads with what failed; the score meter and the bars come off the accent |
| `src/exp/v2c/Shell.tsx` | one import line |

`src/styles.css` is untouched. `src/exp/v2c/styles.css`, `faithful.css` and
`wb2026.css` are untouched, so `.dw-key` keeps every rule it had and
`MagnetWindow` keeps reading them.

## The instruments

- `evidence/dwa-probe.mjs` - accent census scoped to `.dw`, the uppercase
  census, the metadata row heights, the artifact measure, the action row's
  computed geometry.
- `evidence/dwa-capture.mjs` - the ten screenshots, same viewports / same act /
  same crops / same jpeg quality as `evidence/capture.mjs`, so the before and
  after sets are one instrument pointed at two builds.
- `evidence/dwa-urn-proof.mjs` - defect 1 proved on a row that carries a urn.
- `evidence/dwa-proof.json` - the computed-style table, the accent list, the
  motion values, the reduced-motion values, the `#exp/stock` check.

Every one of them installs the write interceptor on `**/rest/v1/**` **and** on
`**/rest/v1/rpc/**` before any navigation, and counts what it blocks.

**Attempted writes across every run in this session: 0.** Console errors: 0.

---

## The seven defects

### 1 · `urn:li:activity:7496174424996585473` printed under "Spun from post"

Still present in code on this branch when the run started (`DraftPane.tsx:994`);
no other agent's label purge had landed here.

The live proof draft has `source_post_id` NULL, so the row could not be shown by
opening it. `dwa-urn-proof.mjs` rewrites the GET in the browser to fill the field
with the exact string the audit named - a read rewrite, nothing written.

| | before | after |
|---|---|---|
| in the DOM | yes | yes, verbatim, nothing truncated |
| visible at rest | **yes**, first row of the Source panel | **no** |
| where | `Rows` at 16px/400, same weight as the words beside it | behind `Identifiers · 2 keys` |
| its type | 16px/400 `--text` | 12px/400 `--text3`, tabular |
| Source panel at rest | `["Source manual", "Candidate 5fa0…"]` | `["Source manual"]` |

Shots: `after/dwa-defect1-urn-deferred-1440x900-dark.jpg` (at rest) and
`after/dwa-defect1-urn-disclosed-1440x900-dark.jpg` (opened, showing nothing was
dropped).

A row key is a lookup: you arrive at it with a question, never by reading past
it. Same density decision as the rubric below. **Kept small on purpose** - one
build block plus one `Fold` - so a merge with the app-wide label purge is easy.

### 2 · A panel header reading "BACKEND DEPTH"

`faithful.css:3359` uppercases `.res-hdr, .dw-insp-h, .dw-queue-h` together, so
sentence-casing one and leaving the others would have been two registers for one
job.

| | before | after |
|---|---|---|
| words | "Backend depth" (system vocabulary) | "Details" |
| computed | 13px/600, `letter-spacing:.65px`, **uppercase** | 13px/500, `letter-spacing:normal`, **none** |
| the queue rail's head | "IN THIS QUEUE", 13px/600 uppercase | "In this queue", 13px/500, none |
| uppercase text elements inside `.dw` | **228** | **0** |

The four jumps were bold uppercase pills with the active one carrying a grey
fill. They are a segmented control in a recessed `--e1` well now, 12px/500
sentence case, and the active segment is a single indicator that travels.

### 3 · Seven action buttons of one weight

Census C3 already said which half was broken: all seven were **already
geometrically identical** and varied only in fill. Geometry was never the defect.
Five of the seven being the same grey rectangle was.

Measured before, on this branch: 7 buttons, every one `44px` tall, `0 13px`,
`r10`, `13px/600`; fills `rgb(184,255,102)` ×1, `rgb(39,39,39)` ×5,
`rgba(255,69,58,.08)` ×1; Delete alone on a second row as a red-outlined box.

After, from `dwa-proof.json`:

| button | class | height | padding | radius | type | fill |
|---|---|---|---|---|---|---|
| Approve | `wbb wbb-primary` | 38 | `0 15px` | 10 | 13px/500 | `rgb(184,255,102)` |
| Edit | `wbb wbb-secondary` | 38 | `0 15px` | 10 | 13px/500 | `rgb(39,39,39)` |
| Schedule | `wbb wbb-secondary` | 38 | `0 15px` | 10 | 13px/500 | `rgb(39,39,39)` |
| Regenerate | `wbb wbb-quiet` | 32 | `0 11px` | 10 | 12px/500 | transparent |
| Swap image | `wbb wbb-quiet` | 32 | `0 11px` | 10 | 12px/500 | transparent |
| Back to idea | `wbb wbb-quiet` | 32 | `0 11px` | 10 | 12px/500 | transparent |
| Delete draft | `wbb wbb-danger` | 32 | `0 11px` | 10 | 12px/500 | transparent, `--sev-danger` label |

**Four weights where there was one and a half.** Padding and radius are constant
within each tier and only fill and border change, which is Linear's rule and the
constancy that keeps a row reading as one family.

**Two tiers, not two wrapped lines.** Seven labels measure ~615px of text against
a 640px measure, so one row wrapped at every viewport and wrapped differently as
the labels changed. The bar is authored as DECIDE then REMAKE. Delete rides at
the far end of the remake tier - the corner diagonally opposite Approve - and it
is a red label, not a red box on a row of its own. Its name is verb plus noun
now, per Geist's rule for a destructive control.

Crops: `before/03-draft-window-actions-1440x900-dark.jpg` against
`after/dwa-03-draft-window-actions-1440x900-dark.jpg`.

**Found by opening every state, not by looking at the resting one.** The confirms
that unfold inside the bar were a second design: a red-tinted box with a red 1px
edge holding a red question rendered at 16px because the flattener eats the
authored size, and two full-width `.btn`s. The destructive colour is now on a 2px
rail and on the button that performs the act, and the box, the border and the
question are neutral. `after` states are in `evidence/dwa-proof.json`'s siblings
and were reviewed at 1440 for Delete, Regenerate, Schedule and Edit.

The **schedule panel moved into the bar**. It rendered at the foot of the
scrolling column, so the one affordance in this window that arms a publisher
opened below the fold while its own trigger stayed pinned on screen - the exact
defect D13 moved Regenerate and Delete out of. Every word of its confirm sheet is
untouched.

### 4 · "Post note", a full-width lime slab

| | before | after |
|---|---|---|
| size | 331 × 49.6 | 87 × 32 |
| area | 16,414 px² | 2,777 px² |
| against Approve (3,562 px² → 3,106 px²) | **4.61×** | **0.89×** |
| weight | `.btn.p`, accent fill (`faithful.css:519`) | `wbb wbb-secondary` |

### 5 · Inspector rows: ALL-CAPS label plus value in bordered boxes

`Rows`/`KeyRows` are shared with Ops and the magnet window, so the markup was not
rebuilt; the `.dd-card > .dd-row > .dd-k/.dd-v` shape is retargeted onto
`.wbkv`'s geometry **scoped inside `.dw-insp`**. One pattern change, one surface
touched.

| | before | after |
|---|---|---|
| rows measured | 21 | 21 |
| key computed | **16px / 400 / UPPERCASE** (authored 12px/600 at `styles.css:254`, dead against the flattener) | **13px / 400 / none / ls 0**, `--text3` |
| value computed | 16px / 400 | **14px / 450**, tabular, `--text` |
| container | `--surface` card, `r14`, 14px padding, a `.5px` rule under every row | no border, no fill, no box; a `--hairline` between rows only |
| min row height | 45.6px | **30.3px** |
| median row height | 71.2px | **45.8px** |
| rows under 40px tall | **0 of 21** | **10 of 21** |

The remaining rows over 40px are two-line keys and multi-line values; nothing was
shrunk to make a number.

**The density decision, not a compression.** The QA rubric was nine
near-identical bars of which exactly one was under the judge's own 70% mark. It
now leads with the dimensions that failed and defers the rest behind a count that
states what it holds:

> Distinct ▇▇▇▇▇▁▁▁ 6/10
> › 8 dimensions at or above the mark

Both degenerate cases go the safe way: nothing failed, the full list stays open
and the panel reads as it did; **most** failed, the fold opens by default so it
can never hide the finding. The judge's SCREAMING_SNAKE names are sentence-cased
on the way to the screen with AI kept as an initialism.

The Source panel takes the same decision (defect 1). The fold header now keeps
its label: `.qa-fold-t` is `margin-left:auto` and the applied-rewrite tail is 46
characters, so at 340px the flex line had squeezed `.qa-fold-k` to zero and the
row rendered as its own tail with no label. Ellipsising it clipped a fact rather
than a decoration, so the line wraps instead and nothing is cut.

### 6 · The middle column runs wide, dead field under the buttons

One correction to the brief, from measurement: the action bar did **not** span
1250px on this branch. It was already 640px wide at `left:336`, the same measure
as `.dw-main-in`. What did reproduce is the dead field, and a control row bounded
by nothing.

The artifact and the row that decides its fate are one object now: a resting
`--e2` card holding the post in an `--e1` well, with the row as its own footer,
`r14`, `--sh-card`. Reference move 8.

| at 2560×1440 | before | after |
|---|---|---|
| `.dw-main` width | 1320 | 1320 |
| `.dw-main-in` max-width | **640px** | **640px** |
| `.li-card` width | **520** | **520** |
| action row width | 640, closed by a hairline spanning the measure | 608, closed by the card it belongs to |
| bare column under the row | ~443px (read off `before/03-draft-window-2560x1440-dark.jpg`) | 378px, and it is now `--e1` ground under a bounded card rather than the tail of an unfinished column |

**The measure did not move and was verified after every commit.** The surplus
went to structure around the artifact: the three columns took the lightness step
(`--e0` rails, `--e1` work ground, `--e2` stage) and dropped the `.5px` rules
that were the only thing separating them, which is ladder rule 3.

### 7 · Thirteen lime-weighted elements on one screen

Measured with the same definition census B3 uses (accent as fill, as the colour
of an element that paints its own text, or as a border/outline/shadow colour),
scoped to `.dw`.

**Before - 13:**

| n | element |
|---|---|
| 1 | `button.dw-key.p` Approve, fill + edge |
| 2 | `span.wb-qa-fill`, the 82 score meter, fill |
| 3–10 | eight `i` inside `.qa-dim-g`, the passing QA dimension bars, fill |
| 11 | `button.btn.p` "Post note", 331×50 fill |
| 12 | `button.dw-qrow.on`, the selected queue row's 2px lime rail |
| 13 | `span.dw-qrow-i`, its lime ordinal |

**After - 1:** `button.wbb.wbb-primary` Approve, fill.

Plus **one lime tint**, `button.dw-qrow.on` at `--accent-soft` (14% alpha) behind
neutral text, which is the third licensed role in phase1 §4 and is reported
separately rather than folded into the count.

The dimension bars and the score meter take `--sev-clear` / `--sev-attention`. A
score is a measurement, not a call to action, and eight lime bars beside one
orange one is exactly how the single failing dimension stayed hidden.

---

## Motion

The rule from the Wispr extraction: colour gets a plain short ease, anything that
moves gets the spring. Three things move and each animates transform and opacity
only.

```
tab indicator   transform 0.26s linear(0 0%, 0.005 0.9%, … 0.997 67.3%, 1 100%)
disclosure caret transform 0.26s linear(…)          same curve
the window       0.26s linear(…) both dwa-in        opacity + translateY(6px)
every control    background-color 0.12s ease-out, color 0.12s ease-out
```

`width`, `height`, `top` and `transition: all` appear nowhere in the sheet. The
indicator is a 1px box translated and scaled off a left origin rather than a box
whose `left` and `width` animate.

Under `prefers-reduced-motion: reduce`:

```
tabIndicatorDuration  0s
dwAnimationDuration   0s
dwAnimationName       none
dwOpacity             1
wbbDuration           0s
```

`animation-name: none` is restated rather than left to wbsys's `0ms`, because an
animation with `both` holds its FROM state at zero duration and would leave the
window invisible rather than still.

---

## Computed-style proof

Every type value authored in `dwsys.css`, read off the running build. Each one
resolves to what was written, which is the whole point of the three-`.wb` rule:
`faithful.css:181` is `.wb.wb, .wb.wb *` at specificity 0-2-0 and a two-class
selector loses to it silently. Verified live on this branch before a line was
written: `.dw-insp .dd-k`, authored `12px/600` at `styles.css:254`, computed
`16px/400`.

| element | computed |
|---|---|
| `.dw-insp-h` panel header | 13px / 500 / lh 18.85 / ls normal / none |
| `.dw-queue-h` rail header | 13px / 500 / none / ls normal |
| `.dw-insp-j .dw-jump` tab | 12px / 500 / none |
| `.dw-sec-h .dw-sec-n` | 13px / 600 / none |
| `.dw-sec-h .dw-sec-t` | 13px / 400 |
| `.dw-insp .dd-k` | 13px / 400 / lh 18.85 / none / ls normal |
| `.dw-insp .dd-v` | 14px / 450 / lh 20.3 |
| `.dw-insp .dwa-id` | 12px / 400 / `rgb(148,148,148)` |
| `.qa-dim-k` | 12px / 400 / none |
| `.qa-dim-n` | 12px / 500 |
| `.dw-insp .wb-qa-n` | 30px / 600 / lh 30 |
| `.dw-insp .qa-p` | 13px / lh 19.5 |
| `.dwa-dims-rest > summary` | 12px / 400 |
| `.dw-acts .wbb-primary` | 13px/500, h 38, pad-l 15, r10, `rgb(184,255,102)` on `rgb(23,23,23)` |
| `.dw-acts .wbb-secondary` | 13px/500, h 38, pad-l 15, r10, `rgb(39,39,39)` |
| `.dwa-acts-remake .wbb-quiet` | 12px/500, h 32, pad-l 11, r10, transparent, `rgb(199,199,199)` |
| `.dw-acts .wbb-danger` | 12px/500, h 32, pad-l 11, r10, transparent, `rgb(255,69,58)` |
| `.dw .ct-chip` | 12px / 400 / none |
| `.dw-cap-t` | 20px / 600 / lh 26 |
| `.dw-qrow-t` | 13px / 500 (selected row) |

Leading is the lever the Wispr measurement identified: the metadata value runs
14px on a 20.3px line and the judge's prose 13px on 19.5px, against 16px on a
25.6px line before.

**The artifact measure, checked after every commit:**
`.dw-main-in` width **640**, `max-width` **640px**, `.li-card` width **520**.
Unchanged at 1440, 2560 and 390.

**`#exp/stock`:** 0 `.wb` nodes, 0 `.dw` nodes, 0 rules from this sheet present
in its stylesheets. Nothing in `dwsys.css` can reach it, and `src/styles.css` has
no diff.

---

## Build, tests, safety

```
npm run build   clean (tsc -b, then vite build, 0 errors)
npm test        906 passing, 1 failing
                the failure is the pre-existing src/lib/calendarItems.test.ts
                "passing no queue is the old behaviour exactly", established as
                the baseline BEFORE any edit and unchanged after every commit
attempted writes  0
console errors    0 across all six viewport/theme captures
new dependencies  0 (the app has three and keeps three)
database / n8n / migrations   none touched
prospect-facing copy          none touched
em dashes in anything authored here   0
```

## Screenshots

`goal-runs/workbench-polish-2026-08-22-out/after/`, framed to match `before/`:

```
dwa-03-draft-window-1440x900-dark.jpg      dwa-03-draft-window-1440x900-light.jpg
dwa-03-draft-window-2560x1440-dark.jpg     dwa-03-draft-window-2560x1440-light.jpg
dwa-03-draft-window-390x844-dark.jpg       dwa-03-draft-window-390x844-light.jpg
dwa-03-draft-window-actions-1440x900-dark.jpg
dwa-03-draft-window-actions-390x844-dark.jpg
dwa-03-draft-window-inspector-1440x900-dark.jpg
dwa-03-draft-window-inspector-390x844-dark.jpg
dwa-defect1-urn-deferred-1440x900-dark.jpg
dwa-defect1-urn-disclosed-1440x900-dark.jpg
```

---

## What still reads as an internal tool to me

The window is calmer, but the inspector is still a database viewer with better
manners. "Gate detail · 1 gate", "Verdict provenance · 3 fields", "Other QA
fields", "Taxonomy · other keys" - those are table names wearing sentence case,
and no amount of type work turns a fold labelled by its column into something a
person came here to read. The panel is organised by where the data is stored
rather than by what a reviewer is deciding, and that is a content problem I did
not have the mandate to solve: I made the row keys quiet and one disclosure away,
which hides the symptom. The Log panel is the clearest case. It prints ten agent
names and ten timestamps with a glyph each, and a reviewer's actual question
about it is "did anything go wrong", which the panel answers only by making you
read all ten rows. The same is true of the Fields tab, which is eleven rows of
lookup at rest and would take the rubric's treatment well. And the judge's prose
still arrives as a 708-character paragraph with a "Show all" under it, which is a
gate's internal monologue rendered faithfully rather than a verdict written for a
human. Those are the three places where this still reads as a tool that reports
its own internals rather than a surface that answers a question, and none of them
are fixable with elevation, hierarchy or type.
