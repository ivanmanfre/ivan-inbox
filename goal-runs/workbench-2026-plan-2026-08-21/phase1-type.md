# Phase 1 — the type ramp and the measure

**Authorship note.** The implementer agent landed all three code commits, then died twice on API errors (once on a stream watchdog, once mid-response) before it could write this deliverable. Per the run's agent-death ladder the remaining work was taken into the main loop: the numbers below are the orchestrator's own reads of `phase1-after/metrics.json` and `phase1-after-light/metrics.json`, not a summary of an agent's self-report.

Commits: `8069db1` (ramp tokens, relative tier leading, meta/eyebrow unification) · `2b10b23` (v2c literals onto the ramp, padding and radius drift collapsed) · `fcf0446` (three uncapped Today lines).

## What changed at the root

| token | before | after |
|---|---|---|
| `--fs-body` | 14px | **16px** |
| `--fs-meta` | 12.5px | **13px** |
| `--fs-eyebrow` | 11px | **12px** |
| `--fs-title` | 16px | **17px** |
| `--fs-page` | 20px | **22px** |
| `--fs-figure` / `--fs-display` / `--fs-glyph` | 30 / 34 / 20px | unchanged |

**Every tier's leading is relative now.** That is the structural half of this phase and it matters more than the sizes: `faithful.css`'s flatten rule pinned `line-height:20px`, so raising the body token to 16px would have produced 16px type on 20px leading (1.25) across the whole app. The flattener now reads `1.6`, and each tier carries a ratio instead of a pixel: page `1.25`, title `1.35`, body `1.6`, meta `1.45`, eyebrow `1` with tracking raised `.04em → .08em`. A future token move now carries its own leading.

## Computed-style table (measured, not declared)

Read from the real DOM at `localhost:4173` on the branch build, authed, per lane per viewport. Format is `size/line-height-px/weight`, dominant three combos by character count.

| lane | 390 | 1440 | 2560 | tiny | >70ch | overflow |
|---|---|---|---|---|---|---|
| today | 16/25.6/400 · 12/18/400 · 13/18.9/400 | same | same | 10 | 0 / 0 / 6 | 0 |
| dms | 13/18.9/400 · 16/25.6/400 · 16/25.6/500 | same | same | 0 | 0 / 6 / 6 | 0 |
| content | 13/18.9/400 · 16/25.6/400 · 16/21.6/500 | same | same | 0 | 0 / 0 / 1 | 0 |
| magnets | 16/21.6/500 · 16/25.6/400 · 13/18.9/400 | same | same | 0 | 0 / 5 / 13 | 0 |
| styles | 16/25.6/400 · 13/18.9/400 · 17/23/500 | same | same | 0 | 0 | 0 |
| strategy | 16/25.6/400 · 13/18.9/400 · 16/25.6/500 | same | same | 0 | 0 | 0 |
| sends | 13/18.9/400 · 16/25.6/500 · 12/12/600 | same | same | 0 | 0 | 0 |
| ops | 16/25.6/400 · 13/18.9/400 · 16/25.6/500 | same | same | 0 | 0 | 0 |
| settings | 13/18.9/400 · 16/25.6/500 · 17/23/600 | same | same | 0 | 0 | 0 |

`16/25.6` is exactly 16px × 1.6. `13/18.9` is 13 × 1.45. `12/12` is the eyebrow at ratio 1. `17/23` is 17 × 1.35. **The ramp landed as declared, on every lane, at every viewport, in both themes.** Console errors 0, real overflow 0, attempted writes 0 throughout.

## Before and after, by rendered mass

Baseline (`phase0-baseline`), characters per combo across the sampled top-tens: `14/21/400 = 48,760` · `14/20/400 = 25,698` · `13/18/400 = 14,295` · `13/19.5/400 = 6,083` · `14/22/500 = 5,604` · `14/20/500 = 4,836` · `11/16/600 = 3,090` · plus `13/20/400`, `13/20/500`, `11/20/400`, `13/18.9/400`, `11/20/600`, `11/11/400`, `13/16/400`. **25 distinct combinations.**

After: `16/25.6/400 = 60,753` · `13/18.9/400 = 23,336` · `12/18/400 = 6,208` · `16/21.6/500 = 5,604` · `16/25.6/500 = 5,026` · `12/12/600 = 3,620` · `12/16.8/400 = 3,032` · `13/18.2/600 = 1,788` · `16/21.6/700 = 1,260`. The long tail of near-duplicate steps (14/20 vs 14/21 vs 14/22, 13/18 vs 13/18.9 vs 13/19.5 vs 13/20) is gone: what remains are the six roles plus a small number of role-specific leadings (1.35 on single-line row primaries, where 1.6 would have fattened 200-row lists for nothing).

## The measure

Prose capped at 70ch. **On every surface the phase was accountable for, the count of prose blocks past the cap is 0 at every viewport**: Today, Ops, Styles, Strategy, Settings, Sends. Worst baseline offenders, all now inside the cap: `.wb-strat-note` 329ch, `.ops-pipe-l` 277ch, `.ov-note` 276ch, `.wb-strat-p` 262ch, `.ct-ex` 189ch. Strategy's edit textarea was capped to the same measure as its reader, which is the inversion the audit named (reader capped, editor running the full 1,156px pane).

`fcf0446` caught three Today lines the first pass missed: `.td-qs`, `.td-qown` and `.td-next .txt` carry `white-space:normal` and ran the full plate at 2560 (108 / 105 / 109 characters).

### The 43 remaining over-cap blocks, and why they stay

Every one is a **single-line truncated row value**, not a prose block: `.snip` and `.td-snip` (message preview lines, ellipsis-clipped, 13px) and `.ct-title.ct-row-p` (row titles, one line). They report a high `ch` because the instrument measures the element's box, and these boxes span the pane by design so the ellipsis lands at the right edge. Capping them would truncate earlier and show the operator *less* of each preview, which is the opposite of the goal. DM bubbles and post previews, the genuinely wrapping cases, belong to the layout pass.

## Waivers: confirmed intact

- **9px Sends KPI tile labels below 480px** (`faithful.css:2321-2324`): untouched, still 9px.
- **10 / 10.5px chips** (`styles.css:432, :441, :595, :639, :309`, `v2c/styles.css:109`): untouched.
- `.wb-mockchip` 9px, `.wb-code-l` 9px, `.ct-thumb-empty` 9px: untouched as chrome.

**One number moved in the right direction and reads as a regression if you do not check it.** Today's sub-11px count went 0 → 10. That is the `.sa-sev` waiver being *honored* rather than broken: before this run, none of the alert strip's `.sa-*` classes were reasserted under `.wb.wb.wb`, so all of them, the 10.5px severity label included, were being flattened to 14px/400. The alerts pass restored them to the sizes `src/styles.css` already declares for the stock surface. The waived size now actually renders at its waived size.

## Spacing and radii

Padding pairs collapsed onto the 4/8/16/24 scale, drift only: 15/17 → 16, 23/25 → 24, and non-chrome 7 → 8. Chrome (rail, tab bar, pane headers) was deliberately left alone as skin-adjacent. Radii: the rendered set is now 8 / 12 / 20 plus the 40px plate and the pill; `--r-hero` 28px was folded onto 20px so hero cards join `--r-card`, and 1-2px marks were left as the rules they are rather than treated as radii.

## Deliberately not done

- `@layer` and the `.wb.wb` flattener itself: out of scope by the run's locked forks. The flattener stays, which is why every rule added in this run carries `.wb.wb.wb`.
- `src/styles.css` untouched, so `#exp/stock` is unaffected. Verified in the Phase 6 sweep.
- No color, ground, plate radius or accent change. One color exception is recorded and defended in `REPORT.md`: `--text4` was lifted #6E6E6E → #7E7E7E (4.13:1 → 5.03:1) as a contrast repair on a tier that carries real words in eleven places.
