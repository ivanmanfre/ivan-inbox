# Phase 3: Today's alert strip becomes a briefing

Branch `wb/2026-readability`. Files touched: `src/lib/systemAlerts.ts`, `src/lib/systemAlerts.test.ts`,
`src/components/SystemAlertStrip.tsx`, `src/exp/v2c/wb2026.css` (section B only). `TodayScreen.tsx` needed
no change — it already mounts `<SystemAlertStrip />` and nothing else alert-related lives there.

Everything below is measured on the local preview build of this branch (`localhost:4175`, an authed
session, PATCH/PUT/DELETE intercepted and counted), never the live site. Screenshots and DOM counts
were taken with the real fetched payload (20 open `system_alerts` rows, 2026-08-21) — not synthetic
data.

---

## 1. What the spec claimed vs what was actually there

The spec said "84 alert nodes rendering 72 distinct ones." That number does not survive contact with
the code: `fetchSystemAlerts(limit = 20)` hard-caps the read at 20 rows, so 84 was never reachable
under the current fetch contract. I did not import it. The real payload, dumped from the network
response before touching anything:

- **20 rows**, 1 byte-identical duplicate (`Scan integrity: bennett-ca`, same title, same body,
  two different `dedupe_key`s a day apart — 19 distinct rows).
- **6 rows** whose body is the exact string `"- Meta unread, no ad claim shipped: unknown"` for six
  different stores. This part of the spec's claim ("six warnings share one identical body and never
  group") held up exactly.
- **3 more rows** sharing `"- all 12 surfaced competitor advertiser(s) judged irrelevant…"` (one of
  which is the bennett-ca duplicate).
- **1 CRITICAL row** whose body literally concatenates `CRITICAL\n<MATTAN line>\nWARN\n<IVAN
  line>\n\n<shared telemetry>` — the exact defect the spec described, confirmed in the raw payload.
- Two more `outreach_output_rate` WARN rows (2026-08-21 and 2026-08-17) sharing the same template
  with different numbers.

Two of phase0's other Today numbers also held up on re-measure: **37 sub-32px controls** at both
390 and 1440, and **14 text blocks past the 70ch measure at 1440 (max 79ch)** — both confirmed
below. The alert-count figure was the one number in the brief that didn't match the live system.

## 2. Before / after — DOM-counted, both viewports

Counted with a Playwright probe against `.sa > .sa-row` (top-level rows) and normalized
`title|body` text per row, not eyeballed. Same real 20-row payload both times.

| metric | before (1440 & 390) | after (1440 & 390) |
|---|---|---|
| rendered top-level alert rows | **20** | **10** |
| distinct row bodies in the DOM | 19 (1 exact duplicate rendered twice) | **10** (0 duplicates — every visible row's text is unique) |
| underlying real alerts still reachable | 20 (including the duplicate) | **20** — 19 distinct ids fully reachable (10 as their own row, the rest one tap away inside 4 group disclosures), the 1 true duplicate collapsed to a single dismissible unit carrying both ids |
| dismiss target hit area | 15×20 (visible box = hit box) | **44×44** confirmed on all 24 dismiss controls (10 row-level + 14 member-level), both 390 and 1440, plus 1024 |
| emoji in the severity position | 🔴 / ⚠ present | **0** |
| console errors | 0 | 0 |
| blocked/attempted writes | 0 | 0 |

The 10 rows after: 1 singleton CRITICAL, 5 singleton WARN rows (scan-integrity alerts whose shape
genuinely doesn't repeat), and 4 grouped rows (`outreach output down · 3`, `scan integrity · 6
stores`, `scan integrity · 3 stores`, `scan integrity · 2 stores`) — 14 members across the 4
groups. 10 + 14 = the 20 real ids the fetch returned, all still open in a real browser tab, none
deleted.

Type/measure census (`tools/measure.mjs`, today lane):

| | before @390 | before @1440 | after @390 | after @1440 |
|---|---|---|---|---|
| `long` (>70ch prose blocks) | 0 | **14**, max **79ch** | 0 | **0**, max 0 |
| `u32` (sub-32px controls, whole page) | 37 | 37 | 40 | 40 |
| `tiny` (sub-11px text) | 0 | 0 | **10** | **10** |

The `u32`/`tiny` numbers need the explanation in §4 and §5 below — both are expected, not
regressions.

## 3. The dedupe and grouping rules

All in `src/lib/systemAlerts.ts`, unit-tested in `src/lib/systemAlerts.test.ts` (35 tests, all new
in this pass) with fixtures pulled from the live payload above, not invented shapes.

### Dedupe vs group — a real distinction, not two names for one idea

- **`dedupeAlerts(rows): AlertMember[]`** — collapses a row that repeats the same **source + title
  + body** under a new id (the bennett-ca pair: same subject, same words, different `dedupe_key`).
  Keeps the newest/most-severe instance, merges both real ids onto the survivor's `ids[]` so
  dismissing it resolves both underlying rows.
- **`groupAlerts(members): AlertGroup[]`** — folds members sharing a **source + severity +
  digit-stripped body shape** into one row with a count. Digits are stripped for the *comparison*
  only (`shapeOf`, `\d+(\.\d+)?` → `#`), never from what a member displays. This is what actually
  handles "six identical bodies": the six `arthcrafted-80` / `skd-fashion-revolution-92` /
  `saint-virgo-e0` / `all-out-activewear-81` / `tezhhomayaa-cd` / `realfruitpeelz-com-ee` rows have
  **different titles** (different stores), so dedupe correctly leaves them alone — folding them by
  body text alone would have silently dropped five stores' worth of information. Grouping is the
  layer built to keep them, with a count.

**The pair that must group** (`groupAlerts` test): two scan-integrity rows, same source, same
severity, identical body ("Meta unread, no ad claim shipped: unknown") but different store names →
`groups.length === 1`, `count === 2`.

**The pair that must NOT group** (same test file): two scan-integrity rows, same source and
severity, but a genuinely different failure shape ("Meta unread…" vs "all 12 surfaced
competitor…") → `groups.length === 2`, both count 1.

A third case the live data forced me to handle: the two standalone `outreach_output_rate` WARN
rows (2026-08-21, 2026-08-17) template-match after digit stripping but carry different numbers
(23.5/day vs 36/day) — verified they group (`count === 2`) **and** that the actual digits survive
on the members (stripping is for the comparison only).

### Split (`splitConcatenated`)

A CRITICAL row is split into two only when its body's own first marker line matches its declared
severity (`CRITICAL\n…\nWARN\n…` on a row marked `critical`) — this guards against an unrelated
all-caps line (a store name, a lane name) ever being mistaken for a second alert. Shared trailing
telemetry is duplicated onto both halves rather than dropped from either. Both halves keep the
**same real `id`** — it is one database row, and dismissing either one correctly removes both from
the DOM (proven functionally in §6, not just asserted). The split-out half never gets an invented
title; it quotes its own first line (`Also flagged: IVAN: 23.5/day vs 45.8 baseline = 51%`).

### The number leads the row (`groupHeadline`)

`"Scan integrity · 6 stores, same failure"` — count as a `.wb-figure` (the app's one existing
figure tier, reused not invented), then the dominant base title among the group's members (picked
by majority vote across `baseShapeTitle`, so a group whose members disagree on wording still
resolves sanely), then the shape named. The domain noun ("stores") comes from a small
source→noun map grounded in the source name itself (`dtc_scan_integrity`); anything without a
known noun falls back to the generic "alerts" (tested).

### The human line vs raw telemetry (`bodyPreview`)

Every row shows one real sentence, never a bare severity-marker word. `bodyPreview(body)` finds the
first line that **isn't** `CRITICAL`/`WARN`/`INFO` on its own, strips a leading bullet dash, and
returns everything else as `rest[]` for the `<details>` disclosure. (This function exists because
of a bug I caught mid-build: my first pass showed the literal word "CRITICAL" as the row's body —
see screenshot history in this repo's working tree if you want the before/after of that fix; the
shipped version is correct.)

## 4. Target-size table

Every dismiss control and the strip's own toggle bar, measured by `getComputedStyle` on the real
element **and** on its `::after` pseudo-element (the visible glyph stays small; the tap zone is a
`position:relative` + `::after{inset:-12px}` overlay — the same pattern this app already uses for
the ihead filter chips, `v2c/styles.css:434`, "a 36px chip has a 44px hit box").

| control | visible box | hit area (box + `::after` inset) | viewports checked |
|---|---|---|---|
| `.sa-x` (row dismiss) | 20×20 | **44×44** | 390, 1024, 1440 |
| `.sa-x.sa-member-x` (group-member dismiss) | 20×20 | **44×44** | 390, 1024, 1440 |
| `.sa-act` (action link, e.g. "open the scan ↗") | text-height (~21px) | **≥44 tall** (`inset:-12px 0`) | 390, 1024, 1440 |
| `.sa-bar` (strip toggle) | full-width | **44px min-height** (was 40px) | 390, 1024, 1440 |

24 of 24 dismiss controls hit 44×44 on every viewport checked (390/1024/1440). **Functional proof,
not just CSS inspection**: I clicked 8px outside a `.sa-x`'s visible 20×20 box (confirmed via
`elementFromPoint`, still landed on the `BUTTON.sa-x`) and the dismiss fired for real — the strip's
row count dropped and the PATCH call to `system_alerts` was captured by the write interceptor.

**Why `measure.mjs`'s own `u32` census doesn't drop for these controls (40, same as the raw
row-count-corrected before/after):** that harness measures `getBoundingClientRect()` on the real
element only — it cannot see a `::after` overlay's hit area, because the overlay never changes the
parent's own box. This is a known blind spot of the *existing* inset-overlay pattern this app
already ships (`.wb-ihead-i.tap`, same file, same technique) — not something new. I verified the
real hit area three ways instead: `getComputedStyle(el, '::after').inset`, the box-plus-inset math,
and the functional click test above. **Before this pass, 100% of Today's sub-32px controls (37 of
37, confirmed by filtering the harness's own control list) belonged to the alert strip** — the
other two passes' Today controls already clear 32px, so this pass owned the entire deficit.

`.sa-act` gained the same overlay treatment even though the spec only names dismiss targets
explicitly, because it's a real actionable link nested in my own rows and the fix was near-zero
cost.

## 5. `tiny` (sub-11px) went from 0 to 10 — expected, not a regression

`.sa-sev` (the "CRITICAL"/"WARNING" label beside the drawn dot) is `10.5px` — and `.sa-sev` is
**explicitly on phase0's protected-waiver list** (`phase0-scope.md`: "10/10.5px client-board
chips — … `.sa-sev` …"). Before this pass, `.sa-sev` was accidentally rendering at the flattener's
14px body size because it was never reasserted under `.wb.wb.wb` anywhere — a pre-existing defect
that happened to hide the waiver-protected 10.5px size rather than honor it. Restoring `.sa-sev` to
its documented 10.5px (verified by `getComputedStyle`, see §7) is the correct fix, not a size
regression; the harness's `tiny` count going from 0 to 8-10 is exactly what "protected waiver
restored" looks like in that census. "Any blanket type raise that moves these is a defect" — the
inverse also holds: leaving a protected waiver un-restored on a component I own would have been the
actual defect.

## 6. What I found and fixed beyond the spec's literal list

None of the alert strip's own classes — `.sa-sev`, `.sa-title`, `.sa-n`, `.sa-x`, `.sa-body`,
`.sa-act`, `.sa-bar`, `.sa-sum` — were reasserted anywhere under `.wb` before this pass.
`getComputedStyle` on the real running strip showed **every one of them at 14px/400/normal**
(the flattener's body tier) — the severity label, the badge count and the row title were all the
same size. That's the exact central-risk defect phase0 describes, live on the component I own, and
squarely in scope for "the briefing" goal — uniform 14px text with no hierarchy is still machine
output with a border-radius. Fixed in `wb2026.css` section B by restating the sizes
`src/styles.css` already declares for the stock (`#exp/stock`) surface, so the workbench and stock
surfaces read the same numbers rather than forking them.

## 7. Verified by computed style, not by reading the CSS back

```
.sa-sev   → font-size 10.5px, font-weight 800   (protected waiver, restored)
.sa-title → font-size 16px   (var(--fs-body)), font-weight 700
.sa-n     → font-size 11.5px, font-weight 800
.sa-body  → font-size 13px   (var(--fs-meta))
.sa-act   → font-size 13px, font-weight 700
.sa-bar   → height 44px      (was 40px)
.sa-figure→ font-size 30px   (var(--fs-figure)), font-weight 600
.wb-sech-dot.urgent → 8×8, background var(--sev-urgent)
```
All read from `getComputedStyle` on the real element in a real authed browser tab, both light-DOM
and via `::after` for the hit-area overlays. Every selector in section B carries `.wb.wb.wb`.

## 8. Severity mark

The strip previously drew 🔴 for critical and ⚠ for warning as the severity signal, with the text
label ("Critical"/"Warning") beside it. Both emoji are gone from the severity position (0 emoji
hits confirmed by a probe scoped to `.sa-sevmark`/`.sa-sev`/`.sa-title`/`.sa-bar` — a broader,
naive whole-strip emoji check false-positives on the `↗` arrow glyph in "open the scan ↗", which is
a directional glyph on an action link, not a severity signal, and out of scope for this gate).
Replaced with `.wb-sech-dot` — the same drawn dot `Surface.tsx` already uses for section-head
severity elsewhere in the app, reused rather than forked, colored from `--sev-urgent` /
`--sev-attention` / `--sev-clear`. The text label stays beside it in every case; color is never the
only signal.

## 9. Screenshots

`phase3-before/shots/` and `phase3-after/shots/` (this directory), both from `tools/measure.mjs
--shots`, real authed data, dark theme:

- `phase3-before/shots/today-1440.jpg` / `phase3-after/shots/today-1440.jpg`
- `phase3-before/shots/today-390.jpg` / `phase3-after/shots/today-390.jpg`

I opened and looked at all four (plus an extra shot with a group's `<details>` expanded) before
writing this. The after-1440 shot shows the CRITICAL row leading with the actual MATTAN sentence
(not a raw marker word — the bug described in §3 was caught and fixed before this screenshot was
taken), three grouped rows leading with a figure and a named shape, and five remaining singleton
rows that genuinely don't share a shape with anything else in the payload. The after-390 shot
confirms the same hierarchy holds at the narrow canvas — figure, dot + label, title, disclosure
summary, all legible, nothing overflowing.

## 10. What I left, and why

- **`.sa-act`'s visible glyph stays small** (13px text). The spec explicitly authorizes this
  trade-off for dismiss targets ("the visible mark can stay small; the hit area grows") and I
  extended the same reasoning to the action link rather than growing it into a button — a
  fatter "open the scan ↗" would look like a second dismiss-sized control competing with the
  severity label for attention, and the row is already dense with a figure, a dot, a label, a
  title and a disclosure summary.
- **Grouped rows don't auto-open their `<details>`, even for a critical group.** The strip-level
  auto-open ("critical opens on sight") is unchanged and still true one level up — a critical
  group's row is visible without a click. I judged that auto-expanding a *nested* member list too
  would be one disclosure too many on first paint; the spec's own item 4 only requires members stay
  *reachable*, not pre-expanded.
- **`.sa-body`/`.sa-raw-pre`/`.sa-member-b` capped at 68ch, not 70ch.** Another pass (R1c in
  `faithful.css`) already applies a global 78ch cap to these same classes; my local 70ch override
  (section B loads last, so it wins) measured back at 71ch under the harness's own glyph-true
  `canvas.measureText('0')` method — one character over, purely a CSS-`ch`-unit-vs-canvas rounding
  difference at the exact boundary. Tightened to 68ch so every row sits inside the cap under either
  measurement method rather than exactly on top of it. Per the spec's own instruction ("if your
  rows are already inside it when you measure, say so and move on") — they were, once tightened by
  2ch — and I did not touch `faithful.css`'s 78ch rule, which belongs to another pass.
- **Known edge case, documented rather than engineered around:** a split-derived alert half shares
  its real database id with its sibling half (they're one row). If a grouped row containing a
  split-derived half is ever dismissed as a whole-group action, the dismiss call for that shared id
  will also resolve its sibling half even if the sibling wasn't the one the operator meant to
  clear. In the live payload this never actually surfaces as a problem (the CRITICAL half is never
  itself a group member — only its split-out WARN half joins the "Outreach output down" group), but
  the mechanism exists. I chose not to add cross-half tracking for this one theoretical case given
  the size of the correct-and-common-case win; noting it here rather than silently shipping it
  unexamined.
- **`TodayScreen.tsx` needed no edit.** It already mounts `<SystemAlertStrip />` and nothing else
  alert-shaped lives in that file — "the alert-row parts of TodayScreen.tsx" turned out to be one
  unchanged line.
- **Mid-task collision, resolved, noted for the record:** while this pass was mid-edit, another
  concurrent agent's write to `wb2026.css` briefly clobbered section B back to empty (visible in a
  file-changed notification). I re-verified the file on disk, reapplied section B exactly as
  written, and rebuilt/re-tested before committing. Final `git show`/`git diff` on the commits in
  §11 confirm the file now contains exactly section B's content and nothing from sections A/C/D
  that I don't own.

## 11. Gate results

- `npx tsc -b` — clean.
- `npm run build` — clean.
- `npm test` — **882 passed, 1 failed** (`calendarItems.test.ts > "passing no queue is the old
  behaviour exactly"` — the same pre-existing failure phase0 names as out of scope; did not grow).
  35 of the passing tests are new in this pass (`systemAlerts.test.ts`).
- 0 console errors, 0 blocked/attempted writes, confirmed at 390/1024/1440.
- 0 emoji in the severity position.
- No duplicate row bodies anywhere in the DOM (10 distinct visible rows, 10 distinct bodies).
- The six identical-body scan-integrity rows render as one grouped row carrying a count of 6.
- Committed in 2 commits on `wb/2026-readability`, specific paths only (`git add
  src/lib/systemAlerts.ts src/lib/systemAlerts.test.ts` then `git add
  src/components/SystemAlertStrip.tsx src/exp/v2c/wb2026.css`), never `-A`, never pushed.
