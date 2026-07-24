# Judge — OPERATOR-UTILITY lens
Judged: all 16 crops in `judge-crops/` (FLOOR/a/b/c × ivan/rise × mobile/desktop). Floor = 5 on every axis by definition.

## Score table (0–10 vs floor)

| Direction | TTA desktop | TTA mobile | Honesty | Glanceability | Two-seat | Total |
|---|---|---|---|---|---|---|
| FLOOR | 5 | 5 | 5 | 5 | 5 | 25 |
| a (command grid) | 7 | 5 | 6 | 6 | 5 | **29** |
| b (persona rail) | 7 | 5 | 4 | 6 | 7 | **29** |
| c (decision-first) | 8 | 8 | 5 | 7 | 5 | **33** |

Axis notes (pixels, not intentions):
- **TTA desktop.** a's 6-KPI strip surfaces Acceptance + Scan opens in row one and adds a campaigns list ("what went out") — 7. b's compare rail answers throttle/runway/accept/24h-vol for BOTH seats in one glance — 7. c's DECISION row (Acceptance / Governor / Runway) is literally ordered to the operator's questions, plus a Sent→Accepted→Opens funnel — 8.
- **TTA mobile.** a-ivan-mobile, a-rise-mobile, b-ivan-mobile, b-rise-mobile are pixel-identical to the FLOOR mobile crops: volume cards still eat the first screen, governor still ~3 screens down. Both score 5 — no change. c-ivan-mobile / c-rise-mobile put all three decision cards + funnel above the fold; all four operator questions answered on screen one — 8.
- **Honesty.** a renders the 98/50 over-cap as a hatched amber overflow segment + "196% of cap" badge (a-ivan-desktop) — the truest over-cap rendering anywhere in the set — but keeps the green NORMAL badge beside it, a live contradiction → 6. b is the only direction WORSE than floor: the marquee compare rail shows both over-cap governors (98/50, 57/35) as full solid-green bars with green NORMAL badges, twice per view, and demotes "196% of cap" to small grey text (b-ivan-desktop) → 4. c fixes runway honesty (amber dot + amber bar on Rise's 2d runway, c-rise-desktop/mobile) but adds a nonsense "308%" funnel step, keeps a green status dot on the over-cap governor, and puts a green dot on Rise's 5% acceptance (c-rise-desktop) → net 5.
- **Glanceability.** a: even grid scans fine but 6 equal-weight cards don't prioritize → 6. b: rail is compact but desktop-only → 6. c: decision row + funnel are readable half-awake; deductions for the ~15 "PAUSED 0" campaign rows of dead weight (c-ivan-desktop/mobile) and truncated card labels on mobile ("ACCEPTA…", c-ivan-mobile) → 7.
- **Two-seat.** a and c remain toggle-only, same as floor → 5. b's always-on Ivan|Rise rail — including cross-seat runway ("40 · 2d" visible while in Ivan's seat, b-ivan-desktop) — is the only real two-seat advance; docked to 7 (not higher) because it evaporates entirely on mobile.

## Per-direction: worst defect / best steal

**a — command grid**
- Worst defect: mobile is untouched — a-ivan-mobile and a-rise-mobile are the floor, unchanged. Half the crops (and the device he checks most) get nothing.
- Best steal: the hatched amber overflow segment + "196% of cap" badge on the governor bar (a-ivan-desktop). It makes over-cap read as *overflow*, not achievement — the single most honest pixel in the tournament.

**b — persona rail**
- Worst defect: the rail amplifies the floor's lie into the hero element — full solid-green bars + green NORMAL badges on 98/50 AND 57/35, repeated on every desktop view (b-ivan-desktop, b-rise-desktop). The most prominent element on screen is the most dishonest.
- Best steal: the always-on two-seat compare rail with cross-seat pipeline runway — seeing Rise's "40 · 2d" while working Ivan's seat (b-ivan-desktop) is exactly how a two-seat operator catches a starving client pipeline without toggling.

**c — decision-first narrative**
- Worst defect: the "308%" funnel step between ACCEPTED (12) and SCAN OPENS (37) (c-ivan-desktop, c-ivan-mobile). A conversion arrow over 100% is arithmetic nonsense rendered in confident green; it poisons trust in every other number on the page. Runner-up: green status dot on the 98/50 governor card.
- Best steal: the DECISION row itself — three status-dotted cards ordered to the operator's actual questions, with the amber RUNWAY "2d" card (c-rise-desktop/mobile) proving the pattern can alarm when it should.

## Ranked verdict

**1. c (33) — 2. a (29, tiebreak over b on honesty) — 3. b (29) — floor (25) last.**

c wins because it is the only direction that improves the phone — where Ivan checks most often — and its decision row is the only composition ordered to his four questions rather than to the data model. a and b tie numerically but a's over-cap rendering moves honesty forward while b's rail moves it backward, and honesty failures on a governor readout are the costliest failure class for an operator deciding whether he's throttled. The winning ship is c's skeleton with a's hatched over-cap bar transplanted into every governor rendering and b's compare rail (in a mobile-surviving form) as the two-seat layer.

## Dominance

**No direction dominates.** c loses honesty to a (green dot on over-cap governor, 308% step vs a's hatched amber bar) and loses two-seat to b (no cross-seat visibility at all). Split verdict — c is the base, a and b each hold one component c must steal before shipping.
