# Deep research — how to structure ivan-inbox as a modern, responsive, internal operator tool

Run 2026-08-01, after Ivan rejected the warm-paper direction. This pass replaces vibes with two things the
last one lacked: **measurements taken from the repo** and **references fetched live, with URLs**.

Brand constraints in force: accent stays `#10A37F`; no warm paper, no editorial serif, no italic register,
zero em dashes in UI copy. See `CONTRACT-2B.md` §Brand-canon and `~/.claude/memory/global/brand-visual-system.md`.

---

## 1 · The real diagnosis, measured (this is the part the last run got wrong)

The last run diagnosed "meh" from screenshots and then invented a direction. Measuring the stylesheets
gives a falsifiable answer instead. All numbers from `src/styles.css` (702 lines) + `src/exp/v2c/styles.css`.

### 1.1 The palette is Apple's iOS system palette, hex for hex

```
--surface:#1C1C1E   = iOS systemGray6 (dark)
--surface2:#2C2C2E  = iOS systemGray5 (dark)
--surface3:#3A3A3C  = iOS systemGray4 (dark)
--text2:rgba(235,235,245,.6) = iOS secondaryLabel (dark)
--text3:rgba(235,235,245,.3) = iOS tertiaryLabel (dark)
--bg:#F2F2F7        = iOS systemGroupedBackground (light)
--blue:#0A84FF      = iOS systemBlue (dark)
--sep:rgba(84,84,88,.5) = iOS separator (dark)
```

Eight of nine surface/text/chrome tokens are literal Apple system values. **This is why it reads generic.**
It does not look like a product with a point of view; it looks like the iOS Settings app, because it is
wearing the iOS Settings app's exact colors. `#10A37F` is the only token that is ours, and it is one accent
sitting on a borrowed ground.

That is a concrete, checkable claim, and it is a better answer to "why is this meh" than anything the
tournament produced.

### 1.2 There is no type scale — there are 28 sizes

| size | uses | | size | uses |
|---|---|---|---|---|
| 13px | 42 | | 14.5px | 13 |
| 12.5px | 42 | | 10.5px | 10 |
| 11.5px | 37 | | 17px | 9 |
| 12px | 29 | | 15.5px | 8 |
| 11px | 25 | | 9px | 6 |
| 14px | 23 | | 9.5px | 5 |
| 15px | 20 | | …and 15 more | |
| 16px | 15 | | **total distinct** | **28** |
| 13.5px | 14 | | | |

**237 of ~290 declarations sit between 9px and 17px.** Ten of those steps are half-pixel (9.5, 10.5, 11.5,
12.5, 13.5, 14.5, 15.5, 16.5). A half-pixel step is not perceptible at reading distance, so functionally
**everything on the screen is the same size**. That is the mechanical cause of "flat / nothing stands out."

### 1.3 Weight is carrying the hierarchy alone, and it is saturated

```
font-weight:600 → 83   font-weight:500 → 12
font-weight:800 → 68   font-weight:400 →  1
font-weight:700 → 67
```

**218 of 231 weight declarations are 600 or heavier. Exactly one is 400.** When every element is semibold
to extra-bold, weight stops signalling importance. `800` is a marketing-display weight; Linear caps its
*display* face at 600 and runs body at 400 (§2.1). We are running headline weight on table rows.

### 1.4 No tabular numerals in the main stylesheet

`font-variant-numeric` appears **0 times in `src/styles.css`** (5 times in `exp/v2c` only). Every count,
timestamp, score, and metric in a dense list is rendering with proportional figures, so digits do not align
down a column. In a tool whose whole job is scanning numbers, this is the cheapest available fix.

### 1.5 Radii: 18 distinct values

`99px ×58`, then `16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 2, 1`. Pills dominate (58 uses), which is an
iOS-app idiom, not a workbench idiom. There is no radius system, so nothing reads as a consistent material.

**Summary of the diagnosis:** the app is not badly built and it is not ugly. It is *undifferentiated* —
a borrowed OS palette, a type continuum instead of a scale, hierarchy delegated entirely to a saturated
weight axis, and no numeric discipline. Every one of those is fixable with tokens and none of them requires
a new visual identity. **That matters: the fix is a system, not a skin, which is exactly the thing I failed
to reach for last time.**

---

## 2 · Reference corpus — fetched live 2026-08-01, not recalled

Per the design-elevation rule, recalled references score zero. Each entry: URL · the move · the application.

### 2.1 Linear — the redesign writeup (primary source, their own engineers)
`https://linear.app/now/how-we-redesigned-the-linear-ui`

- **Density and noise-reduction are complementary, not opposed.** They explicitly set out to "reduce visual
  noise, maintain visual alignment, and *increase* the hierarchy and density of navigation elements."
  More information per screen, with tighter alignment carrying the load.
- **Alignment is the invisible polish lever.** They describe heavy investment in aligning labels, icons and
  buttons vertically *and* horizontally across small surfaces — "not immediately visible, but creates a felt
  sense of polish after minutes of use." This is the single highest-yield unglamorous move available to us.
- **They collapsed 98 theme variables to 3**: base, accent, contrast — generated in **LCH, not HSL**, because
  LCH is perceptually uniform (a red and a yellow at L=50 read equally light). A `contrast` variable then
  drives a real high-contrast theme instead of a hand-tuned second palette.
- **Display face for headings only**, body face for body. Expression at the top of the scale, neutrality below.
- **Chrome-blue was deliberately reduced** in color calculations for a "more neutral and timeless" result.

**Application:** adopt the 3-variable LCH generation model. It replaces our hand-picked Apple hexes with a
*derived* ladder, which is both more coherent and the reason their dark and light themes feel like one system
rather than an inversion.

### 2.2 Linear design-system teardown (concrete numbers)
`https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md`

- Spacing base unit **4px**; density explicitly "compact".
- Type scale with **negative letter-spacing that scales with size** (−3.0px at 80px, −1.0px at 40px,
  −0.05px at 16px, 0 at 14px and below). Tracking is part of the scale, not an afterthought.
- **Hairlines 1px only, no drop shadows on dark surfaces.** Depth comes from a surface ladder
  (`#010102 → #0f1011 → #141516 → #18191a`) plus hairlines (`#23252a`), never from shadow.
- **Accent used ONLY on brand mark, primary CTA, focus rings, link emphasis.** Single accent, no second
  chromatic hue, no gradients.
- Monospace **reserved** for code-adjacent text: IDs, shortcuts, monospaced metadata.
- Focus ring: 2px accent at 50% opacity.

**Application:** this is the material model we should copy wholesale — ladder + hairline, zero shadow. Our
current build uses iOS elevation idioms (opaque grays + pills) which read as mobile chrome on a 1440px canvas.

### 2.3 Superhuman — speed as a design property
`https://blog.superhuman.com/superhuman-is-built-for-speed/` · `https://blog.superhuman.com/how-to-design-for-flow/`
· `https://blakecrosley.com/en/guides/design/superhuman`

- **The 100ms rule** (from Paul Buchheit): every interaction faster than 100ms reads as instantaneous.
  Superhuman's internal target is stricter — 50–60ms — on the theory that the gap between "fast" and
  "feels like thought" is perceptible.
- **Minimal animation is a speed decision**, not an aesthetic one: no time spent loading transitions.
- **Optimistic UI as the core pattern.** Archive → UI updates at 0ms perceived latency → undo toast →
  **focus moves to the next item so keyboard flow is never interrupted** → sync to server in background.
- **"Hesitation is the flow killer."** The next action must always be obvious; make functions visible and
  limit alternatives. Their canonical example: after archiving you see the *next email*, not the inbox list,
  because "lists slow the brain down."
- Shortcut hints rendered **inline in the UI**, teaching the fastest path in situ.

**Application:** this is the biggest available lever and it is behavioural, not visual. Approve/archive/dismiss
in our lists should mutate optimistically, advance focus, and offer undo. No color choice will move the
"feels modern" needle as far as this will.

### 2.4 Rauno Freiberg (Vercel) — Invisible Details of Interaction Design
`https://rauno.me/craft/interaction-design`

- **Remove motion from high-frequency interactions.** "Interaction novelty is diminished" when an animation
  repeats hundreds of times a day. Command menus, context menus and app switchers should appear *instantly*.
  He removed motion from his own tool's core interactions and it "made me feel much faster." macOS
  right-click menus have no motion, by design.
- **Keyboard input feels mechanical, not physical** — animations that flatter touch gestures actively hurt
  keyboard workflows.
- **Interruptibility**: a transition that cannot be reversed mid-flight feels sluggish (his example: iOS
  Settings navigation).
- **Fitts / magic corners**: screen edges have effectively infinite target area; put frequently-used controls
  there.
- **Immediate feedback during a gesture**, thresholds only for commitment. Delaying all feedback until a
  threshold gives zero affordance that a thing is interactive.

**Application:** this directly contradicts the instinct to "add polish via motion." For a tool one expert
opens fifty times a day, the premium move is to *delete* animation from the command palette, tab switch, row
selection, and keyboard nav, and keep it only where it communicates a state change you would otherwise miss.

### 2.5 Dense-table structure
`https://ninjatables.com/big-data-table-design/` · `https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables`
· `https://stephaniewalter.design/blog/essential-resources-design-complex-data-tables/`

- **The anchor column.** The first column is the field that tells the user they are on the right row — name,
  SKU, transaction ID. It orients the entire scan and deserves the strongest treatment on the row.
- **Horizontal rules only.** Full grid lines are reserved for extremely dense tables; horizontal-only reduces
  noise while helping the eye hold its place. This is the recommended default at every data-set size.
- **Row height is a real cost.** Comfortable spacing shows 12–15 rows per viewport; reviewing 300 records is
  9 screens at compact vs 20 at comfortable. Ship a density toggle rather than picking one for all tasks.
- **Search and filter are different tools.** Search finds a known value; filter finds records matching
  conditions the user knows but cannot name. A dense tool needs both.
- **Test whitespace with real content** — what reads as clean in a mockup reads as wasteful at 50 rows.
- **"Big" is a UX threshold, not a row count**: the point where passive reading stops working and the
  interface has to actively help.

### 2.6 Three-pane → mobile triage
`https://docs.appian.com/suite/help/26.6/Pane_Layout.html` · `https://sparkmailapp.com/blog/email-triage`
· `https://unknownkind.com/articles/3-common-app-layouts` · `https://mui.com/x/react-chat/headless/examples/two-pane-inbox/`

- The canonical progression: **wide** = 3 panes with independent scroll · **tablet landscape** = 3 panes,
  shared scroll · **tablet portrait** = nav moves to a top bar, 2 panes · **phone** = list and detail become
  *separate screens*, not a squeezed layout.
- **Mobile users are triaging, not browsing.** Single column enforces a strictly vertical eye path with no
  horizontal scanning. The design driver is the mode change, not the width.
- The triage question is **"does this need a response from me?"** — which argues for surfacing
  reply/delegate/archive **in the list row**, not buried in the detail pane.
- Keyboard selection, nav and **focus restore** belong in the list component itself.

### 2.7 The density counter-argument (recorded honestly)
Search for "2026 dashboard trends" returns mostly template-vendor and agency blogs (AdminLTE, 925studios,
asappstudio) — treat the trend framing as marketing-adjacent. The useful non-vendor points that survived:

- **"Quiet chrome, high density"** and **"tables are the product"** — Attio/Retool/Twenty invest most in
  density, inline edit and keyboard support because that is where users live.
- **The counter-case:** Linear and Notion are also cited as proof that whitespace and progressive disclosure
  beat raw density for daily-use tools.
- **The reconciliation, which I think is right:** the deciding variable is **session length**. Under two
  minutes → mobile-first is correct. Over thirty minutes → the user is doing analytical work that needs
  density, multi-panel comparison and shortcuts, and mobile constraints would strip out exactly what they
  depend on.

**This was the question only Ivan could answer, and his answer fits neither pole.** The literature offers
two session lengths; the actual pattern is a third. See §3.5, which supersedes this framing: the deciding
variable turned out to be *visit frequency across surfaces*, not visit duration.

---

## 3 · What changes because this is internal

Three things, and they invalidate most of what my design corpus knows (which is landing-page moves):

1. **No persuasion surface.** No hero, no trust signals, no social proof, no onboarding, no empty-state
   marketing. Every pixel is information or a control. The `design-elevation` corpus sections A–D are
   almost entirely inapplicable here; only §E (app/dashboard UI) transfers.
2. **One expert user, high repetition.** This inverts two normal defaults: motion becomes a *cost*
   (§2.4), and discoverability matters less than speed — inline shortcut hints beat visible buttons.
3. **Density is the feature, not the risk.** The normal fear of "overwhelming the user" does not apply to
   the person who built the system. The failure mode here is the opposite: a screen so airy it forces
   scrolling to see state that should have been visible at once.

---

## 3.5 · The organizing principle is RE-ENTRY, not analysis (answered by Ivan, 2026-08-01)

I asked whether sessions run thirty minutes or ninety seconds, because §2.7 says that single fact decides
the brief. Ivan's answer is neither pole: **"depends on the section, in content I might sit more, a few
minutes at a time, check inbox, drafts also."**

So the real pattern is: **short visits, several a day, moving across sections.** That is a third mode, and
it has a different dominant cost from either pole in the literature. Thirty-minute analysis pays orientation
cost once and amortises it. Ninety-second glances only ever read one number. A few minutes across several
sections pays **orientation cost on every visit, to every surface.** Re-entry is the tax, and it is charged
five or ten times a day instead of once.

Four consequences, all of which outrank the token work in §4:

1. **Every surface must answer "what changed and what needs me" without reading rows.** Not a dashboard
   summary. A count in the rail that is *accurate*, plus new/changed items sorted to the top of their own
   list. Accuracy matters more than presentation: a badge you have learned to distrust is worse than none.
2. **Section state must survive leaving.** Filters, scroll position, selection, expanded groups. If you
   leave content, check drafts, and come back to a reset list, you re-do the orientation you already paid
   for. This is the single largest quality-of-life gap in the app today (measured below).
3. **Switching sections must be free.** You cross surfaces constantly, so `⌘K` and the rail are load-bearing,
   and per §2.4 the switch should have **zero** transition. Motion on a path you take fifty times a day is
   pure tax.
4. **Density still wins**, but the argument changes. Not "you need multi-panel comparison for analytical
   work." Rather: a few minutes means you cannot afford to scroll to find state, so everything that decides
   whether you act has to be on one screen.

### 3.5.1 Measured: the app persists almost nothing across re-entry

`grep` over `src` for storage APIs and scroll restoration:

- `localStorage` is used in **8 files**, for exactly four things: theme (`inbox-theme`), login email
  (`inbox-email`), notification chime (`chime.ts`), and a Today payload cache (`lib/today.ts`).
- **Filter state is never persisted.** Six sites initialise empty on every mount:
  `ContentList.tsx:516`, `ContentSections.tsx:121/191/233/305`, `Shell.tsx:99`, all
  `useState<FilterState>({})` or `useState<Filter>('all')`.
- **No scroll restoration anywhere.** Every `scrollTop` / `scrollIntoView` hit is either "pin chat to
  bottom" (`ThreadScreen.tsx:85`, `ChatPane.tsx:116`) or "jump to a section anchor"
  (`ContentList.tsx:291`). There is no `scrollRestoration`, no saved offset, no restore-on-return.
- **No selection restore.** Nothing remembers which row was open.

So today: leave the content section, check drafts, come back, and you land at the top of an unfiltered list
with nothing selected. Every visit re-pays orientation in full.

**The fix already exists in the codebase, applied once.** `lib/today.ts:4` writes a localStorage projection
"so the tab paints instantly on open," with a field-by-field allowlist at `:340` and an explicit rule at
`:342` that gated links (`?k=`) must never be added to it. That is the correct pattern, security review
included, and it is generalisable to section state. It was built for Today and never extended.

**Recommendation:** a small `useSectionState` hook persisting `{filters, scrollTop, selectedId, expanded}`
per section key, reusing the `today.ts` allowlist discipline (state keys only, never payload, never tokens).
This is roughly a day of work and, on the usage pattern Ivan just described, it will be felt more than the
entire type and colour system below.

---

## 4 · Proposed system (concrete, buildable, brand-legal)

Not a skin. Every item below is a token or a behaviour, and each cites its source above.

### 4.1 Type — 28 sizes collapse to 6

| token | size / weight / tracking | job |
|---|---|---|
| `eyebrow` | 11 / 600 / +0.4 / uppercase | column headers, section labels |
| `meta` | 12 / 400 / 0 | timestamps, counts, secondary row text |
| `body` | 13 / 400 / 0 | **the workhorse** — row primary, prose |
| `title` | 15 / 500 / −0.1 | section + pane titles |
| `page` | 20 / 600 / −0.4 | screen title |
| `figure` | 30 / 600 / −1.0 / tabular | the ONE hero numeral per surface |

Rules: **no half-pixel sizes**, ever. **Weight ceiling 600** — `700` and `800` are deleted outright (218
declarations to unwind, but it is find-and-replace, not redesign). Body returns to `400`, which currently
has one single use. Negative tracking scales with size, per §2.2.

### 4.2 Numerals

`font-variant-numeric: tabular-nums` on every count, timestamp, score, metric and table cell. Cheapest
credibility win in the whole document. Monospace stays **reserved** for IDs, keyboard shortcuts and code
(§2.2) — not for body, not for labels.

### 4.3 Material — ladder + hairline, zero shadow

Replace the Apple hexes with a **3-variable LCH-derived ladder** (base, accent, contrast) per §2.1.
Four surface steps, one hairline token at low alpha, **no drop shadows**, radii cut from 18 values to four:
`4` chips · `6` buttons/inputs · `10` panels · `999` avatars and status pills **only**. The 58 pill uses
elsewhere get real radii — pills are an iOS idiom and they are why the desktop view reads as a phone app.

### 4.4 Accent budget

`#10A37F` does exactly **two** jobs: primary action, and focus ring (2px @ 50%). Severity keeps its own three
tokens (`#10A37F` clear / `#FF9F0A` attention / `#FF453A` urgent) and nothing else is chromatic. `--blue`
(`#0A84FF`, iOS systemBlue) is retired — it is a second accent we never decided to have.

### 4.5 Rows — the densest surfaces are the test

Anchor column gets `body`/500; everything else `meta`/400 neutral. **Horizontal hairlines only**, no per-row
boxes, no chevrons, background-shift on hover. Density toggle (compact / comfortable) because the two tasks
genuinely differ (§2.5). Row actions live in the row.

### 4.6 Motion — subtract, do not add

**Delete** motion from: command palette, tab switch, row selection, keyboard nav, pane switch. **Keep** it
only where it reports a state change the eye would otherwise miss: a row leaving the list, an undo toast,
a value changing in place. One easing token, 150ms, transform/opacity only. Per §2.4 this *is* the premium
move for a fifty-times-a-day tool — the opposite of the usual instinct.

### 4.7 Behaviour — the biggest lever, and it is not visual

Optimistic mutation on every list action (§2.3): update at 0ms → **advance focus to the next row** → undo
toast → sync in background. Plus `⌘K` everywhere, `j/k` selection, inline shortcut hints.

### 4.9 Ranked build order

Given the usage pattern in §3.5, the order that maximises felt improvement per day of work:

| # | move | ref | effort | why first |
|---|---|---|---|---|
| 1 | **Persist section state** (filters, scroll, selection) | §3.5.1 | ~1 day | Kills the re-entry tax charged 5-10×/day. Pattern already exists in `today.ts`. |
| 2 | **Optimistic actions + focus advance + undo** | §2.3, §4.7 | ~1-2 days | Turns every list into a flow instead of a round trip. |
| 3 | **Accurate "needs me" counts per section** | §3.5 | ~1 day | Answers the arrival question without reading rows. |
| 4 | **Type scale 28→6, weight ceiling 600, tabular-nums** | §4.1, §4.2 | ~1 day | Mostly find-and-replace. First move that makes hierarchy exist. |
| 5 | **Material: LCH ladder, hairlines, radii 18→4, retire `--blue`** | §4.3, §4.4 | ~2 days | Removes the borrowed iOS identity. |
| 6 | **Delete motion from high-frequency paths** | §2.4, §4.6 | hours | Subtraction. Cheapest item here. |
| 7 | **Alignment pass** | §2.1, §4.8 | ~1 day | Invisible in a screenshot, felt in a minute. |
| 8 | **Mobile triage mode** | §5 | ~2 days | Only if phone use is real; unverified. |

Items 1-3 are behaviour and cost about four days. Items 4-7 are the visual system and cost about four days.
**On the pattern Ivan described, 1-3 will be felt more than 4-7** and neither depends on the other, so the
ballot decision on visual direction does not block any of the first three.

### 4.8 Alignment pass

The unglamorous Linear move (§2.1): align every label, icon and control on a shared vertical and horizontal
grid across the small surfaces. Invisible in a screenshot, felt within a minute of use.

---

## 5 · Responsive — two modes, not one layout that shrinks

| width | layout | mode |
|---|---|---|
| ≥1200 | rail + list + context, independent scroll | **workbench** — keyboard-first, density toggle, `⌘K` |
| 768–1199 | rail collapses to icons; list + context | workbench, shared scroll |
| <768 | **single column**; row opens a full-screen detail | **triage** — vertical eye path, actions in the row |

The phone build is not the desktop build reflowed. It shows fewer fields, the anchor column plus one status,
and the action set inline. Per §2.6 the driver is the change of *task*, not the change of width.

---

## 6 · What this does NOT decide — for Ivan

Everything above is system work that is correct under either answer. Two things are genuinely his call:

1. ~~**Session length → density.**~~ **ANSWERED 2026-08-01** — a few minutes at a time, more in content,
   moving across inbox and drafts. Resolved to compact workbench organised around re-entry. See §3.5.
2. **Ground: dark or light.** Linear anchors dark and ships no light variant. Our current build ships both,
   badly (the light theme is an inversion, not a theme). Picking one as primary is cheaper and better than
   maintaining two mediocre ones.
3. **`inkline` is still contaminated.** Its "editorial spine" is serif display + serif stat numerals + a
   highlighter sweep, all ported from the marketing site. Under the absolute retirement it either loses its
   spine (rebuilt on weight and tracking) or it is out, leaving `instrument` alone on the ballot. Flagged in
   `BALLOT.html`, not silently shipped.

---

## Sources

- [Linear — How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Linear design-system teardown — VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- [Superhuman — Why Superhuman is built for speed](https://blog.superhuman.com/superhuman-is-built-for-speed/)
- [Superhuman — The 3 design principles for creating flow](https://blog.superhuman.com/how-to-design-for-flow/)
- [Superhuman: Speed as the Product — Blake Crosley](https://blakecrosley.com/en/guides/design/superhuman)
- [Rauno Freiberg — Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design)
- [Ninja Tables — Big data table design](https://ninjatables.com/big-data-table-design/)
- [UI Prep — The ultimate guide to designing data tables](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables)
- [Stéphanie Walter — Essential resources to design complex data tables](https://stephaniewalter.design/blog/essential-resources-design-complex-data-tables/)
- [Appian — Pane Layout](https://docs.appian.com/suite/help/26.6/Pane_Layout.html)
- [Spark — Email triage](https://sparkmailapp.com/blog/email-triage)
- [unknownkind — 3 common application layouts](https://unknownkind.com/articles/3-common-app-layouts)
- [MUI X — Two-pane inbox](https://mui.com/x/react-chat/headless/examples/two-pane-inbox/)
- [925studios — SaaS dashboard patterns 2026](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) *(vendor-adjacent, used only for the density-vs-whitespace counter-argument)*
