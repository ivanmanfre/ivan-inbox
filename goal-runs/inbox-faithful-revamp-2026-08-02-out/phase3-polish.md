# Phase 3 — polish pass, desktop + mobile

Goal-run `inbox-faithful-revamp-2026-08-02`. Executed in the MAIN loop (the account session limit killed
agent dispatch mid-run; commits every few minutes were the recovery discipline). Six commits on
`exp/vis-faithful`; every Phase 0 finding cited by number.

| commit | what |
|---|---|
| `6dfe8dd` | triad boot default + triad's cat-4 passes the body bar |
| `a6097eb` | 10 classes → real buttons, hover contract executed, focus ring reaches everything |
| `f7dd7b3` | readability: axis short-codes, title clamp, quote/teaser clamps, `#null` dies |
| `1b07a38` | mobile: 44px exits and targets, log chip stops bleeding off-screen |
| `4b594b5` | the approve beat wired for real; loading loops on the one easing |
| `c500a9f` | active stage filter opens its own section (determinism) |

## 3a — the two locked decisions land

- **Triad is the boot default** (`Shell.tsx` cat effect): absence of any signal = triad; `?cat=` persists
  to `wb-cat`; mono stays built and reachable, undocumented.
- **The `wb-cap` badges pass INSIDE the triad answer** (spec amendment): triad's own `--cat-4` goes
  `#747977 → #6C716F`. Harness math: white ink **4.97:1** (was 4.43, bar 4.5); as a mark
  3.98/3.70/3.43/**3.12**:1 on canvas/s1/s2/s3 (bar 3.0). MONO's published hexes untouched (§9 exact-hex
  rule holds for the balloted answers; triad's 4th slot was never in §9.3's three).

## 3b — hover/press/focus (phase0-errors-hover Task B)

Ten classes had no hover; **zero** custom controls were keyboard-reachable. Now: `.chip`, `.sg`, `.sw`,
`.csend`, review `.btn`s, `.ct-alert`, `.wb-ofresh`, `.wb-sech.tap`, the takeover `.back` are real
`<button>`s behind a `:where()` zero-specificity reset (class looks byte-identical — verified by
computed-style + screenshot in BOTH the workbench and the stock app). §7.4 bg-shift at
`--dur-hover`/`--ease` on all of them; press = brightness dip, `transform:none` unified (the surviving
press-squishes killed); the global focus ring now reaches **70 buttons** (live-verified: focused chip
shows `rgb(16,163,127) solid 2px`). The Settings switch slides again at `--dur-state` — the blanket
transition kill had frozen it (scout's "likely unintended collateral," confirmed and fixed).

## 3c — readability (phase0-readability #1-#6, #9)

- **#1 legend clip (the "PUBLIS" class):** the capsule axis wears short stage codes (`STAGE_SHORT` /
  `LM_STAGE_SHORT`, beside the label tables they shorten), full names stay on section headers and the
  `title` tooltip; chart max-width 320→460 in the now-fluid card.
- **#2 title crush:** two-line clamp replaces the single-line clip — a crushed title reads ~40 chars
  instead of ~20; at full width most stay one line and a wrapped row (~56px) holds the 40-60 band.
- **#3 `.ct-subtle` 111-180ch lines:** fluid block, capped measure (`max-width:72ch`).
- **#4 `.td-next` 9× overflow / #9 `.td-qs` single-lined replies:** two-line clamps; the quote also gets
  a 2px hairline quote-rule so quoted material stops reading as system caption (**#6**).
- **#5 `#null` Ops labels:** a NULL `slack_channel` now falls back to the engine label
  (`OpsScreen.tsx`).
- Bonus: `.td-qown` was ACCENT text — §5.2 violation on the base sheet; now `--text4`/500.

## 3d — mobile (phase0-mobile #2/#3/#5/#6/#10)

Takeover back: 6×20px glyph → real 44px button (`.wb-back`). Gear/sync/pane-✕ get invisible 44px pads.
Skip/Approve ≥44px tall at ≤767px. The DM-log kind chip clips end-wise inside its fixed column instead
of starting at x=−5.6px. (#1 — content buried under chrome — was closed by Phase 1's wall kill.)

## 3e — motion

- **The one choreographed beat EXISTS now**: `wb-approve`/`wb-count-tick` were dead CSS
  (phase0-errors-hover Task C); `ReviewActions` plays the beat on approve — row lifts over `--dur-beat`,
  refetch fires when the movement ends, the section count ticks. Skip just leaves (intensity ∝ rarity).
  `prefers-reduced-motion` skips the delay entirely.
- **Loading loops join the contract**: the thinking dot was borrowing the shimmer's `translateX`
  keyframes (it slid, not pulsed) at 1.3s `ease-in-out`; both loops now run on `var(--ease)` at 1.2s,
  opacity/transform only. Stated carve-out: §10.2 caps transitions; indeterminate loading/live loops
  are licensed on loading indicators only, on the one easing token. (The old voice sheet's un-scoped
  easings sit in unmounted components — not conformed, noted.)

## 3f — determinism (phase1-review residual)

An active stage filter forces its section open on both lanes. Measured: `stage=published` renders
**156 cards before AND after reload** (was 4 vs 47).

## Deferred to Phase 6 (needs agents / full instrument pass)

Census re-run at both widths, fresh blind row-find + mobile polish judge at 390, default-app regression,
secret grep, overflow sweep. Gates at this point: `tsc` clean, `npm test` 421/421, lint no new warnings
from touched files.
