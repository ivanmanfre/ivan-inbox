# Phase 2 — Judge panel verdicts (3 Fable seats, calibrated on control-today/control-ops)

| Lens | A (Content tab) | B (Studio hub) | C (Absorb) |
|---|---|---|---|
| J1 Daily-driver ergonomics | **8** | 5 | 7 |
| J2 Native-ness + craft | **8** | 6 | 4 |
| J3 Coverage + IA scalability | 7 | **8** | 6 |
| Total | **23** | 19 | 17 |

**Outcome:** no unanimous winner — A wins the daily-loop and craft lenses, B wins coverage/scalability. Genuine taste residual → **A and B advance to the ballot** (LOCK 2). **C eliminated**: last on two lenses; systemic double-title stacking, chip/title column squeeze (one-word-per-line wraps), raw enum/timestamp leaks; its zero-blast-radius thesis is real but "wins the port, forfeits the roadmap" (J3).

Key judge findings carried into the finalist fix pass (cycle budget: ONE pass per finalist, then re-shoot):
- A: add content-review count to tab badge (C graft); segmented control below large title on Ops/Agent (double-header); `useAgent().error` not consumed on AgentScreen (D10 violation); bucket KPI tile strip at top of Queue (B graft); styles register drift ("Style: " leak in resources rows, inconsistent empty thumbs); self-handle `#content` hash on load (reload currently lands Inbox).
- B: humanize alert cards (alert_type → label, strip markdown asterisks, enforce clamp); zero-count tiles must not wear severity color; kill double-disclosure (› + chevron); styles/type labels → chip idiom (fix wraps); Studio glyph stroke-consistent; designed empty state for Resources; self-handle `#studio` hash; no transient 0 tiles while loading; restore thumbnails on queue cards.
- Note: J2/J3 read three stale crops (b-2/b-4/b-5 predate the alert-window fix — the unclamped 67d alert they flagged is already windowed out); their remaining defect list was verified against current code before being carried here.

C's verdict preserved for the report; its best ideas already grafted: badge truthfulness (→A fix list), per-segment desktop branching (noted for winner integration).
