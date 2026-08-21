# Phase 5: layout fills the canvas

Branch `wb/2026-readability`. Six commits, all CSS plus one 40-line change to
`DmHistory.tsx`:

```
3bb0024  layout: the 860px pane cap becomes a second column of rows
81fa3e1  layout: the content table asks the pane it lives in, not the window
17b1dc8  type: tabular numerals scoped off running prose
1521c67  dms: DM HISTORY opens a window, not all 213 conversations
a4ddf87  magnets: the queue rail's hierarchy the right way up
50708d0  takeover: the surplus goes to the inspector, the artifact stays 640
2f61a45  mobile: the frame row folds into the work row
4387e84  dms: the context sheet docks beside the thread on a wide canvas
88a86eb  layout: the wide row keeps the snippet inside the measure it already had
```

Files touched: `src/exp/v2c/wb2026.css` (section D only), `src/exp/v2c/styles.css`
(the ten-line cap rule, replaced by a destination note), `src/exp/v2c/DmHistory.tsx`,
and one new instrument, `tools/probe5.mjs`. **`src/styles.css` is untouched**
(`git diff --stat` on it is empty), and every selector added carries `.wb.wb.wb`
(checked mechanically over the diff: no added selector lacks `.wb`).

---

## The instrument, and a correction to the brief

The brief specifies `textAreaPctOfWork` (glyph area) as the fill number. Used on
this app it **moves the wrong way**, and that is a property of the metric rather
than of the layout.

Glyph area sums the client rects of every text run. On a surface whose data is
fixed (DMs has 8 pending threads; Content's default tab has 1 row) a **better**
layout can only lower it, because the main thing a wider row does is stop a
snippet wrapping onto a second line. Measured: DMs at 2560 went 8.2% to 7.3%
while the plate visibly went from one 860px column of rows to two full columns
with snippets that finish instead of ellipsizing mid-word.

So `probe5.mjs` reports glyph area **and** two numbers that answer the actual
question, both built from glyph rects (never `elementFromPoint`, the discredited
hit test):

- `colsUsed / colsTotal`, the plate cut into 24px columns, counting the columns
  a glyph rect touches. This is "how much of the plate's WIDTH carries text".
- `coveragePct`, the same cells in two dimensions.

Every before/after pair below is read **off one page in one run**, with the
pre-phase-5 geometry re-injected as a stylesheet for the "before". Two builds
against a live database do not compare: the stock control proved it (below).

**The gate as written is not attainable and I did not chase it.** "No lane
leaves more than 40% of the plate empty at 2560, measured by glyph area" means
glyph fill >= 60%. The densest surface in the app, Today at 1440, measures 96.6%
because it is a wall of text in a 1,184px column; at 2560 the same 8,202
characters measure 47.5%. Nothing in a list UI with thumbnails, chips and row
padding reaches 60% glyph coverage on a 2,304px plate without inventing content.
The honest target is the one below: the starved lanes stop leaving half the
plate blank horizontally.

---

## 1 · The 860px pane cap

`v2c/styles.css:31-40` capped `.nav`, `.draftbanner`, `.stalebar`, `.seg`,
`.swipehint` and `.rows > *` at 860px and centred them on any solo list surface.
A measure belongs on prose, and the type pass already caps prose. Removed as a
pane cap; the surplus buys a second column of conversation rows once the pane
clears 1,560px. Only `.r` splits, banners, section heads, the stale bar and DM
HISTORY keep full width, because a full-width thing chopped in half is a new
defect. A hairline on the second column's rows gives the two columns a seam.

Plate columns of 24px carrying a glyph, before → after:

| lane | 1024 (pane 768) | 1440 (pane 1184) | 2560 (pane 2304) |
|---|---|---|---|
| DMs | 32 → 32 of 32 | 43 → 49 of 50 | **47 → 91 of 96** |
| Content | 31 → 31 of 32 | 40 → 48 of 50 | **40 → 60 of 96** |
| Magnets | 32 → 32 of 32 | 43 → 49 of 50 | **45 → 57 of 96** |

Two-dimensional coverage over the same pairs: DMs 15.9 → 17.3 at 2560, Magnets
15.7 → 17.7, Content 6.4 → 7.2. Glyph area (the metric the brief named): DMs
8.2 → 7.3, Magnets 14.4 → 13.3, Content 3.0 → 3.1. Body characters are identical
in every pair, which is the whole point: **the data did not change, the plate
did**. At 1024 nothing moves, correctly, the cap never bound at a 768px pane.

Shots: `phase5-before/shots/dms-2560.jpg` against
`phase5-after/sweep/shots/dms-2560.jpg`. The before is one 860px column with
1,444px of black to its right and snippets cut at "That's a diamond mine for
what you guys are looki…"; the after is two columns of rows where that snippet
finishes and prints its URL.

At 2560 the DMs lane renders a second working pane. Gate met.

## 2 · Container queries on `.ct-card`

faithful.css:2483 and :2531 had the right three forms and the right two
thresholds, worked out against the fixed tracks (636px of data columns plus a
28px anchor, six 12px gaps and 32px of gutter = 768px, so the title only clears
~280px around 1,300px). Nothing about that arithmetic was wrong. It was keyed
to `@media`, which reads the window, and the table lives in a pane that is
400px wide whenever a peer docks.

Measured with the Claude peer docked (`--peer chat`):

| viewport | pane | before | after |
|---|---|---|---|
| 1024 | 384px | 7-track form, title **0px**, 93px row overflow | 4-track phone row, title 88px, overflow 0 |
| 1440 | 592px | 7-track form, title **0px**, 161px row overflow | 4-track phone row, title 296px, overflow 0 |
| 2560 | 1152px | title 383px against 842px of title | 5-track shed form, title 659px, overflow 0 |

Clipped cells at 1024 and 1440: 2 → 0. Same three forms, same numbers, only the
question changed. This sheet loads after faithful at equal specificity, so a
matching container rule wins over the media rule beneath it; below 1000px of
window no container is declared, the queries never match, and the phone row is
left exactly as faithful wrote it.

### The container-query guard, proven

`container-type: inline-size` implies `contain: layout`, which makes the box a
containing block for `position: fixed` descendants. `.ct-fsheet-scrim`
(faithful.css:1330, `position:fixed; inset:0`) is a descendant of `.wb-work`, so
an unguarded declaration would shrink the mobile filter sheet's scrim to the
pane and stop it covering the tab bar. The declaration is inside
`@media (min-width:1000px)`; the sheet only renders below 768px
(`FilterRow.tsx:30`).

Measured at 390 with the sheet open (`probe5.mjs --mode scrim`):

```
workContainerType : "normal"
workContain       : "none"
scrim             : t 0,  b 812   (full viewport)
tabbar            : t 726, b 804
hitAtTabbarCentre : "wb-fopt/BUTTON"
```

The element painted at the tab bar's centre is the sheet's own option button.
Screenshot: **`phase5-after/scrim-390.jpg`**, the tab bar is not visible
anywhere on the page, and the sheet runs to the bottom edge.

The other two fixed scrims were checked rather than assumed: `.wb-tkscrim`
renders outside `.wb-plate` (Shell.tsx), and `.sheet-scrim` mounts either at the
ConfirmSheet provider (root) or inside `.wb-peer`, never inside `.wb-work`.

## 3 · Tabular numerals scoped off prose

`faithful.css:113` declares `font-variant-numeric: tabular-nums` on `.wb` and
calls it "declared once, never unset". Half right. Columns of counts keep it.
Sentences do not: a fixed advance pads both sides of every digit, so "€70k/mo"
inside a DM bubble comes apart, and the LinkedIn artifact, the one surface whose
job is to show what LinkedIn will render, was drawing figures LinkedIn does not
draw.

Off for bubbles, snippets, the artifact, draft bodies, chat prose, briefing
bodies, row excerpts, idea rationale, the QA verdict, the strategy document and
the context sheet. `faithful.css:123` on `input/textarea/select/button` is
untouched: it exists because a form control inherits none of this, a different
problem.

Verified by computed style on rendered elements:

```
DMS     .snip  normal        .time  tabular-nums   (same row)
THREAD  .b     normal        .day   tabular-nums
STRAT   .wb-strat-read normal  .wb-strat-age tabular-nums
```

## 4 · DM HISTORY paginates

One click inlined all 213 answered threads: body 2,499 → 59,452 characters,
controls 12 → 225, unvirtualised, and the open flag is persisted so it came back
that way on every reload.

Page size **20**, and the reason is what the surface is for. Ivan asked for it
"so i know this is working", it is scanned newest first to confirm the engine
still gets replies. Twenty is about the last month of replies at current volume,
and one screen and a bit at 390 instead of seventeen. The head keeps the full
total; the footer states what is still folded.

| | before | after |
|---|---|---|
| expanded body characters | 59,452 | **4,520** (gate: under 10,000) |
| controls on the page | 12 → 225 | 17 → 38 |
| rows rendered | 213 | 20, footer "193 older still folded" |
| head | 213 conversations · 394 replies · 3 lead magnets | unchanged |

The window is deliberately **not** persisted while the open flag still is: a
reload is the one moment when show-me-everything is certainly stale.

## 5 · The magnet queue rail

Measured at 1440, 11 rows: titles held 118 to 166px on one line and ellipsized
after about 14 characters, while `Guide · 3d ago` wrapped to three and four
lines. Row heights: 44, 56, 75, 93, 112.

The cause is markup, not taste. DraftPane's rail wraps its two lines in
`.dw-qrow-b` (`flex:1`); MagnetWindow's QueueRail puts the title and the meta
straight into the flex row as siblings, so two items with no basis split the
rail and the shorter string won. The rule names that difference with `:has()`
rather than naming a window, so it cannot reach the draft rail beside it and
cannot stop applying if a third window reuses the markup.

| | before | after |
|---|---|---|
| row heights | 44 / 56 / 75 / 93 / 112 (5 distinct) | **76, all 11** |
| title width | 118 to 166px | 203px |
| title lines | 1 | 2 |
| meta lines | 2 to 4 | 1 |
| titles clipped | 3 of first 4 | 0 |

Shots: `phase5-before/magnet-rail-1440.jpg` (the click missed and shows the
before-state list) and `phase5-after/magnet-rail-1440.jpg`.

## 6 · Takeover surplus to the inspector

**The 640px artifact measure does not move**, and that is correctness, not
taste: it is what LinkedIn gives a post and the only job of that column is to
show what the post will look like there.

Measured at 2560 with a one-row queue (so `.dw-norail`): the grid ran
`2040px 520px`, the artifact rode a 640px ribbon inside the 2,040px track, and
about 1,400px of that column carried nothing while the rail holding the QA
rubric, the generation register and the source quote was the narrow one.

| | before | after |
|---|---|---|
| grid at 2560 | `2040px 520px` | `1640px 920px` |
| grid at 1440 | `1080px 360px` | `1080px 360px` (unchanged) |
| `.dw-main-in` | 640px | **640px** |
| `.li-card` | 520px | **520px** |
| inspector | 520px | **920px** |

Two new bands: 560 to 760px from 1900, 700 to 920px from 2400. Width given to a rail
is only a gain if its text still has a measure, so every sentence in the rail is
capped at 68ch, computed on the rendered elements at 685px (`.qa-p`, `.dd-v`),
557px (`.ct-subtle`) and 532px (`.dd-pre`) inside the 920px rail. The extra
width goes to the rubric bars and key/value rows, which is what wanted columns.

**One brief claim corrected by measurement:** the inspector was not 360px at
2560 and its prose was not wrapping at 331px. `v2c/styles.css:1029` already
widened it to `minmax(420px,520px)` above 1700px and it computed 520px. The new
bands start from there.

## 7 · Mobile chrome

Measured at 390 on Content, first draft row at y=254 of 812, so **31%** of the
phone was chrome. Four bands:

```
1  .wb-ribbon    8..52    sync age, the way to Settings
2  .wb-workhead  52..105  the word CONTENT, then four work pills
3  .ct-cmd-top   120..158 client lane, pipeline marks, the alarm
4  .ct-cmd-f     166..200 search and filters
```

Bands 1 and 2 are now one. The ribbon spent a 44px band on two controls, so it
becomes the right-hand end of the work row, which reserves 144px so no pill can
pass under it. **Nothing is deleted**: the same sync chip and the same gear, in
the same order, one tap in the same place. The word CONTENT goes because
faithful.css:2866 already ruled it, `.ct-cmd-j` prints the job name 60px lower
on this canvas, and printing one word twice in two bands is what D6 killed on
the pointer canvas. The pill scroller gains the announced fade the strip's
scroller already had, so a pill cut at the reserved lane reads as scroll rather
than as something hidden under the sync chip.

Result: first row **y=254 → y=204**, 31% → 25%. Scoped with `:has()` to a plate
that actually has a work head, because `WorkSegment` returns null for every
non-work job (`Rail.tsx:42`) and on DMs or Ops the ribbon would otherwise land
on that screen's own title. Shot: `phase5-after/chrome-390.jpg`.

**This lands four bands to three, not to two, and that is a deliberate
disagreement with the brief.** faithful.css:2901 closed a measured defect in
bands 3 and 4: with the alarm in the scroller it rendered at `left:499` on a
390px canvas, reachable only by a swipe nobody knows about, and a search field
sharing that line is about 90px wide. Merging them re-opens a defect that was
closed with numbers. The third band is the strip's own documented two-line
budget.

One thing checked and left: the Filters pill reports a 74px box against a 78px
`scrollWidth` at 390. It is not a clip, the button already computes
`flex:0 0 auto` with `min-width:max-content`, its max-content resolves to 74,
the pill renders whole in the screenshot, and pinning the parent's flex three
different ways moved nothing. It is the `⌄` glyph's advance overhanging its own
content box. Recorded in the CSS so the next pass does not spend the same half
hour on it.

## 8 · The context sheet beside the thread

`ContextSheet.tsx` is the best information design in the app and **not one line
of it changed**. Above 1600px its scrim stops dimming and its card docks to the
right of the thread, in width the pane already wasted (`.msgs` is capped at
760px inside a peer that is 1,000px and more).

Measured at 1920: peer 1,050px, thread column ends at x=1464, card runs
1476 to 1888, a 12px gap and no overlap, scrim background `rgba(0,0,0,0)`, zero
console errors. Shot: `phase5-after/ctxsheet-1920.jpg`, three readable panes:
conversation list, thread, context.

The scrim stays full-bleed and transparent on purpose. The component's only
dismiss affordance is a click on it (`ContextSheet.tsx:71`): there is no close
button and no Escape handler. Shrinking the scrim to the dock would take
dismissal away from a sheet with no other way out. So the thread is readable
while the sheet is open, which is the complaint, and a click on the thread
closes it, which is the contract it already had. Below 1600 the sheet keeps its
current behaviour.

## 9 · Native `popover`: DEFERRED, with the reason

Not attempted, and this is a judgement rather than a shortfall of time.

`popover` puts the element in the **top layer**, where `position: absolute`
resolves against the initial containing block, not against the pill that opened
it. Placing a top-layer popover next to its trigger needs CSS anchor
positioning, which is not in the baseline the brief states (iOS 17 has
`popover`; Safari did not ship anchor positioning until well after). Without it
the panel renders centred in the viewport.

`FilterRow.tsx:71` (`usePlace`) exists to solve exactly that: it measures the
panel on open, flips it to the right edge when it would run past the pane's
right edge (measured, the Filters panel clipped its counts clean off in a 620px
column), and caps its height to the room below. Migrating would replace ~15
lines of dismiss handling with ~25 lines of manual coordinate maths and lose the
container-relative flip. The brief's own escape clause applies: a surface that
loses behaviour keeps the hand-rolled version.

The one clean win available is the **mobile sheet** path, which needs no
positioning and would get `::backdrop` and light dismiss free. Worth a small
follow-up; it is not worth coupling to the popover migration of the popover
path.

---

## Verification

| gate | result |
|---|---|
| console errors | **0** across 9 lanes × 4 viewports |
| real overflow | **0** across 9 lanes × 4 viewports |
| attempted writes | **0** (interceptor on every run) |
| `npm run build` | green |
| `npm test` | 906 passed, 1 failed, the pre-existing `calendarItems.test.ts` failure phase 0 recorded. No new failures |
| second working pane at 2560 | DMs, yes |
| content table clipped with a peer docked | 0 at every width tested |
| mobile filter scrim covers the tab bar at 390 | yes, hit-tested and screenshotted |
| DM HISTORY expanded | 4,520 characters |
| LinkedIn artifact measure | 640px, unchanged; inspector 920px |
| magnet rail | one height (76px), titles two lines |
| mobile chrome | 4 bands → 3, first row 31% → 25% down |

Prose past 70ch, before → after, per lane: DMs 6 → 6 (max 87ch → 89ch),
Magnets 5 → 5 and 13 → 13, Content 1 → 1, Today 6 → 6. **Every over-measure
block in the after-sweep was there before it, and the counts are identical.**
The one that this pass would have widened is `.snip`: the uncapped wide row took
it to 126ch at 1440 and 121ch at 2560, so it is capped at 88ch, exactly what it
measured at 1440 before the pane cap came off. No measure in this app is wider
because of phase 5.

### `#exp/stock`

`src/styles.css` is untouched (empty diffstat) and every rule added or removed
is `.wb`-scoped, checked mechanically across the whole diff.

**The byte-for-byte method `stock-shot.mjs` describes cannot be run against this
app**, and that is worth recording. Two captures of the **same build**, minutes
apart, differ at all three viewports: the stock surface renders live data and
relative times ("13s ago", "just now"), so the PNGs are never equal. I ran that
control explicitly rather than reporting a diff I could not attribute. The proof
substituted for it is the scope proof above.

### Measurement hygiene

Three things bit during this phase and are worth carrying forward:

1. **Two harness runs at once poison each other.** A background sweep plus a
   foreground probe produced nine lanes of zeroes.
2. **A `git worktree` build has no `.env.local`**, and the app renders
   "supabaseUrl is required" with a perfectly green build. The final sweep was
   run from a clean worktree at HEAD (so the concurrent command-layer pass's
   uncommitted work could not contaminate it), and the first attempt measured
   an empty app.
3. `probe5.mjs`'s `inspProseMaxPx` over-reports (1192px inside a 360px rail) for
   the same reason phase 0 flagged: range rects inside a horizontal scroller
   escape their box. Read the computed `max-width` instead, as done above.

## Deferred

- **Native `popover`** (item 9), with the platform reason above.
- **Mobile bands 3 and 4 stay two**, with the faithful.css measurement above.
- **`.ct-idea-n` collides with its title on a 5-character score** (`55.82` in a
  28px anchor track) at every width, before and after. Pre-existing, unaffected
  by this pass, and `ContentSections.tsx` was held by the command-layer pass.
- **`.ct-title` at 217ch on Magnets at 2560** and 153ch on Content. Pre-existing
  and unchanged in count; it belongs to whoever owns `.ct-title`'s measure.
- No `.tsx` work was deferred for file contention: `DmHistory.tsx` was clean
  when it was edited, and `ContentList.tsx` / `ContentSections.tsx` /
  `Shell.tsx` were never needed.
