# UI Elevation Tournament — shared brief (all directions)

You are implementing ONE composition direction for the Sends → Overview dashboard of a dark-native React PWA. This is an **improve run**: the current dashboard is the craft FLOOR — nothing it shows may be lost; you elevate hierarchy/density/composition WITHIN the existing design system. No reskin, no new color language.

## Setup (do exactly this)
```bash
cd /Users/ivanmanfredi/Desktop/ivan-inbox
git worktree add ../ivan-inbox-wt-<DIR> feat/sends-kpi-elevation -b tourney/<DIR>
cd ../ivan-inbox-wt-<DIR>
ln -s /Users/ivanmanfredi/Desktop/ivan-inbox/node_modules node_modules
cp /Users/ivanmanfredi/Desktop/ivan-inbox/.env.local .
cp /Users/ivanmanfredi/Desktop/ivan-inbox/.session.json .
npm run dev -- --port <PORT> &   # base path is /ivan-inbox/
```
`<DIR>` = your direction key (a|b|c), `<PORT>` = your assigned port.

## Hard constraints
- Touch ONLY: `src/screens/kpi/OverviewView.tsx`, `src/styles.css`, and (if your composition needs the header/segment row) `src/screens/SendsScreen.tsx`. NEVER touch `src/lib/*`, `db/*`, fetchers, or any data logic — same data in, recomposed presentation out.
- Design system is authoritative: CSS vars `--bg/--surface/--surface3/--text/--text2/--text3/--sep/--accent`, radius 14-16px cards, `.ov-*`/`.sc-*` idioms, SF-ish system font stack already set. Dark only. Status colors: `#10A37F` green / `#FF9F0A` amber / `#FF453A` red; lane dots blue/green/purple/orange as in code.
- Every metric currently rendered must remain visible or reachable: 4 volume KPIs + 24h + sparklines, acceptance 7d/30d with counts, scan opens 7d/30d/prospects/last, governor per person (week gauge, daily brake, mode badge, accept %, monthly for Rise, headroom lines), pipeline per lane (sendable, bar, sent 7d/30d, runway), campaigns list (name/status/count).
- Mobile (≤999px) must stay app-like: single column, thumb-friendly, no density cram. Desktop (≥1000px) is where your composition differentiates.
- The Ivan governor currently reads 98/50 (196% of cap — operator RAISED the cap intentionally). Your design must render used>cap honestly and calmly (e.g. overflow marker on the gauge), never clamp the number, never scream error.
- No horizontal overflow anywhere: after capture, assert `document.documentElement.scrollWidth === document.documentElement.clientWidth` (and same for the scrolling container) at both viewports. Console must be clean.
- TypeScript + `npm run build` must pass in your worktree.

## Capture (required deliverables)
4 screenshots, fullPage, into `/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/sends-kpi-elevation-2026-07-24/phase-ui/judge-crops/`:
- `<DIR>-ivan-mobile.png` (393×852), `<DIR>-ivan-desktop.png` (1280×900), `<DIR>-rise-mobile.png`, `<DIR>-rise-desktop.png`
Adapt this pattern (session injection + clicks) from `scripts/shot-overview.mjs` in the main repo, pointing at your port + `/ivan-inbox/` path. Report console errors per shot; they must be zero.

## Finish
- `git add -A && git commit -m "tourney/<DIR>: <one-line description>"` in the worktree.
- Kill your dev server.
- Final message: direction key, what you changed structurally (5 lines max), overflow-assert results, console status, commit SHA, crop paths. Raw report, no sales pitch.
