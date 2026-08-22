# Blind design panel A

Four pairs, judged one pair at a time, no knowledge of which state is older. Judgments are on pixels only.

---

## Pair 1: content list (01-X vs 01-Y)

**Winner: TIE. Margin: none.**

**Why.** These are the same layout with the same body. The entire content region (x 240 to 1420, y 130 down) is identical in both: a hairline-separated two-row list, no card elevation, no zebra, `TITLE` and `PILLAR` column heads in gray micro-caps, and three ghost actions per row (`SKIP` `APPROVE` `DELETE` at x 1120 to 1400) that share one weight, one radius and one gray. Nothing in either state tells me which action is the one I am supposed to take, which is the single biggest hierarchy failure on this screen and it is present in both.

The only differences are in the left rail and they cancel out:
- Y adds a top-level readout at (60, 103), bold white `117` plus gray `waiting on you`. That is a real typographic anchor: it gives the rail a first fixation point that X does not have, where X jumps straight from wordmark to nav.
- Y quantifies the nav (`Content 95`, `Magnets 12`) and the tenant chips (`Ivan 2`, `Mattan Danino 54`, `Davorin Smit 39` at y 96). That improves information scent on the chips, which in X are three undifferentiated pills.
- Against that, Y spends its most saturated colour badly. The amber `Workflows 20` row with a warning triangle at (57, 745) is the loudest object in the Y frame, and it is an ops error counter in the nav, competing with the amber dot on the active `Needs review 2` tab at (466, 143), which is where the eye should go. X has exactly one amber accent and it lands on the active tab.
- X pays for that restraint with a dead zone: 200 vertical pixels of nothing between `Dock it beside your work` (y 587) and `Settings` (y 791). Y fills it, but with the warning row.

Net, one adds hierarchy and takes back the accent budget, the other keeps the accent budget and has a hole in the rail. No stranger picks a winner here.

**Does the loser read as an internal tool?** Both do, equally. Strongest tell, shared: `SKIP` / `APPROVE` / `DELETE` rendered as three identical gray micro-caps ghost buttons. A product decides which of the three is primary. An operator who already knows the keyboard order does not need it decided.

**What is still wrong with the winner (both).** The row is not an object. Title, two status chips, a two-line body excerpt, a pillar word, three buttons and a timestamp are all set on the same flat background at four different grays with no container, so the eye has no unit to grab. Column heads say `TITLE` and `PILLAR` but the actual columns are not aligned to anything: `Case Study` sits at x 996 while the tab strip above it starts at x 262. The tab strip itself has nine items with counts and no visual grouping, so `Errors 48` and `Archived 88` carry the same weight as `Needs review 2`, which is the only one that matters.

---

## Pair 2: month calendar (02-X vs 02-Y)

**Winner: Y. Margin: slight.**

**Why.**

*Legibility of the primary object.* Every event in X is a single truncated line: `You can rewr...` (312, 432), `A doc with 5...` (436, 432), `I went down ...` (560, 432), `Someone dr...` (1056, 432). Fourteen entries, fourteen ellipses, not one of them readable. Y gives each cell about 128px of height instead of 90px and wraps to two lines: `You can / rewrite yo...`, `A doc with / 50+ DM...`, `A buyer / asked if t...`. It still truncates, but a scan of the month now returns actual topics instead of a column of dot-dot-dot. On a calendar, whose only job is scanning, that is the load-bearing difference.

*The brightest and heaviest surface.* X's right panel header `No date yet 2` at (1140 to 1404, 210 to 244) is a solid light-gray filled bar with a rounded top, sitting on top of two hairline-bordered cards. That is a table-header-on-a-panel construction, and it is the second brightest block in the frame after the calendar cells. Y replaces it with a plain title, a hairline rule running to the right edge, and a right-aligned count at x 1384. Same information, no filled chrome.

*Header metrics.* X reads `1 armed  0 planned  12 posted  6 queue only` across (1030 to 1404, 150). Four numbers, two of them in private vocabulary. Y reduces to `13 dated this month  6 queue only`. Fewer competing numerals above a grid that is already numeral-dense (35 day numbers), and one of the two is in plain words.

*Figure and ground.* In X the empty cells in the week of 2 to 8 (y 296 to 376) are filled tiles with the same value as the cells that contain work. Every container in the grid sits up at the same elevation, so nothing is figure. Y darkens the empty cells toward the page and lets the occupied cells carry the weight, so the four weeks with content read before the two without.

*Where X is genuinely better.* X shows the whole month. Y's last row (30, 31) is guillotined by the window edge at y 860, which on a month view is a real defect, not a nitpick. X also earns its right panel: two queued cards plus the instruction `Oldest first. Drag one onto a day.` teach the interaction. Y has nothing to teach because the queue is empty, so that comparison is partly data, not design.

**Does the loser read as an internal tool?** Yes. Strongest tell: `1 armed` at (1032, 150). `Armed` is the operator's word for a state machine he wrote. No product ships a top-line metric its user would have to be told the meaning of.

**What is still wrong with the winner.** The pills are exactly the "ugly 3d" object and Y makes them bigger, so it makes them worse. Look at day 12 (683, 512), day 15 (1056, 512), day 18 (560, 640), day 24 (436, 768): a light-gray filled block with a visible border and a lighter top edge, sitting inside a bordered cell, sitting on a bordered grid. Three nested containers, each with its own stroke, which is precisely how a 2013 bevel reads. A calendar entry should be a coloured bar or a plain line of type in the cell, not a raised chip on a raised tile. Second, the status filter row is incoherent: `Review 2` at (800, 96) is selected with an amber outline box while `Sched 1` at (945, 96) is marked with a teal underline. Two selection mechanics on four adjacent chips. Third, the check glyph and the arrow in `✓ 10:00 →` are repeated fourteen times at 10px and carry no distinguishable meaning at that size.

---

## Pair 3: draft review window (03-X vs 03-Y)

**Winner: Y. Margin: decisive.**

**Why.**

*The action bar is the whole verdict.* X scatters seven controls across two rows at the bottom of the centre column: `Approve` `Edit` `Schedule` `Regenerate` `Swap image` `Back to idea` on one line (352 to 918, y 785), then `Delete` in a red outline box dropped onto a second line at (352 to 421, y 836). Seven peers, a wrap, and the destructive action given its own line and its own colour, which is the most visually distinct object in the lower half of the frame. Y groups three actions inside one floating toolbar with a border and a radius (352 to 960, y 800 to 850): lime `Approve`, then `Edit` and `Schedule` as equal-weight secondaries, then the destructive path pushed to the far right of the same bar as a plain text disclosure, `Fix or remove ›` at (838, 825). One primary, two secondaries, one escape hatch, one container. That is a decided screen versus an undecided one.

*Where the brightest colour goes.* X spends lime nine times: the score bar at (1160 to 1400, 250) plus eight full-width dimension bars from `VOICE` (y 373) to `AI_TELLS` (y 610). The most saturated colour in the window is spent on diagnostics that all passed, so the eye is dragged right, away from the draft and away from `Approve`. Y shows one bar for the score and then exactly one dimension row, `Distinct 6/10` at (1107 to 1412, 325), in orange, because it is the one that failed, with the rest collapsed behind `› 8 dimensions at or above the mark`. The right rail now answers "what is wrong" in one glance instead of asking me to read nine bars to find the short one.

*Elevation and containment.* In X the LinkedIn preview floats directly on the page background and is sliced by the button row, so the white card just stops at y 750 with no edge. In Y the preview sits inside a slightly raised panel that runs from x 350 to 965 and the toolbar overlays it as a deliberate floating element, so the card belongs to a container instead of ending where a widget happens to be.

*Typography.* X labels in all caps everywhere: `IN THIS QUEUE`, `BACKEND DEPTH`, and the meta row rendered as three boxed chips `TEXT` `NEEDS REVIEW` `EDITED 17H AGO` (352 to 648, y 158). Three boxes for three pieces of metadata, none of which is an action. Y sets those as sentence case separated by middots, `Text · Needs review · edited 21h ago`, removing three containers from directly under the H1, and renames the rail `What decides it`, which is a sentence a reader can use, versus `BACKEND DEPTH`, which is a schema name.

*Amber treatment.* X puts the judge conflict in a filled amber box with a border (1082 to 1440, 268 to 340) that outweighs the score card above it. Y keeps the same sentence but marks it with a single amber left rule at x 1092, so a warning stays a warning without becoming the loudest block in the column.

**Does the loser read as an internal tool?** Yes, unambiguously. Strongest tell: the rail is titled `BACKEND DEPTH` and its tabs are `QA` `SOURCE` `LOG` `FIELDS`. That is a debugger bolted to a review screen, and the label admits it.

**What is still wrong with the winner.** The preview is still amputated: the white card runs off the bottom of the window at y 860 mid-image, so the thing being approved cannot be seen in full at the moment of approving it. The summary card truncates mid-sentence at `independent of rewrite:…` (y 601) and then offers `Show all 708 characters`, which is a character count offered to a reader, not a word count or a "read more". Below the fold the rail is still four collapsed debug rows, `Raw judge output · 2,389 characters` (1094, 717), `The applied rewrite`, `Gate detail 1 gate`, `Verdict provenance 3 fields`. `Fix or remove ›` is also too polite to be a delete affordance: a user cannot tell whether it edits or destroys. And the queue rail on the left is still a bare list on the page with only a lime left bar and an olive tint marking the current item, at a different radius from every other container in the window.

---

## Pair 4: strategy view (04-X vs 04-Y)

**Winner: TIE. Margin: none.**

**Why.** The content region is identical, pixel for pixel, from the `STRATEGY` header at (252, 48) down to `2 · WHAT THE MESSAGE SAYS` at (252, 870). Same measure, same leading, same section spacing, same inline lime accents on `OFF-LANE` (290, 325) and `1 · THE INSTRUMENTED LANE` (372, 751), same four glyph controls `↑ ↓ + ×` parked at x 1318 to 1394. The only deltas are `saved 3d ago` versus `saved 2d ago` at (1032, 47) and the left-rail count differences already described in Pair 1. Nothing here was designed differently in the two states.

**Does the loser read as an internal tool?** There is no loser, and both read as an internal tool. Strongest tell: the per-section controls are four unlabelled 12px glyphs floating at x 1318 to 1394, roughly 400px to the right of the text they act on, with no hover target, no grouping and no container. Nobody but the person who wrote them knows that `+` inserts a section and `×` deletes one, and nobody but him would accept that they sit nearly half a screen away from the thing they modify.

**What is still wrong (both).** Section titles `Who I sell to` (y 162), `What I sell` (y 521) and `Pillars — 5 slots a week` (y 715) are set at essentially body size and body colour, so the document has no visible level structure: the only reason I can find a section boundary is a slightly larger gap. Hierarchy is instead carried inline by bolded lead-ins, `Floor`, `Tiers`, `First client`, which is a markdown render, not a layout. The text sits on the raw page with no card, no rule, no measure guard, while the right 500px of the pane is empty. Lime is used for `OFF-LANE` and for pillar numbers, so the accent means "emphasis" in one place and "list marker" in another. And the top of the page opens on a disclaimer in the smallest gray on the screen, `1 of 8 sections still unwritten. Only you can see this...`, so the first thing the page says is a note about its own plumbing.

---

## Tally

- Pair 1 content list: TIE
- Pair 2 month calendar: Y
- Pair 3 draft review: Y, decisive
- Pair 4 strategy: TIE

Two decisions, both to Y. Two screens where the two states are the same design carrying different data.

## Where the winner still reads as an internal tool, stated harshly

1. **Strategy is untouched and it is the worst screen in the set.** Neither state did a single thing to it. It is a markdown file printed on a black div with four naked glyphs floating 400px from their targets, section headings the same size as body copy, and an apology about unwritten sections as the opening line. If a stranger opened the app here they would assume they had hit a debug route. This is the screen the "internal tool ui, not polished at all" verdict is about, and no work has been done on it.

2. **The calendar pills are still a bevel, and the winner made them larger.** Days 12, 15, 18, 20 and 24 are light-filled bordered chips inside bordered cells inside a bordered grid. Three strokes stacked. Enlarging the pill enlarged the defect. Also, the winning calendar cannot show the last week of the month.

3. **The content list never decides.** `SKIP` `APPROVE` `DELETE` remain three identical gray ghosts in both states. The main working surface of the app has no primary action, and a nine-tab strip where `Errors 48` shouts as loudly as `Needs review 2`.

4. **The review rail still leaks the schema.** Even after the good pass, the winner shows `Raw judge output · 2,389 characters`, `Gate detail 1 gate`, `Verdict provenance 3 fields`, and offers `Show all 708 characters` to a human reader. Character counts are for the operator who wrote the parser.

5. **The draft preview is cut off at the window edge in the winner.** The user approves a post whose image and last lines he cannot see. That is not an aesthetic complaint.
