# Phase 3 — Tournament logistics (orchestrator, binds all builders)

Three blind builders, one thesis each. Every builder receives: this file, `phase2-spine.md`,
`phase0-surfaces.md`, `phase1-references.md`, and the reference captures in `refs/`. No builder sees
another builder's thesis, branch, or work.

## Candidates

| id | branch | thesis (one line) | port |
|---|---|---|---|
| `faithful` | `exp/vis-faithful` | Reference-forward expressive: read Nixtio at face value everywhere the spine permits — display type at the top of the clamp, chart-forward overview cards, pill chrome, generous card padding; density carried by the spine's dense-list vocabulary. | 5431 |
| `spine` | `exp/vis-spine` | Restraint-first precision: the spine executed at maximum discipline — instrument's austerity re-grounded on the dark ladder, reference moves admitted only where they earn density or scannability; expression concentrated in the display title and one hero figure per surface. | 5432 |
| `split` | `exp/vis-split` | Class-split: full Nixtio expression on `overview` surfaces (Today, Sends Overview/Lanes, Ops KPI band), near-monastic list treatment on `working-list` surfaces, the spine holding the seam; the bet is that the contrast between classes IS the design. | 5433 |

## Mechanics (identical for all three)

- Branch off `exp/brain` @ `17e3cfb`. Worktree under the session scratchpad
  (`git worktree add <scratch>/wt-<id> -b exp/vis-<id> exp/brain`).
- **Do not run `npm install`.** Symlink the main checkout's `node_modules` into the worktree
  (`ln -s /Users/ivanmanfredi/Desktop/ivan-inbox/node_modules <wt>/node_modules`). `package.json` and
  `package-lock.json` must remain byte-identical to base — the Phase 4 gate diffs them.
- Copy `.env.local` from the main checkout. Mint a fresh session with `node scripts/dev-login.mjs` in the
  worktree before any capture (tokens expire ~60 min; a skeleton crop is a failed capture, never evidence).
- Dev server on the assigned port only.
- **Commit every 15-20 minutes of work.** The harness watchdog killed builder agents six times in the prior
  run; on-disk commits are the recovery path. Small commits, real messages.
- Treatment scoping per the spine: token overrides at the `.wb` root + treatment stylesheet(s) imported by
  the v2c shell. `:root` in `src/styles.css` untouched. The two v2c light-chrome patches
  (`src/exp/v2c/styles.css:58`, `:127`) must be visited.
- Both colour answers ship behind `data-cat="mono" | "triad"` on the `.wb` root, values per the spine.
- All surfaces, both classes, both viewports (1440×900, 390×844), real data. Content at real density
  (285 drafts / 88 in review) is the surface you will be judged hardest on.
- Self-verify before finishing: `npm test`, `npm run lint`, `npm run build` green in the worktree; capture
  Content + Today at both viewports with the fixed wait logic
  (`git show exp/brain-2b-instrument:scripts/sweep-instrument.mjs` has the reference implementation —
  domcontentloaded + skeletons cleared + rail stamp not "not loaded" + terminal render; **never**
  `networkidle`, the realtime WebSocket holds it open forever).
- Write `goal-runs/inbox-visual-rebuild-2026-08-02-out/phase3-<id>/BUILD.md` in the MAIN checkout (not the
  worktree): what you changed, the token values you chose within the spine's ranges, self-capture evidence
  paths, and every deliberate departure from the reference with its reason.

## Disqualifiers (gate list, verbatim from the spec — a DQ is terminal, not correctable)

- Any chart or series backed by a hard-coded array (fabricated data)
- New dependency, webfont, `@font-face`, `npm install` of a new package
- `ui-serif` or any serif face; warm-paper editorial in any form
- Console errors originating in `src/` (the unarmed `inbox-claude` broker CORS noise is excluded)
- Horizontal overflow at 390
- AA contrast failure on the primary (dark) theme
- Spine abandonment on dense surfaces (reference achieved on Today, spine dropped on Content)
- Edits to `:root` in `src/styles.css`, `main`, or anything outside the branch
- `git add -A` (three foreign untracked directories sit in `goal-runs/`)

## What is explicitly in bounds

- Re-deriving the dark ladder (warmer/blacker than §4.3.1) IF the OKLCH harness re-runs and the spine's
  contrast bars clear; paste the harness output into BUILD.md.
- Markup changes inside v2c components (adding an anchor-column slot, card footers with legend+total,
  metric-card anatomy, display title) — structure of nav/routes is locked, presentation is the run.
- Read-only count queries where a denominator the design needs does not exist client-side
  (`Prefer: count=exact` head probes, mirroring `src/lib` conventions).
