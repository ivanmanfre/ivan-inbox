# SystemAlertStrip: the auto-expand blast radius

Branch `wb/polish`, main worktree. Measured on production builds (`npx vite build`),
1440x900, authed with `.session.json`, write interceptor armed on `**/rest/v1/**`
and `**/rest/v1/rpc/**` before every navigation.

## The two numbers

`#exp/v2/today`, work area (`.rows.td-rows`) is 780px tall and scrolls internally.

| | strip height | share of work area | first work-queue item y |
|---|---|---|---|
| before | **1485px** | 190.3% | **1836** (956px under the 880 fold) |
| after | **157px** | 20.2% | **508** (visible, 372px above the fold) |
| after, reader collapses | 44px | 5.6% | 395 |

The first work-queue item is the never-opened callout, "8 people wrote and were
never opened here." Before the fix it was a full screen and a half below the
fold. After it, it is the first thing under the masthead, with five triage rows
and the Next call card also on screen without scrolling.

Both numbers come from `getBoundingClientRect` on the running build, not from
source. Probe: `evidence/audit-tools/alert-strip-measure.mjs`, raw output in
`out-alert-strip-before.json` / `out-alert-strip-after.json`.

## Root cause, and why it needed a state machine

`src/components/SystemAlertStrip.tsx:153`:

```ts
const isOpen = open || groups.some(g => g.severity === 'critical')
```

Two defects in one expression.

**Blast radius.** The live payload shapes into 10 groups: 1 critical group
(2 members) and 9 warning groups (19 members). Any critical made `isOpen` true
for ALL 10, which is the 1485px above.

**The control was inert.** `open` starts false and `||` short-circuits, so
`setOpen(!isOpen)` could never make `isOpen` false while a critical existed.
Pressing the bar to collapse did nothing. Confirmed live before the fix: two
successive bar presses left height, row count and chevron byte-identical at
1485px / 10 rows / `⌄` (`out-alert-strip-before.json`, `afterBarClick` and
`afterSecondBarClick`).

A boolean expression has no way to represent "the reader closed this", so the
fix is a state machine written as one:

```ts
type AlertStripState = { choice: 'all' | 'collapsed' | null; acked: string[]; open: boolean }
```

`choice` is what the reader last asked for; `acked` holds the keys of the
critical groups that were on screen at the moment they collapsed. The reader's
choice is read FIRST, so a collapse is state rather than a term something else
can override. A critical whose key is not in `acked` still re-opens the strip,
so a NEW critical wins over a collapse while the one they already dismissed
from view does not.

A group key is its failure SHAPE (severity + source + digit-stripped body).
That is deliberate: a second store failing the check the reader already
collapsed is the same alert, not a new one, and must not re-open over them.

The comment's stated intent is kept. A critical still opens on sight with zero
clicks; only the nineteen warnings behind it now wait at the summary line. The
chevron was changed to answer "is there more than this" rather than "is
anything showing", because "one critical open, nineteen warnings hidden" has to
read as more-to-come.

## Route taken: (a), scoped to the workbench shell

`SystemAlertStrip` takes `autoOpen?: 'all' | 'critical'`, default `'all'`.
`TodayScreen` passes `threads === undefined ? 'all' : 'critical'` , the SAME
discriminator every other workbench-only prop on that screen already rides
(`threads`/`opsDrafts`/`onOpenThread`/`onOpenContent`, see the p4c note at
TodayScreen.tsx:842). No second mechanism was invented, and #exp/stock passes
no props, so it keeps `'all'`.

Route (b) was not taken. The stock behaviour IS a defect there too, but the
pixel-identical gate has already been verified once this run, and the fix is
available to stock later as a one-word prop change. Breaking a verified gate to
buy something that is one word away is a bad trade.

### The gate holds: 0 differing pixels

`#exp/stock` Today, captured in the same 1440x900 window off the before-build
and the after-build:

```
NOISE FLOOR (before build, two captures): differing 0 / 1296000, maxChannelDelta 0
NOISE FLOOR (after build, two captures):  differing 0 / 1296000, maxChannelDelta 0
SIGNAL (before build vs after build):     differing 0 / 1296000, maxChannelDelta 0
```

The render is deterministic (noise floor is exactly zero), so the zero signal is
a real result and not a threshold being met. Stock's strip is still 921px tall
with all 10 groups open and its bar still inert, exactly as before. Shots in
`evidence/alert-strip-shots/`, diff script `/tmp/p5-diff.mjs` (canvas decode,
no image library in this tree).

Four unit tests pin stock's old truth table, including that its collapse is
still inert, so a later edit cannot drift it silently.

## The alert strings are DATA, not chrome. Left alone.

`Scan integrity: rpnzl-1d` and `Meta unread, no ad claim shipped: unknown` are
`system_alerts.title` and `system_alerts.body`, verbatim from the database.

Verified against the live row payload, not by grep alone. Intercepted the
`/rest/v1/system_alerts` response on the running build:

```json
{ "src": "dtc_scan_integrity",
  "title": "Scan integrity: rpnzl-1d",
  "body": "- Meta unread, no ad claim shipped: unknown\n- brand name is a single short word ('RPNZL'); identity matching ran exact-only" }
```

The app constructs neither string. Its only transformations are `cleanTitle`
(strips a leading emoji) and `baseShapeTitle` (drops everything after the first
colon, for group headlines only). Nothing in `src/lib/labels.ts` is involved and
nothing there should be: the writer is the scan pipeline, outside this run, and
there is a standing rule against rewriting stored copy. **No change made.**

## The three "redundant" scan-integrity groups: not a grouping bug

On screen: `Scan integrity · 2 stores, same failure`, `· 3 stores`, `· 4 stores`.

They are three genuinely DIFFERENT failures. Grouping keys on the digit-stripped
body, and the live rows carry four distinct bullet texts plus combinations:

- `- Meta unread, no ad claim shipped: unknown` (arthcrafted-80, skd-fashion-revolution-92)
- `- all 12 surfaced competitor advertiser(s) judged irrelevant...` (bennett-ca x2 deduped, paleonola-3d, air-tea-company-inc-b8)
- `- relevance judge dropped N of 12 competitor candidates...` (satya-blends-59, noisy-clan-e9)
- two-bullet combinations (rpnzl-1d, hive-food-c4, oshun-b2, waverunnrs-b0), each its own shape

So the grouping is correct and nothing merged that should not have. The defect
is one layer up, in what a grouped row DISPLAYS:

1. `groupHeadline` prints `modeBaseTitle`, which cuts the title at the first
   colon. Every scan-integrity group therefore headlines as "Scan integrity",
   discarding the one thing that distinguishes the three.
2. `SystemAlertStrip.tsx:93` gates the body preview behind `!grouped`, so a
   grouped row shows NO body at all. The failure text is behind the disclosure.

Together those turn three different failures into three visually identical rows.

**Not fixed, reported.** The one-line fix is to render the shared preview on
grouped rows too (it is the shape every member shares by construction, so it
invents nothing). It is deliberately left out because it changes what #exp/stock
paints, which would break the same gate route (a) was chosen to protect, and
gating a second unrelated behaviour on `autoOpen` would overload a prop that
currently means one thing. Orchestrator's call.

## Verification

- `npm run build` (runs `tsc -b`) clean.
- `npx vitest run`: **1042 passing, 1 failing.** Baseline was 1029 passing with
  one known pre-existing failure in `calendarItems.test.ts`; that same one is
  the only failure, and the 13 new tests are the delta.
- `npx oxlint`: two new `only-export-components` warnings on the exported pure
  helpers. 22 identical pre-existing warnings already exist in this tree
  (BulkBar.tsx, ChatPane.tsx), so this matches house style rather than
  introducing a new class.
- Screenshots: `after/today-fixed-{1440x900,390x844}-{dark,light}.jpg`.
- **Genuine mutation attempts: 0**, across every probe run. No 401s; the token
  was valid throughout and `tools/refresh.mjs` was never run.

### New tests (`src/components/SystemAlertStrip.test.tsx`, 13)

The pure `alertStripView` / `toggleAlertStrip` helpers are exported so the
transitions can be driven press-by-press. `renderToStaticMarkup`, the pattern
the other component tests in this tree use, fires no events and could not have
reached any of this.

Covered: critical-only auto-open; a critical still opening with no click;
warnings alone opening nothing; the bar press that used to be inert now
collapsing; the collapse surviving a re-poll of identical alerts; a NEW critical
re-opening; a DISMISSED critical not counting as a new one; a new warning not
re-opening; re-expanding from collapsed; and four tests pinning stock's `'all'`
truth table, its still-inert collapse included.

## Note for the orchestrator

`npm run build` writes to `dist/`, which is the bundle the shared
`vite preview --port 4173` was serving while two other agents were measuring.
That server's content changed under them mid-run. My own before/after
measurements were taken on isolated builds (`dist-p5-before` on :4271,
`dist-p5-after` on :4272) specifically to avoid disturbing them, but the final
`npm run build` gate could not avoid `dist/`. Those two directories are build
artifacts and are not committed.
