# WORKBENCH SYSTEM AUDIT

Five measured censuses of `src/exp/v2c/` on branch `wb/polish`, taken against the
production build at `http://localhost:4173/` on 2026-08-22.

**Every number here is measured**, not estimated: either a computed style read
out of a real DOM in a real browser at 1440x900, or a grep with its count. The
scripts are in `evidence/audit-tools/` and re-run as after-proofs.

Surfaces walked (10): `today`, `dms-list`, `content-list`, `content-calendar`,
`ops`, `sends`, `strategy`, `settings`, `thread-open` (a DM thread opened as a
context peer), `draft-open` (a draft window with its queue, main and inspector
columns all mounted).

---

## 0 · THE REPO TRAP, CONFIRMED

The diagnosis in the brief is correct and I read the rules to confirm the exact
shape and line numbers.

| what | file:line | rule |
|---|---|---|
| the flattener | `src/exp/v2c/faithful.css:181` | `.wb.wb, .wb.wb *{ font-size:var(--fs-body); font-weight:400; letter-spacing:0; line-height:1.6 }` |
| font-family flatten | `src/exp/v2c/faithful.css:190` | `.wb.wb *{ font-family:inherit }` |
| first re-assertion | `src/exp/v2c/faithful.css:123` | `.wb.wb.wb input, .wb.wb.wb textarea, .wb.wb.wb select, .wb.wb.wb button{ font-variant-numeric:tabular-nums }` |
| type tiers re-asserted | `faithful.css:194-265` | seven tiers, every selector prefixed `.wb.wb.wb` |
| the rule written down | `faithful.css:18-26`, `styles.css:964-971`, `wb2026.css:9-12` | all three sheets carry the warning in a comment |

`.wb.wb` is specificity 0-2-0 and beats every single-class font rule in the base
sheets. `.wb.wb.wb` is 0-3-0. **A new selector written with one `.wb` (0-1-0) or
two (0-2-0, and losing on source order because `faithful.css` is imported after
`styles.css`) silently renders at `--fs-body` 16px / weight 400 / letter-spacing
0 / line-height 1.6.** It does not error, it does not look broken in review, it
looks like body text.

Load order is `Shell.tsx:60,64,67`: `styles.css` then `faithful.css` then
`wb2026.css`. `wb2026.css` is last and already carries `.wb.wb.wb` on every rule
in the file, so it is the correct home for anything new.

**Consequence for every recommendation below:** every new primitive ships as
`.wb.wb.wb .<name>` in `wb2026.css`, and any new type declaration must restate
`font-size` / `font-weight` / `letter-spacing` / `line-height` explicitly rather
than inheriting, because the flattener has already overwritten all four on every
descendant. There is a second trap on top of the first: because the flattener
sets these on `*`, a parent-level type declaration does not reach its children.
Type must be declared on the leaf that carries the words.

---

## A · TOKEN + SURFACE CENSUS

Tool: `audit-tools/token-census.mjs` (static, all four sheets) plus
`audit-tools/measure.mjs` + `analyze-a.mjs` (live computed style).

### A0 · headline

| measure | count |
|---|---|
| distinct custom properties | **74** |
| definition sites (a token defined more than once counts once per site) | **130** |
| tokens with zero `var()` readers | **2** (`--pat-1`, `--pat-4`) |
| distinct painted background colours across all 10 surfaces | **25** |
| **nested pairs with IDENTICAL computed background-color (distinct shapes)** | **25** |
| same-colour live instances across the 10 surfaces | **58** |
| child boxes that paint nothing at all and are separated by a border alone | **20 shapes / 128 instances** |

### A1 · the surface ladder is four steps in a range one tenth of the available one

| token | dark | dark L | light | light L | delta L to previous (dark) |
|---|---|---|---|---|---|
| `--canvas` | `#0C0C0B` | 0.0037 | `#F7F7F5` | 0.9289 | - |
| `--surface1` | `#1F1F1F` | 0.0137 | `#FFFFFF` | 1.0000 | +0.0100 |
| `--surface2` | `#2A2A29` | 0.0231 | `#EFEFED` | 0.8620 | +0.0094 |
| `--surface3` | `#353533` | 0.0354 | `#E3E3E0` | 0.7665 | +0.0123 |
| `--hairline` | `#303030` | 0.0296 | `#DBDBD8` | 0.7068 | - |
| `--hairline-strong` | `#4C4C4C` | 0.0723 | `#B5B5B2` | 0.4609 | - |

Two things fall out of this table and both matter.

1. **The whole dark ladder spans L 0.0037 to 0.0354.** That is a range of 0.032
   on a 0-to-1 scale. Four surface steps are packed into the bottom 3.5% of
   luminance. The steps between them (+0.010, +0.009, +0.012) are near the floor
   of what reads as a step at all on a screen at typical brightness.
2. **`--hairline` (L 0.0296) is BRIGHTER than `--surface2` (L 0.0231) and sits
   between surface2 and surface3.** The separator line is louder than two of the
   three surfaces it is meant to separate. That is the mechanical reason the app
   reads as drawn-with-lines: the lines genuinely have more contrast against the
   canvas than the surfaces do against each other.

Full 74-token table with every definition site and read count:
`audit-tools/out-tokens.md`. Full colour table both themes: `out-census-a.md` A1.

### A2 · what is actually painted

Union across the 10 surfaces, 635 painted elements:

| painted colour | which token | elements | share |
|---|---|---|---|
| `rgb(42,42,41)` | `--surface2` | 218 | 34.3% |
| `rgb(31,31,31)` | `--surface1` | 128 | 20.2% |
| `rgb(12,12,11)` | `--canvas` | 67 | 10.6% |
| `rgb(53,53,51)` | `--surface3` | 46 | 7.2% |
| `rgb(255,255,255)` | `--cat-3` / white marks | 45 | 7.1% |
| `rgb(184,255,102)` | `--accent` | 42 | 6.6% |
| everything else (19 colours, severity + category + scrims) | - | 89 | 14.0% |

**Three greys carry 65% of every painted element in the app, and they are
separated by a total of 0.021 luminance.**

### A3 · THE CORE FINDING: nested elements painted the same colour

25 distinct `child on parent` shapes, 58 live instances. Full table in
`audit-tools/out-census-a.md` A3. The ones where a visual relationship is
unambiguously intended:

| # | child | on parent | shared bg (L) | what currently separates them | seen on |
|---|---|---|---|---|---|
| 1 | `div.cal-chip` | `div.cal-day` | `#1F1F1F` (0.0137) | **a 3px LEFT rail only**, colour = STATUS (`rgba(16,163,127,.75)` scheduled, `#FFD60A` review, `rgba(235,235,245,.45)` published), never elevation | calendar, draft-open |
| 2 | `div.cal-chip.cal-chip-lock` | `div.cal-day` | `#1F1F1F` | same 3px left rail | calendar, draft-open |
| 3 | `div.cal-chip.cal-chip-lock.cal-chip-queue` | `div.cal-day` | `#1F1F1F` | same rail, `dashed` | calendar, draft-open |
| 4 | `div.cal-chip.cal-chip-lock` | `div.cal-day.cal-day-out` | `#1F1F1F` | same rail, parent at `opacity:.42` | calendar, draft-open |
| 5 | `div.dd-card` | `div.dd-card` | `#1F1F1F` | **NOTHING.** A card nested inside a card, identical colour, no border, no shadow | ops |
| 6 | `div.rows.ct-rows` | `div.wb-work.wide.wb-solo` | `#0C0C0B` (0.0037) | `border-top 1px solid rgb(48,48,48)` | content-list, calendar |
| 7 | `div.rows.ct-rows` | `div.wb-work.list` | `#0C0C0B` | `border-top 1px solid rgb(48,48,48)` | draft-open |
| 8 | `div.rows.ov` | `div.wb-work.wide` | `#0C0C0B` | `border-top 1px solid rgb(48,48,48)` | sends |
| 9 | `div.rows.wb-tk-body.dw-body` | `section.wb-tk` | `#0C0C0B` | `border-top 1px solid rgb(48,48,48)` | draft-open |
| 10 | `div.dw-acts` | `div.rows.wb-tk-body.dw-body` | `#0C0C0B` | `border-top 1px solid rgb(48,48,48)`. The draft window's **entire action bar** is the colour of the body it floats over. | draft-open |
| 11 | `div.dw-insp-h` | `div.rows.wb-tk-body.dw-body` | `#0C0C0B` | **NOTHING** (inspector header on the inspector) | draft-open |
| 12 | `div.dw-queue-h` | `div.rows.wb-tk-body.dw-body` | `#0C0C0B` | **NOTHING** (queue header on the queue) | draft-open |
| 13 | `div.wb-pane-h.slim` | `div.wb-peer.wb-peer-thread.on` | `#0C0C0B` | `border-bottom 1px solid rgb(48,48,48)` (a pane header on its own pane) | thread-open, draft-open |
| 14 | `div.wb-sech` | `div.wb-sech-strip` | `#0C0C0B` | `border top+bottom 1px solid rgb(48,48,48)` | calendar, draft-open |
| 15 | `button.wb-sech.tap` | `div.wb-sech-strip` | `#0C0C0B` | `border top+bottom 1px solid rgb(48,48,48)` | ops |
| 16 | `div.wb-sech-strip` | `div.rows.ct-rows` | `#0C0C0B` | **NOTHING** | calendar, draft-open |
| 17 | `div.wb-sech-strip` | `div.rows.ops-rows` | `#0C0C0B` | **NOTHING** | ops |
| 18 | `div.ops-sechdr` | `div.rows.ops-rows` | `#0C0C0B` | `border top+bottom 1px solid rgb(48,48,48)` | ops |
| 19 | `div.ct-tabs` | `div.rows.ct-rows` | `#0C0C0B` | `border-bottom 1px solid rgb(48,48,48)` | content-list |
| 20 | `div.rows.td-rows` | `div.wb-work.wide` | `#0C0C0B` | **NOTHING** | today |
| 21 | `div.rows` | `div.wb-work.wide.wb-solo` | `#0C0C0B` | **NOTHING** (DMs list on its own pane) | dms-list |
| 22 | `div.rows` | `div.wb-work.list` | `#0C0C0B` | **NOTHING** | thread-open |
| 23 | `div.rows.ops-rows` | `div.wb-work.wide` | `#0C0C0B` | **NOTHING** | ops |
| 24 | `div.rows.settings` | `div.wb-work.wide` | `#0C0C0B` | **NOTHING** | settings |
| 25 | `div.rows.ct-rows.wb-strat` | `div.wb-work.wide` | `#0C0C0B` | **NOTHING** | strategy |

**Of the 25 shapes, 11 are separated by nothing at all and 14 by a 1px or 3px
line. Zero are separated by a change of surface colour.** That is the whole
diagnosis in one row of arithmetic: in this app, elevation is not a colour
decision, it is a line decision, and there is no case where it is anything else.

Note also that rows 20-25 are the same shape six times: the scrolling list
container is painted `--canvas`, identical to the pane that holds it, on six
different screens. The list never reads as an object placed on a pane.

**The single most damning pair is #1.** `faithful.css:3724` sets
`.cal-day{ background:var(--surface1) }` and `faithful.css:3750` sets
`.cal-chip{ background:var(--surface1) }`. A chip sitting inside a cell, in the
most visual surface in the app, is painted the identical colour as the cell. The
comment above the rule (`faithful.css:3744-3749`) records that a previous pass
deliberately removed the chip's fill and its ring because "three elevation cues
stacked on a 32px control ... read as a raised 2015 button". The removal was
right; the replacement never arrived. What is left is zero elevation cues plus a
status rail carrying a second job it cannot do.

### A4 · child boxes that paint nothing and lean entirely on a line

20 distinct shapes, 128 live instances. The heaviest, by number of surfaces they
appear on:

| child | on parent | separator | on how many of the 10 surfaces |
|---|---|---|---|
| `button.wb-rail-minbtn` | `div.wb-plate` | `1px solid rgb(48,48,48)` all four sides | **10 / 10** |
| `div.wb-rail-sync` | `div.wb-plate` | **NOTHING** (r 999px, invisible pill) | **10 / 10** |
| `div.wb-rail-grp` | `div.wb-plate` | `left 1px solid rgb(48,48,48)` | 6 / 10 |
| `div.wb-rail-grp.on` | `div.wb-plate` | `left 1px solid rgb(184,255,102)` | 4 / 10 |
| `aside.dw-insp` | `div.rows.wb-tk-body.dw-body` | `left 1px solid rgb(48,48,48)` | draft-open |
| `aside.dw-queue` | `div.rows.wb-tk-body.dw-body` | `right 1px solid rgb(48,48,48)` | draft-open |
| `section.dw-sec` | `div.rows.wb-tk-body.dw-body` | `bottom 1px solid rgb(48,48,48)` | draft-open |
| `div.cal-day.cal-day-empty` | `div.rows.ct-rows` | `inset 0 0 0 1px rgb(48,48,48)` | calendar |
| `div.wb-cardf` (card footer) | `div.ov-pipe` / `div.ov-tbl` / `div.rows.ov` | `top 1px solid rgb(48,48,48)` | sends |
| `div.ct-card.wb-strat-card.blank` | `div.rows.ct-rows.wb-strat` | `inset 0 0 0 1px rgb(48,48,48)` | strategy |

**The draft window's three-column layout is entirely constructed out of 1px
lines.** `dw-queue`, `dw-main` and `dw-insp` are all `#0C0C0B`, all separated by
`border-left`/`border-right: .5px solid var(--sep)` (`styles.css:1020-1021`).
Three columns, one colour, two lines.

### A5 · one defect found in passing

`button.cal-chip-t` computes `border: 2px outset rgb(0,0,0)` on all four sides.
That is the **user-agent default button border**, not an authored value: no rule
in any of the three sheets sets a border on `.cal-chip-t`, and `faithful.css:123`
re-asserts `font-variant-numeric` on `button` but never `border:0`. It is
invisible only because `outset` black on `#1F1F1F` is nearly the same colour.
Any elevation model that lightens the chip will make this 2px bevel appear.

---
