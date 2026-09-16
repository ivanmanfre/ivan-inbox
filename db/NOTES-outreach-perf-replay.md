# outreach_perf_payload: first live replay (2026-09-16)

Applied `db/069_outreach_perf_payload.sql` to `bjbvqvzbzczjbatgmccb` through the Management API
(201, body `[]`). Grants match the benchmark control: `outreach_perf_payload` and
`audn_benchmark_payload` are both anon=false, authenticated=true, service_role=true.

Replay command: `SUPABASE_SERVICE_KEY=... node scripts/verify-outreach-perf.mjs`. Exit 1, which is
the cross-check flag and not a payload error. Every CHECK line is explained below.

## (a) Reply basis per lane: threaded vs stamp-only

| client  | threaded | stamp-only |
|---------|----------|------------|
| ivan    | 94       | 0          |
| risedtc | 81       | 2          |
| arch    | 20       | 0          |

Threaded replies dominate everywhere. The stamp fallback (a `last_reply_at` newer than the send,
with no later send in between) contributes 2 replies in total, all on RISE. So the reply numbers
below are essentially all real threaded inbound, not inferred from a timestamp.

## (b) The CHECK lines and why they are not bugs

Four CHECK lines fired, all on the same two causes. Neither is a defect in the payload.

1. **Different denominator.** `lane_chain_weekly` is cohort based: its `reply_rate` divides by
   `accepted` whenever the lane has an accept step, not by sends. `outreach_perf_payload` divides
   by matured DM sends. So the weekly number is structurally larger on every lane that gates on an
   accept. RISE engager is the clearest case: weekly 29.3% is 12 replied over 41 accepted, while
   the payload's 10.7% is the same 12 replies over 112 matured dm1 sends. The replies agree exactly.
   The rates differ because the denominators are different questions.
2. **Different window and maturation.** Weekly covers the single closed week 2026-09-07 and is
   unmatured. The payload's current cell is the last 21 days of sends that are at least 7 days old.
   On the two thin cold lanes (ivan cold 3/6 accepted, RISE cold 2/4 accepted) the weekly
   denominator is under ten, so its rate swings to 50% on a couple of replies.

CHECK lines, verbatim from the run:

- `xcheck cold: weekly reply_rate 50.0% (3 replied / 88 sent / 6 acc) vs payload dm1 0.0% CHECK`
  Weekly divides 3 by 6 accepted. The payload's ivan cold cell has 2 matured sends in the window
  (Poland Agencies), both without a reply. Denominator plus tiny-n, not a bug.
- `xcheck harvest: weekly reply_rate 29.4% (5 replied / 44 sent / 17 acc) vs payload dm1 20.7% CHECK`
  5 over 17 accepted versus 6 over 29 matured sends. Denominator, not a bug.
- `xcheck engager: weekly reply_rate 29.3% (12 replied / 142 sent / 41 acc) vs payload dm1 10.7% CHECK`
  Same 12 replies on both sides. Denominator, not a bug.
- `xcheck cold: weekly reply_rate 50.0% (2 replied / 44 sent / 4 acc) vs payload dm1 0.0% CHECK`
  2 over 4 accepted versus 0 over 1 matured send. Denominator plus tiny-n, not a bug.

## (b2) The two RPCs do not share a lane vocabulary

This is the finding the cross-check surfaced that the brief did not anticipate, and it is worth a
decision before the UI is built.

`outreach_perf_payload` derives the lane with `lane_of(campaign.name)`, which collapses everything
into six buckets: signal, partner, harvest, engager, warm, cold. `lane_chain_weekly` reads
`enrichment_data->>'lane'` off the prospect first, falls back to its own campaign-name map, and
then moves any prospect whose first touch was an InMail into a synthetic `inmail` lane. Its lanes
are therefore prospect level and much finer: poland, profile_view, kyle, orbit, lm_commenters,
engager_warm, hiring_signal, israel_trip, cold_games, and so on.

The consequence in the run is every `no dm1 cell in payload` line. Those are not missing data.
They are lanes that exist in the weekly vocabulary and have no counterpart name in ours, for
example ARCH `engager_warm` with 76 sends, which our payload counts inside `engager`. The two
surfaces will not line up lane for lane in the UI. Ivan should pick one axis.

## (c) Alarms that fired on live data today

Two, both drift, none sibling.

1. **ivan / harvest / inmail: 4.8% now (2/42) versus 13.6% prior (30/220).** Suspect dimension
   country, share 0.68. The split is United States 1/26 (3.9%), United Kingdom 0/8, Canada 0/4,
   Spain 0/2, Ireland 1/1, UAE 0/1. The US subset is 26 of the 42 sends and carries most of the
   miss, so the InMail fall is concentrated in the US rather than spread across geographies.
2. **risedtc / engager / dm1: 10.7% now (12/112) versus 19.4% prior (41/211).** Suspect dimension
   source, share 0.98. The split is `rise_warm_engager` 12/111 and `competitor_engager_mega_r2`
   0/1.

Alarm 2 exposes a defect in the attribution guard, see concerns.

## Concerns

- **The suspect on RISE engager is vacuous.** The attribution step skips a child that IS the whole
  cell with `s.n < d.n`, a strict count inequality. A child of 111 in a cell of 112 passes that
  test and then claims to explain 98% of the missing replies, which only restates the cell. The
  guard needs a proportional floor (the child must leave a real remainder, for example at most
  ~80% of the cell) rather than a strict count comparison. Until then, treat `suspect_dim` as
  meaningless whenever `suspect_share` is near 1 and the split has one dominant value.
- **The active-only rule hides most of Ivan's and RISE's cold history.** Ivan's "Agency Owners &
  Ops Leaders" (82 matured sends) and "Agency-Focused Consultants & Fractionals" (89) are
  `is_active = false`, as is "RiseDTC Cold (DTC Sales Nav)" (46). They are excluded by design,
  which is why ivan cold shows n=2 and RISE cold shows n=1. That follows Ivan's instruction
  ("only show active lanes and dm sends") but it means the cold lane on both clients is
  effectively empty on this view.
- **Ivan's warm lane has gone quiet.** "Creators' Lead-Magnet Commenters" has 133 matured sends in
  90 days but 0 in the current 21-day window (warm dm1 now 0/0, prior 11/60). No alarm can fire on
  a lane that stopped sending, so silence there will never be flagged.
- **ARCH has no baseline at all.** Every ARCH cell reads prior 0/0 and status thin, because ARCH
  has no matured sends older than 81 days. Drift detection on ARCH is inert until roughly late
  October. ARCH cold dm1 at 30.8% (16/52) is real but currently uncomparable.

## Lanes present, and the active lanes that are missing and why

Verified against a live dump of `outreach_campaigns` joined to matured send counts.

- **ivan** payload lanes: cold, engager, harvest, warm.
  Missing `signal`: the four active "Quiet on LinkedIn" campaigns have 0 sends in 90 days.
  Legitimate. Missing `partner`: Ivan has no partner campaign. Poland Agencies and the Agency
  Owners campaigns are not separate lanes here, they fold into `cold` by `lane_of`; Profile View
  folds into `engager`.
- **risedtc** payload lanes: cold, engager, warm.
  Missing `partner`: "RiseDTC Fractional CMO Partners" is active with 8 sends in 90 days, but all
  8 are inside the 7-day maturation window, so 0 matured. Legitimate. Competitor Engagers and
  Profile View both fold into `engager`; Client Orbit and Network Activation fold into `warm`.
- **arch** payload lanes: cold, engager.
  Missing `warm`: "Network Activation" and "Client Orbit" are both active with 0 sends in 90 days.
  Legitimate. "Warm (his engagers)" folds into `engager`.

No lane is missing because of a SQL error. Cell totals reconcile against the campaign dump exactly
(ARCH cold 87 = 52+21+14, ARCH engager 29 = 18+3+8, RISE engager 654 = 242 current + 412 base,
RISE warm 31 = 3 + 28). No rate exceeds 1. No active, currently-sending lane is absent.

---

## Raw replay output

```
run 2026-09-16T18:57:36.257Z · cross-check week_start 2026-09-07

== ivan · threaded 94 · stamp_only 0
cold                 dm1    now 0/2 (0.0%)  prior 0/0 (0.0%)  thin
engager              dm1    now 0/0 (0.0%)  prior 0/2 (0.0%)  thin
harvest              dm1    now 6/29 (20.7%)  prior 30/129 (23.3%)  thin
harvest              dm3    now 1/10 (10.0%)  prior 1/9 (11.1%)  thin
harvest              inmail now 2/42 (4.8%)  prior 30/220 (13.6%)  drift
harvest              nudge  now 2/20 (10.0%)  prior 3/62 (4.8%)  thin
  ALARM drift inmail  4.8% vs 13.6% suspect=country share=0.6829
warm                 dm1    now 0/0 (0.0%)  prior 11/60 (18.3%)  thin
warm                 dm3    now 0/7 (0.0%)  prior 1/8 (12.5%)  thin
warm                 inmail now 0/1 (0.0%)  prior 3/22 (13.6%)  thin
warm                 nudge  now 0/0 (0.0%)  prior 3/33 (9.1%)  thin
  lanes in payload: cold, engager, harvest, warm
  xcheck cold: weekly reply_rate 50.0% (3 replied / 88 sent / 6 acc, thin=false) vs payload dm1 0.0% CHECK
  xcheck harvest: weekly reply_rate 29.4% (5 replied / 44 sent / 17 acc, thin=false) vs payload dm1 20.7% CHECK
  xcheck poland: no dm1 cell in payload (weekly sends 11, replied 1)
  xcheck inmail: no dm1 cell in payload (weekly sends 5, replied 0)
  xcheck profile_view: no dm1 cell in payload (weekly sends 3, replied 0)
  xcheck own_post_engager: no dm1 cell in payload (weekly sends 1, replied 0)
  xcheck kyle: no dm1 cell in payload (weekly sends 0, replied 1)
  xcheck lm_commenters: no dm1 cell in payload (weekly sends 0, replied 0)

== risedtc · threaded 81 · stamp_only 2
cold                 dm1    now 0/1 (0.0%)  prior 3/5 (60.0%)  thin
engager              dm1    now 12/112 (10.7%)  prior 41/211 (19.4%)  drift
engager              dm3    now 0/15 (0.0%)  prior 0/0 (0.0%)  thin
engager              inmail now 1/31 (3.2%)  prior 5/65 (7.7%)  ok
engager              nudge  now 4/84 (4.8%)  prior 10/136 (7.3%)  ok
  ALARM drift dm1  10.7% vs 19.4% suspect=source share=0.9801
warm                 dm1    now 0/0 (0.0%)  prior 1/3 (33.3%)  thin
warm                 dm3    now 0/1 (0.0%)  prior 0/0 (0.0%)  thin
warm                 inmail now 1/2 (50.0%)  prior 5/21 (23.8%)  thin
warm                 nudge  now 0/0 (0.0%)  prior 0/4 (0.0%)  thin
  lanes in payload: cold, engager, warm
  xcheck engager: weekly reply_rate 29.3% (12 replied / 142 sent / 41 acc, thin=false) vs payload dm1 10.7% CHECK
  xcheck cold: weekly reply_rate 50.0% (2 replied / 44 sent / 4 acc, thin=false) vs payload dm1 0.0% CHECK
  xcheck inmail: no dm1 cell in payload (weekly sends 18, replied 3)
  xcheck orbit: no dm1 cell in payload (weekly sends 0, replied 1)

== arch · threaded 20 · stamp_only 0
cold                 dm1    now 16/52 (30.8%)  prior 0/0 (0.0%)  thin
cold                 inmail now 1/21 (4.8%)  prior 0/0 (0.0%)  thin
cold                 nudge  now 1/14 (7.1%)  prior 0/0 (0.0%)  thin
engager              dm1    now 2/18 (11.1%)  prior 0/0 (0.0%)  thin
engager              inmail now 0/3 (0.0%)  prior 0/0 (0.0%)  thin
engager              nudge  now 0/8 (0.0%)  prior 0/0 (0.0%)  thin
  lanes in payload: cold, engager
  xcheck engager_warm: no dm1 cell in payload (weekly sends 76, replied 5)
  xcheck inmail: no dm1 cell in payload (weekly sends 18, replied 2)
  xcheck hiring_signal: no dm1 cell in payload (weekly sends 11, replied 1)
  xcheck cold_games: no dm1 cell in payload (weekly sends 9, replied 0)
  xcheck israel_trip: no dm1 cell in payload (weekly sends 9, replied 1)
  xcheck soft_launch: no dm1 cell in payload (weekly sends 3, replied 0)
  xcheck hand_raise: no dm1 cell in payload (weekly sends 2, replied 1)
  xcheck funding_signal: no dm1 cell in payload (weekly sends 1, replied 0)
  xcheck cold_apps: no dm1 cell in payload (weekly sends 0, replied 2)
  xcheck new_in_role: no dm1 cell in payload (weekly sends 0, replied 0)
  xcheck orbit_pilot_fintech: no dm1 cell in payload (weekly sends 0, replied 1)
  xcheck sponsor_team: no dm1 cell in payload (weekly sends 0, replied 0)
```
