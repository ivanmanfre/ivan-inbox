# Phase 1 spec — type ramp, measure, spacing, radii

Repo: `/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `wb/2026-readability`. Edit ONLY `src/exp/v2c/faithful.css` and `src/exp/v2c/styles.css`. **Never touch `src/styles.css`** — it styles `#exp/stock`, which must stay pixel-identical. The v2c workbench wraps the stock screens in `.wb` and overrides them from the two v2c sheets, so everything you need is reachable from there.

## How the cascade actually works (read before editing)

`faithful.css` (imported after `styles.css` by the Shell) flattens everything at `.wb.wb, .wb.wb *` (line ~174) to `--fs-body`/400/lh-20px, then re-asserts seven tiers at `.wb.wb.wb` (lines ~184-357). Tokens live at the `.wb` root block (line ~33). Anything you add MUST use `.wb.wb.wb` specificity or the flattener eats it — this exact defect shipped once (declared 15px, rendered 13px). `v2c/styles.css` rules with 2-3 compound classes tie or beat the flattener, which is where most of the ~240 rogue font-size literals still render from.

## 1. Token + tier edits in faithful.css

| token / tier | now | target |
|---|---|---|
| `--fs-body` | 14px | **16px** |
| `--fs-meta` | 12.5px | **13px** |
| `--fs-eyebrow` | 11px | **12px** |
| `--fs-title` | 16px | **17px** |
| `--fs-page` | 20px | **22px** |
| `--fs-figure`, `--fs-display`, `--fs-glyph` | 30/34/20px | unchanged |

Line-heights (currently hardcoded px inside the tier blocks — change them WITH the sizes or the ramp renders 16px/20px = 1.25 and looks broken):

- Flatten rule (~line 174-179): `line-height:20px` → `line-height:1.6` (relative, so unassigned elements land on 16/1.6).
- body tiers (`.wb-body`, `.r .name`, etc., two blocks ~236-258): `line-height:20px` → `1.6`.
- meta tier (~261-285): `line-height:16px` → `1.45`.
- eyebrow tier (~288-316): `letter-spacing:.04em` → `.08em`, `line-height:16px` → `1`. Size rides the token.
- title tier (~221-233): `line-height:24px` → `1.35`.
- page tier (~209-218): `line-height:24px` → `1.25`.
- figure/display/glyph tiers: leave alone.
- mono/code block (~340-346): size rides `--fs-meta` (now 13px), `line-height:16px` → `1.45`.
- The chevron/glyph utility block (~329-337) that reads `--fs-title`: leave the size, set `line-height:1.35` if it was 20px.

## 2. The rogue-literal layer

The rendered census (phase0-baseline/metrics.json) shows the page mass at these off-ramp combos: `14/21/400` (48.7K chars), `14/20/400` (25.7K), `13/18/400` (14.3K), `13/19.5/400` (6.1K), `13/20/*`, `13/18.9/400`, `11/16/600` (3.1K), `11/20/*`. After the token bump these must land on 16/1.6 (body), 13/1.45 (meta) or 12/1 (eyebrow).

In `v2c/styles.css`, remap literals to tokens **by role, not by find-replace**:

- `font-size:14px`, `14.5px`, `15px`, `15.5px` on prose/row-primary roles → `var(--fs-body)`; their `line-height:1.4/1.45/1.5` → `1.6` when the element is running prose, keep `1.35-1.45` only for single-line row primaries where 1.6 would fatten list rows (log rows, table cells — judgment call, record each).
- `font-size:13px`, `13.5px`, `12.5px`, `12px` on secondary/meta roles → `var(--fs-meta)` + `line-height:1.45`.
- `font-size:11px`, `11.5px` on uppercase labels/chips → `var(--fs-eyebrow)`.
- `font-size:17px` (6×) → `var(--fs-title)`.
- Sizes ≥20px: map to `--fs-page`/`--fs-figure`/`--fs-display` where the role matches; leave chart-internal SVG text sizes alone.
- `9px`/`9.5px`/`10px`/`10.5px`: **DO NOT RAISE**. These include Ivan's waivers. Specifically `faithful.css` ~2323 (`.ov-tile-lbl` 9px under 480px media) and every sub-11px chip stays exactly as measured. Also `.wb-mockchip` 9px (styles.css:151) and `.wb-code-l` 9px (:327) stay — they are chip/stamp chrome, not text.
- `.wb-ul li` 14.5px (styles.css:309) → `var(--fs-body)` / 1.6 — that is reading prose.

You do NOT need to convert every literal — you need the RENDERED census clean. Work from the metrics, verify, iterate.

## 3. The measure

Cap prose at **70ch** (`max-width:70ch` on the text block, not the pane) on: Today (alert bodies `.sa-body`, notes), Ops (`.ops-pipe-l`, `.ov-note`, prose), Styles (`.ct-style-b`, `.ct-ex`), Strategy (`.wb-strat-p`, `.wb-strat-note`), the QA inspector prose, magnet window prose (`.dd-body`), settings notes, empty states (`.wb-empty-s`). Measured worst offenders: `.wb-strat-note` 329ch, `.ops-pipe-l` 277ch, `.ov-note` 276ch, `.wb-strat-p` 262ch, `.ct-ex` 189ch.

**Strategy's edit textarea**: the reader is capped but the editor runs the full pane (1,156px). Cap the textarea's width to the same measure as the rendered text (`.wb.wb.wb` selector on the strategy textarea, `max-width:70ch` — find it in StrategyView.tsx's class names).

Do NOT cap: DM thread bubbles (Phase 5 owns bubbles), table/grid cells, code blocks, chart axes. Left-align within the pane (no centering changes).

## 4. Spacing + radii normalization (conservative pass)

- Padding: where a padding pair is within 2px of the 4/8/16/24 scale (6→8 NO — visual sizes shift; rule: only collapse values that are drift, i.e. 15/17→16, 23/25→24, 7→8 only in non-chrome list internals). Do not re-space chrome (rail, tab bar, pane headers) — that is skin-adjacent. Record every collapse in the ledger. If in doubt, leave it.
- Radii: rendered set must become {8,12,20,40,999-pill}. In `v2c/styles.css`: `99px/999px/9999px` pills stay pills (fine); `2px/4px/5px` → `var(--r-chip)` (8px) ONLY on cards/controls — keep 1px/2px on hairline-ish underline marks (`faithful.css` 1-2px marks are rules, not radii). `10px` → `var(--r-ctl)`. `--r-hero` (28px) → **20px** so hero cards join `--r-card` (audit ruling: 10 rendered radii collapse to 8/12/20 + the 40px plate). `--plate-r:40px` untouched.

## 5. Verification protocol (the phase is not done without it)

1. `npm run build` green.
2. Rebuild, then run against the local preview (`npx vite preview --port 4173` if not running):
   `node goal-runs/workbench-2026-plan-2026-08-21/tools/measure.mjs --out goal-runs/workbench-2026-plan-2026-08-21/phase1-after --shots`
3. Gates on `phase1-after/metrics.json`:
   - dominant body combo is `16/25.6/400` (± rounding) on every lane; no `14/2x` or `13/1x` combo above 500 chars anywhere except waived chips;
   - `long` (blocks >70ch) count = 0 on today/ops/styles/strategy/settings/magnets at 1440 and 2560 (dms/content bubbles excluded until Phase 5);
   - `tiny` (sub-11px) unchanged from baseline (waivers intact, nothing new);
   - 0 console errors, 0 overflow;
   - light theme spot-check at 1440: `--theme light`, same gates.
4. Write `goal-runs/workbench-2026-plan-2026-08-21/phase1-type.md`: the computed-style table (role × surface × declared × computed × viewport, from metrics.json roles data), the ledger of literal remaps, the padding/radius collapses, and anything you deliberately left.
5. Commit on `wb/2026-readability` in ≤3 logical commits (tokens+tiers / literal remap / measure+radii). Never push.

## Hard rules

- `.wb.wb.wb` on every selector you add. Computed styles are the only truth.
- Do not touch: `src/styles.css`, any `.tsx` except reading class names, `--ground`, `--plate-r`, `--accent*`, color tokens, the light-theme block's colors (EXCEPT nothing in this phase), `#exp/stock`.
- Zero em dashes in any comment or string you write. No banned AI-tell vocabulary.
- If a change makes a surface look broken in your shots, fix or revert that change; never ship "declared but looks wrong".
