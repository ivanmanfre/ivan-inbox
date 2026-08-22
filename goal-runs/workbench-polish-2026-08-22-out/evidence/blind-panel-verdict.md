# The blind panel, decoded

The mission's definition of done required that "a blind judge panel prefers the new state on all ten baseline surfaces." The run's own report stated it had judged **one** surface, the draft window, and that the 2013 verdict was therefore "asserted rather than judged" everywhere else. This closes that gap, and the answer is not the one the report implies.

## Method

Eleven surfaces, captured at 1440x900 dark, before and after, from the same instrument (`evidence/capture.mjs`, re-run against the current build into `after/mirror/`). Each pair was copied to `/tmp/panel` as `NN-X.jpg` and `NN-Y.jpg` with the before/after assignment **alternating** by surface, so neither state is consistently X. The key was held by the orchestrator and never given to a judge.

Three judges, each given a subset small enough not to stall, each told to open no file but the images, and each required to name a mechanic rather than write "cleaner" or "more modern". One seat was briefed as the Taste skeptic with a standing instruction to default to TIE and to hunt for "a different arrangement of the same look".

An earlier attempt gave two judges all 22 images at once. Both stalled and died. The batch size is the fix, and it is worth recording.

## The result

| Surface | Verdict | Margin |
|---|---|---|
| Draft window | **after** | decisive |
| Magnets lane | **after** | slight |
| Ops lane | tie, leaning after | hair |
| Content list | tie | none |
| Strategy | tie | none |
| Styles | tie | none |
| DMs thread | tie | none |
| **Calendar** | **before** | slight |
| **DMs list** | **before** | slight |
| **Command palette** | **before** | slight |
| **Claude chat pane** | **before** | clear |

**After wins 2. Before wins 4. Five ties.**

The DoD item **FAILS**. It is not close, and the honest summary is: the run won decisively on the one surface Ivan photographed and complained about, and lost or tied everywhere else.

## Why it lost, and the distinction that matters

The four losses are not one thing. Three of them are **features scored as clutter**, and one is a **real design regression**.

**Features scored as clutter (DMs list, chat pane, palette).** Phase 4 put a "sum up" chip and a Discard button on every DM row. Phase 5 put a context strip on the chat pane reading "Claude can see 1 thing, names and states only". The palette gained per-command precondition text. A judge asked which screen looks designed marks all of that down, correctly by its own brief. The skeptic seat said it plainly, and then argued against itself, which is the sentence worth keeping:

> "A secondary action rendered statically on every row, with no hover reveal and no visual demotion, is the single most reliable tell of an internal tool... If the brief were 'which is better to work in' rather than 'which looks designed', Y wins."

That is the run's central tension stated by someone who did not know which side was which. Ivan asked for two things in one breath: make it stop looking like 2013, and make me faster. On the DMs list those two pulled in opposite directions, and the run chose speed without paying the visual cost of demoting the new control. **The fix is not to remove the feature. It is to demote it: reveal on hover and focus, quiet weight, one baseline.** Not done in this run.

**A real regression (the calendar).** This one is the run's own fault and has no feature defending it. The gate "a chip is at most 45% of its cell height" was bought by cutting the chip title to a single line. Measured on the shipped build: **13 of 13 titles ellipsed**. The judge:

> "Fourteen entries, fourteen ellipses, not one of them readable... On a calendar, whose only job is scanning, that is the load-bearing difference."

The panel also found `1 armed` in the calendar header, operator vocabulary for a state machine, printed as a top-line metric. The run's own no-internals scanner cannot catch that class: it hunts raw urns, uuids and SCREAMING_SNAKE, and "armed" is an ordinary English word. **A gate that only knows the shapes of jargon will pass jargon spelled in plain words.**

Both are being repaired. See `phase3-calendar.md`, amendment section.

## What the panel confirmed

The draft window is the run's real win and it won without knowing which was which:

> "One grouped toolbar with a single primary vs seven scattered buttons plus a red Delete on a wrapped second row; one failing dimension shown vs nine lime bars stealing the accent budget; sentence-case meta vs three all-caps chips; 'What decides it' vs 'BACKEND DEPTH'."

Every one of those is a Phase 1 primitive doing its job. The system works where it was applied.

## What the panel exposed that the run had not said

Five ties. Content list, strategy, styles, DMs thread, and ops within a hair. On those surfaces the elevation ladder, the radius scale and the control variants were applied underneath and **produced no perceptible improvement to a judge looking at the result**. The skeptic's summary of its four:

> "No change in typography, type scale, divider or card language, or accent palette. One look, arranged twice."

That is the finding the run most needed and least wanted. The design system is real, it is measured, and on five of eleven surfaces it is invisible, because those surfaces were never redesigned, only re-tokenised. Retokenising is not designing.

## The honest scoreboard on Ivan's complaint

- "this section looks like an internal tool ui not polished at all" (the draft window, the surface he sent): **answered, judged blind, decisive.**
- "the calendar pills look like ugly 3d": the bevel is gone by measurement, but the surface as a whole lost its blind comparison on legibility. **Answered on the mechanic, failed on the outcome, repair in flight.**
- "this still looks like a 2013 design" as a verdict on the whole app: **not answered.** Two surfaces of eleven improved to a judge's eye. The rest are tied or worse.

## Judges' own files

`blind-panel-A.md` (content list, calendar, draft window, strategy), `blind-panel-B.md` (styles, ops, DMs list, thread; skeptic seat), `blind-panel-C.md` (magnets, palette, chat pane). Key at `/tmp/panel/KEY.json`, reproduced in the decode table above.
