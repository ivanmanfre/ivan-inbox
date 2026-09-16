# outreach_perf_payload: live replay notes

## Second replay after e6f8c1b (2026-09-17)

**SQL version replayed:** `db/069_outreach_perf_payload.sql` at commit `e6f8c1b`,
sha256 `8498e20a8087c76ca77d3cfcf86322575b71e8cc9c51a4cac4738ea4c6368195`. That exact file was
applied to `bjbvqvzbzczjbatgmccb` through the Management API (201, body `[]`) and every number and
alarm below was produced by it, so the alarm block reproduces against that hash.

Commit `e6f8c1b` changed the attribution guard from a strict count comparison (`s.n < d.n`) to a
complement floor (`(d.n - s.n) >= v_child_floor`, so a suspect child must leave at least 15 sends
outside it). Grants re-checked and unchanged: `outreach_perf_payload` and `audn_benchmark_payload`
are both anon=false, authenticated=true, service_role=true.

**The attribution defect is fixed, and the suspect did not go to none.** The RISE engager dm1 alarm
now reads `suspect=country share=0.7653`, where against the pre-fix function it read
`suspect=source share=0.9801`. The old suspect `rise_warm_engager` covered 111 of the cell's 111
sends and left a complement of zero, so the new floor excludes it, exactly as intended. A country
child then cleared the floor honestly: United States is 84 of 111 sends at 10.7%, leaving a
complement of 27, which is above the floor of 15. That is a real contrast against the 19.3%
baseline rather than a restatement of the cell. Ivan lane's alarm is unchanged at
`suspect=country share=0.6829`.

Everything else matches the first replay apart from one day of corpus movement, which is expected
because both windows roll:

- ivan cold dm1 went 0/2 to 0/3 and ivan warm dm3 went 0/7 to 0/8 as new sends matured past the
  7-day line.
- RISE engager dm1 went 112 to 111 current and 211 to 212 prior: one send aged across the 21-day
  boundary from the current window into the baseline. The rate moved 10.7% to 10.8% and the prior
  19.4% to 19.3%. The reply counts (12 and 41) did not move.
- ARCH is byte for byte identical. Reply basis is identical on all three lanes.

---

## (a) Reply basis per lane: threaded vs stamp-only

| client  | threaded | stamp-only |
|---------|----------|------------|
| ivan    | 94       | 0          |
| risedtc | 81       | 2          |
| arch    | 20       | 0          |

Threaded replies dominate everywhere. The stamp fallback (a `last_reply_at` newer than the send,
with no later send in between) contributes 2 replies in total, all on RISE. So the reply numbers
below are essentially all real threaded inbound, not inferred from a timestamp.

## (b) The cross-check lines and what they mean

The script now compares like for like and no line fails the run. Three causes separate the two
RPCs. The first two are measurement differences; the third is a population difference and is the
one that matters most when reading the cold lanes.

1. **Different denominator.** `lane_chain_weekly.reply_rate` divides by `accepted` on any
   accept-gated lane (cap watchdog line 286: `replyDen = r.has_accept ? Number(r.accepted) :
   Number(r.sends)`), while the payload divides by matured DM sends. The script therefore rebuilds
   the weekly rate as `replied / sends` and prints both denominators; the RPC's own `reply_rate` is
   shown alongside for reference only. On RISE engager the like-for-like comparison is weekly
   12/142 = 8.5% against payload dm1 12/111 = 10.8%, which passes at `ok`. Both sides report 12
   replies, though the two populations are not identical (different windows, different lane maps),
   so this is agreement in magnitude rather than a proof of the same underlying set.
2. **Different window and maturation.** Weekly covers the single closed week 2026-09-07 and is
   unmatured. The payload's current cell is the last 21 days of sends that are at least 7 days old.

3. **Different population: the active-only rule, and Poland.** This is the cause the two cold
   lines need, and maturation cannot explain them. Ivan's weekly `cold` lane carries 88 sends in
   one week while the payload's ivan cold cell has n = 3. No maturation window turns 88 into 3.
   The reason is that the payload counts only campaigns with `is_active = true`, per Ivan's
   instruction ("only show active lanes and dm sends"), and Ivan's two largest cold campaigns,
   "Agency-Focused Consultants & Fractionals" (89 matured sends in 90 days) and "Agency Owners &
   Ops Leaders" (82), are both flagged `is_active = false` while still producing sends. The weekly
   RPC has no such filter, so it counts them. On top of that, `lane_of` folds Poland Agencies into
   `cold` while the weekly RPC gives Poland its own `poland` lane (11 sends that week), so the two
   cold buckets do not even contain the same campaigns. RISE is the same story: its weekly cold
   carries 44 sends while the payload's cold cell has n = 1, because "RiseDTC Cold (DTC Sales Nav)"
   (46 matured) is `is_active = false`.

   **Read the cold lines accordingly.** A weekly 50% against a payload 0% on those lanes is not a
   maturation artifact and not a disagreement about reply counting. The two sides are measuring
   different campaigns. The script now prints `skip (thin)` on both of them, because the payload
   side is below the 30-send floor and the comparison would be meaningless either way.

Cross-check lines, verbatim from the run:

- `xcheck cold: weekly 3/88 sent = 3.4% (rpc reply_rate 50.0% over 6 acc) vs payload dm1 0/3 = 0.0% skip (thin)`
- `xcheck harvest: weekly 5/44 sent = 11.4% (rpc reply_rate 29.4% over 17 acc) vs payload dm1 6/29 = 20.7% skip (thin)`
- `xcheck engager: weekly 12/142 sent = 8.5% (rpc reply_rate 29.3% over 41 acc) vs payload dm1 12/111 = 10.8% ok`
- `xcheck cold: weekly 2/44 sent = 4.5% (rpc reply_rate 50.0% over 4 acc) vs payload dm1 0/1 = 0.0% skip (thin)`

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

## (c) Alarms that fired on live data

Two, both drift, none sibling. Produced by `db/069` at `e6f8c1b`, sha256 `8498e20a...6368195`.

1. **ivan / harvest / inmail: 4.8% now (2/42) versus 13.6% prior (30/220).** Suspect dimension
   country, share 0.68. The split is United States 1/26 (3.9%), United Kingdom 0/8, Canada 0/4,
   Spain 0/2, Ireland 1/1, UAE 0/1. The US subset is 26 of the 42 sends and carries most of the
   miss, so the InMail fall is concentrated in the US rather than spread across geographies.
2. **risedtc / engager / dm1: 10.8% now (12/111) versus 19.3% prior (41/212).** Suspect dimension
   country, share 0.77. The split is US 9/84 (10.7%), CA 1/12 (8.3%), GB 0/6, AU 1/4, FR 0/1,
   United States 0/1, BE 1/1, DE 0/1. The US subset is 84 of the 111 sends and is running at
   roughly half the baseline rate.

Both alarms point at country.

## Concerns

- **Campaigns flagged inactive are still sending.** Ivan's "Agency-Focused Consultants &
  Fractionals" (89 matured sends in 90 days) and "Agency Owners & Ops Leaders" (82), and
  "RiseDTC Cold (DTC Sales Nav)" (46), are all `is_active = false` yet account for the bulk of the
  weekly cold volume. The payload excludes them by design, which is why ivan cold reads n = 3 and
  RISE cold n = 1. Either the flags are stale or the cold lane is genuinely invisible on this
  view; Ivan should say which.
- **The country dimension mixes ISO codes and full names.** RISE carries both `US` (84 sends) and
  `United States` (1 send) in the same split; ivan uses full names throughout. Normalise before
  rendering the split as an explanation, or a country child will be split across two rows and
  understated.
- **Ivan's warm lane has gone quiet.** "Creators' Lead-Magnet Commenters" has 133 matured sends in
  90 days but 0 dm1 in the current 21-day window (warm dm1 now 0/0, prior 11/60). No alarm can
  fire on a lane that stopped sending, so silence there will never be flagged.
- **ARCH has no baseline at all.** Every ARCH cell reads prior 0/0 and status thin, because ARCH
  has no matured sends older than 81 days. Drift detection on ARCH is inert until roughly late
  October. ARCH cold dm1 at 30.8% (16/52) is real but currently uncomparable.
- **The Management API returns intermittent 544 timeouts.** The first apply needed several
  attempts; later applies needed none. Scripted DDL on this project should retry.
- *(Closed)* The vacuous-attribution defect, where the guard `s.n < d.n` let a child covering
  nearly the whole cell claim to explain it, was **fixed in `e6f8c1b`** and the second replay ran
  against the fixed function. It is no longer open. See the RISE alarm above for the corrected
  behaviour.

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

No lane is missing because of a SQL error. No rate exceeds 1. No active, currently-sending lane is
absent.

---

## Raw replay output (db/069 at e6f8c1b, sha256 8498e20a...6368195)

```
run 2026-09-16T22:19:42.933Z · cross-check week_start 2026-09-07
exit 3 = transport/shape · exit 1 = impossible value · WARN = like-for-like rate gap > 5 points

== ivan · threaded 94 · stamp_only 0
cold                 dm1    now 0/3 (0.0%)  prior 0/0 (0.0%)  thin
engager              dm1    now 0/0 (0.0%)  prior 0/2 (0.0%)  thin
harvest              dm1    now 6/29 (20.7%)  prior 30/129 (23.3%)  thin
harvest              dm3    now 1/10 (10.0%)  prior 1/9 (11.1%)  thin
harvest              inmail now 2/42 (4.8%)  prior 30/220 (13.6%)  drift
harvest              nudge  now 2/20 (10.0%)  prior 3/62 (4.8%)  thin
  ALARM drift inmail  4.8% vs 13.6% suspect=country share=0.6829
warm                 dm1    now 0/0 (0.0%)  prior 11/60 (18.3%)  thin
warm                 dm3    now 0/8 (0.0%)  prior 1/8 (12.5%)  thin
warm                 inmail now 0/1 (0.0%)  prior 3/22 (13.6%)  thin
warm                 nudge  now 0/0 (0.0%)  prior 3/33 (9.1%)  thin
  lanes in payload: cold, engager, harvest, warm
  xcheck cold: weekly 3/88 sent = 3.4% (rpc reply_rate 50.0% over 6 acc) vs payload dm1 0/3 = 0.0% skip (thin)
  xcheck harvest: weekly 5/44 sent = 11.4% (rpc reply_rate 29.4% over 17 acc) vs payload dm1 6/29 = 20.7% skip (thin)
  xcheck poland: no dm1 cell in payload (weekly sends 11, replied 1)
  xcheck inmail: no dm1 cell in payload (weekly sends 5, replied 0)
  xcheck profile_view: no dm1 cell in payload (weekly sends 3, replied 0)
  xcheck own_post_engager: no dm1 cell in payload (weekly sends 1, replied 0)
  xcheck kyle: no dm1 cell in payload (weekly sends 0, replied 1)
  xcheck lm_commenters: no dm1 cell in payload (weekly sends 0, replied 0)

== risedtc · threaded 81 · stamp_only 2
cold                 dm1    now 0/1 (0.0%)  prior 3/5 (60.0%)  thin
engager              dm1    now 12/111 (10.8%)  prior 41/212 (19.3%)  drift
engager              dm3    now 0/15 (0.0%)  prior 0/0 (0.0%)  thin
engager              inmail now 1/31 (3.2%)  prior 5/65 (7.7%)  ok
engager              nudge  now 4/84 (4.8%)  prior 10/136 (7.3%)  ok
  ALARM drift dm1  10.8% vs 19.3% suspect=country share=0.7653
warm                 dm1    now 0/0 (0.0%)  prior 1/3 (33.3%)  thin
warm                 dm3    now 0/1 (0.0%)  prior 0/0 (0.0%)  thin
warm                 inmail now 1/2 (50.0%)  prior 5/21 (23.8%)  thin
warm                 nudge  now 0/0 (0.0%)  prior 0/4 (0.0%)  thin
  lanes in payload: cold, engager, warm
  xcheck engager: weekly 12/142 sent = 8.5% (rpc reply_rate 29.3% over 41 acc) vs payload dm1 12/111 = 10.8% ok
  xcheck cold: weekly 2/44 sent = 4.5% (rpc reply_rate 50.0% over 4 acc) vs payload dm1 0/1 = 0.0% skip (thin)
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
