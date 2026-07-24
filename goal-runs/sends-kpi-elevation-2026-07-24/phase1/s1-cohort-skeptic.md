# S1 — Cohort-lag skeptic: adversarial verification of r1-cohort-acceptance.md

Role: refute the researcher's finding and proposed fix. Default REFUTED on thin evidence.
Live snapshot: 2026-07-24T16:05:33Z (client UTC clock as now-proxy). Full population, independently pulled:
`GET /outreach_messages?select=id,prospect_id,sent_at,message_text,outreach_prospects(connected_at,campaign_id,outreach_campaigns(client_id))&direction=eq.outbound&message_type=eq.connection_note&sent_at=not.is.null` — `Prefer: count=exact` returned **1009** rows (2 pages: 1000 + 9). Dedup by `(prospect_id, message_text, sent_at)` keep-lowest-id: 1009 → 1009 (no-op, matches researcher).

## Attack 1 — Re-derive the 4 cross-cohort rows (independent, full population)

Independent recomputation (my own script, my own pull, not the researcher's numbers):

| client | sent_7d | acc_7d trailing | acc_7d cohort | sent_30d | acc_30d trail | acc_30d cohort | sent_total | acc_total trail | acc_total cohort |
|---|---|---|---|---|---|---|---|---|---|
| ivan | 41 | 12 | 8 | 250 | 52 | 52 | 952 | 136 | 135 |
| risedtc | 57 | 3 | 3 | 57 | 3 | 3 | 57 | 3 | 3 |

Trailing exactly matches the live view (`GET /inbox_accept_v` at the same timestamp: ivan 41/12/29.3/250/52/20.8/952/136; risedtc 57/3/5.3 across the board). ivan trailing 12/41 = **29.3%**, cohort 8/41 = **19.5%**.

Cross-cohort rows (connected_at within 7d, sent_at before the 7d cutoff 2026-07-17T16:05:33Z), full population sweep, all clients — exactly **4**, all ivan, identical prospect_ids and timestamps to the researcher's table:

```
51af80bc-ab21-43f6-a9c3-209d0a3d9aa2  sent 2026-07-13T06:15:23  conn 2026-07-19T12:01:23  gap 6.2d
15e4dbf5-60fb-47bd-b61e-d41d69cc04dd  sent 2026-07-17T00:14:09  conn 2026-07-17T21:16:05  gap 0.9d
c533049f-d348-483c-9b78-f0324ddc3192  sent 2026-07-17T01:09:37  conn 2026-07-21T05:46:00  gap 4.2d
04b34d25-b598-4f9a-9ea2-05851ebd80a7  sent 2026-07-17T03:21:02  conn 2026-07-19T16:01:21  gap 2.5d
```

Sanity check: cohort-7d accepts with conn outside the 7d window = 0 (as expected: conn ≥ sent ≥ cutoff). 12 = 8 + 4 exactly. 30d coincidence (52 both ways) also reproduces. **Could not refute. CONFIRMED.**

## Attack 2 — Right-censoring: is 19.5% "true" or differently biased?

The researcher's report never mentions right-censoring. That is a real omission: 19.5% is a **floor, not truth**. Live evidence:

- Acceptance-lag distribution over all 138 accepted rows (conn ≥ sent): median **0.49d**, mean 2.40d, p75 2.45d, p90 6.66d, p95 12.70d. **89.9% of eventual accepts land within 7d of send**; 62.3% within 1d.
- Maturity of today's 7d cohorts: ivan 14/41 sends are <3d old; risedtc **57/57** sends are <3d old (campaign started this week — its 5.3% is the most immature number on the board).
- Historical censoring magnitude: the cohort sent 14–21d ago (n=73, ivan) had 17 accepts by window close → 18 now (+1, +5.9% relative). So post-close drift is ~1–2 points, one-directional (up only).
- Matured-window alternative measured live: ivan sends 7–14d ago = **14/70 = 20.0%** — vs 19.5% current cohort. The staleness cost of a matured window buys ~0.5pt of accuracy today.

**Position (not a survey):** ship the cohort metric with a maturity caveat in the caption; do NOT switch to a matured 7–14d window. Reasons: (a) cohort bias is bounded (≤100%), small (~1–2pt at this lag profile), monotone toward truth, and self-corrects on every re-read; trailing bias is unbounded (>100% reachable in any throttle week — documented governor-clamp/rate-limit history makes that precondition realistic) and points the wrong way; (b) the matured window answers "how did the week before last do", which is not the operator's question, for ~0.5pt of gain; (c) the existing caption slot already carries the caveat. But the researcher's "cohort-true is 19.5%" phrasing is wrong as stated — the correct claim is "at least 19.5% and rising, vs a 29.3% figure that was never a rate of anything coherent." Fix is in the caption copy below.

## Attack 3 — Guard asymmetry (`connected_at >= sent_at`)

The guard sits only in the `accepted` flag (numerator side). The connected-before-sent row stays in every denominator (sent_7d/30d/total) and can never count in a numerator. Live impact, full population: **exactly 1 row of 1009** —

```
b7a03d40-65d3-485c-9a18-82afae3ef8c6  sent 2026-05-12T17:17:06Z  conn 2026-05-12T14:21:26Z (3h before)
```

May 2026 → zero rows in any current 7d/30d window; only effect is accepted_total 136 → 135. Verdict on semantics: counting a note fired at an already-connected prospect as a failed send is **defensible and arguably correct** (it consumed a send and produced no new connection; excluding it would hide an upstream send-gating bug). Not a defect. Requirement: the view's header comment must state this asymmetry explicitly so the next auditor doesn't re-litigate it.

Deeper asymmetry the researcher missed — **double-credit**: dedup is per `(prospect_id, message_text, sent_at)`, so a prospect who received two *different* notes both before their single accept gets counted as 2 accepts on 2 sends. Live sweep: 3 prospects have >1 post-dedup note rows; exactly **1** is double-credited:

```
9aa2473b-62bc-4e56-a1c8-b3b793ac7c93 (ivan): two different notes 2026-05-13 12:06:40 and 12:08:42,
one connection 12:16:00 — both rows flagged accepted under BOTH current and proposed semantics.
```

This is not introduced by the proposal (current view has it too), magnitude is 1/135, per-note numerator over per-note denominator stays internally consistent and ≤100%. Flag in comment; do not redesign the metric around it.

## Attack 4 — Column-shape compatibility

- Proposed SQL emits exactly `client_id, sent_7d, accepted_7d, sent_30d, accepted_30d, sent_total, accepted_total, rate_7d, rate_30d` in the **same order** as the current view (required for `CREATE OR REPLACE VIEW` — Postgres rejects reorders/renames; this passes). Types identical: text / bigint counts / `round(numeric,1)` rates with the same `nullif` null behavior.
- Frontend: `AcceptRow` (`/Users/ivanmanfredi/Desktop/ivan-inbox/src/lib/kpis.ts:3-8`) matches field-for-field. The Engagement card (`/Users/ivanmanfredi/Desktop/ivan-inbox/src/screens/kpi/OverviewView.tsx:109-138`) consumes only `sent_7d/accepted_7d/sent_30d/accepted_30d` and recomputes the percentage client-side via `acceptRate()` (integer `Math.round`); the view's `rate_7d/rate_30d/sent_total/accepted_total` are typed but never rendered. `OverviewView.tsx:73`'s `sent_total` is a lane/sends row, not AcceptRow. **No frontend break.**

## Attack 5 — sent_total / accepted_total semantics after the change

`accepted_total` changes meaning from "prospect ever connected" (136) to "connected at/after the credited note" (135). Nothing in the UI renders either total, and no caption references "total" — **no caption/number mismatch is possible today**. Two real footnotes:

1. The 005 header says the trailing style "matches the number outreach_sender_health reacts to." The change severs that stated alignment: the governor chip (`OverviewView.tsx:179`, `accept {g.accept_rate}%` from RPC `inbox_governor`) may now disagree with the Acceptance card on the same screen. Not a break (separate data path, sender_health untouched), but the header comment and the caption must not claim to be the governor's number.
2. `APPLY-kpi-views.sql` also carries this view — apply the replacement in both files or the apply script will silently revert the fix on next run.

## Verdicts

- **Claim 1 (trailing view mixes cohorts; 29.3% vs 19.5%; 4 cross-cohort of 12): CONFIRMED** — independently reproduced from full live population, row-exact. One correction: 19.5% is a right-censored floor, not "true"; the report should have said so.
- **Claim 2 (replacement SQL correct + shape-compatible): CONFIRMED** — no blocking defect found after attacking guard asymmetry, double-credit, replace-view column rules, and frontend shape. Ship the researcher's SQL with the amended header comment below; fix the caption per below; update APPLY-kpi-views.sql in the same commit.

## SQL to ship (researcher's logic unchanged; header comment corrected to survive audit)

```sql
-- Connection acceptance per client. COHORT style: denominator = connection_notes
-- SENT in the window; numerator = those same rows whose prospect connected at/after
-- the note (connected_at >= sent_at). Replaces the prior trailing style, whose
-- numerator (accepts by connected_at) and denominator (sends by sent_at) were drawn
-- from disjoint populations — cross-cohort inflation, structurally unbounded (>100%
-- reachable in a send-throttle week). NOTE this number no longer matches the
-- trailing rate outreach_sender_health / inbox_governor react to — do not "reconcile" them.
-- Known, accepted edge semantics (measured 2026-07-24, do not re-litigate without new data):
--  * connected_at < sent_at (1 row ever): counts as a failed send in the denominator,
--    never in the numerator — a note to an already-connected prospect is a wasted send.
--  * two different notes to one prospect before a single accept (1 prospect ever):
--    both rows count as accepted; per-note over per-note stays <= 100%.
--  * Recent sends are right-censored: window rates are floors that rise as sends
--    mature (median accept lag 0.49d; ~90% of accepts land within 7d).
create or replace view inbox_accept_v with (security_invoker = on) as
with sends as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id, m.sent_at, p.connected_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound' and m.message_type = 'connection_note'
    and m.sent_at is not null
  order by m.prospect_id, m.message_text, m.sent_at, m.id
),
flagged as (
  select client_id, sent_at,
    (connected_at is not null and connected_at >= sent_at) as accepted
  from sends
)
select
  client_id,
  count(*) filter (where sent_at >= now() - interval '7 days')                          as sent_7d,
  count(*) filter (where sent_at >= now() - interval '7 days' and accepted)             as accepted_7d,
  count(*) filter (where sent_at >= now() - interval '30 days')                         as sent_30d,
  count(*) filter (where sent_at >= now() - interval '30 days' and accepted)            as accepted_30d,
  count(*)                                                                              as sent_total,
  count(*) filter (where accepted)                                                      as accepted_total,
  round(100.0 * count(*) filter (where sent_at >= now() - interval '7 days' and accepted)
        / nullif(count(*) filter (where sent_at >= now() - interval '7 days'),0), 1)    as rate_7d,
  round(100.0 * count(*) filter (where sent_at >= now() - interval '30 days' and accepted)
        / nullif(count(*) filter (where sent_at >= now() - interval '30 days'),0), 1)   as rate_30d
from flagged group by client_id;
```

Expected post-change values against today's snapshot: ivan 41/8/19.5 · 250/52/20.8 · 952/135; risedtc 57/3/5.3 · 57/3/5.3 · 57/3.

## UI caption copy to ship

Replace `OverviewView.tsx:138` (`"Connections sent recently haven't had time to accept."`) with:

> **Share of notes sent in each window that got accepted. Recent sends are still maturing — this rate only rises.**

Rationale: the old caption was written to excuse the trailing metric; the new one states cohort semantics in one line and turns the right-censoring bias into an explicit, correctly-signed caveat. Do not caption it as "acceptance rate" bare — the governor chip on the same screen carries a differently-defined accept %.
