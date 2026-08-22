# Draft window tournament: judge panel verdict

**STATE Y ships.**

The single reason: Y is the only state that touched the region the owner was actually pointing at. "This section looks like an internal tool" is a verdict on a 9-bar all-caps dyno readout sitting next to the thing he is trying to read. Y cut it to one line. Z rebuilt the reading column beautifully and left the dyno readout intact with a new hue, which means Z ships two aesthetics on one screen and a stranger sees the worse one first.

Scores: Pass 1 stranger X 2 / Y 6 / Z 5. Pass 2 craft X 2 / Y 7 / Z 6. Pass 3 job X 3 / Y 7 / Z 6. Totals X 7, Y 20, Z 17.

Z wins the artifact region outright and four specific things must be grafted out of it. See §4.

---

## Pass 1: the stranger test

*Does it look like a product someone shipped, or like an internal tool? Name what gives it away.*

### STATE X: 2/10

It gives itself away in the first half second and then keeps giving itself away. A panel header that reads `BACKEND DEPTH`. Nine all-caps dimension labels (`VOICE`, `SUBSTANCE`, `SPECIFICITY`, `DISTINCT`, `OPINION`, `ECONOMY`, `HOOK`, `VERIFIED`, `AI_TELLS`) with an underscore left in the last one, each with its own progress bar, each with an `n/10` fraction. A monospace `REWRITE_OK` token in prose. At 2560 it exposes a raw `CANDIDATE 5fa0fcbf-42fa-4bcc-8a3a-5a9e61a4332b` and an agent log with ten rows of internal agent names and timestamps. Seven action buttons rendered as identical grey rectangles with one neon one and one red one dropped onto a second line as if it did not fit. Every single one of those is a thing a person builds for himself and never has to explain to anyone. Score is 2 rather than 1 only because the LinkedIn artifact preview itself is well built and the queue rail is legible.

### STATE Y: 6/10

The caps are gone everywhere, including inside the inspector. The nine meters are gone, replaced by the one that is failing plus a single line reading `8 dimensions at or above the mark`. The action row has visible tiers instead of seven equal rectangles. At 1440 dark it reads, at a glance, like something with a designer attached to it.

What still gives it away: the right rail at rest reads `Raw judge output · 2,389 characters`, then `The applied rewrite / the copy that published · 512 chars · rewrite_total 74`, then `Gate detail 1 gate`, then `Verdict provenance 3 fields`. `rewrite_total 74` is a variable name shown to a human. Scroll and there is `Source: manual`, a bare UUID, and a ten-row log of `Promoter`, `Editorial Agent`, `Lint Gate`, `AI-Slop Gate`, `Claim Check`, `Forbidden Language Gate`, `QA Agent` with `REWRITE_OK` in a monospace amber pill. Sentence-casing a debug drawer produces a polite debug drawer. It survives partly because collapsed technical detail behind chevrons is a pattern shipped products genuinely use, which is not true of the meter wall.

The second tell is the 2560 shot. The artifact column is pinned starting at roughly x=530 with about a thousand pixels of empty canvas to its right, inside a region that runs to x=1280. That does not read as generous whitespace, it reads as a layout that was never given a rule for wide screens.

### STATE Z: 5/10

The left two-thirds of Z is the best work in this tournament and I want to say so before I mark it down. The metadata chips are gone entirely, replaced by `Text · Needs review · edited 18h ago` as plain inline text. The action row is a single floating dark capsule with three real buttons and one disclosure. At 2560 the artifact is centered in its canvas and the action bar sits clear of it, so the whole LinkedIn card including the Like/Comment/Repost/Send row is visible. A stranger looking only at that would say product.

Then the eye moves right and finds `VOICE 8/10`, `SUBSTANCE 8/10`, `SPECIFICITY 9/10`, `DISTINCT 6/10`, `OPINION 7/10`, `ECONOMY 7/10`, `HOOK 7/10`, `VERIFIED 10/10`, `AI_TELLS 8/10`. Nine all-caps rows, nine bars, in a bordered box, with the underscore still in `AI_TELLS`. This is X's panel with the green shifted from lime to teal and one row given an amber highlight. The amber contradiction callout is not merely retained, it is now heavier than X's: a full amber border plus an amber gradient fill, occupying more area than before.

The inconsistency is itself a tell, and it is the specific one the acceptance test names. A product ships one aesthetic. A screen where the left half was designed and the right half was recolored is a screen where somebody fixed the part they were looking at. That is what an operator building for himself does.

---

## Pass 2: the craft reading

*Elevation, hierarchy, rhythm, control design, type roles, eye path, accent spend. Cited against `reference-study.md` and `wispr-calibration.md`.*

### STATE X: 2/10

Fails the four ranked recommendations at the bottom of `reference-study.md` in order. The accent budget (§3 Move 1, Linear: one accent fill per view) is spent thirteen ways: nine dimension bars, the score bar, the `PASS` chip, the `Approve` fill, and the queue rail's selected-row treatment, all in the same lime family. The caps-label-in-a-box pattern (§4 Move 1, Linear: drop the border, quiet inline prefix, value is the target) is used for every metadata surface on the screen. The button row fails §2 Move 1 and Move 2 (Geist and Linear: constant padding and radius, vary only fill and border) because it varies nothing at all across six controls and then breaks the family for a seventh. `Delete` also fails Geist's verb-plus-noun rule for destructive labels. Eye lands on the neon `Approve` and then is immediately pulled right by a solid block of nine green bars, which is the accent competing with itself.

### STATE Y: 7/10

Honours §4 Move 2 (Linear board cards: show the high-priority subset, defer the rest to a peek) more literally than I expected anyone to. Nine meters become the one below the bar plus `8 dimensions at or above the mark`. That is the cited move executed exactly, and it is the highest-leverage change made by either candidate, because the meters were never a reading surface, they were a "is anything wrong" surface and now they answer that in one line. §4 Move 1 is honoured throughout: `Details`, `Summary`, `Source`, `Log`, `Distinct`, `Gate detail`, `Verdict provenance` all in sentence case, no caps anywhere.

§2 Move 2 (Linear: fixed padding and radius, vary only fill and border) is honoured in the action row. `Approve` filled, `Edit` and `Schedule` at secondary weight with the same geometry, `Regenerate` / `Swap image` / `Back to idea` dropped to text-only tertiary. §2 Move 1's destructive rule is honoured: `Delete draft`, verb plus noun, error variant as text, held at the far right away from the primary cluster. §3 Move 1 goes from thirteen accent elements to three (lime `Approve`, teal score bar, orange `Distinct`). Not one, but the one that matters is unambiguous.

The amber contradiction box becomes a left-rule callout with no fill, which is exactly Geist's "avoid heavy decorative treatment, elevation clarifies layering" applied to a warning.

Failures. §2 Move 4 (put the control row at the bottom edge of the artifact it acts on) is honoured at 2560 where the shelf sits inside the outer card below the post, but violated at 1440 and 390 where the shelf floats over the artifact and cuts the post image mid-frame. In light mode the shelf is white on a white artifact card with no shadow separating them, so two elevated materials nest with no boundary, which is the specific thing Geist's materials doc says to avoid; `wispr-calibration.md` §3 licenses a shadow up to 12% alpha for exactly this case and Y uses none. The metadata pills (`Text`, `Needs review`, `edited 18h ago`) are still bordered boxes, a residual §4 Move 1 violation. And the 2560 composition has no rule.

### STATE Z: 6/10

Best control design on the screen by a distance. `Fix or remove ›` collapses four secondary and destructive actions behind one disclosure, so at rest the row is `Approve` / `Edit` / `Schedule` / one word. That is §2 Move 1's "Button is reserved for state-mutating actions, lower-stakes actions belong in a lighter component" pushed one step further than Geist itself describes, and it is the single best idea produced by this run. The expanded shelf keeps all four with a hairline divider, so nothing is lost.

Honours §4 Move 1 on the metadata line better than Y does: the pills are gone entirely, replaced with plain text and middot separators, which is literally "quiet inline prefix, no bordered container." Honours §2 Move 4 best of the three at 2560, where the bar sits below the artifact rather than over it and the column is centered, so the wide viewport reads as composed rather than unresolved.

Failures, and they are large. §4 Move 1 is violated wholesale in the inspector: nine all-caps labels inside a bordered box is the defect that section was written to name. §4 Move 2 is violated: everything is shown, nothing is deferred, and the patch applied instead is to give the failing row an amber background, which is an admission that the scan was too slow without fixing why. §3 Move 1 is violated outright and this is the decisive one. Count the colored elements in Z at 1440: nine teal bars, the teal score bar, the teal `PASS` chip, the amber callout, the orange `DISTINCT` bar and its amber row highlight, the lime `Approve`. That is fourteen. X had thirteen. Changing lime to teal changes the hue of the violation, not the violation. And the consequence is exactly what Linear's rule exists to prevent: the largest, highest-contrast object on Z's screen is the QA readout, not the decision. The eye lands on the amber box, not on `Approve`.

In light mode Z nests a white capsule on a white artifact card with no shadow, so the capsule loses its edge and the post's reaction icons peeking below it read as an accident rather than an overlay. A floating capsule needs an edge more than a flat shelf does, so Z is hurt worse by the missing shadow than Y is.

---

## Pass 3: the job reading

*Read what is about to go out under his name, decide, move to the next one. Fifty times a week.*

### STATE X: 3/10

Seven equally weighted targets means every pass costs a re-read of the row. `Delete` sits one row below `Approve` with no separation of consequence. The nine meters demand a scan every single time to discover the only fact that matters, which is whether anything is below the bar. And the summary is truncated mid-sentence with no affordance to finish it at 1440, so the one piece of prose that would actually help him decide is the one thing he cannot read.

### STATE Y: 7/10

The best decision surface. `8 dimensions at or above the mark` is the whole meter wall reduced to the sentence he needed, and `Distinct 6/10` is left visible because it is the exception. `Show all 708 characters` gives the summary a real ending. The action row's three tiers mean `Approve` is found without looking. This is the state that costs the least attention per draft.

Where it wastes attention: `Delete draft` is permanently rendered, and at 390 it lands in the bottom-right thumb zone on the same visual row as `Regenerate` and `Swap image`, four inches from `Approve`. A destructive action should not be reachable by accident on the surface he uses fifty times a week. `Raw judge output · 2,389 characters` and `rewrite_total 74` are permanently on screen and are never the answer to anything he is asking.

### STATE Z: 6/10

Wins the mechanics of acting and loses the mechanics of deciding. One row, four targets, destructive actions two clicks away. On mobile it is one line where Y needs two. If the job were only "press the button," Z wins.

But the job starts with reading, and Z charges a scan of nine bars on every draft to surface one fact. The amber row highlight shortens that scan and proves the cost was noticed. Fifty times a week that is fifty scans that Y replaced with fifty glances at one sentence. Z also truncates the summary with `Show all 708 characters` the same as Y, so it does not lose there.

---

## The Taste skeptic

*Default position: still an internal tool. Argue me out of it.*

### STATE X

Not argued out. Not close. Nothing here needs a skeptic.

### STATE Y: partially argued out, and the part that remains is honest about itself

Y's improvements are real and they are not merely a re-arrangement. Collapsing nine meters into one line plus a sentence is a change in what the screen claims to be for, not a tidier version of the same claim. The action row's three tiers change what the operator is asked to decide. Those are design decisions, not cleanup.

**What is still wrong with Y, unsoftened:**

- The three-region arrangement is untouched, and it is a developer's arrangement: list, thing, everything-we-know-about-the-thing. The right rail's job is still "expose the pipeline."
- `Raw judge output · 2,389 characters` is a character count of a JSON blob presented to a human as a section header. `rewrite_total 74` is a database column. `Verdict provenance 3 fields` counts fields. These are visible at rest, at every viewport, in both themes.
- The agent log is a build log. `Promoter`, `Editorial Agent`, `Lint Gate`, `AI-Slop Gate`, `Claim Check`, `Forbidden Language Gate`, `QA Agent`, `Content Agent`, `Hook Agent` with timestamps and a monospace `REWRITE_OK` pill. This is the single most "built by an operator for himself" object left in the winning state.
- At 390 the log rows break: `Forbidden Language Gate` and `QA Agent` push their timestamps onto a second line, producing ragged rows. A layout defect, shipped.
- The action shelf clips the post image at 1440 and 390. The artifact is the thing being judged and the controls cover part of it.
- Light mode: white shelf on white card, no shadow, no lightness step, no boundary of any kind. Y solved same-colour-on-same-colour in the inspector and reintroduced it in the action shelf.
- 2560 has no composition rule. A third of the region is empty and it is empty on one side.
- The queue rail's selected item still uses a green-tinted background, so the accent is spent twice on a screen whose whole thesis is spending it once.

### STATE Z: not argued out

This is the state this tournament exists to catch, and it caught it.

Z will report large numbers and they will be true for the region it worked on. Row heights, chrome removed, chips eliminated, a seven-control row reduced to four. Every one of those is real and the artifact region is genuinely the best on offer. And the screen still reads as an internal tool, because the region the owner's complaint was actually about is unchanged.

**What is still wrong with Z, unsoftened:**

- The inspector is X. Nine all-caps labels, nine bars, one bordered box, `AI_TELLS` with the underscore intact. The change is a hue.
- The accent count went up, not down. Fourteen colored elements at 1440 against X's thirteen. Recoloring lime to teal makes the violation calmer, not smaller, and it costs the screen its one real accent: `Approve` in lime now sits in a field of teal bars that are individually quieter but collectively louder.
- The amber contradiction callout is larger and heavier than X's. It is the highest-contrast object on the screen and it is a footnote about an internal disagreement between two stored fields. The most visually dominant thing on a screen for approving a post is a note that two database columns disagree.
- The amber highlight on the `DISTINCT` row is a patch. If the correct row can be identified and highlighted, the other eight did not need to be drawn.
- Light mode floating capsule with no edge. A capsule that does not float is just a white band with a green pill in it.
- The `›` at the right of the tab row is an unlabeled icon-only control, against the icon-only rule in §2 Move 3 and Geist's aria requirement.
- Z's two halves do not look like the same product, and that is a worse failure than either half being mediocre, because it is the exact signature of self-built software: the part in front of you gets designed, the part behind it gets left.

### Capability check, for verification rather than assumption

Neither state appears to lose a control. X exposes Approve, Edit, Schedule, Regenerate, Swap image, Back to idea, Delete. Y renders all seven at rest. Z renders three plus `Fix or remove ›`, and the expanded shelf shot confirms Regenerate, Swap image, Back to idea, Delete draft. Tabs QA / Source / Log / Fields present in both.

Flag for verification, not assumed:
1. **Y** collapsed eight dimension scores behind `8 dimensions at or above the mark`. Confirm expanding it reveals all eight with their scores, and that the row is keyboard reachable.
2. **Y and Z** both truncate the summary behind `Show all 708 characters`. Confirm it expands in place rather than opening a modal.
3. **Z** added a `›` control at the right of the tab row that does not exist in X. Confirm what it does and that it has an accessible name.
4. **Both** at 390: the log rows wrap timestamps onto a second line. Confirm this is a CSS defect and not a fixture artifact.

---

## Graft list

Four things from Z go into Y. They are all in the artifact region, which is where Z won.

**1. `Fix or remove ›` replaces Y's tertiary text row.** Into Y's action shelf. Y currently renders `Regenerate` / `Swap image` / `Back to idea` / `Delete draft` permanently. Replace all four with Z's single disclosure, keeping Y's expanded-shelf contents and Y's `Delete draft` label. This gets Y from seven visible controls to four, removes a destructive action from the mobile thumb zone, and takes Z's one genuinely superior idea. Z's `dwb-03-draft-window-actions-shelf-1440x900-dark.jpg` is the reference for the expanded state, including the hairline divider. One change to Z's version: `Delete draft` in the expanded shelf is rendered in full red at the same size and weight as its siblings and it is last, so it takes the eye. Keep Y's quieter error-text weight.

**2. Z's plain-text metadata line replaces Y's pills.** Into Y's header, under the title. Y renders `Text`, `Needs review`, `edited 18h ago` as three bordered chips. Z renders `Text · Needs review · edited 18h ago` as inline text with middot separators. Z's is the correct read of §4 Move 1 and Y's is a residual violation of it. Straight swap.

**3. Z's 2560 centering rule replaces Y's left-pinned column.** Into Y's center region. Y's worst single shot is `dwa-03-draft-window-2560x1440-*.jpg`, where the artifact column starts around x=530 inside a region running to x=1280 and leaves a thousand pixels empty on one side. Z centers the column horizontally and vertically in the available canvas and the result reads as composed. Take the centering, not Z's vertical centering of the title block, which pushes the heading a long way down the viewport.

**4. Z's dark-mode capsule edge, plus the shadow neither state has.** Into Y's action shelf. Z's dark capsule reads as a floating object because it has a rounded, contained shape; Y's shelf reads as a panel edge. Take the capsule shape. Then fix the defect both states share: in light mode the shelf/capsule is white on a white artifact card with no separation. Apply `wispr-calibration.md` §3, a shadow at 8 to 12% alpha on top of a lightness step, on the floating shelf only. This is licensed for exactly this case and neither candidate used it.

**Not grafted, deliberately:** nothing from Z's inspector. Its meter block, its amber callout treatment, its row highlight and its teal recolor are all steps backwards from Y and must not travel with the four items above.

---

## What remains wrong with the winner: the watch-first list

Ranked by how loudly each one still says "built by an operator for himself." Every item below survives in Y after the four grafts.

1. **The agent log.** Nine internal agent names, timestamps, and a monospace `REWRITE_OK` amber pill, at rest, on every viewport. Highest-priority remaining defect on the screen. Either give it a human register (what happened, when, and whether it passed) or move it behind an explicitly technical affordance.
2. **`Raw judge output · 2,389 characters`, `rewrite_total 74`, `Verdict provenance 3 fields`, `Gate detail 1 gate`.** Variable names and item counts presented as section headers. These are the "internal tool" verdict in text form, and they are the reason Y scored 6 on the stranger test rather than 8.
3. **The bare `Candidate 5fa0fcbf-42fa-4bcc-8a3a-5a9e61a4332b` UUID** at 2560. Nothing on a review screen should show a primary key.
4. **The three-region arrangement itself, unresolved.** Y proved discipline gets a long way inside the existing shape. It did not prove the shape is right. The right rail is still organized by where the data came from rather than by what the operator needs to know. This is the open question that should decide the next run, and Y winning this one does not settle it.
5. **The action shelf clipping the artifact at 1440 and 390.** Graft 4 improves how the shelf reads but does not stop it covering the post image. §2 Move 4 says the row belongs at the bottom edge of the artifact, which Y already does correctly at 2560 and incorrectly at every smaller viewport.
6. **The queue rail's green-tinted selected row.** A second accent spend on a screen arguing for one. `reference-study.md` §3 Move 2 gives the fix directly: a low-alpha tint for "selected but not primary" is acceptable, a full accent-family fill is not. Verify which one this is at the pixel level before changing it.
7. **The 390 log-row timestamp wrap.** Small, but it is a visibly broken row in a shipped state.
8. **The `Spice check` control.** A bare label floating with no visible affordance in both candidates, at the bottom of the summary card. It reads as a leftover.

---

## Last check: did either report claim something the pixels do not support?

*Written after all scoring above was complete and fixed. Reports read only at this point. Nothing above was changed as a result.*

The verdict stands. One finding here is large enough to be the most useful thing in this document, and it is the one the Taste skeptic was told to look for.

### The accent census is the wrong instrument, and it flatters the loser

Both reports claim **13 accent-weighted elements down to 1**, using the same census definition, naming the same thirteen, and giving the same reason: the QA bars move off the accent onto a semantic `--sev-clear` / `--sev-attention` ramp because "a score is a measurement, not a call to action."

Both claims are **true**. Both are also nearly meaningless as evidence about how the screen reads, and they are meaningless in opposite directions.

- **Y** moved the bars off the accent *and then hid eight of the nine behind a disclosure*. Pixels at rest: three saturated elements.
- **Z** moved the bars off the accent *and left all nine on screen at full size*. Pixels at rest: nine teal bars, an orange bar, an amber row highlight, an amber callout with a full border and fill, a teal score bar, a teal `PASS` chip, a lime `Approve`. Fifteen saturated elements, more than X had.

Both report `1`. The number went to 1 for Z because the definition of "accent" moved, not because the colour left the screen. Recolouring lime to teal satisfies a census scoped to `--accent`; it does not satisfy an eye. **This is exactly the failure mode the tournament was built to catch: a state that measures better and still looks like an internal tool.** Z's own line, `1440 dark / 1440 light / 2560 / 390 → 1 / 1 / 1 / 1`, is the most confident number in either report and it is the least informative one.

Credit where due: both candidates disclosed the queue-rail lime tint separately rather than folding it in, and both said so explicitly and unprompted. Neither is being dishonest. The instrument is.

**Consequence for the run:** the accent census should not be used to compare candidates again without a second measure beside it, something like saturated-elements-visible-at-rest, counted from the rendered image rather than the DOM.

### Claims the pixels do not support

1. **Z: uppercase.** Z's §5 says the de-shouting "is applied to the other four register variants in the window: the section names, the `Block` headers, **the rubric keys**, the prose caption, every disclosure summary and the stage's own chip row," and its census closes with "Not one `tt:uppercase` and not one non-zero tracking value survives in this window's chrome." The `tt:uppercase` half is almost certainly literally true. The rubric-keys half is contradicted by Z's own screenshot: `dwb-03-draft-window-inspector-1440x900-dark.jpg` shows `VOICE`, `SUBSTANCE`, `SPECIFICITY`, `DISTINCT`, `OPINION`, `ECONOMY`, `HOOK`, `VERIFIED`, `AI_TELLS` in caps at default state, nothing expanded, at every viewport in both themes. The reconciliation is that those labels are literal uppercase strings in the data, so removing `text-transform` leaves them shouting. A CSS-property census cannot see that. Note the census scope word: **chrome**. The rubric is not chrome.
   Y's equivalent claim, `uppercase text elements inside .dw: 228 → 0`, is supported at every viewport in both themes.

2. **Z: `.dd-row` boxes in the inspector 21 → 0.** True for that selector and visibly false as a pattern. The rubric block, the summary, and the amber callout all still render as bordered boxes containing label/value pairs in `dwb-03-draft-window-inspector-1440x900-dark.jpg`. The count is honest, the impression it creates is not.

3. **Y: 2560 dead space.** Y reports the bare column under the action row going from about 443px to 378px, a 15% improvement on the vertical. Z's §6 diagnosed the same defect and got it right where Y did not: "the screenshot names it as vertical space, and it is real, but the measurement says the larger part is horizontal." Z is correct. Y fixed the smaller half of its own named defect and its 2560 shots still carry roughly a thousand pixels of one-sided horizontal emptiness. **Graft item 3 stands and is now better evidenced than when I wrote it.**

### Claims that hold up

- Y's `8 dimensions at or above the mark`, a faithful execution of `reference-study.md` §4 Move 2, and the highest-leverage change made by either candidate.
- Z's dock alignment. Its own numbers, `artifact_card x366 w520` and `dock x366 w520`, confirm the action row is aligned to the artifact rather than to the column, which is §2 Move 4 done correctly and is why Z's 2560 composition reads.
- Z's `Fix or remove` disclosure resolving to `Approve / Edit / Schedule / Fix or remove`, which goes past what §2 Move 1 describes and is graft item 1.
- Both: the artifact measure is 520px before and after in both states. Neither shrank the thing being read, and both said so. That was the right constraint and both held it.
