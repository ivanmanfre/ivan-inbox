# Blind panel: calendar month view, X vs Y

Judged blind at 1440x900, dark theme. Two files only: `/tmp/panel2/cal-X.jpg`, `/tmp/panel2/cal-Y.jpg`.
Zoomed crops (3x to 4x nearest neighbour) and pixel value probes were used for the chip, header, right panel and last row.

## 1. Winner

**Y, clear margin.** Not decisive, because the underlying scanning mechanic is identical in both and both fail the same completeness test. But on the two things this screen exists to do, know which days are occupied and read what the entry is, Y is ahead on the second by a wide gap, and Y is the only one of the two that does not draw its entries as raised buttons.

## 2. Scanning the month

Both states use the same primary mechanic, and it is the right one: the **day tile fill lifts when the day is occupied**. Measured, sampling tile background beside the date numeral where no chip covers it:

| | empty day (13, 5) | occupied day (14) |
|---|---|---|
| X | `#0c0c0a` | `#1f1f1f` |
| Y | `#0c0c0a` | `#1c1c1c` |

So occupancy is legible without reading a word in both. X's occupied fill is marginally lighter (`1f` vs `1c`), and X's chip fill is much lighter (`#3e3e3e` vs Y's `#31 3433`), so at a hard squint X's occupied days pop slightly harder.

That extra pop is not a win, for two reasons.

First, in X the pop comes from the **chip**, not the day. X's chip fills nearly the whole tile (day 15's chip runs the full inner width and bottoms out on the tile border), so the cell stops reading as a cell and reads as a lozenge with a date number stuck above it. Y's chip occupies roughly the top third of the tile and leaves visible tile below it, so the tile stays the unit and the chip is clearly a child of it. A day with two entries would still look like one day in Y; in X it would look like a stack of buttons.

Second, X applies **two different chip treatments** for what must be two states. Days 9, 10, 11, 14, 17, 21 have no chip fill at all, just a dashed left rule with text sitting straight on the tile. Days 12, 15, 18, 20, 24 have a filled, bevelled chip. So in X, "state" is encoded as flat-versus-3D, and at a glance half the occupied days look substantially louder than the other half for reasons that have nothing to do with importance. Y gives every entry the same fill and encodes state in the left bar instead (dashed grey, solid grey, solid green) plus a glyph (green check versus a dot on day 24). Same information, one visual weight.

Net: same mechanic, Y applies it more consistently. Call it a slight Y edge on scanning, and a decisive Y edge on "does an occupied day still read as a day".

## 3. Reading an entry

Three entries, same three cells in each state.

**Thursday 20 (week of 16 to 22, fifth column of that row):**
- X: `✓ 14:00` / "Nobody books off…" (16 characters of title survive)
- Y: `✓ 14:00` / "Nobody books off your first…" (27 characters)

**Friday 14 (week of 9 to 15, sixth column):**
- X: `✓ 15:00 →` / "LinkedIn gives me…" (17 characters)
- Y: `✓ 15:00 →` / "LinkedIn gives me around…" (24 characters)

**Monday 24 (week of 23 to 29, second column):**
- X: `10:00` / "10 to 15 calls a…" (16 characters, and note there is no state glyph at all before the time)
- Y: `● 10:00` / "10 to 15 calls a month is…" (25 characters, with a dot glyph marking a state distinct from the checked ones)

Both truncate to two lines. Y's smaller type buys about 50 to 70 percent more title per chip across the board, and the same holds everywhere I checked: "Sunday: next wee…" versus "Sunday: next week is…" (Sun 26 of the leading week), "The format that…" versus "The format that reaches…" (Wed 29 leading week), "A buyer asked if t…" versus "A buyer asked if the case…" (Tue 18), "You scroll LinkedIn…" versus "You scroll LinkedIn ever…" (Fri 21). One entry ties: Wed 12 reads "I built a complete…" in both.

Is an ellipsised title still useful? It depends entirely on where the cut lands, and that is the whole argument. "Nobody books off your first…" is a recognisable hook; you know which post that is. "Nobody books off…" is a fragment that could be any of five drafts, so you have to click to find out, which defeats the month view. X cuts inside the subject in almost every cell. Y usually gets one clause out. Neither reaches "I never need to hover", but only one of them is usable as an index.

X's compensation is bigger type, roughly 16px title against Y's roughly 13px, which is genuinely easier per glyph. That is the one real thing X buys, and it is not worth the price it pays in words.

## 4. The chip as an object

**X is guilty, and severely.** Its filled chips (12, 15, 18, 20, 24) are drawn with the full bevel kit:

- a light hairline outline on the **top and left** edges,
- a hard, near-black offset band on the **right and bottom** edges,
- a fill (`#3e3e3e`) lifted far above both the tile (`#1f1f1f`) and the page (`#0c0c0a`), roughly 3.2x the tile's lift,
- a corner radius almost equal to the tile's own radius, so the nesting depth is ambiguous,
- and a chip footprint so large that the bottom shadow band collides with the tile's own border (clearest on day 15 and day 20).

Highlight top-left plus shadow bottom-right is the literal definition of a bevelled, raised button. On day 20 the chip looks like a key you could press, sitting on a card, sitting on a page: three stacked planes to express one draft on one day. That is the "ugly 3d" and it is also the specific era tell, because this is the Aqua and Bootstrap 2 button recipe. Worse, X mixes it: the unfilled chips on days 9, 10, 11, 14, 17, 21 have no plane at all, so the grid contains both zero-elevation and two-elevation objects at once, with no legend.

**Y is largely clean.** The chip is a single flat fill (`#31 3433`) with a solid or dashed left bar, no outer outline, no offset shadow, no highlight edge. Probing the row immediately above and below the day 15 chip gives the same value (`#1b1b1b` both sides), meaning there is no shadow being cast. The mechanic is fill difference plus a left accent rule, which is the correct pair: it says "this is a thing inside the cell" rather than "this is a thing on top of the cell". Radius is smaller than the tile's, which reads as nesting rather than as sibling.

So the owner's complaint maps cleanly onto X and only onto X, at the calendar chip level. Y has a residual bevel problem, but it moved to the right panel, see below.

## 5. Header and right panel

**Vocabulary a stranger would have to be taught.**

- X's month summary reads `13 dated this month` and `6 queue only`. "Queue only" is internal shorthand; nothing on screen defines the queue. Y reads `1 scheduled` and `12 posted`, both of which a stranger already knows. Y wins outright here.
- Both share the state filter row `Gen 0 | Review 2 | Appr 0 | Sched 1`. "Appr" and "Sched" are truncated words, not abbreviations anyone reads aloud, and "Gen" is genuinely ambiguous (generated? general? generating?). This is a shared defect and it survives into the winner.
- Y's right panel row shows `Text  2d` under each card. "Text" as a format label next to a bare "2d" age is unexplained; a stranger reads "Text" as a verb.
- Y's sidebar adds counts to everything at once: `117 waiting on you`, `DMs 10`, `Content 95`, `Magnets 12`, `Workflows 20`, plus per-client counts `Ivan 2`, `Mattan Danino 54`, `Davorin Smit 39`. Some of that is useful, but 95 next to Content with no unit invites the wrong question, and "117 waiting on you" is a number nobody can act on. X is calmer here (`Content 2`, `DMs 9`) but tells you less.

**Chrome heavier than its content.** In X the right panel is a titled section, `Ready, no date`, with a horizontal rule above and below the title, a trailing rule, a `0`, and the sentence "Nothing approved is sitting without a date." That is five pieces of chrome around an empty set, occupying a full column of the viewport to say nothing. In Y the same panel is `No date yet  2` in a filled header bar with the microcopy "Oldest first. Drag one onto a day.", plus two real cards. Y's version earns the column; X's does not, though X's is honestly at the mercy of the data.

Both states keep the same bevelled pill buttons in the calendar toolbar: the `‹`, `›` and `Today` controls all carry a light top edge and a dark bottom edge. That is the same 3D vocabulary as X's chips, and it survives untouched into the winner.

## 6. Completeness

**Neither month fits.** Both are clipped by the window edge on the trailing week.

- X: the final row (30, 31, then 1 to 5 of September) begins at roughly y=837 with the frame ending near y=880, so about 43px of a roughly 128px row is visible. The date numerals are there and everything below them is gone.
- Y: the final row begins at roughly y=794, so about 86px is visible, roughly double, but it is still cut mid-cell.

So the answer for both is "a week is cut off by the window edge". Y is less bad, and Y earns that purely by being denser. Neither state gets a whole August plus its spill days onto one screen, which for a month calendar is a real failure and not a nitpick.

## 7. What is still wrong with Y

Mandatory list, all specific.

1. **The bevel did not die, it moved to the right panel.** The two "No date yet" cards carry exactly the defect X was guilty of in the grid: a light hairline on the top and left, a rounded outline, a slight raise off the panel. So the app now contains two contradictory chip languages, flat in the calendar and raised in the panel, twenty pixels apart.
2. **The right-panel cards have almost no left padding.** "Built a €70k/mo agency on zero paid ads…" and "Two months of build, then 30k a month t…" both start flush against the card's left border, with the text nearly touching the accent rule. It reads like a bug, not a decision.
3. **Today is weaker than in X.** Day 22's ring in Y is close in value to an ordinary tile border, so "today" is carried mostly by the bolded numeral. X's today ring is visibly brighter. Y lost a real affordance while cleaning up.
4. **The check glyph washes out on the lighter chips.** On day 15 the green check over the lighter fill is close to unreadable at 100 percent; contrast between the green and the chip fill is too low. On day 14, over the darker fill, the same glyph is fine. State is now legible only on some chips.
5. **Chip fill is not consistent.** Days 15 and 20 sit lighter than 21 and 14, with no legend anywhere and no repetition of the pattern in the header filters, so the user has to infer what two fills mean. If the fills carry state, the state filters should share the coding; they do not.
6. **Title type is small, roughly 13px, and the time row is dimmer still.** Y bought its extra words with size. On a 27 inch monitor this is fine; on a laptop at arm's length the time row is close to the readability floor.
7. **The dashed left rule is drawn wrong.** On days 14 and 21 the dashed bracket has a stray hooked stroke curling at the top and bottom, like a broken border image. Present in both states, more obvious in X, but still shipping in Y.
8. **The trailing week is still cut.** Point 6 above. Half a solved problem.
9. **Empty days offer nothing.** Twenty-plus tiles in Y hold nothing but a numeral and no affordance whatsoever, no hover-implied add, in a screen whose panel copy literally says "Drag one onto a day". The instruction points at a target that gives no sign it is a target.

## Closing

A stranger would call Y an internal tool built by someone competent, not a designed product, and would call X an internal tool built in 2013. Y gets the fundamentals right, which is why it wins: entries are nested, not raised, occupancy is carried by tile fill, and the summary line uses words a human already owns. But the tells are still all over it. The single strongest one is the **inconsistency of the chip language within one screen**: the calendar chip is correctly flat while the right panel card, sitting six inches away in the same viewport, is bevelled with a highlight edge and near-zero left padding. A designed product has one object language and repeats it. Y has two, and the one it kept is the one the owner already objected to.
