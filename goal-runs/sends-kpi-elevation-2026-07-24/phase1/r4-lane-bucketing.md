# F4 — Lane bucketing audit of `lane_of()` (db/006_kpi_pipeline.sql)

Read-only audit via Supabase REST (`outreach_campaigns`, `outreach_prospects`, `inbox_pipeline_v`).
27 rows in `outreach_campaigns`. 6,271 rows in `outreach_prospects`.

## `lane_of()` logic (current, verbatim)

```sql
create or replace function lane_of(camp_name text) returns text
language sql immutable as $$
  select case
    when camp_name ilike '%engager%' or camp_name ilike '%engagement harvest%'
      or camp_name ilike '%anchor%' or camp_name ilike '%profile view%'   then 'engager'
    when camp_name ilike '%warm%' or camp_name ilike '%orbit%'
      or camp_name ilike '%network activation%'                           then 'warm'
    else 'cold'
  end
$$;
```

Key structural fact: **the `engager` branch is checked before the `warm` branch.** Any name containing both
"warm" and "engager"/"engagers" (there are three of these) resolves to `engager`, not `warm`. This turns out
to be load-bearing and correct (see below) — it is not an accident to fix.

## Per-campaign trigger_type distribution (all 27 campaigns)

| Campaign | client_id | is_active | lane_of() result | trigger_type mix (n) | Verdict |
|---|---|---|---|---|---|
| Accounting & Tax Advisory Firms | ivan | false | cold | mostly NULL (156), industry_signal 17, company_news 13 | Correct — bare vertical, cold sourced |
| Agency Owners & Ops Leaders | ivan | true | cold | mostly NULL (661) | Correct |
| Agency-Focused Consultants & Fractionals | ivan | true | cold | mostly NULL (1011) | Correct |
| Architecture & Interior Design Firms | ivan | false/archived | cold | n=12, mixed | Correct |
| Coaches & Advisors (Boutique Practices) | ivan | false | cold | mostly NULL (186) | Correct |
| Construction & Trades | ivan | false/archived | cold | n=28, mixed | Correct |
| Consultancies & Strategy Firms | ivan | false | cold | mostly NULL (164) | Correct |
| Creative & Brand Agencies | ivan | false | cold | **0 prospects** | Correct (dormant) |
| Email Lane — Agencies (Cold) | ivan | false | cold | NULL (85) | Correct, explicit |
| Law Firms (Boutique) | ivan | false/archived | cold | n=20, mixed | Correct |
| Manufacturing & Industrial Ops | ivan | false/archived | cold | n=28, mixed | Correct |
| Marketing & Creative Agencies | ivan | false | cold | mostly NULL (186) | Correct |
| Paid-Media & Performance Agencies | ivan | false | cold | **0 prospects** | Correct (dormant) |
| **Profile View — Ivan** | ivan | true | **engager** | `profile_view`: 4/4 (100%) | See "Profile-view" verdict below |
| Property Management Companies | ivan | false/archived | cold | n=23, mixed | Correct |
| Real Estate Brokerages | ivan | false/archived | cold | n=32, mixed | Correct |
| Research Firms & Insights Practices | ivan | false | cold | mostly NULL (169) | Correct |
| RiseDTC — Client Orbit (clients' networks) | risedtc | true | warm | NULL (38) | Correct — mines client's existing network, matches "orbit" |
| RiseDTC — Cold (DTC Sales Nav) | risedtc | true | cold | NULL (252) | Correct, explicit |
| RiseDTC — Network Activation (ICP connections) | risedtc | false | warm | NULL (46) | Correct — DMs Mattan's existing 1st-degree connections |
| **RiseDTC — Profile View** | risedtc | true | **engager** | `profile_view`: 2/2 (100%) | See "Profile-view" verdict below |
| **RiseDTC — Warm (his engagers)** | risedtc | true | **engager** | **0 prospects** | See verdict below |
| Staffing & Recruiting Firms | ivan | false/archived | cold | n=16, mixed | Correct |
| **Warm - Engagement Harvest** | ivan | true | **engager** | `engaged_post` 256 + `content_engagement` 5 = 261/261 (100%) | **Correct as-is** |
| Warm - Hiring Signal | ivan | false | **warm** | `hiring`: 90/90 (100%) | Correct — operator's own model explicitly puts "hiring-signal warm lists" in the warm bucket |
| Warm - Kyle Engagers | ivan | true | **engager** | `engaged_post` 938 + `content_engagement` 30 = 968/985 (98.3%) | Correct — "warm" in name but "engager" branch fires first, and data confirms engager is right |
| Warm - LM Anchor Engagers | ivan | true | **engager** | `engaged_post`: 1591/1591 (100%) | Correct — matches both "anchor" and "engagers", data confirms engager |

(orphan: 17 `outreach_prospects` rows with `campaign_id IS NULL`, `trigger_type='room_census'` — not attached
to any campaign, so `lane_of()` never runs on them; see "Secondary finding" below.)

## Verdicts on the 4 named ambiguous campaigns

1. **"Warm - Engagement Harvest" (ivan)** → bucketed `engager`. Evidence: 100% `engaged_post`/`content_engagement`
   trigger_type. **Correct as-is, no change.**

2. **"RiseDTC — Warm (his engagers)" (risedtc)** → bucketed `engager`. Currently **0 prospects**, so trigger_type
   evidence is unavailable. But the campaign's own `description` field is explicit: "Works anyone who likes/comments
   on HIS LinkedIn posts toward a booked call" — i.e. people who engaged with Mattan's own content. That is exactly
   the operator's definition of "engager," despite the word "Warm" in the name (a legacy naming holdover, same
   pattern as "Warm - Kyle Engagers" and "Warm - LM Anchor Engagers" on the ivan side, both confirmed correct by
   data). **Correct as-is by design intent; no change.** Flag for later: once this lane is actually armed and
   sourced (memory: "Warm has NO sender" / BORN-DEAD), re-verify the trigger_type mix comes back as
   `engaged_post`/`content_engagement`-dominant to close the loop empirically.

3. **"Profile View — Ivan" (ivan)** → bucketed `engager`. 4/4 prospects have trigger_type literally `profile_view`
   — a distinct signal from `engaged_post`/`content_engagement`, not one of the two the operator named as the
   engager litmus test. Profile-viewing is engagement with the account's own *presence*, not its *content* —
   arguably a fourth micro-lane by the operator's own naming (`profile-view-dm-lane` in memory).
4. **"RiseDTC — Profile View" (risedtc)** → same, 2/2 `profile_view`. Same reasoning applies.

   **Recommendation on 3 & 4: keep bucketing under `engager`, no schema/SQL change.** Reasoning:
   - Combined volume is trivial (6 prospects total across both clients) — not enough to distort the KPI dashboard's
     engager numbers either way.
   - Profile-viewing is unambiguously NOT cold (not a sourced stranger) and NOT warm/orbit (not existing network) —
     of the three visible lanes, `engager` is the only defensible bucket.
   - Adding a 4th `profile_view` lane would require a `LANE_LABELS` entry in `src/lib/kpis.ts`, a UI column, and
     ongoing volume to justify the surface area — not worth it at n=6.
   - **Caveat to document, not fix:** if profile-view volume grows materially (the `profile-view-dm-lane-07-23`
     lane going live could scale this), re-open the question of a dedicated `profile_view` lane rather than letting
     it silently dilute the "engager = engaged with content" mental model on the dashboard.

## Task 3 — replicated CASE logic locally over all 27 names

Reproduced by hand against the exact `ilike` patterns above (see per-campaign table's "lane_of() result" column).
**No unintended branch hits found.** Specifically checked for the traps called out in the brief:
- No bare-vertical/cold campaign contains "anchor," "warm," "orbit," "engager," "engagement harvest," "profile view,"
  or "network activation" as a stray substring (e.g. no "warmup" or "seaworthy"-style false positive).
- The three names combining "warm" + "engager(s)" (RiseDTC — Warm (his engagers), Warm - Kyle Engagers,
  Warm - LM Anchor Engagers) all resolve to `engager` because that branch is checked first — and in every case
  where prospects exist, the trigger_type distribution independently confirms `engager` is the right bucket
  (98-100% engaged_post/content_engagement). This is a deliberate, correct precedence — not a bug.
- "RiseDTC — Cold (DTC Sales Nav)" contains the literal word "Cold" but isn't matched by name pattern at all; it
  falls through to the `else → cold` default, which is the same answer, just redundant-safe rather than pattern-hit.
- "Email Lane — Agencies (Cold)" — same, falls through to cold by default, correct.

**Conclusion: `lane_of()` has zero misbuckets against current campaign names.** The one soft edge case
(profile-view campaigns landing in `engager` rather than a nonexistent 4th lane) is a defensible design choice,
not a bug — see recommendation above.

## Task 4 — `inbox_pipeline_v` live output cross-check

```
client_id | lane    | sendable | sent_7d | sent_30d
ivan      | cold    | 74       | 21      | 128
ivan      | engager | 92       | 20      | 122
ivan      | warm    | 0        | 0       | 0
risedtc   | cold    | 40       | 40      | 40
risedtc   | warm    | 0        | 17      | 17
```

No `risedtc / engager` row appears at all — the view uses a `full outer join` over `runway`/`sent` CTEs, and
since RiseDTC's only engager-bucketed campaigns ("RiseDTC — Warm (his engagers)": 0 prospects; "RiseDTC — Profile
View": 2 prospects, none ICP-scored ≥7 or sent) contribute nothing to either CTE, the row is simply absent — not
a bug, just genuinely empty right now. Consistent with memory `rise-warm-engager-lane-run-07-23`
("engager lane RAN: 41/90d→0 ICP") and `outreach-liveness-filter-07-23` ("Warm has NO sender").

`ivan / warm` = 0/0/0 is worth noting even though it's not a misbucket: because every ivan-side "Warm - X"
campaign except "Warm - Hiring Signal" resolves to `engager` (by design, confirmed above), the `warm` lane for
`ivan` is fed by exactly one campaign — "Warm - Hiring Signal" — which is `is_active=false` and has zero
historical sends. So the dashboard's "ivan / warm" row is not broken, it's just structurally starved: there is
currently no active ivan-scoped campaign that means "existing network/orbit." That matches the operator's own
mental model (warm = orbit/network-activation/hiring-signal), it's just that none of those lanes are currently
armed for the `ivan` client_id. **No SQL change indicated** — this is a sourcing/activation gap, not a
classification bug.

## Secondary finding (outside F4 scope, flagging for awareness)

17 `outreach_prospects` rows have `campaign_id IS NULL` (`trigger_type='room_census'`, stages
`connected`/`dm_sent`/`replied`, icp_score 4-10, created 2026-07-17). Because `inbox_pipeline_v`'s `runway` and
`sent` CTEs both `join outreach_campaigns c on c.id = pr.campaign_id`, these 17 rows are invisible to the KPI
pipeline entirely — no lane, no client_id attribution, not counted anywhere. This doesn't affect the lane-bucketing
question (F4), but it's a data-completeness gap worth a separate ticket: either backfill a `campaign_id` for
room_census-sourced prospects or add a `coalesce`d "no campaign" bucket so these don't silently vanish from
totals.

## Final recommendation

**No change to `lane_of()` or the `LANE_LABELS` map needed.** Every one of the 4 originally-flagged ambiguous
campaigns is correctly bucketed under the operator's own stated model once checked against ground-truth
trigger_type data (or, for the currently-empty ones, against the campaign's own description text). The
CASE-branch ordering (engager-check before warm-check) is a deliberate and currently-correct mechanism for
resolving the "Warm - ...Engagers" naming collisions on the ivan side and the "RiseDTC — Warm (his engagers)"
collision on the risedtc side.
