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

## MEASUREMENT PROVENANCE

Censuses A-E were all measured against the **same** production build:
`dist/` as built at 2026-08-22 11:04, before `src/exp/v2c/wbsys.css` existed and
before any phase-2 builder change landed. Repo HEAD at capture time was in the
`ccc9e2a -> 6939828 -> 0117a78` lineage on `wb/polish`. Every number below is a
**before-count** taken on that build, so a later run can rebuild and re-run the
same scripts to produce a comparable after-count.

Raw data: `audit-tools/out-measure.json` (all 10 surfaces),
`audit-tools/out-draft-only.json` (draft window in a clean context),
`audit-tools/out-tokens.md`, `audit-tools/out-census-a.md`,
`audit-tools/out-census-b.md`.

---

## B · ACCENT BUDGET CENSUS

Tool: `audit-tools/accent-census.mjs` (static, three sheets + all `.ts`/`.tsx`
under `src/exp/v2c`, `src/screens`, `src/lib`) and `audit-tools/draft-only.mjs`
(live, clean draft window).

**The rule under test:** lime marks the one primary action of a screen and the
live/now state, nowhere else.

### B0 · the tokens

| token | file:line | dark | light | `var()` readers |
|---|---|---|---|---|
| `--accent` | `faithful.css:58` | `#B8FF66` | `#B8FF66` (unchanged) | 159 |
| `--accent-ui` | `faithful.css:50`, light at `:172` | `#B8FF66` | `#5A8A00` | 11 |
| `--accent-soft` | `faithful.css:59` | `rgba(184,255,102,.14)` | `rgba(16,163,127,.14)` | 24 |
| `--cat-1` | `faithful.css:104`, `:141` | `#B8FF66` | same | 9 |
| `--delta-up` | `faithful.css:47` | `#B8FF66` | same | 2 |

`--cat-1` and `--delta-up` are **not named accent but are the identical hex**, so
on screen they spend the same budget. Any accent audit that greps only for
`--accent` undercounts by these two.

### B1 · static occurrences

| where | occurrences |
|---|---|
| CSS lines painting lime (all three sheets, comments excluded) | **113** |
| of which reached only through the value-aliases `--cat-1` / `--delta-up` | 12 |
| `var(--accent)` reads: `faithful.css` / `styles.css` / `wb2026.css` | 21 / 52 / 8 |
| `var(--accent-ui)` reads | 7 / 0 / 3 |
| `var(--accent-soft)` reads | 2 / 15 / 0 |
| JSX / TS occurrences (inline styles or literals) | **4** |

The accent is almost entirely a stylesheet decision, which is good news: 113 of
117 spends are changeable in CSS without touching a component.

Full line-by-line table with file:line, selector and property:
`audit-tools/out-census-b.md`.

### B2 · every distinct thing wearing lime in the live UI, with a verdict

Aggregated across the 10 surfaces, ranked by painted area (the eye's actual
currency). "n" is live instances across all surfaces.

| n | max area | how it wears lime | selector | what it marks | deserves it? |
|---|---|---|---|---|---|
| 4 | 40,590px2 | **bg-fill** | `div.b.out` | every OUTBOUND DM bubble (`faithful.css:519`) | **NO.** Not an action, not live state. The single largest lime spend in the app, and it repeats once per message sent. |
| 1 | 16,416px2 | **bg-fill** | `button.btn.p` "Post note" | note composer submit, `DraftPane.tsx:694` | **NO.** The named offender. 331x50, `parentW` 331, i.e. **full width**, on a screen whose primary is Approve. |
| 2 | 509,120px2 | shadow (1px inset edge) | `div.wb-peer.wb-peer-thread` | the active context peer's edge | borderline: nav-active keyline, one per screen. Keep. |
| 4 | 37,107px2 | border (1px left) | `div.wb-rail-grp.on` | active rail job | borderline: nav-active keyline, one per screen. Keep. |
| 1 | 18,776px2 | shadow | `button.dw-qrow.on` | selected queue row | **NO** as accent. This is selection, and per the system spec selection is a tint, not the accent. |
| 1 | 3,562px2 | bg-fill | `button.dw-key.p` "Approve" | the draft window's primary action | **YES.** This is the one. |
| 8 | 9,175px2 | text + border | `span.wb-strat-kicker` "OFF-LANE" | a strategy label | **NO.** A label, eight at once. |
| 14 | 2,162px2 | text + border | `a.sa-act` "open the scan" | inline links on Today | **NO.** Fourteen accent links on one screen. |
| 16 | 470px2 | text + border + shadow | `span.client.kind-dm` "DM" | channel chip on every DM row | **NO.** A category, sixteen at once. |
| 4 | 773px2 | text + border + shadow | `span.chanchip.chan-dm` "INVITE" | channel chip | **NO.** Same reason. |
| 9 | 1,296px2 | bg-fill | `div.av.g5` / `div.av.g1` | avatar monogram, colour-hashed by name | **NO.** The accent used as a categorical hash. |
| 9 | 1,794px2 | bg-fill | `span.wb-qa-fill` + 8 `i` in `.qa-dim-g` | the QA score meter and its 8 dimension bars (`faithful.css:2980`) | **NO.** A score is a measurement. Eight identical lime bars also hide the one low score, which goes amber at `:2981` and is the only bar worth finding. |
| 1 | 5,102px2 | bg-fill | `span.td-stack-s` | Today stacked-bar segment | **NO.** Data mark. |
| 1 | 2,059px2 | bg-fill | `div.td-bar-f` | Today progress fill | **NO.** Data mark. |
| 4 | 1,764px2 | bg-fill + text | `div.td-qn` | Today queue numerals | **NO.** Data mark. |
| 1 | 871px2 | text + border | `span.ov-fpct` "21%" | a funnel percentage | **NO.** Data mark. |
| 1 | 290px2 | bg-fill | `div.sc-bar.peak` | peak bar on Sends | **NO.** Data mark. |
| 2 | 4,185px2 | bg-fill + border | `button.wb-ask` "Ask Claude" | opens the chat peer | **NO.** A secondary action wearing the primary's clothes. |
| 1 | 1,581px2 | bg-fill | `button.sw.on` | a settings toggle in the ON position | borderline: a binary state, not live/now. Should be a tint. |
| 2 | 1,156px2 | text + border | `div.sc-refresh` | refresh glyph | **NO.** |
| 1 | 288px2 | text + border | `span.dw-qrow-i` "2" | queue index numeral | **NO.** |
| 1 | 64px2 | bg-fill + border | `span.td-zmark.done` | a done tick | **NO.** Semantically this is `--sev-clear`. |
| 10 | 49px2 | bg-fill | `span.wb-sync-dot` | the freshness dot, one per screen | **YES.** Live/now state, exactly as licensed. |
| 4 | 49px2 | bg-fill | `span.wb-lad-dot.on` | ladder step reached | borderline. |
| 2 | 49px2 | bg-fill + shadow | `span.wb-lad-dot.now` | ladder step NOW | **YES.** Live/now. |
| 1 | 36px2 | bg-fill | `span.wb-ok-dot` | health OK dot (`faithful.css:516`) | **YES.** Live/now. |
| 10 | 400px2 | text + border | `span.wb-rj-ic` | active rail glyph (`faithful.css:510`) | borderline: nav-active, one per screen. Keep. |
| 1 | 64px2 | bg-fill | `span.td-lg-d` / `span.wb-legend-d` | chart legend swatch | **NO.** Data mark. |

**Verdict tally across the 29 distinct lime-wearing selectors:**

| verdict | distinct selectors | live instances |
|---|---|---|
| deserves the accent (primary action, live/now) | 4 | 14 |
| borderline (nav-active keyline, selection, binary state) | 6 | 14 |
| **does NOT deserve it** | **19** | **83** |

### B3 · BEFORE-COUNT: accent-weighted elements visible at once, per screen

This is the number the phase-1 gate ("exactly one accent-weighted primary action
per screen") is measured against.

| screen | accent-weighted total | lime fills | lime text | edge only | worst single offender |
|---|---|---|---|---|---|
| **today** | **27** | 11 | 16 | 0 | 14 `a.sa-act` links plus 4 `div.td-qn` numerals |
| **thread-open** | **24** | 12 | 11 | 1 | 4 full lime outbound bubbles at 40,590px2 each |
| **draft-open (clean, `.dw` scoped)** | **13** | 11 | 1 | 1 | `button.btn.p` "Post note", full width, 4.6x the area of Approve |
| **dms-list** | **13** | 4 | 9 | 0 | 16 `span.client.kind-dm` chips |
| **strategy** | **11** | 1 | 9 | 1 | 8 `span.wb-strat-kicker` labels |
| **sends** | **7** | 4 | 3 | 0 | chart marks |
| **content-list** | **3** | 1 | 1 | 1 | (already close to budget) |
| **content-calendar** | **3** | 1 | 1 | 1 | (already close to budget) |
| **ops** | **3** | 2 | 1 | 0 | (already close to budget) |
| **settings** | **3** | 2 | 1 | 0 | toggle ON fill |
| **total across 10 surfaces** | **107** | 49 | 53 | 5 | |

Note: `measure.mjs` reports draft-open at 17, not 13, because it opens the DM
thread first (the shell's context peer survives a hash change and eats the first
click on the content list otherwise), so four of the thread's lime bubbles are
still mounted. `draft-only.mjs` re-opens the draft in a fresh context and scopes
the walk to `.dw`. **13 is the honest draft-window figure and is the one to
beat.**

### B4 · the named offender, exact

```
button.btn.p  "Post note"
  DraftPane.tsx:694   <button type="button" className="btn p" ...>
  faithful.css:519    .wb.wb.wb .b.out, .wb.wb.wb .btn.p, .wb.wb.wb .wb-pane-ic.asst,
                      .wb.wb.wb .td-zmark.done{ background:var(--accent); color:var(--ink) }
  computed            331 x 50, background rgb(184,255,102), color rgb(23,23,23)
                      parent width 331  ->  FULL WIDTH
  area                16,416px2  =  4.6x the area of the screen's real primary
                      (button.dw-key.p "Approve", 3,562px2)
```

One rule, `faithful.css:519`, is responsible for the two largest lime spends in
the app: every outbound DM bubble and this button. It is a four-selector rule and
it is the single highest-leverage line in this census.

**Target for a later phase: 1 accent-weighted primary per screen. Before-count
107 across 10 surfaces; the gate is 10 plus the licensed live/now dots.**
