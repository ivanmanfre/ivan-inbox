# Phase 2 — The Shared Spine

Goal-run `inbox-visual-rebuild-2026-08-02`. Branch `exp/brain` @ `17e3cfb`. Written 2026-08-02.

**What this is.** A contract, not a mood board. Every clause below is a rule a builder can be measured
against and an instrument can fail. Sections 2-9 are binding on **every** candidate; §11 lists what a
candidate may vary. The central risk this document exists to defeat: *the Nixtio reference contains no dense
list and this app is mostly dense lists.* A candidate that achieves the reference on Today and abandons the
spine on Content is disqualified. §7 is where this run is won.

Colour derivations verified by `phase2-colour-harness.py` (in this directory; output pasted verbatim in §9).
Ladder inherited from `RESEARCH-INTERNAL-TOOL.md` §4.3.1 — **with one correction, §4.4.**

---

## 1 · Scoping — where treatment is allowed to live

1.1 All candidate tokens are declared at the **`.wb` root** — `.wb{ … }` in a new treatment stylesheet.

1.2 **`:root` in `src/styles.css:1-16` is never edited.** Not retoned, not extended, not "just the dark
block". The prior run's instrument candidate retoned `:root` globally; this run does not. **DQ if a diff
touches lines 1-16 of `src/styles.css`.**

1.3 The treatment stylesheet is imported by the v2c shell, **after** `src/exp/v2c/Shell.tsx:30`
(`import './styles.css'`). One file per candidate, named `src/exp/v2c/<candidate>.css`.

1.4 **The bridge is mandatory and is the easiest thing in this document to miss.** The stock screens
mounted inside the workbench (`TodayScreen`, `DraftsScreen`, `OverviewView`, `OpsScreen`, `ThreadScreen`,
`SettingsScreen`) read the app's **legacy** token names, not the ladder's names. A `.wb` block that declares
only `--canvas/--surface1/--hairline` leaves every stock screen on the iOS `:root` palette. Every candidate
declares both, in one block:

```css
.wb{
  --canvas:#090B0A; --surface1:#121513; --surface2:#191D1B; --surface3:#212523;
  --hairline:#2C302E; --hairline-strong:#3E4240;
  --text:#F3F6F5; --text2:#AEB2B0; --text3:#7F8582; --text4:#6F7472;
  /* BRIDGE — legacy names the stock screens actually read */
  --bg:var(--canvas); --surface:var(--surface1); --sep:var(--hairline);
  --accent:#10A37F; --accent-soft:rgba(16,163,127,.16);
  --blue:var(--text2);            /* the undeclared second accent, retired to neutral */
}
```

**Test:** with the workbench mounted, `getComputedStyle(document.querySelector('.wb')).getPropertyValue('--bg')`
must not resolve to `#000000`, and `--blue` must contain no blue channel dominance. Fail = DQ-correctable.

1.5 **Two v2c light-mode chrome patches must be visited** or the rail and pane headers fight the new ladder:
`src/exp/v2c/styles.css:58` (`:root[data-theme='light'] .wb-rail`) and `:127`
(`:root[data-theme='light'] .wb-pane-h`). Both hard-code light rgba backgrounds.

1.6 **v2c local radii are treatment surface** and are redefined by §6 —
`src/exp/v2c/styles.css:11-16` (`--r-sm:14px; --r-md:16px; --r-lg:20px; --r-chip:7px`).

1.7 **One structural token is licensed, and only one.** `src/exp/v2c/Shell.tsx:208` renders the first-paint
skeleton as `className={mobile ? 'app' : 'app dt wb'}` — at 390 the loading state carries **no `.wb` class**,
so the iOS `:root` palette shows through for the first seconds of every cold mobile load. Change it to
`'app wb'`. That is the complete licensed structural edit; nothing else moves.

---

## 2 · Type scale (7 tokens, no eighth)

2.1 Canon's six tokens are adopted unchanged, plus one `display` tier for M1.

| token | size | weight | tracking | line-height | job |
|---|---|---|---|---|---|
| `--fs-display` | **34 / 44 / 56** (§2.3) | `--fw-display:700` | `-0.02em` | `1` (= size) | M1 screen title, uppercase |
| `--fs-figure` | 30px | 600 | `-0.033em` | 32px | the ONE hero numeral per surface, tabular |
| `--fs-page` | 20px | 600 | `-0.02em` | 24px | pane / peer title |
| `--fs-title` | 15px | 500 | `-0.01em` | 24px | section + card title |
| `--fs-body` | 13px | 400 | 0 | 20px | **the workhorse** — row primary, prose |
| `--fs-meta` | 12px | 400 | 0 | 16px | timestamps, counts, secondary row text |
| `--fs-eyebrow` | 11px | 600 | `+0.04em` | 16px | uppercase — column heads, section labels, legends |

2.2 **No half-pixel sizes anywhere.** The measured defect is 28 distinct sizes including ten half-pixel steps
(`phase0-diagnosis.md`). *Test:* the runtime type census over every text leaf inside `.wb` returns **≤ 9
distinct computed `font-size` values per screen** (7 text tiers + up to 2 glyph-only sizes carrying no words),
and **zero non-integer values**.

2.3 **`--fs-display` is stepped, not fluid.** Three integers set by media query, matching the app's own three
responsive modes: **34px** below 768, **44px** at 768-1199, **56px** at ≥1200. A `clamp()` on `vw` is
**forbidden** — it emits fractional computed sizes (41.6px, 47.3px…) at every intermediate width and destroys
the integer-size census in 2.2, which is the one measurement that proves the scale exists. The clamp the spec
asked for is expressed as its three landing values.

2.4 **Weight ceiling is 600 — with exactly one exception, `--fw-display:700`, scoped to `≥28px`.**
Justification: the measured defect (218 of 231 declarations ≥600, 800 the app's *most common* weight) lives in
the **9-17px band**, where heavy weight adds noise and subtracts hierarchy. At 34-56px weight is silhouette,
not texture — and it is the only lever left once webfonts, serif and `@font-face` are banned. *Test:*
`font-weight ≥ 700` on **at most one element per screen**, and that element's computed size is ≥28px.

2.5 M1 is achieved with **system sans + scale + tracking + case only**. No webfont, no `@font-face`, no new
dependency, **`ui-serif` banned**. The display title is uppercase, flush left, and is the largest text on its
screen by ≥1.5× over the next tier.

2.6 **`font-variant-numeric: tabular-nums` is declared once on `.wb` and never unset.** Every count,
timestamp, score, metric, denominator and table cell inherits it. *Test:* zero leaves inside `.wb` with a
numeral and a computed `font-variant-numeric` of `normal`.

2.7 Monospace stays reserved for IDs, keyboard shortcuts and code (`.wb-code`, chat code blocks). Never body,
never labels, never numerals — tabular figures already solve alignment.

---

## 3 · Ladder — surfaces, hairlines, text

3.1 The §4.3.1 OKLCH ladder is the **default and the fallback**: `canvas #090B0A` · `surface1 #121513` ·
`surface2 #191D1B` · `surface3 #212523` · `hairline #2C302E` · `hairline-strong #3E4240` ·
`text #F3F6F5` · `text2 #AEB2B0` · `text3 #7F8582` · `text4 #6F7472`.

3.2 A candidate **may re-derive** (the reference is warmer and blacker than the austere brief this ladder was
built for) but must re-run `phase2-colour-harness.py` against its own values and paste the passing table into
its build note. **The three bars, stated explicitly:**

- **Body text ≥ 4.5:1** on every surface it sits on.
- **Non-text marks ≥ 3:1** on every surface they sit on (WCAG 1.4.11) — chart marks, bar fills, dots,
  hairline-boxed chip borders, icon glyphs carrying meaning.
- **Focus ring: 2px accent at 100% opacity.** Linear's published 50% spec measures **2.20-2.32:1** on our
  ladder and fails; 70% scrapes 3.06:1; 100% clears at **4.85:1** worst case. Ship 100%. No candidate may
  reopen this.

3.3 **A surface step alone is not a boundary.** Adjacent surfaces separate by 1.074-1.098:1. Any boundary that
matters carries a **hairline**; the surface step is a hint. Corollary (harvested from `instrument`): **one
separation device per boundary** — a hairline OR a background shift OR spacing, never two stacked.

3.4 **Zero drop shadows on resting surfaces.** Depth is ladder + hairline. Shadow is permitted on exactly one
class of element: transient overlays (sheet, popover, toast).

3.5 Inherited rules that fall out of the measured table: **`text3` is not body type on `surface3`** (4.12:1) —
label and metadata only there; **`text4` is metadata and disabled state only**, everywhere.

---

## 4 · Correction to canon (found by this run's harness)

4.1 `RESEARCH-INTERNAL-TOOL.md` §4.3.1 publishes `--text4: #606562` in its CSS block. Its own generator
(`scratchpad/oklch.py`, `oklch(0.5550 0.007 169.5)`) emits **`#6F7472`**, and the document's published
contrast row (4.15 / 3.87 / 3.58 / 3.26) is `#6F7472`'s, not `#606562`'s.

4.2 `#606562` measures **3.32 / 3.09 / 2.87 / 2.61** — it **fails the 3:1 bar on `surface2` and `surface3`**,
i.e. the hex in the CSS block reintroduces the exact defect the surrounding prose says the harness caught and
fixed. **Use `#6F7472`.** A candidate that copies the CSS block verbatim ships a failing token.

---

## 5 · Accent budget

5.1 `--accent:#10A37F` is locked and does exactly three jobs: **primary action · active nav / selection ·
live signal**. Nothing else in the chrome is chromatic.

5.2 **`--accent` is forbidden as a text colour.** It is 3.20:1 against white and cannot carry body copy. Where
a figure or label was painted accent, the colour moves to a mark and the words go back to `--text`.

5.3 **Labels on a filled accent mark are ink `#171717` (5.61:1), never white (3.20:1).** Darkening the green
to make white pass would introduce a second value of the one locked hue.

5.4 Severity keeps its three tokens and its meaning: `--sev-clear #10A37F` · `--sev-attention #FF9F0A` ·
`--sev-urgent #FF453A`. **Severity is never reused as category encoding** (that is what §9 exists to prevent).

5.5 **One severity mark per run, not per row** (harvested from `instrument`): twelve rows of one tier each
with twelve red spines ranks nothing. Red goes on the header that counts them; the rows take a neutral rule.

5.6 *Test:* runtime accent census — elements whose computed colour/background/border/shadow contains
`rgb(16,163,127)`, per screen, **must not exceed 30 at 1440**. Run it against the **rendered page**, never a
source grep: the prior build's clean hex-grep was lying (two `#30D158` rules survived one specificity level
deeper in the base sheet).

---

## 6 · Radius family — one family, four values plus pill

6.1 Canon says 4/6/10/999-restricted; the reference uses ~20-24px cards and pill chrome everywhere; v2c ships
14/16/20/7. Resolved:

| token | value | applies to |
|---|---|---|
| `--r-chip` | **6px** | every small label, status/categorical chip, badge box, inline tag |
| `--r-ctl` | **10px** | buttons, inputs, textareas, segmented controls, menu items |
| `--r-card` | **18px** | the default card / group container / peer pane |
| `--r-hero` | **24px** | a card that owns its whole region (overview hero, chart card) |
| `--r-pill` | **999px** | the licensed list in 6.3 **only** |

6.2 Nested radii: inner radius = outer − padding. Never a larger radius inside a smaller one.

6.3 **Pill licence — the reference wins on chrome, and this is the exact list.** `--r-pill` (or `50%`) is
permitted on, and only on:

1. avatars and circular icon buttons (the M7 rail glyph slot, search, settings, overflow);
2. top-level nav / job items and view-switcher segments (M7 pill nav);
3. filter pills (`label: value ⌄`) and the inline list filter (M5 / M13);
4. numeric count badges attached to nav;
5. the compose / primary FAB;
6. severity dots and legend dots;
7. **chart marks whose geometry is a capsule** (M9 capsule bars, M11 timeline bars) — this is data geometry,
   not chrome.

6.4 **Everything else is banned from `999px`** — rows, cards, inputs, and categorical/status chips, which
take `--r-chip`. That is what stops a dense row reading as an iOS settings screen, and it is what Attio
actually does: its Type/Source fields are small rounded rectangles, not capsules. *Test:* computed
`border-radius ≥ 100px` (or `50%`) only on elements matching 6.3. Baseline defect: 58 pill uses today.

---

## 7 · Dense-list vocabulary — **the run is won here**

Binds every `working-list` surface: Inbox, Drafts, **Content** (the test surface), Sends→Log, Ops pending
queue, and the short row zones on Today.

7.1 **Anchor-column contract.** Every working-list row begins with a **fixed-width leading slot** carrying
**exactly one** mark — an avatar, an entity glyph/thumb plate, or a status chip (M12). Tokens:
`--anchor-w:28px`, `--anchor-gap:12px`. Row layout is
`grid-template-columns: var(--anchor-w) minmax(0,1fr) auto`.
*Test (the rail test):* within one list, the left edge of every row's **primary** text is at an identical x —
variance **0px** — at both 390 and 1440. The eye tracks a rail.

7.2 **Content specifically** (`ContentList.tsx:60-95`): the anchor slot is the `.ct-thumb` plate at
`--anchor-w`, and the **status stops floating.** Today the status/QA chip sits inside the wrapping `.ct-meta`
row (`:72-89`), so its position moves with the title's length and nothing tells the eye which row it is on.
Contract: status is expressed **on the anchor** (a corner dot or an inset spine on the plate) **or** as chip
position #1 in a `flex-wrap:nowrap` first slot that can never reflow. Free-floating status chips are a
**fail**, not a taste note. This is the single most-weighted defect in the whole run.

7.3 **De-bordered rows.** The **group** carries the boundary (`surface1`, `--r-card`, one hairline); the
**rows carry none** — `margin:0; background:transparent; border-radius:0; border-top:1px solid var(--hairline)`
between siblings. No per-row card, no shadow, no four-sided border. On a 285-row surface, ~200 floating boxes
is a quilt; one ruled sheet is scannable.

7.4 **Hover = background shift** to `--surface2`, `--dur-hover`. **Selection = 2px inset accent spine**
(`box-shadow: inset 2px 0 0 var(--accent)`) — the same mark active nav uses, so "where am I" is one
vocabulary app-wide. Selection is never a fill, never a border, never both a spine and a fill.

7.5 **Sticky section headers with tabular counts** (harvested `instrument` header face — one object with
slots, replacing the four unrelated header patterns `.wb-sech` / `.td-zh` / `.grouphdr` / `.ov-h`):

> `01` tabular index · **LABEL** `--fs-eyebrow` uppercase · —— the rule —— · `18` right-set tabular count ·
> ▪ severity square (only if the run carries one, per 5.5)

`position:sticky; top:0`, height `--sech-h:32px`, background `--surface1` (opaque — a translucent sticky
header over 285 scrolling rows is mush). **The count above the rows is always the count of what you are
looking at.**

7.6 **Hierarchy is indentation + a trailing count badge (M10), never extra chrome.** No boxes inside boxes,
no chevron column. Indent step `--indent:20px`, max depth 2.

7.7 **Row anatomy, in order:** anchor slot → primary (`--fs-body` / 500 / `--text`) → meta
(`--fs-meta` / 400 / `--text3`) → trailing value, **right-aligned, tabular**. Trailing values in one list
share a right edge (variance 0px).

7.8 **Density band.** Working-list row content-box height is **40-60px at 1440** and **≤72px at 390** (where a
second meta line is permitted). Outside the band = fail. This makes candidates comparable without freezing
one number.

7.9 **The acceptance test: three-second row-find, on Content, at 390 and 1440.** Given a screenshot and a
target ("the Mattan draft in review with a failing QA verdict"), a judge who has not seen the build locates
the row in ≤3 seconds. Run at both widths. A candidate that passes at 1440 and fails at 390 has not passed.

---

## 8 · Mark anatomy (M3 / M4 / M9 / M14) + the data-honesty rule

8.1 **Metric card** = eyebrow (`--fs-eyebrow`, uppercase) · direction glyph (▲/▼, severity-coloured, ≤10px) ·
**big tabular numeral** (`--fs-figure`) · micro-caption (`--fs-meta` / `--text3`). All four slots or it is not
a metric card. **One `--fs-figure` numeral per surface** — a screen with four 30px numerals has no hero.

8.2 **Chart card** = eyebrow · `…` overflow menu (top-right) · the plot · legend (dot + label, `--fs-eyebrow`)
· **right-aligned `Total: N` footer with the REAL denominator**. M4.

8.3 **The number lives inside the mark** (M9) where the mark is large enough to hold it: capsule bars and
timeline bars print their value inside; label colour per §5.3 / §9.5 (ink on every filled categorical except
MONO `--cat-4`, which takes white — see the harness table).

8.4 **Threshold-coloured bars (M14):** a metric's health is the **fill colour of its own bar** hitting a
severity zone — the bar doubles as the verdict. No separate status badge beside a bar that already says it.

8.5 **DATA HONESTY — DQ, not correctable.**

- Any `Total:` / denominator / percentage **must** come from a `Prefer: count=exact` head probe or from the
  full fetched set. **Never `rows.length` of a truncated fetch.** PostgREST silently caps at 1000.
- **Sends → Log must say "newest 360 of 1,752"** and "newest 60 of 246 blocked" (76% of failures are
  invisible by construction). Stating the denominator is honest; charting "all sends" from the 360 fetched is
  misrepresentation.
- **Ideas** renders 59 of 1,716 — any "ideas total" comes from a probe.
- Zero hard-coded arrays feed any chart today (fabrication sweep, `phase0-surfaces.md`). **Any hard-coded
  series in a candidate diff is new, and is a DQ.**
- `TodayScreen` zones 01-03 bind to edge fn `get-morning-brief` (opaque server-side). Candidates restyle it;
  instruments cannot verify its figures and must not fail it for that.

---

## 9 · Fork 2 — the colour decision, as two built token sets

**Every candidate ships both.** They are token values only, so the cost is a second `.wb` block. Switch:
`data-cat` on `<html>` (`document.documentElement`), default `"mono"`. MONO is declared in `.wb{…}`; TRIAD in
`:root[data-cat='triad'] .wb{…}`. Setting an attribute on `<html>` is **not** editing `:root`'s tokens — §1.2
holds. *Test:* toggling the attribute in devtools changes **only** colour values; zero layout shift.

9.1 **Categorical colour is DATA-VIZ ONLY.** Never on chrome, actions, text, or status. `--cat-*` may appear
on: chart series fills/strokes, legend dots, and the categorical chip in a table cell (M12). Nowhere else.

### 9.2 ANSWER MONO — `data-cat="mono"` — zero new hues

```css
.wb{ --cat-1:#10A37F; --cat-2:#DBDFDD; --cat-3:#A1A6A4; --cat-4:#747977; }
```

Series 1 is the accent; 2-4 are neutral tiers generated **at the accent's own hue** with the ladder's trace
chroma, so they are the same material as the surfaces. **Beyond 4 series, differentiation is PATTERN, not
colour** — solid / 45° hatch / dotted / hollow-with-hairline, declared as `--pat-1..4` and applied via
`background-image` repeating-linear-gradients. Pattern survives greyscale, print, and every form of colour
blindness.

### 9.3 ANSWER TRIAD — `data-cat="triad"` — two derived hues

```css
:root[data-cat='triad'] .wb{ --cat-1:#10A37F; --cat-2:#3A93D0; --cat-3:#D099E8; }
```

Derivation, not eyeballing: a 0.5°-grid **maximin** search over the full hue circle for the two hues whose
smallest circular distance to any fixed point (accent 169.5°, severity amber 67.2°, severity red 28.3°) and to
each other is greatest. Solution **242.5°** (blue) and **315.5°** (violet), minimum pairwise separation
**72.8°** across all five points.

**The finding that changed the answer.** At the accent's own L and C both new hues cleared every contrast and
hue bar — and then **collapsed onto each other under simulated protanopia and deuteranopia** (ΔE 0.041 /
0.046 against a 0.08 bar). That is structural, not a bad hue pick: dichromacy folds the hue circle onto one
blue-yellow axis, so *any* two hues on the same side of the confusion line merge. Hue alone cannot carry three
categories. Remedy per spec — adjust L minimally and re-run: `--cat-3` lifted **L 0.6374 → 0.7624** (+0.125,
the minimum 0.005-step that clears it). **TRIAD therefore separates on hue AND lightness**, which is the only
separation a dichromat can use, and it is a contract: a candidate may not "harmonise" `--cat-3` back down.

### 9.4 Harness output (verbatim, `phase2-colour-harness.py`)

```
ACCENT #10A37F -> oklch(L=0.6374 C=0.1242 H=169.51)
sev-attention  #FF9F0A -> oklch(L=0.7824 C=0.1711 H=67.22)
sev-urgent     #FF453A -> oklch(L=0.6633 C=0.2236 H=28.29)

ANSWER MONO — contrast vs every ladder surface (bar: >= 3.00:1)
  token          canvas   surface1   surface2   surface3    worst  verdict
  cat-1 #10A37F    6.17       5.75       5.33       4.85     4.85  PASS
  cat-2 #DBDFDD   14.67      13.67      12.66      11.53    11.53  PASS
  cat-3 #A1A6A4    8.00       7.45       6.90       6.28     6.28  PASS
  cat-4 #747977    4.46       4.15       3.85       3.50     3.50  PASS
  adjacent-tier separation: cat-1/2 dE 0.288 · cat-2/3 dE 0.180 · cat-3/4 dE 0.149   ALL PASS

ANSWER TRIAD — maximin solution h1=242.5deg h2=315.5deg, min pairwise sep 72.8deg
  [CVD remedy] cat-3 collapsed onto cat-2 for dichromats (dE 0.041 < 0.08).
               L lifted 0.6374 -> 0.7624 (+0.125) — the minimum step that clears it.
  token          canvas   surface1   surface2   surface3    worst  verdict
  cat-1 #10A37F    6.17       5.75       5.33       4.85     4.85  PASS
  cat-2 #3A93D0    5.89       5.48       5.08       4.63     4.63  PASS
  cat-3 #D099E8    8.84       8.23       7.63       6.95     6.95  PASS
  categorical vs categorical: cat-1/2 hue 73.0 dE 0.148 · cat-1/3 hue 145.7 dE 0.269
                              cat-2/3 hue 72.8 dE 0.193                      ALL PASS
  categorical vs SEVERITY (bars: hue >= 45deg, dE >= 0.12)
    cat-1 vs attention hue 102.3 dE 0.273 | cat-1 vs urgent hue 141.2 dE 0.331
    cat-2 vs attention hue 175.2 dE 0.329 | cat-2 vs urgent hue 145.8 dE 0.335
    cat-3 vs attention hue 112.0 dE 0.247 | cat-3 vs urgent hue  73.0 dE 0.243
    ==> ALL PASS   (worst hue distance 73.0deg, worst dE 0.243)
  CVD (Vienot 1999), bar dE >= 0.08 — protan + deutan, all 15 pairs: ok  (worst 0.086)

SHARED BARS
  focus ring   50% -> 2.20:1 FAIL | 70% -> 3.06:1 PASS | 100% -> 4.85:1 PASS   ship 100%
  body text    text 18.15/16.90/15.66/14.27 · text2 9.21/8.57/7.94/7.24
               text3 5.24/4.88/4.53/4.12(+) · text4 #6F7472 4.15/3.87/3.58/3.26(+)
               text4 as published #606562  3.32/3.09/2.87/2.61  <-- FAILS, see §4
  label on a filled mark:  ink #171717 on accent 5.61:1 PASS | white 3.20:1 FAIL
    triad cat-2 ink 5.35 · cat-3 ink 8.03 -> ink
    mono  cat-2 ink 13.33 · cat-3 ink 7.26 -> ink · cat-4 white 4.43 -> WHITE
```

9.5 In-mark label colour follows that last block per token. It is the one place the two answers differ in
behaviour rather than value: MONO `--cat-4` takes **white**, everything else takes **ink**.

9.6 Both answers are presented to the ballot as **two built surfaces**, never as an argument. No candidate
resolves Fork 2 by quietly picking one.

---

## 10 · Motion

10.1 **One easing token:** `--ease: cubic-bezier(.25,1,.5,1)`, declared once. No second curve, no `ease-out`
literals, no springs.

10.2 Durations: `--dur-hover:100ms` (hover, press) · `--dur-state:180ms` (band 150-250ms) ·
`--dur-beat:200ms`. Nothing exceeds 250ms.

10.3 **transform and opacity only.** No animated width/height/top/left/colour/box-shadow.

10.4 **DELETE motion from:** tab switch, row selection, keyboard nav, pane switch, command palette. These are
the 50×/day paths; animation there is a tax, not a delight. *Test:* zero non-zero computed `transition-*` on
`.wb-rj`, `.seg/.sg`, row-active classes, and pane containers.

10.5 **Exactly ONE choreographed beat, app-wide** (harvested from `instrument`): approving a draft. The row
takes `translateY(-10px)` + fade over `--dur-beat`; the refetch fires **when the movement ends** so the list
never jumps under a hand; the section count above it receives a matching `translateY(-4px)` tick as it lands
on its new value. Cause and effect, 24 inches apart, in one gesture. The count moves when the number moves and
at no other time. **Nothing else in the app is choreographed** — intensity in proportion to rarity.

10.6 `@media (prefers-reduced-motion: reduce)` disables **both halves** of the beat and every transition
except opacity. *Test:* with the media feature emulated, zero `transform` transitions remain.

---

## 11 · Filter contract (M5 / M13) — one vocabulary, two densities

11.1 **Overview surfaces:** a row of `label: value ⌄` pills, right-set beside the display title.
Anatomy: `--r-pill`, height 30px (≥768) / 32px (touch), `--surface2` fill, no border, label
`--fs-meta`/400/`--text3`, value `--fs-meta`/**500**/`--text`, chevron 9px `--text3`. The label is never
omitted — "Now ⌄" alone is a mystery; "Date: Now ⌄" is a sentence.

11.2 **Working lists:** one **compact inline pill** sitting in the search field's row (Raycast M13), same
anatomy at height 26px. Not a second row of chips, not a filter bar. Same `label: value ⌄` grammar.

11.3 **Same grammar both places.** *Test:* every filter control in the app matches one of the two anatomies
above; zero bespoke filter chrome.

11.4 The active state of a filter is the **value text**, not a coloured fill. A filter pill never takes
`--accent` as a background — accent is reserved (§5.1).

---

## 12 · Disqualification list (restated so a builder cannot miss it)

| # | rule | severity |
|---|---|---|
| D1 | `:root` in `src/styles.css:1-16` edited | **DQ** |
| D2 | fabricated data — any hard-coded series, any denominator from `rows.length` of a truncated fetch | **DQ, not correctable** |
| D3 | new npm dependency, webfont, or `@font-face` | **DQ** |
| D4 | `ui-serif` anywhere | **DQ** |
| D5 | warm-paper / serif editorial direction in any form (2nd offence, absolutely retired) | **DQ** |
| D6 | `git add -A` (three foreign untracked dirs sit in `goal-runs/`) | **DQ** |
| D7 | any push to `main` | **DQ** |
| D8 | secret in built `dist/` | **DQ** |
| D9 | console error originating from `src/` (the unarmed `inbox-claude` broker CORS pair is a known, allowed exception — state it precisely, never round it to zero) | fail |
| D10 | horizontal overflow at 390 on any surface | fail |
| D11 | AA body contrast failure on the primary (dark) theme | fail |
| D12 | only one colour answer shipped | fail |
| D13 | the two v2c light-mode patches (`v2c/styles.css:58`, `:127`) unvisited | fail |

Light theme stays functional and legible; it is **not** held to the polish bar. Dark is the anchor.

Capture discipline (or the evidence is worthless): the anon key returns **HTTP 200 with zero rows** on RLS
tables — silent, not 401. Every capture needs the minted session (`scripts/dev-login.mjs` → `.session.json`).
**A skeleton crop is a failed capture, never a design verdict.** Do not wait on `networkidle` — this app holds
an open realtime WebSocket and can never satisfy it.

---

## 13 · What candidates MAY vary

The tournament needs room. Each candidate declares where it sits on the **expressive ↔ restrained** axis and
is judged against its own declaration:

- **Card padding and vertical rhythm** within the §7.8 density band.
- **`--fs-display` weight of presence:** which surfaces carry a display title at all, and how much space it
  is given (the token values are fixed; the composition is not).
- **`--r-hero` usage:** a candidate may collapse `--r-hero` into `--r-card` and never use 24px.
- **Chart flourish:** capsule bars vs plain bars, dot-matrix, ring gauges, the M11 diamond-milestone
  treatment, whether the M15 keyed table rides inside the chart card.
- **M16 dotted leaders** — optional, and if used, used consistently on one list type.
- **M17 in-card sparklines** — optional, allowed only where the trend exists in already-fetched data.
- **The ticked section rule** (`instrument`'s repeating-gradient ruler) — a strong move, but optional.
- **Empty-state register** beyond the mandatory floor (name the state · one next action · freshness stamp).
- **Ladder re-derivation** per §3.2, harness re-run and pasted.

**What no candidate may vary:** §1 scoping · §2 type scale and its 7 tokens · §3 the three contrast bars and
the 100% focus ring · §4 the `text4` correction · §5 accent budget · §6 radius family and the pill licence ·
§7 every clause of the dense-list vocabulary · §8 mark anatomy and data honesty · §9 both colour answers and
their exact hexes · §10 motion · §11 filter grammar · §12 the DQ list.

---

## 14 · Acceptance index — every contract, and how it is measured

| § | contract | instrument |
|---|---|---|
| 1.4 | bridge tokens declared | computed `--bg` on `.wb` ≠ `#000000` |
| 1.7 | mobile first-paint carries `.wb` | class assertion at 390 during load |
| 2.2 | ≤9 computed sizes/screen, zero fractional | runtime type census over `.wb` text leaves |
| 2.4 | ≤1 element/screen at weight ≥700, and it is ≥28px | same census |
| 2.6 | tabular-nums everywhere | census: zero numeral leaves at `normal` |
| 3.2 | body ≥4.5:1, marks ≥3:1, ring 100% | per-leaf WCAG walk, both themes, alpha-composited |
| 5.6 | ≤30 accent elements @1440 | runtime accent census against the **rendered page** |
| 6.4 | pill licence | computed `border-radius ≥100px` only on the §6.3 list |
| 7.1 | anchor rail | x-position variance of row primary text = 0px, @390 and @1440 |
| 7.2 | Content status is anchored | visual + DOM: status not inside a wrapping meta flex |
| 7.8 | density band | measured row content-box heights |
| 7.9 | **three-second row-find on Content @390 and @1440** | blind judge, timed |
| 8.5 | data honesty | diff read for hard-coded arrays; denominators traced to a count probe |
| 9 | both answers ship | toggle `data-cat`, capture both, zero layout shift |
| 10.4/10.6 | motion deleted / reduced-motion | computed transition audit, media-feature emulation |
| 12 | DQ list | gates: `npm test`, `npm run lint`, `npm run build`, overflow sweep, console sweep |

---

*Spine ends. Nothing dispatches to a builder before this file exists; it now does.*
