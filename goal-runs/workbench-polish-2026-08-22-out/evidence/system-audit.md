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

---

## C · CONTROL CENSUS

Tools: `audit-tools/analyze-c.mjs` (live, all 10 surfaces),
`audit-tools/draft-only.mjs` (the draft action row),
`audit-tools/flattener-victims.mjs` (static specificity analysis).

### C0 · headline

| measure | count |
|---|---|
| real controls measured (`button`, `a[href]`, `input`, `textarea`, `select`, `role=button`) | **211** |
| pointer-cursor text spans, excluded as they are text INSIDE a control | 91 |
| **DISTINCT visual treatments** | **45** |
| treatments that sit inside a near-duplicate cluster (same job, different numbers) | **20**, in 7 clusters |
| hit targets under 32px | **56 instances / 9 distinct selectors** |
| distinct computed heights across all controls | **17** |
| distinct control radii | 5 (`0px`, `8px`, `12px`, `20px`, `999px`) |
| distinct control font sizes | 4 (`12px`, `13px`, `16px`, `17px`) |
| distinct control font weights | 4 (`400`, `500`, `600`, `700`) |
| distinct control fills | 8 |

**45 distinct visual treatments for 211 controls is one new look per 4.7
buttons.** The phase-1 spec asks for 4 variants at 3 sizes, i.e. 12. Full table
in `audit-tools/out-census-c.md`.

### C1 · the biggest treatments

| n | example selector | h | pad T R B L | radius | font | fill | edge |
|---|---|---|---|---|---|---|---|
| 32 | `button` (no class), `button.x` | 35.6 | 5 6 5 6 | 12px | **16px/400** | transparent | none |
| 26 | `button.sa-x`, `button.sa-x.sa-member-x` | 20 | 0 0 0 0 | 999px | 12px/400 | transparent | none |
| 14 | `a.sa-act` | 20.8 | 0 0 0 0 | 0px | 13px/700 | transparent | none (lime text) |
| 14 | `button.cal-chip-t` | 87 | 5 8 5 8 | 0px | 13px/400 | transparent | **2px outset rgb(0,0,0)** |
| 12 | `button.chip` | 36 | 0 16 0 16 | 999px | 13px/500 | `rgb(42,42,41)` | none |
| 10 | `button.wb-rail-minbtn` | 32 | 0 0 0 0 | 12px | 16px/400 | transparent | 1px solid `rgb(48,48,48)` |
| 9 | `button.ct-cmd-lane` | 34 | 0 12 0 12 | 999px | 13px/500 | transparent | none |
| 8 | `button.ct-tab` | 32 | 0 10 0 10 | 12px | 13px/500 | transparent | none |
| 8 | `button.wb-stat.*` | 34 | 0 8 0 10 | 8px | 16px/400 | `rgb(42,42,41)` | none |
| 6 | `button.dw-qrow` | 62.4 | 8 14 8 14 | 12px | 16px/400 | transparent | none |
| 4 | `button.cal-navb` | 34 | 0 0 0 0 | 12px | 17px/400 | `rgb(42,42,41)` | **2px outset rgb(0,0,0)** |
| 4 | `button.dw-key` | 44 | 0 13 0 13 | 12px | 13px/600 | `rgb(42,42,41)` | 1px solid `rgb(53,53,51)` |

### C2 · the near-duplicate clusters

Seven clusters where controls share fill, radius and type but disagree on the
box. This is what "assembled rather than designed" looks like in numbers.

| cluster (fill / radius / size) | exact treatments in it | the values that differ |
|---|---|---|
| transparent / 12px / 16px | 5 | heights 25.6, 35.6, 36, 53.6, 62.4; pad T/R 0/0, 5/6, 8/14, 14/16 |
| `rgb(53,53,51)` / 999px / 13px | 3 | heights 32, 34, 36; pad T/R 0/12, 0/16, 7/0 |
| `rgb(42,42,41)` / 999px / 13px | 3 | heights 32, 36; pad T/R 0/16, 7/0 |
| `rgb(42,42,41)` / 12px / 16px | 3 | heights 43.6, 44, 81.3; pad T/R 0/0, 8/14, 9/0 |
| `rgb(42,42,41)` / 999px / 13px | 2 | heights 34, 36; pad T/R 0/11, 0/16 |
| `rgb(184,255,102)` / 12px / 16px | 2 | heights 31, 49.6; pad T/R 0/0, 12/0 |
| transparent / 0px / 16px | 2 | heights 18, 25.6 |

### C3 · the draft window's action row, exact computed values

Measured on a clean draft window (`out-draft-only.json`). The brief named five
buttons; **the row actually renders seven** in this state (an eighth, "More",
appears when `aria-expanded` opens, and "Approve" is replaced by "Retry" when
`status === 'error'`, so the count is state-dependent).

| label | class | h | min-height | padding | radius | font | fill | border |
|---|---|---|---|---|---|---|---|---|
| Approve | `button.dw-key.p` | 44 | 44px | `0 13px` | 12px | 13px/600 | `rgb(184,255,102)` | 1px solid `rgb(184,255,102)` |
| Edit | `button.dw-key` | 44 | 44px | `0 13px` | 12px | 13px/600 | `rgb(42,42,41)` | 1px solid `rgb(53,53,51)` |
| Schedule | `button.dw-key` | 44 | 44px | `0 13px` | 12px | 13px/600 | `rgb(42,42,41)` | 1px solid `rgb(53,53,51)` |
| Regenerate | `button.dw-key` | 44 | 44px | `0 13px` | 12px | 13px/600 | `rgb(42,42,41)` | 1px solid `rgb(53,53,51)` |
| Swap image | `button.dw-key` | 44 | 44px | `0 13px` | 12px | 13px/600 | `rgb(42,42,41)` | 1px solid `rgb(53,53,51)` |
| Back to idea | `button.dw-key` | 44 | 44px | `0 13px` | 12px | 13px/600 | `rgb(42,42,41)` | 1px solid `rgb(53,53,51)` |
| Delete | `button.dw-key.d` | 44 | 44px | `0 13px` | 12px | 13px/600 | `rgba(255,69,58,.08)` | 1px solid `rgba(255,69,58,.4)` |

**The good news the census turns up:** this row is already the most disciplined
control family in the app. Geometry is identical across all seven (44px tall,
`0 13px`, 12px radius, 13px/600) and only the fill and edge vary. That is exactly
the constancy the phase-1 spec asks for. The defect is not the geometry, it is
the **weighting**: five of seven are the same grey rectangle, so "Edit",
"Regenerate" and "Back to idea" carry the same visual weight as "Schedule". The
system already has the right skeleton; it needs a `quiet` tier so the five
collapse into two.

### C4 · hit targets under 32px

56 instances across 9 distinct selectors. Every one is a real control.

| selector | min h | min w | instances | screens |
|---|---|---|---|---|
| `a.msg-link` | **18** | 170.7 | 2 | thread-open, draft-open |
| `button.sa-x` | **20** | 20 | 10 | today |
| `button.sa-x.sa-member-x` | **20** | 20 | 16 | today |
| `a.sa-act` | **20.8** | 104 | 14 | today |
| `button.dw-jump.on` | **24** | 34.6 | 1 | draft-open |
| `button.dw-jump` | **24** | 42.5 | 3 | draft-open |
| `input.wb-strat-t` | **25.6** | 931.3 | 8 | strategy |
| `a.dd-link` | **25.6** | 331 | 1 | draft-open |
| `button.sw.on` | **31** | 51 | 1 | settings |

The two worst are `button.sa-x` and `button.sa-x.sa-member-x` at **20 x 20**,
26 instances on Today. Those are dismiss buttons, i.e. destructive, at 39% of
the 32px minimum area.

### C5 · THE FLATTENER IS ALREADY BITING IN PRODUCTION

The brief asked me to account for the trap. It is not hypothetical: it is
currently eating authored type on 128 selectors.

The proof, one control family, measured end to end:

```
AUTHORED   styles.css:1508
           .wb-strat-ctl button{ ... font-size:13px; line-height:1; padding:5px 6px;
                                 border-radius:var(--r-sm); ... }
           specificity 0-1-1

BEATEN BY  faithful.css:181
           .wb.wb, .wb.wb *{ font-size:var(--fs-body); font-weight:400;
                             letter-spacing:0; line-height:1.6 }
           specificity 0-2-0, and faithful.css is imported AFTER styles.css

COMPUTED   button (no class) and button.x on Strategy
           font-size 16px, font-weight 400        <- authored 13px is DEAD
           padding 5px 6px, border-radius 12px    <- these SURVIVE (not flattened)
           32 instances, and they are the single most common control treatment
           in the entire app
```

Two more verified the same way: `.wb-ask` (`styles.css:149`, authored
`font-size:12.5px; font-weight:700`) and `.wb-retry` (`styles.css:164`, authored
`font-size:12.5px`) both compute at **16px / weight 400**. `.wb-ask` loses its
bold as well as its size, because the flattener sets `font-weight:400` in the
same rule.

Static census across all three sheets, with import order factored in
(`audit-tools/out-flattener-victims.md`):

| measure | count |
|---|---|
| declaration sites killed by the flattener | **216** |
| by sheet | `styles.css` 214, `faithful.css` 2, `wb2026.css` 0 |
| by property | font-size 204, font-weight 143, letter-spacing 65, line-height 61 |
| of the font-size deaths, **never re-asserted anywhere at `.wb.wb.wb`** | **128** |

`wb2026.css` has zero victims because every rule in it already carries three
`.wb` classes and it is imported last. That is the pattern to copy.

**128 selectors are silently rendering type the author did not choose.** This is
not a styling opinion, it is a correctness bug, and it is the mechanical reason
the app has 17 distinct control heights: when the type inside a control is 16px
instead of the authored 12.5-13px, the control grows, and the next author
compensates with padding rather than finding the dead declaration.

---

> **PROVENANCE BREAK.** Censuses A, B and C were measured on `dist/` built
> 2026-08-22 **11:04** (pre-builder). Between census C and census D the phase-2
> builder shipped `a85f417 phase1: elevation ladder --e0..--e4` and `dist/` was
> rebuilt at **11:32**, adding `src/exp/v2c/wbsys.css` and moving `--hairline`
> from `#303030` to `rgba(255,255,255,.07)`. Census D therefore carries TWO
> readings, both labelled. They agree, which is itself useful: the builder's
> first pass changed surfaces and hairlines and did not touch the label/value
> pattern, so the before-count below is still the one to beat.

## D · LABEL/VALUE PATTERN CENSUS

Tools: `audit-tools/analyze-d.mjs` (epoch 1, class-based, from
`out-measure.json`) and `audit-tools/kv-census.mjs` (epoch 2, structural, from a
fresh browse of all 10 surfaces plus the draft inspector's four tabs).

### D0 · headline

| measure | epoch 1 (11:04 build) | epoch 2 (11:32 build) |
|---|---|---|
| detector | ALL-CAPS label element + its value sibling | structural: any row whose two children are a quiet label and a louder value |
| **live instances** | **163** | **146** |
| **distinct implementations of the same idea** | **26** | **45** |
| distinct label CLASSES | **23** | - |
| screens carrying at least one | **10 of 10** | 10 of 10 |
| distinct row heights | 27 | 38 |
| median row height | 25.6px | 47.6px |
| authored sites found in `.tsx` | **117** | - |

The two detectors disagree on the count because they are asking different
questions: epoch 1 counts every all-caps micro-label (including chips and
badges), epoch 2 counts every two-child label-then-value row (including ones that
are not capsed). **Both land between 146 and 163 instances built out of between
26 and 45 separate implementations, on all ten screens.** That is the number that
matters: one pattern, reimplemented dozens of times.

The 23 distinct label classes doing this one job:

```
btn  chanchip  client  ct-chip  ct-x  dw-jump  dw-sec-n  log-chip  ops-pipe-t
ov-badge  ov-fl  ov-rc-badge  ov-tile-lbl  res-hdr  sa-sev  span  td-big-c
td-ct-c  td-kind  td-sub  td-tl  wb-legend-l  wb-rail-grp-l
```

### D1 · the canonical implementation, and why it is broken

There IS a shared component. It is used in two places and nowhere else.

```
MARKUP     ContentBits.tsx:60-62
             <div className="dd-row">
               <div className="dd-k">{k}</div>
               <div className="dd-v">{v}</div>
             </div>
           also ContentSections.tsx:883-885
           also MagnetWindow.tsx:470,473,476 (value-only, no key)

CSS        styles.css:252   .dd-row{display:flex;gap:12px;align-items:baseline;
                                    padding:10px 0;border-bottom:.5px solid var(--sep)}
           styles.css:254   .dd-k{flex:none;width:108px;font-size:12px;font-weight:600;
                                  color:var(--text3); ...}          specificity 0-1-0
           styles.css:256   .dd-v{flex:1;min-width:0;font-size:14px;line-height:1.35; ...}

COMPUTED   div.dd-row > div.dd-k + div.dd-v
           22 live instances on ops and draft-open
           key   font-size 16px, weight 400   <- authored 12px/600 is DEAD
           value font-size 16px               <- authored 14px is DEAD
           padding 10 0 10 0, gap 12px, align baseline, border-bottom none
           row height  min 46.6  median 72.2  max 246.8
           rows under 40px tall: ZERO
```

`.dd-k` at `styles.css:253` is on the silent-victim list from census C: its
`font-size`, `font-weight` AND `letter-spacing` are all killed by
`faithful.css:181`, and nothing re-asserts them at `.wb.wb.wb`. **The one shared
label/value component in the app renders its key at the same size and weight as
its value.** There is no label/value contrast left, which is precisely why the
pattern got reimplemented 25 to 44 other ways: the shared one does not look like
anything, so each surface rolled its own.

The vertical cost follows directly. With key and value both at 16px and both
free to wrap, **no metadata row in the app is under 46.6px tall**, and the median
is 72.2px. The phase-1 `.wbkv` spec (13px key / 14px value, baseline-aligned in a
`minmax(84px,26%) 1fr` grid, 6px row-gap) puts a single-line row at roughly 21 to
24px. That is a 50 to 65% reduction on 146 to 163 rows.

### D2 · every distinct implementation, epoch 1 (class-based)

Full table with computed styles in `audit-tools/out-census-d.md`. The heaviest:

| n | label class | inside | screens | label type | value | row h |
|---|---|---|---|---|---|---|
| 36 | `.client` | `div.top` | dms-list, thread-open | 12px/600/UPPER ls=.96px | 12px | 25.6px |
| 17 | `.log-chip` | `div.log-r` | ops | 12px/600 ls=.48px | 16px | 69.4px |
| 14 | `span` (unclassed) | `div.cal-head` | calendar, draft-open | 12px/600/UPPER ls=.72px | 12px | 25.2px |
| 10 | `.wb-rail-grp-l` | `div.wb-rail-grp` | **all 10** | 12px/600/UPPER ls=.48px | 16px | 197.4px |
| 10 | `.sa-sev` | `span.sa-sevmark` | today | **10.5px**/800/UPPER ls=.84px | 16px | 16.8px |
| 8 | `.td-kind` | `div.td-top` | today | 12px/600/UPPER ls=.96px | 16px | 25.6px |
| 8 | `.ct-chip` | `div.ct-meta` | content-list, draft-open | 12px/600/UPPER ls=.96px | 12px | 14px |
| 7 | `.wb-legend-l` | `span.wb-legend` | sends | 12px/600/UPPER ls=.96px | 16px | 12px |
| 7 | `.ov-badge` | `div.ov-tr` | sends | 12px/600/UPPER ls=.96px | 13px | 45.6px |
| 6 | `.td-ct-c` | `div.td-ct` | today | 12px/**400**/UPPER ls=**normal** | 16px | 61.6px |
| 4 | `.dw-sec-n` | `div.dw-sec-h` | draft-open | 12px/**800**/UPPER ls=.6px | 13px | 36.8px |
| 4 | `.dw-jump` | `span.dw-insp-j` | draft-open | 12px/**700**/UPPER ls=.36px | 12px | 24px |
| 3 | `.res-hdr` | `div.dw-sec-body` | draft-open | **13px**/600/UPPER ls=.65px | 16px | 585.7px |

Look down the "label type" column. The same idea is rendered at **12px, 12px,
12px, 10.5px, 13px** and at weights **400, 600, 700, 800**, with letter-spacing
at **normal, .36, .48, .6, .65, .72, .84, .96px**. Five sizes, four weights,
eight tracking values, for one thing that is always "a quiet label".

### D3 · the draft inspector's four tabs, epoch 2

The brief names these specifically. Measured by opening each tab in turn:

| tab | label/value rows on screen |
|---|---|
| whole draft window, default | 27 |
| QA | see `out-kv.json` |
| Source | see `out-kv.json` |
| Log | see `out-kv.json` |
| Fields | see `out-kv.json` |

The inspector section header itself (`div.dw-sec-h > span.dw-sec-n +
span.dw-sec-t`) is a fifth variant of the same shape, at 12px/800/UPPER with
0.6px tracking and 12px 14px 4px 14px padding.

### D4 · what one new pattern would fix

| surface | label/value instances on it (epoch 2) |
|---|---|
| ops | 28 |
| draft-open | 27 |
| today | 24 |
| strategy | 24 |
| sends | 19 |
| content-calendar | 11 |
| settings | 5 |
| content-list | 3 |
| thread-open | 3 |
| dms-list | 2 |
| **total** | **146** |

**One `.wbkv` primitive replaces 26 to 45 implementations across 10 of 10
surfaces, covering 146 to 163 live rows.** It is the single highest-coverage
primitive in this audit.

---

## E · SPACING + RHYTHM CENSUS

Tool: `audit-tools/analyze-e.mjs`. Padding and gap come from the epoch-1
(11:04, pre-builder) live measurement, bucketed by ROLE. Radii are read
**statically from the sheets at commit `0117a78`**, because the builder shipped a
new radius scale in `wbsys.css` at 11:32 and a live read would no longer be a
before-count.

### E0 · the declared scale

| token | value | file:line | `var()` reads |
|---|---|---|---|
| `--sp-1` | 4px | `faithful.css:3110` | 24 |
| `--sp-2` | 8px | `faithful.css:3110` | 58 |
| `--sp-3` | 12px | `faithful.css:3110` | 52 |
| `--sp-4` | 16px | `faithful.css:3110` | 8 |
| `--sp-5` | 24px | `faithful.css:3110` | 7 |
| `--gut` | 16px | `faithful.css:95` | 70 |
| `--pad-card` | 24px | `faithful.css:96` | 5 |
| | | **total token reads** | **224** |

The scale is a 4/8 ladder: `{4, 8, 12, 16, 24}`. Its own comment
(`faithful.css:3107-3109`) says it was declared "so the rules below stop
inventing 11px / 13px / 14px one-offs".

### E1 · headline

| measure | count |
|---|---|
| elements carrying padding or gap | 1,338 |
| elements carrying padding | 871 |
| non-zero spacing declarations | 4,748 |
| **declarations OFF the {4,8,12,16,24} scale** | **2,972 = 62.6%** |
| distinct off-scale numbers | **18** |
| distinct padding quadruples | **96** |
| distinct gap values | **17** (of which 12 are off-scale) |
| **distinct rendered radii, pre-builder** | **11**, plus three spellings of "pill" |

**The scale is read 224 times and contradicted 2,972 times.** The comment at
`faithful.css:3107` predicted the exact failure mode and the failure happened
anyway: the three most common spacing values in the running app are **10px (462
instances), 14px (302) and 6px (336)**, and not one of them is on the scale.

### E2 · distinct padding values per ROLE

Bucketed so a card's 24px is never compared to a chip's 4px. The brief's own
standard applies: N numbers doing N jobs is fine, N numbers doing ONE job is not.

| role | elements | distinct padding values | off-scale values in that role |
|---|---|---|---|
| **button** | 113 | **15** | 2, 5, 6, 7, 9, 10, 11, 13, 14, 18 |
| **pane** | 108 | **12** | 2, 3, 6, 9, 10, 13, 14, 20, 32 |
| **section** | 131 | **11** | 2, 3, 6, 7, 10, 14, 18 |
| **card** | 165 | **10** | 2, 6, 13, 14, 18, 20 |
| **chip** | 139 | 8 | 1, 2, 3, 5, 6, 11 |
| **row** | 101 | 8 | 2, 6, 10, 13, 14 |
| input | 3 | 4 | 9, 10, 11 |
| other | 578 | 18 | 1, 2, 6, 7, 9, 10, 11, 14, 20, 22, 28, 30, 40 |

**The clearest single failure is `button`: 15 distinct padding values for one
job.** Ten of the fifteen are off-scale. This is the same defect census C found
from the other end (17 distinct control heights, 45 distinct treatments), and it
has the same root cause: when the flattener silently oversizes the type inside a
control, the next author reaches for padding to compensate instead of finding the
dead declaration.

`pane` at 12 and `section` at 11 are the next worst, and those are the surfaces
the elevation model is about to touch anyway.

### E3 · gap values

17 distinct gaps: `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 18, 20, 24`.

Only `4, 8, 12, 16, 24` are on the scale. **The app uses every integer from 1 to
13 as a gap**, which is the signature of gaps being nudged by eye rather than
chosen from a ladder.

### E4 · the most common padding pairs

871 padded elements, **96 distinct padding quadruples**.

| padding (T R B L) | instances | share of padded elements | mostly | on scale? |
|---|---|---|---|---|
| `10 14 10 14` | **111** | **12.7%** | rows, cards | **NO** (neither 10 nor 14) |
| `6 6 6 6` | 84 | 9.6% | the calendar day cell | **NO** |
| `24 24 24 24` | 13 | 1.5% | hero cards | yes (`--pad-card`) |
| `2 14 2 14` | 19 | 2.2% | sections | **NO** |
| `20 14 16 14` | 10 | 1.1% | sections | **NO** |

**The single most common padding pair in the app is `10px 14px`, at 12.7% of
every padded element, and it is off-scale on both axes.**

Restricted to SECTION-level elements (pane, card, section: 305 elements):

| padding | instances | share of sections |
|---|---|---|
| `6 6 6 6` | 84 | **27.5%** |
| `2 14 2 14` | 19 | 6.2% |
| `24 24 24 24` | 13 | 4.3% |

The 27.5% is one element repeated: `.cal-day{padding:6px}` (`faithful.css:3725`),
84 day cells on the calendar. Excluding the two calendar-bearing screens, the
picture is flatter and worse: 160 section elements, top value `2 14 2 14` at
8.8%, then `24 24 24 24` at 8.1%. **No section padding value accounts for more
than 9% of sections.** There is no dominant section rhythm to speak of.

### E5 · radii, and three spellings of "pill"

Static count at commit `0117a78`, before the builder's new scale:

| radius | declarations | sheets |
|---|---|---|
| 1px | 1 | faithful.css |
| 2px | 5 | faithful.css, styles.css |
| 4px | 2 | styles.css, wb2026.css |
| **8px** | **30** | faithful.css, styles.css |
| 10px | 1 | styles.css |
| **12px** | **57** | all three |
| **20px** | **36** | all three |
| 40px | 1 | faithful.css (`--plate-r`) |
| 99px | 34 | styles.css |
| 999px | 33 | all three |
| 9999px | 2 | styles.css |

Two findings.

1. **11 distinct rendered radii** where the phase-1 spec asks for 4. The token
   family (`--r-chip` 8, `--r-ctl` 12, `--r-card`/`--r-hero` 20, `--r-pill` 999)
   accounts for the three big buckets, but 1px, 2px, 4px and 10px are hand-typed
   one-offs that no token explains.
2. **"Pill" is spelled three different ways**: `99px` (34 declarations, all in
   `styles.css`), `999px` (33, all three sheets, this is `--r-pill`) and `9999px`
   (2, `styles.css`). They render identically on most elements and diverge on
   tall ones, and they guarantee that any future search for the pill radius finds
   only a third of it.
