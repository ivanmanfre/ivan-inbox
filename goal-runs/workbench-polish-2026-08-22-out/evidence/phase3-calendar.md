# Phase 3, the calendar. What shipped, and what it measured.

Branch `polish/cal`, worktree `/Users/ivanmanfredi/Desktop/ivan-inbox-pw-cal`.
Ivan, twice, looking at the month grid: *"look at the calendar pills they look like ugly 3d"*
and *"there is a green background that is taking some space from us."*

Every number below is measured in a browser against his own session, GET only.
**Writes that reached the database: 0.** See §8.

---

## 1. The chip probe, before and after

`goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs`, run verbatim against this
build. Raw JSON in `evidence/cal-tools/probe-before-*.json`, `probe-after-*.json` and
`chip-probe-after.json`.

| | orchestrator's baseline | before (this branch, post phase 1) | after |
|---|---|---|---|
| chip size | 108x87 | 108x83 | **108x32** |
| chip background | `rgb(31,31,31)` | `rgb(39,39,39)` | `rgb(39,39,39)` |
| cell background | `rgb(31,31,31)` | `rgb(28,28,28)` | `rgb(28,28,28)` |
| same colour as its cell | **yes** | no | **no** |
| relative luminance step | **0.0000** | 0.0087 | **0.0087** |
| border radius | 12px | 6px | **6px** |
| box shadow | none | none | **`0 2px 8px rgba(0,0,0,.08)`** |
| cell height | 124px | 120px | **86px floor, grows with content** |
| chip share of cell | **70%** | 69% | **37%** |
| `cellsWithOverflow` | 0 | 0 | **0** |
| native `title` on a chip | yes | yes | **no** |

The 3D was a **missing lightness step**, not a shadow to remove. Phase 1 had already put the
chip on `--e3` and the empty cell on `--e1`, which is why the before column on this branch
reads 0.0087 rather than 0. What this phase added on top of it:

- the cell with content states `--e2` explicitly rather than inheriting it through the
  `--surface1` alias, so a later edit to the alias cannot silently flatten the pair again;
- `--sh-card` at **8% alpha**, sitting **on top of** the step and never instead of it;
- the user-agent `border: 2px outset rgb(0,0,0)` on `button.cal-chip-t`, which no sheet sets
  and which was invisible only because black `outset` on `#1F1F1F` is nearly the same colour.
  On `--e3` it would have appeared as a 2px bevel, which is the exact artefact being removed.

The previous run stripped the chip's fill and its ring precisely because they looked raised,
deleting the last cue. That is not repeated here.

## 2. Height ratio, at both viewports and then some

Gate: at most 45% of cell height at 1440 and at 390.

| viewport | theme | chip | cell | ratio | verdict |
|---|---|---|---|---|---|
| 1440x900 | dark | 32px | 86px | **37%** | pass |
| 1440x900 | light | 32px | 86px | **37%** | pass |
| 390x844 | dark | 40px | 93px | **43%** | pass |
| 390x844 | light | 40px | 93px | **43%** | pass |
| 2560x1440 | dark | 32px | 86px | **37%** | pass |

Before: 69% at 1440, 56% at 390.

**Height is fixed, not minimum.** `min-height` on a two-line clamped title has no ceiling, so
the longest title in the month set the height of every row in the grid. The chip is now
`height: var(--cal-chip-h)`, and the row count is what flexes.

**The mobile numbers are the same DOM.** Below 767px the grid is an agenda list in CSS. The
cell there is a heading with rows under it rather than an object, so §2's fill, radius and
ring are explicitly switched back off, which keeps the step intact as chip `--e3` on the
pane's `--e2`. Nothing reads a viewport in JS.

**The cell floor moved twice, and the second move was a correction.** It went to 122px so two
chips and a "+N" always fit, which left a 32px chip in a 122px cell and made a sparse month
read emptier than the one Ivan complained about. The floor is the EMPTY case, not the full
one: a `.cal-day` is a flex column in a grid row that sizes to its tallest cell, so the floor
dropped to 86 and busy days grow. One chip costs 63px, two cost 98, two and a "+N" cost 119.
Six rows of month cost 732px at the old floor and 516 at this one.

## 3. The two-post day, and the overflow

**The month has neither.** `daysWithTwoPlus: 0` in every before-probe: 13 dated posts across
13 separate days. So the case was **constructed**, and saying so is the point.

`evidence/cal-tools/cal-fixture.mjs` intercepts the GET on `carousel_drafts` and **appends**
five synthetic rows to the response, every one titled `Fixture:` on its face. Two land on the
6th and three on the 19th. Nothing is written; this is a read rewritten in flight, in one
browser, for one screenshot.

It took three attempts and the two failures are worth recording:

1. Rows were relocated by `scheduled_at.startsWith('2026-08')`. That matched 5 rows on a month
   the grid was drawing 13 of, because `scheduled_at` is UTC and the grid buckets by LOCAL day.
2. Parsed properly, and `published_at` moved too, because `calendarItems.ts:143` places a
   published chip on the day it actually went out and 12 of the 13 are published. That produced
   one three-post day and no two-post day: which rows SURVIVE into the grid depends on stage,
   on the queue dedup and on the lane filters, none of which the response body can be read for.
3. Appending rows instead of relocating them. The fixture now knows what it produced.

Measured, `evidence/cal-tools/fixture-shape.json`:

| day | chips in DOM | chips painted | "+N" | cell height | cell scrolls |
|---|---|---|---|---|---|
| Aug 6 | 2 | **2** | none | 103px | no |
| Aug 19 | 3 | 2 | **"+1 more"** | 124px | no |

Shots: `after/cal-two-post-day-1440x900-dark-fixture.jpg` and
`after/cal-overflow-panel-1440x900-dark-fixture.jpg`, the second with the panel open listing
all three.

**The cap is CSS, not JS**, and that is load-bearing. React renders every chip and the true
count on the "+N"; `wbcal.css §2` hides the third and beyond above 767px. Below 767px the same
DOM is an agenda with no height to run out of, the cap is off, and every chip draws. A JS
slice would have deleted the third post from the phone as well.

The mechanic is FullCalendar's `dayMaxEventRows`: cap the ROWS, put the rest behind a "+N"
that opens a popover, and never let chip height be the variable. Two posts render as two chips;
three render as two chips and a "+1", the "+N" row counting as the third row.

## 4. The stage vocabulary, and the call I had to make

Five stages, plus a queue-only variant, plus a drift warning. Then the `wb/polish` merge landed
a **sixth axis on the same object**: `data-arm` (armed / planned / out), rendering the literal
word `Armed` or `Planned` beside the clock.

The merged build showed what it cost: `10:00 ARMED` on the 24th collided with the corner
control and clipped. The word takes roughly 45px of a 93px content width, and the title is what
says which post it is.

**The call, made deliberately: at grid size the arming word becomes a glyph, and the word is
restored in three places that have room.**

| state | mark | shape carries | colour |
|---|---|---|---|
| armed | `●` filled | something holds this post | `--text4` |
| planned | `○` hollow, dotted rail | a date, and nothing behind it | `--sev-attention` |
| stuck | `▲` | armed and late | `--sev-urgent` |
| published | `✓` (the existing tick) | it went out | `--sev-clear` |
| queue only | `⇢`, dashed rail | no draft row behind it | inherited |
| drift | `⚠` | the two tables disagree | `--sev-attention` |

Filled versus hollow is the axis `polish/p4a` needs, so the two merge rather than fight. Colour
is the second cue and never the only one. The word survives in the popover, in the accessible
description, and in the count in the bar (`1 armed  0 planned  12 posted`); below 767px the chip
is 342px wide and the word **stays on the face**, which is a CSS decision on the same DOM.

It is drawn as a `::before` on `.cal-chip-h` keyed off attributes `p4a` already sets, so this
phase touches none of the lines that branch owns. Decorative by construction, which is correct:
it is a redundant encoding of something the description already says in words.

## 5. The popover, anchored, at every edge

`ContentCalendar.tsx:363` passed `title={tip}`. A native title cannot be styled, waits about a
second, is unreachable by keyboard, and lands where the browser likes. Replaced with
`CalPopover.tsx`: `createPortal`, `getBoundingClientRect`, arithmetic. **No new dependency**;
`react-dom` is already one of the three. CSS anchor positioning was the other candidate and was
rejected: `anchor-name` is Chrome-only, so it would have been a fallback path *plus* this path.

🔴 **The portal target is `.wb`, not `document.body`.** The first cut got it wrong in a way that
looked fine in the DOM: the tokens (`--e4`, `--hairline`, `--sh-over`, `--spring`) are declared
on `.wb`, and every selector in these sheets is written `.wb.wb.wb .thing` per `faithful.css:181`.
A panel in `document.body` matched no rule at all and measured **1440x18, parked at y=900**,
off the bottom of the viewport. That is the same class of bug as the one this phase exists to
fix, found by measuring rather than by looking.

`evidence/cal-tools/cal-popover.mjs`, **25 checks, all pass**. Each hovers a chosen extreme and
asserts three things: the panel is inside the viewport on all four sides, it does not overlap
the CELL it describes, and its left edge is within 400px of its chip (a viewport-corner tooltip
fails that by hundreds of pixels).

| viewport | theme | first | right edge | left edge | bottom edge | keyboard |
|---|---|---|---|---|---|---|
| 1440x900 | dark | pass | pass | pass | pass | pass |
| 1440x900 | light | pass | pass | pass | pass | pass |
| 2560x1440 | dark | pass | pass | pass | pass | pass |
| 390x844 | dark | pass | pass | pass | pass | pass |
| 1280x520 | dark | pass | pass, **flips above** | pass | pass | pass |

The right edge at 1440 is the case that breaks without a clamp: the Saturday cell spans
x 996 to 1116 and the panel is 337px wide. Measured at left 1005, right **1342**, top 475,
against a cell whose bottom is 467. Inside the viewport, below the cell, touching neither.

The 1280x520 row exists because every other canvas has room below the cell, so `below` always
wins and the **flip branch never runs in a browser**. A short viewport forces it, and it is
also covered by six unit tests on the exported pure `place()` (both edges, both corners, and
the case where neither side fits and the panel is clamped into view rather than pushed off).

Keyboard: focus opens it, `aria-describedby` is set to the panel's id while open, Escape closes
it. `role="tooltip"`; the overflow panel is `role="dialog"` with a light-dismiss scrim, focus
moved into it and returned to the "+N" on close. A queue chip's face is a `<span>` and now
carries `tabIndex={0}`, because it holds the one sentence explaining why it is inert and a
description a keyboard cannot reach is the defect being removed.

Shots: `after/cal-popover-right-edge-*.jpg`, `after/cal-popover-bottom-edge-*.jpg`.

## 6. The frame: three arms, and the honest finding

Built as token sets on `data-frame` on the root element, so the ballot renders all three live.

| arm | `--plate-gap` | `--plate-r` | width lost at 1440 | `--ground` | shot |
|---|---|---|---|---|---|
| **A** as shipped, **default** | 20px | 40px | 40px, **2.8%** | `#c5e1a5` | `after/cal-frame-a-1440x900-dark.jpg` |
| **B** tightened | 10px | 22px | 20px, **1.4%** | `#c5e1a5` | `after/cal-frame-b-1440x900-dark.jpg` |
| **C** work area flush | 3px | 0px | 6px, **0.4%** | `#c5e1a5` | `after/cal-frame-c-1440x900-dark.jpg` |

**`--ground` is `#C5E1A5` in all three, read out of computed style, not asserted.** No arm
names a colour at all.

**A is the default by omission.** `[data-frame='a']` carries no declarations, so switching back
to it restores `faithful.css:45` *and*, at ≤767px, `faithful.css:157`'s own 24/8 override. An
arm that restated A's numbers would have broken the mobile override the moment the ballot
switched away and back.

Arm C is written as a 3px gap rather than a literal 0 because 0 deletes the pistachio from the
screen and the brief keeps it as a 3px edge. Same pixels, and the token stays a token.

### The rail, and why I did not touch it

The plan said the frame is not where Ivan's space is going: the "Ready, no date" rail held one
sentence and 264px, seven times what the frame costs.

**That finding is now dead, and the reason matters.** The `wb/polish` merge fixed the filter
that made the rail permanently empty. It holds **89 rows across the lanes** (ivan 2, risedtc 48,
arch 39) with its own capped scroll region. A column holding 48 undated posts has earned its
264px. So the rail is left exactly where it is and this phase changes only the thing Ivan
actually pointed at. Recorded here rather than quietly dropped, because "the rail is the real
thief" was in the brief and it stopped being true mid-run.

## 7. Motion

Wispr Flow's rule, measured out of its shipped bundle: colour changes get a plain short ease,
anything that MOVES gets the spring. It does not animate everything, it animates motion.

- Chip, cell and "+N": 120ms `ease-out` on `background-color`, `color`, `box-shadow`.
- Month change: `.cal-grid` is keyed on the month, so React replaces the node and a 260ms
  `var(--spring)` entry runs from scratch on every step. `data-dir` flips the side it enters
  from, because back a month should not slide the same way as forward. Transform and opacity
  only; it composites and never reflows.
- Popover: 260ms `var(--spring)` on transform, measured at opacity 0 on the first frame and
  told to animate in on the next, so the spring runs from the anchored position rather than
  from the origin.
- **Drag.** It signalled a live drag with `opacity: .4` and nothing else. Measured now, live,
  `evidence/cal-tools/drag-state.json`:

  ```json
  { "dragging": true, "opacity": "0.55",
    "boxShadow": "rgba(0, 0, 0, 0.12) 0px 2px 8px 0px",
    "transform": "matrix(1.02, 0, 0, 1.02, 0, 0)",
    "dropTargetLit": true }
  ```

  That is `--sh-drag`, Wispr's own distinct 12% drag token, which is also the alpha cap for
  this whole surface: the plate sits on `#C5E1A5` and anything heavier bleeds onto the
  pistachio. Shot: `after/cal-chip-mid-drag-1440x900-dark.jpg`.
- `prefers-reduced-motion: reduce` collapses all of it to **0ms**, not to a faster version of
  the same movement, and drops the drag scale and the month animation entirely.

Never a layout property. `width`, `height`, `top` and `transition: all` appear nowhere in this
sheet.

## 8. Writes, auth, and the standard pattern that would have let one through

**Attempted writes: 0**, across every run in this phase.

The chip-probe's interceptor exempts `/rpc/` (`!q.url().includes('/rpc/')` at line 15). Dragging
a chip calls `operator_set_schedule_date`, which **is** a POST to `/rpc/`, so the standard
pattern lets the one write this surface can make go straight through. Every tool here inspects
`/rpc/` POSTs by name: a write rpc (`operator_*`, `dashboard_action`, `n8nclaw_*`,
`append_agent_log`) is fulfilled, counted and its payload recorded; a read rpc continues, or the
surface renders empty and the measurement is of nothing.

| run | attempted writes | 401s |
|---|---|---|
| `cal-probe.mjs` x5 viewports, before | 0 | 0 |
| `cal-probe.mjs` x5 viewports, after | 0 | 0 |
| `cal-popover.mjs`, 25 checks | 0 | 0 |
| `cal-fixture.mjs` | 0 | 0 |
| `cal-after.mjs`, 12 shots | 0 | 0 |

`tools/refresh.mjs` was never run. No 401 was seen at any point.

The drag shot never completes a drop, so `setScheduleDateAt` is never reached; the interceptor
would have counted it if it were.

## 9. Build, tests, and what was not touched

- `npm run build` (`tsc -b` + vite) clean.
- `npm test`: **943 passing**, 1 failing. The failure is the known pre-existing
  `calendarItems.test.ts > passing no queue is the old behaviour exactly`, identified on a clean
  checkout before any work started (a clock-dependent `stuck` versus `scheduled`). Baseline was
  906 before the merge and 934 after it; this phase added 9.
- `ContentCalendar.test.tsx` is green and grew by 10 cases: the two-post day, the three-post day
  with all three chips in the DOM, the "+N" arithmetic, an assertion that **no chip carries a
  native `title` any more**, and six on `place()` at the edges.
- Two tests asserted on `title="Posted 09:30`. `renderToStaticMarkup` fires no events, so a
  popover cannot be opened in them. Rather than weaken them to "the chip rendered", the sentence
  was lifted into an exported pure `chipDescription(item)` and the tests assert on it directly,
  which is what they were about.
- **`src/styles.css` untouched.** **`faithful.css` untouched by this phase** (its 97 changed
  lines all arrive from the `wb/polish` merge). Nothing deleted anywhere; `wbcal.css` overrides.
- **`#exp/stock` unreachable, proven rather than assumed.** Every selector in `wbcal.css` is
  `.wb.wb.wb`-scoped or `:root[data-frame]`-scoped, the sheet is imported only by the v2c Shell,
  the `@keyframes` name is unique across all sheets, and the stock route renders **0 `.wb` roots
  and no `data-frame` attribute**. Nothing in the sheet can match there.
- No new runtime dependency. The app has three and keeps three.
- No new RPC, no migration, no n8n. `setScheduleDateAt` is unchanged and is still the only
  thing on this surface that writes.

## 10. Files

| file | what |
|---|---|
| `src/exp/v2c/wbcal.css` | new, 258 lines, six numbered sections, imported last in Shell.tsx |
| `src/exp/v2c/CalPopover.tsx` | new, the anchored panel and the exported pure `place()` |
| `src/exp/v2c/ContentCalendar.tsx` | the "+N", the popover wiring, `chipDescription`, the month key |
| `src/exp/v2c/ContentCalendar.test.tsx` | 10 new cases, two rewritten off the dead `title` |
| `evidence/cal-tools/` | probe, popover edge tool, fixture, after-capture, all JSON |
| `after/cal-*.jpg` | 20 shots |
