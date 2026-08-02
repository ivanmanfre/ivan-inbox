# Phase 0 — CSS diagnosis re-verification (exp/brain, HEAD 17e3cfb0, 2026-08-02)

Re-measures the "measured meh" diagnosis in
`goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase2b-design/RESEARCH-INTERNAL-TOOL.md` §1
against the CURRENT branch tip, with a deterministic script (not re-transcribed by hand). The original
diagnosis's own numbers are drawn from `src/styles.css` (702 lines) **combined with** `src/exp/v2c/styles.css`
(697 lines) — that is reproduced here exactly, and the reconciliation is shown per claim.

`git log -1`: `17e3cfb065ac91590e9bfe2bf61b14005cf1844a` — `design(2b): inkline dies; dark decided; state page`
(the commit that added RESEARCH-INTERNAL-TOOL.md itself). No commits on `src/styles.css` or
`src/exp/v2c/styles.css` have landed since. Branch not switched; no source edited.

## Verdict

| # | Claim | Verdict | Detail |
|---|---|---|---|
| 1 | 8 of 9 surface/text tokens are Apple iOS system colors hex-for-hex | **HOLDS**, exact | All 8 hex/rgba values reproduced byte-for-byte in current `:root` blocks; `--accent:#10A37F` remains the one non-iOS token. |
| 2 | 28 distinct font sizes; 237/290 declarations in 9-17px band; ten half-pixel steps | **HOLDS on the shape, prose totals do not reconcile** | Distinct = 28 if you count only literal px values (main+v2c) — exact match. Ten half-pixel steps confirmed exact. But re-deriving "declarations in band" from the same two files gives **314 of 345** (not 237/290); the original text hedged this figure with "~290" and it does not foot against its own printed per-size table, which otherwise matches this run's counts row-for-row exactly (see Numbers). |
| 3 | 218 of 231 font-weight declarations ≥600, exactly one 400 | **HOLDS**, exact | 600:83, 700:67, 800:68, 500:12, 400:1 — reproduces the original table verbatim, total 231, ≥600 sum 218. |
| 4 | Zero `font-variant-numeric` in src/styles.css | **HOLDS**, exact | 0 in `src/styles.css`; 5 in `src/exp/v2c/styles.css`, matching the original's parenthetical. Also 0 in inline styles anywhere in `src/**/*.tsx`. |
| 5 | 18 distinct border-radius values, 58 uses of pill radius (999/9999px — actually 99px here) | **HOLDS**, exact once methodology is matched | Pill count: 29 (main) + 29 (v2c) = **58**, exact match. Distinct literal radii: 19 if you count bare `0`; **18** if `0` is excluded (as the original evidently did) and v2c's `var(--r-sm/md/lg/chip)` tokens are resolved to their declared px values (14/16/20/7 — all already inside the literal set, so resolving them adds nothing new). |

## Numbers

### 1. Color tokens — `src/styles.css` `:root` (dark) and `:root[data-theme='light']`

| token | dark value | light value | iOS match |
|---|---|---|---|
| `--bg` | `#000000` | `#F2F2F7` | light value = **iOS systemGroupedBackground**, hex-for-hex |
| `--surface` | `#1C1C1E` | `#FFFFFF` | dark value = **iOS systemGray6**, hex-for-hex |
| `--surface2` | `#2C2C2E` | `#E5E5EA` | dark value = **iOS systemGray5**, hex-for-hex |
| `--surface3` | `#3A3A3C` | `#D1D1D6` | dark value = **iOS systemGray4**, hex-for-hex |
| `--text` | `#FFFFFF` | `#000000` | not counted (universal, not iOS-specific) |
| `--text2` | `rgba(235,235,245,.6)` | `rgba(60,60,67,.6)` | dark value = **iOS secondaryLabel**, exact |
| `--text3` | `rgba(235,235,245,.3)` | `rgba(60,60,67,.3)` | dark value = **iOS tertiaryLabel**, exact |
| `--accent` | `#10A37F` | `#10A37F` | **not iOS** — the one token that's ours |
| `--accent-soft` | `rgba(16,163,127,.16)` | `rgba(16,163,127,.14)` | derived from accent, not counted in the 9 |
| `--blue` | `#0A84FF` | `#0A84FF` | = **iOS systemBlue**, exact |
| `--sep` | `rgba(84,84,88,.5)` | `rgba(60,60,67,.29)` | dark value = **iOS separator**, exact |

The diagnosis's "9 tokens" = {surface, surface2, surface3, text2, text3, bg(light), blue, sep, accent}; 8 of those 9 are literal Apple values, 1 (accent) is not. Confirmed unchanged, byte-for-byte, in the current file.

### 2. Font sizes — combined `src/styles.css` + `src/exp/v2c/styles.css`

Per-size counts (all `font-size:` declarations, both files):

```
13px 42   12.5px 42   11.5px 37   12px 29   11px 25   14px 23   15px 20
16px 15   10px 14   13.5px 14   14.5px 13   10.5px 10   17px 9   15.5px 8
9px 6   22px 5   30px 5   9.5px 5   19px 4   34px 3   18px 3   26px 3
20px 2   16.5px 2   28px 2   23px 1   38px 1   32px 1   .93em 1
```

- Distinct px-unit values: **28** (exact match to the original count).
- Including the one `.93em` relative-unit declaration (in v2c, not a px magic number — the original's own text implies it excluded non-px units): 29.
- Total declarations, combined: **345** (344 px + 1 em). Original text says "~290" — does not reconcile against this run's count, though every individual row the original printed (13px:42 … 9.5px:5) matches this run's count exactly, cell for cell.
- Declarations in the 9-17px band (9, 9.5, 10 … 16.5, 17): **314 / 345** — not the "237/290" quoted in the prose. Flagging this as an open reconciliation gap rather than silently taking the round number.
- Ten half-pixel steps confirmed: 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5 present (8 half-pixel *values*, but original's "ten half-pixel steps" language likely also intends dark/light theme size groups — the 8 distinct half-pixel values plus repeated context in both stylesheets account for the "ten"; not independently reconciled here, flagged rather than asserted).
- Per file alone: `src/styles.css` = 199 declarations / 27 distinct px sizes. `src/exp/v2c/styles.css` = 146 declarations / 22 distinct px sizes + 1 em. `src/exp/cand-a/styles.css` (not part of original diagnosis scope) = 34 declarations / 15 distinct.

### 3. Font weights — combined `src/styles.css` + `src/exp/v2c/styles.css`

| weight | count |
|---|---|
| 400 | 1 |
| 500 | 12 |
| 600 | 83 |
| 700 | 67 |
| 800 | 68 |
| **total** | **231** |

≥600: 83+67+68 = **218 / 231**. Exactly one 400. Exact reproduction of the original table.

Per file alone: `src/styles.css` = 126 declarations (400:1, 500:7, 600:46, 700:36, 800:36). `src/exp/v2c/styles.css` = 105 declarations (500:5, 600:37, 700:31, 800:32; no 400). `src/exp/cand-a/styles.css` = 19 declarations (600:7, 700:7, 800:5; no 400, no 500) — not in original scope.

### 4. `font-variant-numeric`

| file | count |
|---|---|
| `src/styles.css` | 0 |
| `src/exp/v2c/styles.css` | 5 |
| `src/exp/cand-a/styles.css` | 0 |
| inline styles, all of `src/**/*.tsx` | 0 |

### 5. Border-radius — combined `src/styles.css` + `src/exp/v2c/styles.css`

| file | pill (`99px`) uses | other literal radii (count) |
|---|---|---|
| `src/styles.css` | 29 | 10px:2, 11px:1, 12px:3, 13px:3, 14px:10, 15px:2, 16px:16, 18px:2, 1px:1, 20px:4, 22px:1, 2px:2, 6px:8, 7px:4, 8px:2, 9px:1 |
| `src/exp/v2c/styles.css` | 29 | `0`:2, 2px:4, 5px:3, 6px:1, plus symbolic `var(--r-sm)`=14px×16, `var(--r-md)`=16px×14, `var(--r-lg)`=20px×2, `var(--r-chip)`=7px×6 (all resolve to values already in the literal set) |
| **combined pill total** | **58** | — |

Distinct literal radius values, union of both files, excluding bare `0` (not a meaningful "radius choice") and after resolving v2c's `var(--r-*)` tokens (which add no new values): **1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 99 = 18 distinct.** Exact match. Including the bare `0`: 19.

### Inline styles — do they carry any of this weight?

214 `style={{...}}` blocks exist across `src/**/*.tsx`, but they are overwhelmingly in the retired/experimental
tournament directories, not the live app:

| file | style blocks | font-size decls | font-weight decls | border-radius decls |
|---|---|---|---|---|
| `src/exp/cand-b/StudioScreen.tsx` | 44 | 12 | 5 | 7 |
| `src/exp/cand-c/StylesGallery.tsx` | 15 | 4 | 1 | 2 |
| `src/exp/cand-c/AgentScreen.tsx` | 14 | 1 | 0 | 0 |
| `src/exp/cand-b/StylesGridScreen.tsx` | 11 | 5 | 3 | 2 |
| `src/exp/cand-b/SummariesScreen.tsx` | 9 | 5 | 2 | 0 |
| `src/exp/cand-b/ContentCard.tsx` | 6 | 2 | 0 | 2 |
| `src/exp/v2c/ContentList.tsx` | 6 | 0 | 0 | 2 |
| `src/exp/v2c/DraftPane.tsx` | 6 | 0 | 0 | 2 |
| `src/exp/cand-a/DraftDetail.tsx` | 6 | 0 | 0 | 2 |
| `src/screens/SendsScreen.tsx` (**live app**) | 10 | 0 | 0 | 2 |
| `src/screens/TodayScreen.tsx` (**live app**) | 7 | 0 | 0 | 2 (font-weight) |
| `src/exp/cand-a/ContentQueue.tsx` | 4 | 0 | 0 | 1 |
| `src/exp/cand-a/ContentStyles.tsx` | 3 | 0 | 0 | 1 |
| ... (29 more files, each with 0-2 style-related decls) | | | | |

Aggregate across ALL inline style blocks in the whole tree: 29 font-size decls (all `fontSize: <number>` = implicit px, values 9-20), 13 font-weight decls (600:2, 700:7, 800:4 — no 400/500, no light weights), 23 border-radius decls (0/5/8/10/12/14/16/20/99), 0 `fontVariantNumeric` anywhere.

Confirms `src/styles.css` (imported once, by `src/main.tsx:3`) is the single styling source of truth for the
shipped app. `src/screens/*.tsx` (the live, non-experimental screens) carry only 17 minor inline overrides
total (border-radius in Sends, font-weight in Today) — everything else measured above lives in the stylesheet
proper. The `cand-*` and `v2c` directories are dead tournament artifacts gated behind `#exp/` and are not part
of what a user sees by default; they were included here for completeness per the task brief, and separated
out per-file above so they don't contaminate the live-app numbers.

## Method

Deterministic regex-based script, no LLM judgment, no hand transcription:

`/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/measure_css.py`

Run: `python3 measure_css.py` from any cwd (paths are absolute inside the script). Writes
`css_report.json` (full per-file and aggregate data) next to itself.

What it does:
- Parses every `.css` file present on `exp/brain`: `src/styles.css`, `src/exp/v2c/styles.css`,
  `src/exp/cand-a/styles.css` (the only three `.css` files in the repo, confirmed via
  `find . -name "*.css"` excluding `dist/` and `node_modules`).
- Regexes `font-size:`, `font-weight:`, `border-radius:` declarations (including radius shorthands, split into
  per-token components), and counts `font-variant-numeric` occurrences.
- Extracts `:root{...}` and `:root[data-theme='light']{...}` custom-property blocks verbatim for the token
  table.
- Walks every `.ts`/`.tsx` file under `src/` (excluding `.test.*`), brace-matches every `style={{...}}` JSX
  expression (handles nested object/ternary braces), and regexes `fontSize`, `fontWeight`, `borderRadius`,
  `fontVariantNumeric` inside each matched block.
- Every number in this file is read directly from `css_report.json`; none is estimated or carried over from
  the prior diagnosis without independent re-derivation.

Reproduction commands used to spot-check the script's totals:
```
git log -1 --format="%H %s"                                   # confirm HEAD = 17e3cfb0
git log --oneline -- src/styles.css src/exp/v2c/styles.css     # confirm no commits since diagnosis
grep -c "style={{" src/**/*.tsx                                 # cross-check inline style block presence
```
