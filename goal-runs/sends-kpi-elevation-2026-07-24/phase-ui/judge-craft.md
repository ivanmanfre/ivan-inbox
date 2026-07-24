# Judge — DESIGN-CRAFT lens (rendered pixels)
Floor = 5 on every criterion. Judged from the 16 crops in `judge-crops/`.

## Score table

| Criterion | a (command grid) | b (persona rail) | c (decision-first) |
|---|---|---|---|
| 1. Hierarchy & rhythm | **7** | 6 | **8** |
| 2. Density without clutter | **7** | 4 | 6 |
| 3. System coherence | **8** | 7 | 7 |
| 4. Detail craft | **7** | 6 | 6 |
| **Total** | **29/40** | **23/40** | **27/40** |

(Floor scores 20/40 by definition. Floor's own worst sin, for reference: the desktop right half under GOVERNOR is dead space, and the over-cap 98/50 bar renders as a full plain green bar — it lies.)

## Per-direction notes

### a — command grid
- **Worst craft defect** (`a-ivan-desktop.png`): Acceptance and Scan opens are rendered TWICE on one screen — once in the 6-up KPI strip, again as full ENGAGEMENT cards with the identical numbers (29%, 12/41, 38/67). Duplicated data on a single view is a hierarchy error dressed as density. Secondary: the KPI strip is internally inconsistent — 4 cards carry sparklines, 2 don't, so the row's baseline rhythm breaks at card 5.
- **Best craft idea worth stealing** (`a-ivan-desktop.png` governor): the over-cap treatment. Green fill to cap, then a **hatched amber segment** for the overage, plus a `196% OF CAP` amber pill. It's the only rendering in the tournament where 98/50 is legible as "you blew past the cap" at a glance. Also good: the em-dash + "no opens" empty state in the Rise Scan-opens KPI (`a-rise-desktop.png`).

### b — persona rail
- **Worst craft defect** (`b-ivan-desktop.png`, same in `b-rise-desktop.png`): the COMPARE rail holds two small cards and then the entire right column below them is dead black — a half-column of empty canvas next to a fully packed left column. This is exactly the floor's disease, reintroduced. Secondary: the WEEK gauge renders the over-cap as a second green segment after a thin tick — overage in the same success color as the safe zone is ambiguous at reading distance.
- **Best craft idea worth stealing** (`b-rise-desktop.png`): the Ivan/Rise compare cards themselves — tight `98/50 · 16.6%` typography, twin mini-gauges, NORMAL badge, and a selected-state accent border. Cross-persona state in one glance is genuinely useful; it just needs to live in a layout that doesn't strand it. The labeled WEEK / DAILY BRAKE split inside the governor card is also a naming upgrade over the floor's two anonymous bars.

### c — decision-first narrative
- **Worst craft defect** (`c-ivan-desktop.png` funnel, plus `c-ivan-mobile.png`): the funnel row shows `12 ACCEPTED → 308% → 37 SCAN OPENS`. A 308% stage-to-stage conversion reads as a broken metric — scan opens aren't a subset of accepted, so the funnel grammar (arrows + %) is the wrong idiom for the third stage. On mobile the 3-up DECISION row cracks: label truncates to `ACCEPTA…` and the delta wraps to a second line (`±0 vs 30d` in `c-rise-mobile.png`) — the hero row is the one place truncation is unacceptable. Also: 12 consecutive `PAUSED 0` campaign rows are noise the layout does nothing to collapse.
- **Best craft idea worth stealing** (`c-rise-desktop.png` DECISION row): status-dot semantics on the three answer cards — Rise's 2d runway gets an amber dot and amber bar while healthy cards stay green, and the acceptance card carries a `▲8 vs 30d` delta. "Where do I stand right now" is answered in one fixation. C is also the only direction that actually carries its redesign to mobile instead of shipping the floor unchanged.

## Verdict

**Ranked: a > c > b.**

A wins because it is the only direction that raises density AND craft without breaking anything structural: it fills the floor's dead right half with real content, keeps the exact card idiom of the mobile design language, and ships the tournament's only honest over-cap gauge — its sins (duplicate metrics, two sparkline-less strip cards) are edits, not rebuilds. C has the best top-of-page thinking (decision row + status dots) and the only real mobile effort, but it ships a nonsense 308% funnel stage, truncated hero labels on mobile, and a 12-row wall of zeroed PAUSED campaigns — craft errors in the most prominent pixels. B's compare cards are a great component trapped in the worst layout of the three: it reintroduces the floor's empty half-column, which the brief explicitly punishes.

**Dominance: NO direction dominates (strict).** A beats or ties C and B on criteria 2–4 but loses hierarchy to C (7 vs 8); C loses density and craft to A; B leads nothing. Winning move: A's layout + steal C's decision row w/ status dots and B's compare cards (placed above the campaigns column, not in a rail), keep A's hatched over-cap gauge everywhere 98/50 appears.
