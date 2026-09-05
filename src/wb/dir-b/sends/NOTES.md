# S09 — Sends overview (Direction B, "surface")

Files written, all under `/private/tmp/wb-dir-b/src/wb/dir-b/sends/`:

| File | What it is |
|---|---|
| `index.tsx` | `SendsScreen`, same props (`{ client, setClient }`) as `src/screens/SendsScreen.tsx`. The shell: masthead, client scope, sub-view switch, window control. |
| `overview.tsx` | `OverviewView`, the rebuilt Overview sub-view. Same props as `src/screens/kpi/OverviewView.tsx`. |
| `legacy.tsx` | The Lanes and Log sub-views and both drill-ins, copied unchanged. Not rebuilt. |
| `sends.css` | The classes `dir-b.css` does not already carry. Tokens only; census-clean (no hex, no `rgb()`, no px font-size, no px radius, no `transition: all`). |

`npx tsc -p tsconfig.app.json --noEmit` reports zero errors in these four files.
(The two pre-existing errors in the run are in `wb/dir-b/content/calendar.tsx`
and `wb/dir-b/ops/index.tsx`, another builder's folder.)

---

## What changed, per screen

### The shell (`index.tsx`)

Every hook, its order, every piece of state, both `try` blocks in `load`, the
soft-failing inbound fetch, `usePullToRefresh`, `buildLanes`, `buildInboundLanes`
and both detail early-returns are byte-for-byte the shipped ones.

- Masthead is `Header` (title "Lanes", sub "Outreach and inbound, per client")
  with the refresh control as `IconButton icon="refresh" label="Refresh"` on the
  tail — same `load` call, same word, no unicode glyph.
- The client scope is three `Chip`s in place of `.chip` buttons. Same three
  labels, same `setClient`.
- **Sub-view switch** is one `Segmented` with `markerId="s09-view"`, so the
  selected pill is a shared-layout marker travelling between Overview, Lanes and
  Log rather than three fills swapping (ref: the direction brief; the marker is
  `Segmented`'s own `layoutId`).
- **Window control**: the brief says it "keeps its exact current behaviour, drawn
  with `Segmented` or `Chip`s", so it is a second `Segmented`
  (`markerId="s09-range"`) carrying the same three `TIMEFRAMES` values on the
  same `setTimeframe`, still only rendered on the Overview sub-view, still
  revealing the custom date pair only once `Custom` is chosen. The word "Range"
  is kept as its eyebrow and the pill's `title` string ("The window every figure
  below is computed over") is kept as the control's accessible name. **Decision
  logged:** drawing it as a `Segmented` retires the `range` open/closed state,
  because a segmented control has no menu to open. The VALUE and everything the
  value drives are untouched; only a click is removed.
- The custom date pair is two `Input type="date"`s (labels "From"/"To", hidden)
  instead of two hand-styled `<input>`s with inline hex. Same `value`, same
  `min`/`max` clamp, same `onChange`.

### Overview (`overview.tsx`)

Data layer untouched: the one `Promise.all` of eleven fetches, `fetchRangeKpis`
in `RangeSummary`, `buildLedger`, `buildLanes`, every derivation and every
severity threshold are copied verbatim. There are no writes on this surface, so
there is nothing to preserve on that side.

- **The tile band** — the four decision readings are `StatTile`s in
  `.dirb-tiles`. Each figure counts up from 0 to its reading with a
  `useMotionValue` + `animate` over `DUR` (180ms) on `ease`, staggered
  `stagger(i)` = 30ms across the band. A tile with no reading passes
  `value={undefined}` so `StatTile` draws its `emptyText` and the count-up never
  runs. `emptyText` is **"No data"**, not the primitive's default "No reading":
  "No data" is the shipped string (ledger S09-5..8) and strings move, they do not
  get rewritten. Nothing animates a tile's width or height.
- Each tile carries its predicate as `note` (`"{acc}/{sent} · 7d"`,
  `"{n} sendable"`, `"{in} in / {out} out · 7d"`, the governor's mode badge +
  headroom) and Accept carries its `delta` with the arrow glyph — `StatTile`
  draws `deltaUp`/`deltaDown`/`minus`, which replaces the `▲ ▼ ±` characters the
  source printed. The delta text `"{n} · 30d"` is unchanged.
- The source draws no series on these four, so no tile takes `spark`. The one
  place the source *has* a series is the per-lane Volume card, and the spark is
  drawn there.
- **Lane rows are cards** — Volume is `.dirb-cards` of `Card className="dirb-lift"`:
  the lane name on the left, its figure mono and right-set, and the `24h: {n}`
  line as a mono state label wearing `.dirb-working` with
  `data-live={lane.sent_24h > 0}`, so a wash sweeps under it while the lane is
  sending and settles flat when it stops (ref: Card Status List, isaiahbjork).
- **Charts** — every chart is the same chart on the same data, re-housed in a
  `Card` under its `Block` eyebrow: the funnel (only Sent→Accepted carries the
  `%` arrow; the later steps stay neutral `·` separators), the two gauges
  (including the un-clamped over-cap geometry, its hatched overflow and its cap
  tick), the sparkline (same peak index, same heights) and the pipeline bars.
  Palette is token-only: **severity keeps its hue** (it is a live signal), and
  the accent marks the current series (the spark's peak bar). **A category is
  never a colour**, so the per-lane `LANE_DOT` hexes and the four `data-cat`
  legend swatches are gone; lanes are told apart by their labels, which is the
  form the legend already had. The Pipeline legend keeps its three marks: those
  encode SEVERITY (5d+ / 2-5d / under 2d), not a category.
- **Empty / error / loading** — `EmptyState` with `ghosts` for "No funnel data
  yet.", "No pipeline data.", "No governor data.", "No campaigns." and the
  no-data screen; `Banner tone="urgent"` for the raw error text (top level and
  inside `RangeSummary`); `SkeletonRows` for both loading states, with the
  shipped `Loading…` string carried as the accessible label.
- Both `.ov-duo` pairs and the right column survive as `.s09-duo` / `.s09-col`:
  one column on a phone, two from 900px, from the same parts.

### Lanes and Log (`legacy.tsx`)

Not rebuilt, per the brief. `LogView`, `LaneDetail`, `InboundDetail` and the
lanes body are **not exported** from `src/screens/SendsScreen.tsx` and a builder
may not edit `src/screens/**`, so they are copied here instead of imported. The
only edits are the three-level import paths and lifting the lanes body (inline
JSX in the shipped `SendsScreen`) into `LanesView` with identical markup, class
names and props. Their inline hex palette and their `.sc-*` / `.log-*` classes
are deliberately untouched. See seam request 1.

Unicode marks in both new files are written as `\u` escapes (`·`, `—`,
`→`, `∞`, `−`, `…`, `‹`, `›`, `⚠`) so no
literal glyph sits in the TSX while every rendered string stays byte-identical.

---

## Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| Figure count-up | tile mounts / its reading changes | `animate(motionValue, to)` in `Figure` (`overview.tsx`) | text content only (no layout) | 180ms (`DUR`) | `ease` `cubic-bezier(.25,1,.5,1)` | no |
| Band stagger | tile band mounts | `delay: stagger(i)`, i = 0..3 | animation start offset | 30ms step (`STAGGER`) | n/a | no |
| Reduced motion | OS setting is `reduce` | `Figure` seeds the value at the reading and animates with `duration: 0` | text content | 0 | n/a | no |
| Sub-view marker | Overview / Lanes / Log switch | `Segmented` `layoutId="s09-view"` | transform | spring 400/32 | spring | no |
| Window marker | 7d / 30d / Custom switch | `Segmented` `layoutId="s09-range"` | transform | spring 400/32 | spring | no |
| Card lift | hover / active on a Volume or Seat card | `.dirb-lift` (CSS, `dir-b.css`) | background-color, border-color, transform | 120ms (`--ds-dur-hover`) | `--ds-ease` | no |
| Working wash | a lane has sent inside 24h | `.dirb-working[data-live="true"]::after`, `@keyframes dirb-sweep` (`dir-b.css`) | transform | 1400ms | `--ds-ease` | **yes** |
| Loading shimmer | a fetch is in flight | `SkeletonRows` (`ds.css`) | the system shimmer | `--ds-dur-slow` | `--ds-ease` | **yes** |

Nothing on this surface animates width, height, top, left, margin or padding,
and no rule uses `transition: all`. The gauge and bar fills set `width` as a
static style and never transition it.

**Logged decision on "at most one continuous loop per surface":** the working
wash is one rule with one keyframe, but it can be wearing more than one lane card
at a time when more than one lane has sent inside 24h (at most four, and only
while they are actually sending). `.dirb-working[data-live]` is the class the
direction ships for exactly this row state, and telling the truth about which
lanes are running is worth more than holding the count at one. It is also the
only loop that ever coexists with the skeleton shimmer, and they never render at
the same time (the shimmer is the pre-data state).

---

## Ledger: all 24 items of `S09.md`

| # | Kept | How |
|---|---|---|
| S09-1 | yes | `SkeletonRows rows={4} label="Loading…"` — the string moves to the accessible label; the brief mandates `SkeletonRows` for loading. |
| S09-2 | yes | `Banner tone="urgent" icon="error" title={error}` — raw caught message, unchanged. |
| S09-3 | yes | `EmptyState ghosts` with the full sentence verbatim as its title. |
| S09-4 | yes | `Block label="Decision" tail="where do I stand right now"`. |
| S09-5 | yes | Accept tile: `r7`% counting up, `BarGauge`, `{acc7}/{sent7} · 7d`, delta arrow + `{|trend|} · 30d`, 4-state severity pip, "No data". |
| S09-6 | yes | Governor tile: `{used}/{cap}`, over-cap `Gauge`, mode `Badge` (NORMAL / WARM-ONLY / COLD-PAUSED / CAP REACHED), "{n} left today", "{pct}% of cap" pill, "No data". |
| S09-7 | yes | Runway tile: days or `∞` (no count-up on `∞`, there is no number to count), meter, red<2d / amber<5d / green, "No data". |
| S09-8 | yes | Refill tile: `{rate}x` to two decimals, half-mark meter, "· empty in {n}d" in urgent, green≥1.2 / amber≥1 / red<1, "No data". |
| S09-9 | yes | `FunnelPlot`: Invites → Accepted (only step with `%`), then neutral `·` to Convos and Calls; empty state "No funnel data yet." with the `7d` tail. |
| S09-10 | yes | All three caption lines verbatim (era totals, 30d + scan opens + last open, the Ivan-era note). |
| S09-11 | yes | `Table` with Day / Invites / Accepted / DMs / InMail / Cap, "Today" label, quiet zeros, `{used}/{limit}` or an em dash, "−{n} burned", and the totals row last. Still returns `null` at `rows.length === 0`. |
| S09-12 | yes | The Invites-vs-Cap explainer, verbatim. |
| S09-13 | yes | `RangeSummary`, still gated on `timeframe==='custom' && range`, still its own `fetchRangeKpis`, with loading / error / populated. |
| S09-14 | yes | Volume cards: `laneCount()` for 7d / 30d / custom range, `24h: {n}`, the sparkline with its peak bar. |
| S09-15 | yes | Legend (lane labels) + "Total: {n}". **The colour swatches are dropped** — a channel is a category, and this direction forbids a category a colour. The labels carry the same information. |
| S09-16 | yes | Pipeline per-lane bars, severity-coloured by lane runway, "sent · 7d {n} · 30d {n}", "No pipeline data." |
| S09-17 | yes | "{n}d runway" / "runway ∞" as the block tail. |
| S09-18 | yes | Legend 5d+ / 2-5d / under 2d (marks kept: severity, not category) + "Total: {n} sendable". |
| S09-19 | yes | `GovGauge` cards: gauge, mode badge, `{used}/{cap} {window}`, cap + cohort line (including "cohort: not enough data yet (opens ~MM-DD)"), the shared-counter gate note, the daily brake sub-gauge, headroom line in both window shapes, the monthly line. "No governor data." |
| S09-20 | yes | Seat cards select the client (`setClient`), carry `selected`/`neutral`, mode badge, gauge, window text, Cohort accept, Reply 30d + sub, Pipeline + runway, 24h vol. Now a `Card` with `.dirb-lift`. |
| S09-21 | yes | "What we filter on →" link, still hidden when `getExpVariant()==='stock'`, still `stopPropagation`. |
| S09-22 | yes | Campaigns as a `Table`: name, ACTIVE/PAUSED `Badge`, "7d {n}", total. "No campaigns." |
| S09-23 | yes | The expander is a quiet `Button` reading "+ {n} paused, 0 sent" / "− {n} paused, 0 sent" and it toggles the same `showPaused`. Still absent entirely when `client==='ivan'` (the hidden set is empty there). |
| S09-24 | yes | "{shown} of {n} campaigns shown" and "Total: {n} sent", computed from the same sets. |

Nothing in the ledger was dropped. The only losses anywhere are the two the
direction requires: **category colour** (lane dots and the Volume legend
swatches) and **the range pill's menu-open state**, both logged above.

---

## Seam requests

1. **Export the Lanes and Log views from `src/screens/SendsScreen.tsx`.** Only
   `SendsScreen` is exported today, so keeping S08 and S10 "as they are" forced a
   copy into `legacy.tsx`. Four exports — `LogView`, `LaneDetail`,
   `InboundDetail` and a `LanesView` lifted from the existing JSX — would let
   this file be deleted and the shipped components imported directly, which is
   what the brief actually asks for. Only the orchestrator can make that edit.
2. **`StatTile` has no slot for a mark or a meter.** The Accept / Governor /
   Runway / Refill tiles each carry a severity dot and a gauge that the source
   drew inside the tile; with no `tail` or `children` on the primitive they are
   drawn by a `.s09-tile` wrapper around it. A `tail` slot (for the severity pip)
   and a `foot` slot (for the meter) on `StatTile` would delete that wrapper and
   the CSS behind it.
