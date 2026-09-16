# outreach_perf_payload: live replay notes

## Fourth replay after 6a33c4d (2026-09-17)

**SQL version replayed:** `db/069_outreach_perf_payload.sql` at commit `6a33c4d`,
sha256 `31cebc4aff4706961da4b54b1dc11ab644d6ada5475b08fa880accd085755763`. Applied through the
Management API with a 5-attempt retry loop on 544; succeeded on the first attempt (201, body `[]`).
The change is the verdict floor, `v_floor` 30 to 20; the child floor stays 15. The script's own
thin constant was lowered to 20 in the same round so both sides agree on what counts as thin.

Grants re-checked for all four functions against the control, all identical:

```
audn_benchmark_payload   anon=False  authenticated=True  service_role=True
outreach_perf_payload    anon=False  authenticated=True  service_role=True
perf_country_key         anon=False  authenticated=True  service_role=True
perf_wilson_upper        anon=False  authenticated=True  service_role=True
```

**Exit 0.** No IMPOSSIBLE, no transport or shape failure. One WARN, explained below.

### Every alarm, verbatim

```
ivan:    ALARM drift dm1     4.5% vs 29.6% suspect=none share=-
ivan:    ALARM drift inmail  4.8% vs 13.6% suspect=country share=0.6829
risedtc: ALARM drift dm1    10.8% vs 19.3% suspect=country share=0.7857
arch:    (no alarms)
```

### What changed versus the third replay, in words

**1. Ivan cold dm1 now fires, as predicted.** `cold dm1 now 1/22 (4.5%) prior 8/27 (29.6%)` moved
from `thin` to `drift` and raised `ALARM drift dm1 4.5% vs 29.6%`. This is the 25-point fall the
third replay flagged as the largest in the payload and unreportable; the floor change makes it
reportable. It is the only new alarm.

**2. Ivan cold inmail did NOT fire, and could not have.** The expectation allowed for it, but
`cold inmail now 1/28 (3.6%) prior 1/48 (2.1%)` is a rate that went **up**, not down. Drift only
triggers on a fall, so no floor would have produced an alarm here. It moved from `thin` to `ok`,
which is the correct verdict: judged, and healthy.

**3. The new cold alarm carries no suspect, and that is structural rather than a bug.**
`suspect=none`. With a verdict floor of 20 and a child floor of 15, attribution needs a child of at
least 15 that still leaves at least 15 outside it, so it needs a cell of at least 30. A 22-send
cell can now raise an alarm but can never name a suspect. Every cell between 20 and 29 is in that
band. The alarm is still correct, it just says "this fell" without "and here is where". Flagged as
an open concern below.

**4. Three cells moved from unjudged to judged healthy.** ivan harvest dm1 (6/29 against 30/129),
ivan harvest nudge (2/20 against 3/62) and ivan cold inmail (1/28 against 1/48) all went `thin` to
`ok`. Lowering the floor did not only add alarms; it also converted cells that were previously
silent into positive statements that they are fine.

**5. The first WARN of any replay appeared, and the run still passed.**
`xcheck harvest: weekly 5/44 sent = 11.4% ... vs payload dm1 6/29 = 20.7% WARN`. This line was
`skip (thin)` before only because the payload side, 29, was under the old floor of 30. The 9.3
point gap is the familiar population and window difference: weekly is one unmatured week counting
every step on the lane, while the payload is 21 days of matured dm1 only. It is a WARN and not a
failure, which is exactly the exit-code separation working as designed.

**6. Ivan cold's cross-check became a real comparison**, which the third replay predicted would
happen once the floor allowed it: `xcheck cold: weekly 3/88 sent = 3.4% ... vs payload dm1 1/22 =
4.5% ok`. The two sides agree within about a point now that the same campaigns sit on both.

**7. RISE and ARCH are unchanged.** RISE cold cells are all still under 20 (1, 0 and 2 current), so
nothing there crossed the new floor, and ARCH still has no baseline at all. Reply basis is
identical on all three lanes: ivan 108/0, risedtc 86/2, arch 20/0.

---

## Third replay after e0033f9 (2026-09-17)

**SQL version replayed:** `db/069_outreach_perf_payload.sql` at commit `e0033f9`,
sha256 `6415c4495d1f6f447990d330aa49cdddab322fae4ad22b601fafcd06e43f6115`. Applied through the
Management API with a 5-attempt retry loop on 544; it succeeded on the first attempt (201, body
`[]`), so no retries were consumed. Every number in this section was produced by that file.

Grants re-checked for all three functions the file defines, against the `audn_benchmark_payload`
control. All four match:

```
audn_benchmark_payload   anon=False  authenticated=True  service_role=True
outreach_perf_payload    anon=False  authenticated=True  service_role=True
perf_country_key         anon=False  authenticated=True  service_role=True
perf_wilson_upper        anon=False  authenticated=True  service_role=True
```

Replay re-run for all three lanes with the key in the environment only. **Exit 0.** No WARN, no
IMPOSSIBLE, no transport or shape failure.

### What changed versus the second replay, in words

`e0033f9` did two things: campaign scope became not-archived AND (flagged active OR still sending a
matured DM inside the current window), and country spellings now fold through `perf_country_key`.
Both landed, and the effect is confined to where it was predicted.

**1. The cold lanes are no longer empty.** This is the big change, and it answers the concern the
second replay raised about inactive-flagged campaigns that kept sending.

- Ivan cold went from a single `dm1 0/3` cell to a full four-step ladder: `dm1 1/22` (prior 8/27),
  `dm3 0/3` (prior 2/7), `inmail 1/28` (prior 1/48), `nudge 0/10` (prior 1/20). That is 63 current
  and 102 baseline sends where there were 3 and 0, so roughly 165 sends re-entered scope. That is
  in line with the expected 89 + 82 matured from "Agency-Focused Consultants & Fractionals" and
  "Agency Owners & Ops Leaders", the balance being sends in days 81 to 90 that the baseline window
  excludes by design.
- RISE cold went from `dm1 0/1` alone to `dm1 0/1` (prior 6/17), `inmail 0/0` (prior 2/27),
  `nudge 0/2` (prior 0/5): 3 current and 49 baseline, against the expected ~46 matured from
  "RiseDTC Cold (DTC Sales Nav)". The RISE cold dm1 baseline also thickened from 3/5 to 6/17.
- Reply basis rose accordingly: ivan threaded 94 to 108, RISE threaded 81 to 86. Stamp-only is
  unchanged at 0 / 2 / 0, so every recovered reply is threaded inbound.

**2. Country now shows one US bucket.** In the RISE engager dm1 alarm the second replay listed
`US` 84 and `United States` 1 as two separate rows; they are now a single `US` 9/85. Ivan's harvest
inmail split changed spelling the same way, `United States` to `US` and `United Kingdom` to `UK`,
with the same counts. The RISE suspect share moved from 0.7653 to 0.7857 as a direct result of the
merge. No other alarm field moved.

**3. ARCH is byte for byte unchanged**, as expected: it has no inactive-but-sending campaigns and
its country values were already single-spelling.

### Does any new alarm fire on cold? No, and the reason matters

**No new alarm fired.** Both alarms are the same two as the second replay, and neither is on a cold
lane. But the most dramatic fall anywhere in the payload is now sitting in a cold cell and is being
suppressed by the sample floor:

- **ivan cold dm1: 4.5% now (1/22) against 29.6% prior (8/27).** That is a 25-point drop, far
  larger than either alarm that did fire. It is marked `thin` and cannot alarm because both sides
  are under the 30-send floor (22 and 27). It is within a handful of sends of qualifying.
- ivan cold inmail (28 current) is likewise one or two sends short of the floor.

So the cold lane is now visible but still cannot raise an alarm. Ivan should see that number even
though the function refuses to flag it, and it is worth deciding whether the floor of 30 is right
for a lane that sends in small batches.

### Cross-check: the cold lines did not become real comparisons

The expectation was that the cold cross-check lines might move from `skip (thin)` to a real
comparison. They did not, on either client, and for different reasons:

- ivan cold: the payload side is now 22, up from 3, but still below the script's floor of 30. The
  line reads `weekly 3/88 sent = 3.4% ... vs payload dm1 1/22 = 4.5% skip (thin)`. Worth noting
  the two rates are now close (3.4% against 4.5%) where before they were 3.4% against 0.0%, which
  is what you would expect once the same campaigns are on both sides.
- RISE cold: the payload dm1 side is still 1, because the recovered RISE cold volume is almost all
  baseline (49 of 52 sends) rather than current. Nothing to compare yet.

The one real comparison, RISE engager, is unchanged and still `ok` (weekly 12/142 = 8.5% against
payload 12/111 = 10.8%).

---

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

Three, all drift, none sibling. Current values below are from the fourth replay, produced by
`db/069` at `6a33c4d`, sha256 `31cebc4a...755763`, with the verdict floor at 20.

1. **ivan / cold / dm1: 4.5% now (1/22) versus 29.6% prior (8/27).** Suspect dimension none. This
   is the largest fall in the payload, a 25-point drop, and it became reportable only when the
   verdict floor dropped from 30 to 20 in `6a33c4d`. It carries no suspect because attribution
   needs a child of at least 15 that leaves at least 15 outside it, which is impossible in a
   22-send cell; see the concerns.
2. **ivan / harvest / inmail: 4.8% now (2/42) versus 13.6% prior (30/220).** Suspect dimension
   country, share 0.68. The split is US 1/26 (3.9%), UK 0/8, Canada 0/4, Spain 0/2, Ireland 1/1,
   United Arab Emirates 0/1. The US subset is 26 of the 42 sends and carries most of the miss, so
   the InMail fall is concentrated in the US rather than spread across geographies.
3. **risedtc / engager / dm1: 10.8% now (12/111) versus 19.3% prior (41/212).** Suspect dimension
   country, share 0.79. The split is US 9/85 (10.6%), CA 1/12 (8.3%), GB 0/6, AU 1/4, FR 0/1,
   BE 1/1, DE 0/1, SG 0/1. The US subset is 85 of the 111 sends and is running at roughly half the
   baseline rate. `US` and `United States` are one bucket here since `e0033f9`.

Two of the three point at country. The third, ivan cold dm1, is unattributed by construction.
Ivan cold inmail (1/28 against 1/48) does **not** alarm and never could: its rate rose rather than
fell, and drift only triggers on a fall. It reads `ok`.

## Concerns

- **A cell between 20 and 29 sends can alarm but can never name a suspect.** With the verdict
  floor now 20 and the child floor still 15, attribution needs a child of at least 15 that leaves
  at least 15 outside it, so it needs a cell of at least 30. ivan cold dm1 (22 sends) is the live
  example: it raises a correct alarm and reports `suspect=none`. The alarm says "this fell"
  without "and here is where". Either that band is accepted as alarm-only, or the child floor
  needs to scale with the cell rather than sit at a fixed 15.
- **The campaign flags are still stale, even though the payload now routes around them.** Ivan's
  "Agency-Focused Consultants & Fractionals" (89 matured sends in 90 days) and "Agency Owners &
  Ops Leaders" (82), and "RiseDTC Cold (DTC Sales Nav)" (46), are all `is_active = false` while
  still sending. `e0033f9` keeps them in scope on the strength of their sends, so the numbers are
  right, but the flags themselves say something untrue about the campaigns and anything else
  reading `is_active` will still be wrong.
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
  against the fixed function. See the RISE alarm above for the corrected behaviour.
- *(Closed)* The cold lane being empty under the active-only rule was **fixed in `e0033f9`**,
  which keeps a not-archived campaign in scope when it is still sending. Ivan cold went from 3
  sends to 165, RISE cold from 1 to 52.
- *(Closed)* The country dimension mixing ISO codes and full names was **fixed in `e0033f9`** via
  `perf_country_key`. The third replay shows one `US` bucket per split.
- *(Closed)* The cold lane being visible but unable to alarm was **fixed in `6a33c4d`**, which
  lowered the verdict floor from 30 to 20. ivan cold dm1 now fires, and three further cells moved
  from unjudged to judged healthy. The script's own thin constant was lowered to 20 to match.

## Lanes present, and the active lanes that are missing and why

Verified against a live dump of `outreach_campaigns` joined to matured send counts.

- **ivan** payload lanes: cold, engager, harvest, warm.
  Missing `signal`: the four "Quiet on LinkedIn" campaigns have 0 sends in 90 days, so they are
  neither active-with-sends nor still-sending.
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

## Raw replay output (fourth replay, db/069 at 6a33c4d, sha256 31cebc4a...755763)

```
run 2026-09-16T22:29:53.151Z · cross-check week_start 2026-09-07
exit 3 = transport/shape · exit 1 = impossible value · WARN = like-for-like rate gap > 5 points

== ivan · threaded 108 · stamp_only 0
cold                 dm1    now 1/22 (4.5%)  prior 8/27 (29.6%)  drift
cold                 dm3    now 0/3 (0.0%)  prior 2/7 (28.6%)  thin
cold                 inmail now 1/28 (3.6%)  prior 1/48 (2.1%)  ok
cold                 nudge  now 0/10 (0.0%)  prior 1/20 (5.0%)  thin
  ALARM drift dm1  4.5% vs 29.6% suspect=none share=-
engager              dm1    now 0/0 (0.0%)  prior 0/2 (0.0%)  thin
harvest              dm1    now 6/29 (20.7%)  prior 30/129 (23.3%)  ok
harvest              dm3    now 1/10 (10.0%)  prior 1/9 (11.1%)  thin
harvest              inmail now 2/42 (4.8%)  prior 30/220 (13.6%)  drift
harvest              nudge  now 2/20 (10.0%)  prior 3/62 (4.8%)  ok
  ALARM drift inmail  4.8% vs 13.6% suspect=country share=0.6829
warm                 dm1    now 0/0 (0.0%)  prior 11/60 (18.3%)  thin
warm                 dm3    now 0/8 (0.0%)  prior 1/8 (12.5%)  thin
warm                 inmail now 0/1 (0.0%)  prior 3/22 (13.6%)  thin
warm                 nudge  now 0/0 (0.0%)  prior 3/33 (9.1%)  thin
  lanes in payload: cold, engager, harvest, warm
  xcheck cold: weekly 3/88 sent = 3.4% (rpc reply_rate 50.0% over 6 acc) vs payload dm1 1/22 = 4.5% ok
  xcheck harvest: weekly 5/44 sent = 11.4% (rpc reply_rate 29.4% over 17 acc) vs payload dm1 6/29 = 20.7% WARN
  xcheck poland: no dm1 cell in payload (weekly sends 11, replied 1)
  xcheck inmail: no dm1 cell in payload (weekly sends 5, replied 0)
  xcheck profile_view: no dm1 cell in payload (weekly sends 3, replied 0)
  xcheck own_post_engager: no dm1 cell in payload (weekly sends 1, replied 0)
  xcheck kyle: no dm1 cell in payload (weekly sends 0, replied 1)
  xcheck lm_commenters: no dm1 cell in payload (weekly sends 0, replied 0)

== risedtc · threaded 86 · stamp_only 2
cold                 dm1    now 0/1 (0.0%)  prior 6/17 (35.3%)  thin
cold                 inmail now 0/0 (0.0%)  prior 2/27 (7.4%)  thin
cold                 nudge  now 0/2 (0.0%)  prior 0/5 (0.0%)  thin
engager              dm1    now 12/111 (10.8%)  prior 41/212 (19.3%)  drift
engager              dm3    now 0/15 (0.0%)  prior 0/0 (0.0%)  thin
engager              inmail now 1/31 (3.2%)  prior 5/65 (7.7%)  ok
engager              nudge  now 4/84 (4.8%)  prior 10/136 (7.3%)  ok
  ALARM drift dm1  10.8% vs 19.3% suspect=country share=0.7857
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

- Weekly WhatsApp digest wired: n8n workflow `Outreach - Perf Alerts (weekly)` id `HumBEynfiGtRRrb4`, active=true (Monday 08:00 Europe/Warsaw + POST webhook `perf-alerts-now`); forced run execution `1774207` status success, sent: 3 (ivan cold DM1, ivan harvest InMail, [RISE] engager DM1; arch none).
