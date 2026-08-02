# Direction brief — `instrument` · "Instrument"

**Thesis:** the app becomes a precision instrument: cool-neutral light ground, Linear/Geist-grade austerity, everything earns its ink. The bet: what Ivan will love daily is not brand theater but the feeling that every pixel is load-bearing — the "meh" was visual noise and weak hierarchy, and the cure is subtraction executed at top-studio level.

**Ground / material:** cool neutral light (e.g. `#FAFAF9` frame → white `#FFFFFF` inset canvas card — the Linear two-surface shell, E1 verbatim), ink `#18181B`-family text. Hairlines are ink-alpha (5-8%), one separation device per boundary (border OR bg-shift OR spacing, never stacked). De-bordered rows (E3): group container + divide-y hairlines, bg-shift hover, no per-row boxes. Depth: exactly two shadow levels (canvas card, overlays). Radii: 6px cards / 4px controls, nothing else.
**Dark theme duty:** functional, legible, not the thesis.

**Type:** system sans only, but with a real scale: 24-34px medium-weight stat numerals (tabular-nums), 15px body, 11px tracked uppercase labels, and honest weight hierarchy (400/500/600 doing distinct jobs). No serif anywhere — this direction tests whether discipline alone beats brand gesture. Line-height and vertical rhythm on an 8px grid, enforced.

**Accent `#10A37F` deployment — strict E4 budget:** accent = primary action + active nav + live signals. Period. All decorative green (borders, tints, misc icons) returns to neutral. Severity amber/red as small square-dot + neutral text chips, consistent anatomy. The result should make the accent feel rare and therefore meaningful.

**Data-viz:** Geist-grade: hairline tracks, solid fills, square ends, tabular-nums, explicit axis/cap labels at 11px, no gradients, no rounded caps. The over-cap hatch survives. Sparklines allowed where a trend exists in data already fetched.

**Motion:** ONE easing token (cubic-bezier(.25,1,.5,1)), 150-250ms, transform/opacity only, THE most disciplined of the three directions. Signature beat (E6, intensity ∝ rarity): approving a draft — the row settles out with a 200ms transform + the count ticks down; nothing else in the app is choreographed. Hover states ≤100ms.

**Empty states:** instrument register — small 11px uppercase label + one hairline-boxed next-action + freshness stamp. Confident whitespace is the character; but every 1440px screen keeps ≥1 structural element per region (no featureless voids — the prior tournament's Ops defect).

**References to FETCH (≥2, cite the move + URL + evidence):**
- `https://linear.app` — two-surface shell, de-bordered rows, accent budget
- `https://vercel.com/geist/introduction` — type scale, tables, data treatment
- `https://superhuman.com` — speed-as-feel, interaction restraint
- One live generic admin template (fetch any Tailwind admin demo) — as the NEGATIVE control: name three specific choices you made that it wouldn't

**Fails if:** it reads as the generic template it's calibrated against (brand seat will bin it — the risk of this direction is scoring "clean" and "anonymous" simultaneously); or the austerity collapses the content lanes' 198-row density into unreadable sameness; or hierarchy is asserted in the brief but unmeasurable in the crop.

---

# BUILD — what `instrument` actually did

Branch `exp/brain-2b-instrument`, base `87050cd` (tip of `exp/brain`). Commits:
`6d3a79e` treatment · `a186829` severity-per-run · `8b58bbe` weight leaks + honest rhythm.
All treatment lives in one new file, `src/exp/v2c/instrument.css` (766 lines), plus a
retoned token block in `src/styles.css`. No element added, no column moved, no route
renamed — structure is the locked floor and it stayed locked.

## How the before/after numbers were produced

Both columns are **live runtime measurements, not source greps**. A second git worktree
was checked out detached at the base commit `87050cd`, given the same `.env.local` and the
same minted session, and served on port 5404; the candidate ran on 5403. The same probe
(`scripts/_after.mjs`) walked every text leaf inside `.wb` on both servers and counted
computed `font-size`, computed `font-weight`, and every element whose computed colour,
background, border or shadow contains `rgb(16,163,127)`. Same data, same session, same
probe — so the deltas below are a diff, not a claim.

### Type scale — distinct computed sizes per screen

| surface | before | after |
|---|---|---|
| content 1440 (densest) | **19** | **10** |
| content 390 | 16 | 11 |
| today 1440 | 19 | 9 |
| inbox 1440 | 13 | 7 |
| sends 1440 | 18 | 8 |
| ops 1440 | 18 | 7 |
| settings 1440 | 12 | 5 |

Union across the shipped app: **25 distinct sizes** — `9 · 9.5 · 10 · 10.5 · 11 · 11.5 ·
12 · 12.5 · 13 · 13.5 · 14 · 14.5 · 15 · 15.5 · 16 · 17 · 18 · 19 · 20 · 22 · 26 · 28 ·
30 · 32 · 34`. Half-pixel drift is not a scale; it is the absence of one.

After: **seven text steps — 11 · 12 · 13 · 15 · 17 · 20 · 28/34** — plus one 10px chip
step and 9–10px glyph sizes carrying no words. The jumps are real ratios (11→15 is 1.36,
17→28 is 1.65), not ±2px.

**Weights.** Before, the content lane rendered six weights and the two heaviest carried
the most text: `400:95 · 500:118 · 600:257 · 700:437 · 800:522 · 900:1`. Weight 800 was
the app's most common weight — which is another way of saying it had no hierarchy, because
a hierarchy in which the loudest voice is also the most frequent one is a monotone. After:
**three weights, `400:586 · 500:377 · 600:467`**, each with one job — 400 body and meta,
500 names and readouts, 600 the tracked 11px label. Nothing in the app is heavier than 600.
The last two leaks were found by walking leaves rather than reading the sheet: a `✓` inside
a 12px zone mark still at 800, and a trend caret at 700. Both closed in `8b58bbe`.

**8px rhythm — stated as measured, not as advertised.** Line-heights are `16 / 20 / 24 /
32 / 40`. The five steps that set a region's rhythm are on 8: 11px→16, 15px→24, 17px→24,
28px→32, 34px→40. The 13px meta tier rides the 4px sub-grid at 20, because 13/24 is airy
and 13/16 is cramped. The build's first draft claimed "every line-height is a multiple of
8"; the probe showed that was false for one tier, so the claim was corrected in the sheet
rather than the tier bent to fit it. Section padding is `22px / 7px` above and below an
11px/16px label, which lands the next row on the 8px grid.

## Section headers — one face instead of four

The shipped app had four unrelated header patterns (`.wb-sech`, `.td-zh`, `.grouphdr`,
`.ov-h`/`.res-hdr`/`.ops-sechdr`). They are now one object with slots:

> `01` — tabular index, 11px/500 · **INBOX** — 11px/600 tracked `.11em` uppercase ·
> ————— the rule ————— · `18` — right-set tabular count · ▪ severity square

The rule is the move. It is not a plain 1px line: it is a hairline **with a tick every
8px** (`repeating-linear-gradient(90deg, var(--sep) 0 1px, transparent 1px 8px)` over a
baseline), so the header literally draws the grid its own type rides on. A generic template
ships a title bar; this ships a measuring face. Headers are `position:sticky`, which is
what makes a 198-row lane navigable — the count above the rows is always the count of what
you are looking at.

## Content-lane rows — de-bordered

Before: every draft was its own floating card — `background: var(--surface2)`, `border-radius:16px`,
`margin: 10px 16px`, its own separation on all four sides. On the densest surface in the
app that is ~200 boxes, and it is the single most template-shaped thing in the build.

After: **the group carries the boundary, the rows carry none.** `.ct-card` is
`margin:0; padding:11px 20px; background:transparent; border-radius:0;
border-top:1px solid var(--hair)` — one 7%-ink hairline between siblings, a background
shift to `--surface2` on hover, and nothing else. Selection is a 2px inset accent spine,
the same mark active nav uses, so "where am I" is one vocabulary across the app. Inbox,
Today, Sends and Ops rows were folded into the identical anatomy (`.r + .r`, `.td-r + .td-r`,
`.ov-tr + .ov-tr`). Density improved without shrinking anything: rows lost 20px of vertical
margin each and gained nothing.

Same logic applied to chips: one anatomy for every small label in the app — 10px/600
tracked caps, hairline box, transparent fill, ink text, 4px radius, and a **5px square**
when it carries severity. Avatars lost six decorative gradients across twelve hues for a
neutral rounded-square plate with ink initials.

## Empty states — a register, not a shrug

`CalmEmpty` gained a character (`src/exp/v2c/Surface.tsx`):

```
LANE EMPTY                          ← 11px/600 tracked, the state named
No Ivan drafts in the pipeline.     ← 15px ink, one line, no apology
[ Re-read the pipeline ]  ▪ Checked 2m ago   ← hairline-boxed next action + tabular stamp
```

Every empty surface now names its state (`lane empty`, `idea queue empty`, `publish queue
empty`, `no resources`, `queue clear`), offers exactly one next action, and stamps its
freshness — so an idle instrument still reads as switched on. This directly answers the
prior tournament's Ops defect (a 600px featureless void): every 1440px region keeps at
least one structural element.

## Motion + the single beat

**One easing token**, `cubic-bezier(.25,1,.5,1)`, declared once per theme. Hover and press
are 100ms; state changes 150–250ms; transform and opacity only. The press affordance is
`scale(.98)` on controls and a background shift on rows — never both.

**The beat.** Approving a draft is the rarest and most consequential thing that happens in
this app, so it is the only thing choreographed. `ReviewActions.onDone` is intercepted:
the row takes `.settling` → `translateY(-10px)` + fade over 200ms, the refetch fires when
the movement ends (so the list never jumps under a hand), and the section count above it
receives the same 200ms `translateY(-4px)` tick as it lands on its new value. Cause and
effect, 24 inches apart, in one gesture. `useTick` in `Surface.tsx` compares the previous
count, so the readout moves when the number moves and at no other time. Both halves are
disabled under `prefers-reduced-motion`.

Nothing else in the app is choreographed. Intensity in proportion to rarity.

## Accent budget — before/after, counted

Elements whose computed colour, background, border or shadow contains `rgb(16,163,127)`:

| surface | before | after | cut |
|---|---|---|---|
| content 1440 | **107** | **26** | −76% |
| content 390 | 104 | 21 | −80% |
| sends 1440 | 66 | 15 | −77% |
| today 1440 | 23 | 12 | −48% |
| inbox 1440 | 15 | 7 | −53% |
| ops 1440 | 9 | 8 | — |
| settings 1440 | 8 | 7 | — |

What was retired: the second hue. `--blue: #0A84FF` now resolves to ink, the six-hue
pipeline stage map became **one ink ramp at four alphas plus the accent** (`ideas → generating
→ review` are `--ink1/2/3`; only `approved` — the stage that means Ivan acted — takes green),
and the 60-bar Sends sparkline that was painted entirely in the accent is now ink with
**only today's bar green**. Accent survives in exactly three roles: primary action, active
nav, live signal.

One consequence worth naming: `#10A37F` is now forbidden from being a text colour, which is
also what makes the text ramp pass AA — accent-on-white is 3.2:1 and could never have
carried body copy. Where a figure or a label had been painted in a severity tier (22 AA
failures), the tier moved to the 5px square that every other severity already uses and the
words went back to ink. The primary button carries **ink `#171717` on `#10A37F` = 4.92:1**;
white would have been 3.2:1, and darkening the green to fix it would have introduced a
second value of the one locked hue.

Late fix (`270dffc`): a hex grep over the treatment file reports a clean palette, and it is
lying — `#30D158` survived in two rules of the *base* sheet, one specificity level deeper than
the label rule meant to catch them (`.ctx-lbl .ok`, `.ctx-link.scan`). **The accent gate has to
be run against the rendered page, not the source**, which is what the runtime census does and
what a grep-only check would have passed.

Late fix (`a186829`): the expanded alert list was twelve rows of one tier each with its own
red spine — a picket fence that ranks nothing and spends the whole severity budget on a
homogeneous group. Red now stays on the head that counts them; the run takes a continuous
neutral rule. **One severity mark per run, not per row.**

## External references — FETCHED, with evidence

**1 · Geist (Vercel) — `https://vercel.com/geist/introduction`, `/colors`, `/materials`,
`/typography`.** Retrieved 2026-08-01 by `curl` with a desktop UA: `introduction` HTTP 200 /
217,150 bytes; `typography` 200 / 161,369; `colors` 200 / 222,640; `materials` 200 / 126,105.
Token names extracted from the served markup: `--ds-gray-100/200/400/700/800/900/1000`,
`--ds-background-100/200`, `--geist-radius`, `--geist-foreground`.

- **Move taken (two-surface shell + text ramp):** Colors says *"There are two background
  colors for pages and UI components… Background 2 should be used sparingly"* and *"Colors
  9–10: Text and Icons — Color 9 secondary text and icons, Color 10 primary."* So: exactly
  two grounds (`--frame #FAFAF9` chrome / `--surface #FFFFFF` canvas) and a text ramp whose
  every tier is an accessible ink value rather than a decorative alpha —
  `#171717` 18.3:1 · `#52525B` 7.7:1 · `#6B6B73` 5.3:1. The shipped light theme's third tier
  was `rgba(60,60,67,.3)` = **1.6:1**, i.e. decoration wearing the costume of text.
- **Move taken (materials, not hand-rolled surfaces):** Materials says *"Radius 6px"* for
  `material-base`/`material-small`, and *"Don't stack two Materials on the same element."*
  Hence exactly two radii (6px plate / 4px control), exactly two elevations, and Rule 1 of
  the sheet: **one separation device per boundary** — a border OR a background shift OR
  spacing, never two.
- **Move taken (where tabular figures belong):** Typography documents `text-label-13` as
  *"with Strong, and Tabular (123) — used as a secondary line next to other labels"*, and a
  heading ladder of 72/64/56/48/40/32/24/20/16/14 — real jumps, no half-steps. That is the
  warrant for putting `font-variant-numeric: tabular-nums` on the small readout tier and for
  refusing ±2px steps.

**2 · Linear — `https://linear.app/homepage`.** Retrieved 2026-08-01 by `curl` with a desktop
UA, HTTP 200, 1,762,972 bytes received (the full 2.48 MB document timed out at 45s; enough
markup landed to resolve the stylesheet graph). Fourteen production stylesheets then pulled
from `https://static.linear.app/web/_next/static/css/` (`Providers.qSrgnk7B.css`,
`Grid.Cds8fjKR.css`, `Link.Tpxbzi3N.css`, et al) into a 57,750-byte concatenation.

- **Move taken (hairlines are ink-alpha, not grey):** the sheet's boundary token is
  `--edge-highlight-color: #ffffff0f` — a **6% alpha of the ink**, not a named grey. So
  `--sep: rgba(24,24,27,.11)` and `--hair: rgba(24,24,27,.07)`, which invert correctly with
  the ground instead of needing a second palette.
- **Move taken (hover is faster than you think):** the sheet's interaction token is
  `--transition-duration: .1s`, and the measured duration histogram across all fourteen files
  is `.16s ×6 · .2s ×3 · .12s ×2 · .1s · 80ms` — a top-studio app spends **80–200ms**, never
  300. Hover here is 100ms, state 150–250ms, and the beat is 200ms.

**3 · Negative control — TailAdmin, `phase2b-design/brand-refs/control-generic-admin.png`,**
plus a live fetch of `https://tailwindui.com/templates` (HTTP 200, 94,306 bytes) to confirm
the pattern is the category default and not one product's quirk. Read below.

*(Superhuman `https://superhuman.com/` also fetched, HTTP 200 / 667,601 bytes, but it is a
marketing page rather than the product surface, so nothing was taken from it. Recording it
as fetched-and-rejected rather than pretending it contributed.)*

## Three choices the generic admin template would not make

Looking at the control: TailAdmin is a grey field carrying floating white cards with 12–16px
radii and shadows, bold sentence-case card titles with kebab menus, indigo chart bars over an
indigo area gradient, tinted green/red percentage pills, coloured icon tiles, and an active
nav item rendered as a filled tinted pill. It is competent. It is also nobody's.

1. **It would never let a section header carry a ruler.** Every region in the control gets a
   card and a title — `Monthly Sales`, 18px/700, sentence case, with a `⋮` in the corner.
   Instrument spends that slot on an instrument face instead: a tabular index, an 11px
   uppercase label tracked to `.11em`, a right-set tabular count, and a hairline **ticked
   every 8px** so the header displays the grid the page is built on. A template asserts
   structure with a box; this one shows its measurements. That is a choice with a cost —
   it is less friendly — and it is the choice a tool for one expert user should make.

2. **It would never delete the row card.** The control's instinct on any list is one card per
   item; that is what its component library is *for*. Instrument removes the per-row box
   entirely on the 198-row content lane: no fill, no radius, no margin, no shadow, one 7%-ink
   hairline between siblings, hover as a background shift. The template's version costs four
   borders, a radius, a shadow and 20px of margin per row and produces a quilt at scale; this
   produces a sheet you can scan. Density went up while nothing got smaller.

3. **It would never ration its own brand colour.** The control paints indigo into bars, area
   fills, icon chips and the active-nav pill, then adds green and red as *third and fourth*
   hues in tinted pills. Instrument cuts accent elements on the densest screen from 107 to 26,
   retires the blue outright, makes the categorical ramp one hue at four alphas, paints a
   60-bar sparkline in ink so that **only today is green**, and forbids the accent from ever
   being a text colour. A template treats brand colour as a budget to spend; this treats it as
   a signal that stops meaning anything the moment it is spent.

*(A fourth, offered as the tell that this was measured rather than styled: the primary button
carries ink `#171717` on `#10A37F` at 4.92:1. The template's move — and the obvious one — is
to darken the green until white passes. That would have introduced a second value of the one
locked hue, so the label changed colour instead of the brand.)*

## The 3-second felt difference

Put the two 1440px content crops side by side and start a three-second timer. Nobody reads.
Here is what is actually different in that window:

**Before**, the eye has nowhere to land, because everything is competing: 107 green elements,
19 type sizes, six font weights with 800 as the most common one, roughly two hundred rounded
cards floating on a grey field, six unrelated hues in the stage map, and every section titled
in a bold that matches every other bold on screen. It reads as *a lot of software*. That is
the "meh": not ugly, just loud in a way that carries no information — visual volume with a
flat dynamic range.

**After**, the eye lands immediately, and it lands on a number. The screen is one white sheet
ruled into sections; the only things louder than 15px body text are the 28/34px tabular
readouts, and the only green things are the thing you clicked, the place you are, and the
signal that says the data is live. The 3-second read is *this machine is on, here is where you
are, here is the count*. That is a different sentence from *here is a dashboard*.

The falsifiable version of the claim, from `DIAGNOSIS.md`: a stranger binning crops should not
put this one with TailAdmin. The tells that separate them are all countable — no card per row,
no second hue, no shadow on a resting surface, no weight above 600, a ticked rule instead of a
title bar, and an empty state that names its own state and offers one action instead of
apologising. And the honest risk this direction was warned about is the same one: austerity can
score *clean* and *anonymous* at once. The defence is that anonymity comes from **defaults**,
and every number above is a departure from one.

## Gate numbers

| gate | result |
|---|---|
| `npm test` | **334 passed / 334**, 20 files, 0 failed |
| `npm run lint` (oxlint) | **0 errors** (warnings pre-existing on base) |
| `npm run build` | clean, `✓ built in 413ms`, PWA precache 15 entries |
| new npm dependency | **none** — `package.json` unchanged |
| webfont / `@font-face` | **zero** — system stack only, no serif used |
| horizontal overflow @390 | **0 of 50 shots** (`docOverflow:false`, `scrollWidth == clientWidth == 390`) |
| clipped elements | **0 of 50 shots** |
| AA body contrast, primary (light) | **0 failures** across 7 surfaces (was 22) |
| AA body contrast, secondary (dark) | **0 failures** — dark is legible, not merely present |
| accent hue | `#10A37F` only. `#0A84FF` retired; the six avatar gradients (`#30D1C9 #FF375F #30D158 #5E5CE6 #BF5AF2 #64D2FF`) and the `#BF5AF2` InMail chip neutralised; two surviving `#30D158` rules killed in `270dffc`. Severity `#FF9F0A` / `#FF453A` unchanged |
| 3-tier severity | intact — 3 tiers, 3 hexes, one anatomy (5px square / 2px spine) |
| monospace outside code blocks | none — `.wb-code` / chat code blocks only |
| console errors | **6 of 50 shots**, all the unarmed `inbox-claude` broker (CORS + paired ERR_FAILED); zero from `src/` |
| login screens in sweep | 0 of 50 (`loginVisible:false`) |

**Console errors, stated precisely rather than rounded to zero.** The final sweep records
**6 entries across 50 shots**, and all six are the same fact twice: 3 CORS preflight failures
plus their 3 paired `net::ERR_FAILED` against `supabase.co/functions/v1/inbox-claude` — the
Claude broker, which is deployed but unarmed and explicitly out of bounds for a treatment
builder. **Zero React errors, zero uncaught exceptions from `src/`, zero CSS warnings, zero
login screens (`loginVisible: false` on all 50).**

Getting to that number required fixing the harness, which is worth recording because it was
producing false evidence in both directions. `sweep-v2c.mjs` waits with
`waitUntil:'networkidle'` — a condition this app can **never** satisfy, because it holds an
open Supabase realtime WebSocket for the life of the page. Every navigation therefore burned
its full 60s timeout, logged that timeout as a console error, and then screenshotted whatever
had arrived. The inbox paginates `inbox_messages_v` a thousand rows at a time, so "document
ready" and "surface has its data" are 30+ seconds apart, and the densest surface came back
fully rendered in one run and as a wall of grey skeleton bars in the next — from identical
code. Three commits fix it (`8b58bbe`..`HEAD`): wait on `domcontentloaded`, then on the app's
own loaded signal (skeletons cleared **and** the rail stamp no longer reads `not loaded`
**and** a terminal render exists — real rows, a calm-empty, or a failed panel, since an empty
DOM also has zero skeletons). Median time-to-ready is now ~7s instead of a 60s stall, and the
crops are deterministic.

Two runs were discarded rather than shipped: one where the minted session's access token had
expired (every surface captured mid-load), and one where the machine's network dropped
mid-sweep (240 `ERR_INTERNET_DISCONNECTED`, 6 shots damaged). The delivered set is a single
uninterrupted run against a freshly minted session. **The measurement was the least reliable
instrument in this build, and that is a finding, not an aside** — the prior tournament's
crops were captured with the same broken wait.

## Measurement scripts committed alongside

`scripts/sweep-instrument.mjs` (a copy of the repo's `sweep-v2c.mjs`, retargeted to port 5403
and extended with the Mattan lane and two dark-theme controls), `scripts/_after.mjs` (type and
accent census), `scripts/_contrast.mjs` (per-leaf WCAG walk, both themes, with alpha
compositing against the nearest opaque ancestor). Every number above is reproducible from them.
The 50-shot set in `crops/instrument/` plus `sweep.json` is one uninterrupted run.
