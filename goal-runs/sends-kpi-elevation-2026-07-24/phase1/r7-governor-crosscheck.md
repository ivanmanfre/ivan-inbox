# F7 — Governor number cross-checks: findings

Source: `inbox_governor()` — `/Users/ivanmanfredi/Desktop/ivan-inbox/db/008_kpi_governor.sql:6-71`.
Wraps `public.outreach_sender_health(p_client_id text DEFAULT NULL)` — a raw Postgres function with **no migration file in this repo**. Full source recovered from `/Users/ivanmanfredi/Desktop/Ivan - Content System/goal-runs/risedtc-golive-cockpit-2026-07-21/track3-outreach_sender_health-clientid.sql` (the patch that added `p_client_id`) and cross-checked live via `select prosrc from pg_proc where proname='outreach_sender_health'` pattern already used in `accept-starvation-2026-07-17/output/01-queries.sql`. All numbers below reproduced independently against live Supabase (`bjbvqvzbzczjbatgmccb`) on 2026-07-24, ~13:10 local.

## 0. The actual function body (ground truth — not previously in this repo)

```sql
CREATE OR REPLACE FUNCTION public.outreach_sender_health(p_client_id text DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql STABLE AS $function$
with cp as (
  select p.id as prospect_id
  from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
  where p_client_id is not null and c.client_id = p_client_id
),
sent_cohort as (
  -- invites sent 3-18 days ago: old enough to have been accepted/ignored
  select distinct el.prospect_id
  from outreach_engagement_log el
  where el.action_type = 'connection_request' and el.success = true
    and el.created_at between now() - interval '18 days' and now() - interval '3 days'
    and (p_client_id is null or el.prospect_id in (select prospect_id from cp))
),
judged as (
  select (p.stage in ('connected','replied','dm_sent')) as accepted
  from sent_cohort s join outreach_prospects p on p.id = s.prospect_id
),
agg as (select count(*) cohort, count(*) filter (where accepted) accepted from judged),
sends as (
  select
    (select count(*) from outreach_engagement_log
       where action_type='connection_request' and success=true and created_at >= now() - interval '7 days'
         and (p_client_id is null or prospect_id in (select prospect_id from cp))) as weekly_sends,
    (select count(*) from outreach_engagement_log el join outreach_prospects p on p.id = el.prospect_id
       where el.action_type='connection_request' and el.success=true and el.created_at >= now() - interval '7 days'
         and coalesce(p.trigger_confidence,0) >= 3
         and (p_client_id is null or el.prospect_id in (select prospect_id from cp))) as warm_sends_7d
),
m as (select a.cohort, a.accepted, s.weekly_sends, s.warm_sends_7d,
       case when a.cohort > 0 then a.accepted::numeric / a.cohort else null end as rate
      from agg a cross join sends s)
select jsonb_build_object(
  'cohort', cohort, 'accepted', accepted,
  'accept_rate', case when rate is null then null else round(rate,4) end,
  'weekly_sends', weekly_sends, 'warm_sends_7d', warm_sends_7d, 'warm_cap', 25,
  'cap', case when cohort < 15 then 35
              when rate >= 0.30 then 100 when rate >= 0.20 then 70
              when rate >= 0.12 then 50 when rate >= 0.06 then 35
              else 20 end,
  'warm_only', case when cohort >= 15 and rate < 0.12 then true else false end
) from m; $function$;
```

**Critical structural fact:** the cohort/accepted/weekly_sends source table is `outreach_engagement_log` (`action_type='connection_request', success=true`), **not** `outreach_messages` (which `inbox_accept_v` and `inbox_governor`'s own `daily_used`/`daily_cap` subqueries use). These are two different logging paths for the same physical sends, so row-for-row parity between the Governor and the Acceptance card is not guaranteed even before window semantics are considered.

**Critical scoping fact:** `p_client_id is null or ...` means when `p_client_id` is NULL (the default / "Ivan" call), the client filter **does not apply at all** — it is not "campaigns where `client_id IS NULL`", it is "no filter, count everyone." This matters (see §1 below) because Ivan's campaigns have `client_id = NULL` in the DB (the `coalesce(client_id,'ivan')` convention is a *display* convention used elsewhere, not a literal value `outreach_sender_health` can filter on) — there is no parameterization that means "Ivan-only."

---

## 1. Rise accept_rate = 0.0 — inferred cohort definition + verdict

**Cohort = distinct prospects with a successful `connection_request` in `outreach_engagement_log` where `created_at` is between 18 and 3 days ago** (a "matured" window — old enough that LinkedIn accept/ignore has had time to land, per the function's own comment). "Accepted" = of that cohort, how many prospects currently have `stage in ('connected','replied','dm_sent')`.

Live reproduction (fresh pull, `outreach_engagement_log` joined to `outreach_prospects`→`outreach_campaigns` for client attribution):

| window | all-clients rows | risedtc | ivan |
|---|---|---|---|
| created_at in [now-18d, now-3d] (cohort window) | 139 | **0** | 139 |
| created_at >= now-7d (weekly_sends) | 98 | 57 | 41 |

`risedtc_first_dispatch_not_before = 2026-07-21T21:00:00Z` (`integration_config`) — Rise's sender only started firing ~3 days before this snapshot. The cohort window requires sends to be **at least 3 days old**; since Rise's oldest sends are only just crossing that 3-day line (and most are younger), **zero** Rise `connection_request` events currently sit inside `[now-18d, now-3d]`. `cohort=0` → `agg.accepted=0` → `rate = case when cohort>0 ... else null end` → `null`, which `inbox_governor()` coalesces to `0` (`coalesce((h->>'accept_rate')::numeric,0)`).

**Verdict: CORRECT, not a bug.** Rise's cohort is genuinely empty — there is no population old enough to judge yet. `accept_rate=0.0` is a display artifact of `null`→`coalesce(...,0)`, and it will start moving within the next 1-2 days as day-1 Rise sends cross the 3-day floor. `inbox_accept_v`'s 3/57 = 5.3% (7d) is a *different, unmatured* metric (see §3) — it is not wrong either, it is answering a different question (see recommended copy in §5).

⚠ **Forward-looking risk this audit surfaces:** because the default (`p_client_id IS NULL`) call applies no client filter, the moment Rise's day-1 sends age past 3 days, they will start leaking into the **"ivan" row's** `cohort`/`accepted`/`weekly_sends` (see §1a below) — Ivan's numbers are not protected from Rise contamination structurally, only coincidentally (right now Rise has zero rows old enough to leak in).

### 1a. New finding not in the original brief: the "ivan" governor row is currently contaminated with Rise's sends

`inbox_governor()` calls `outreach_sender_health()` with no argument for the "ivan" row (`db/008_kpi_governor.sql:15`). Per the scoping fact above, this returns **global** totals, not Ivan-only totals:

- `weekly_sends` returned = **98** = 41 (ivan campaigns) + 57 (risedtc campaigns) — confirmed by joining `outreach_engagement_log`→`outreach_prospects`→`outreach_campaigns.client_id` on the same 7-day window (Counter: `{'risedtc': 57, 'ivan': 41}`).
- `cohort` returned = 139, and by coincidence 100% of it is Ivan's (`{'ivan': 139}`, 0 risedtc) — only because Rise has no rows old enough yet (see above). This is temporary, not structural protection.

**Consequence:** the Governor UI's "used: 98 / cap: 50" for Ivan is not "Ivan sent 98 this week" — it's "Ivan + Rise combined sent 98 this week." Ivan's true weekly usage is **41**, which is *under* his cap of 50 (9 headroom), not 96 over it. The operator note "Ivan intentionally raised his cap; used>cap is CORRECT" is true as a policy stance, but the specific 98-vs-50 reading it's being applied to is inflated by a scoping bug, not purely by intentional volume. This is a real, currently-live defect in `outreach_sender_health()`'s parameter design (there is no way to ask it for "campaigns where `client_id IS NULL`" — only "no filter" or "one non-null client_id") and should be fixed at the function level (e.g., add an explicit `ivan` sentinel that maps to `client_id IS NULL`), not papered over in the dashboard.

---

## 2. Rise cap: 35 (sender_health) vs 100 (integration_config) — which one throttles reality

`outreach_sender_health`'s `cap` field is an **adaptive rate-based ramp**, not a config value:
```
cap = case when cohort < 15 then 35        -- insufficient data floor
           when rate >= 0.30 then 100
           when rate >= 0.20 then 70
           when rate >= 0.12 then 50
           when rate >= 0.06 then 35
           else 20 end
```
Rise: `cohort=0 < 15` → falls into the **"insufficient data" placeholder bucket** → `cap=35`. This is not a real ceiling grounded in Rise's performance — there is no accept-rate data yet to base a ramp on. Compare Ivan: `cohort=139, rate=0.1655` → falls in the `rate>=0.12` bucket → `cap=50`, which **is** grounded in real, live data.

`integration_config.risedtc_connect_weekly_cap = "100"` is a separate, manually-set hard ceiling (confirmed live: `GET integration_config?key=like.risedtc_*` → `risedtc_connect_weekly_cap: "100"`, alongside `risedtc_connect_daily_cap: "20"`, `risedtc_connect_monthly_cap: "400"`).

**Which one the live sender workflow actually obeys** — read directly from the deployed n8n workflow `Outreach - Connection Request Sender` (`5ZXtArhobWrDDpfJ`, active, node `Query + Build Notes`, RISE branch):

```js
let dailyCap = 20, floorMs = 0, weeklyCapOverride = 0;
// ...reads risedtc_connect_daily_cap, risedtc_first_dispatch_not_before, risedtc_connect_weekly_cap from integration_config
const h = await this.helpers.httpRequest({ ...url: RSB + "/rest/v1/rpc/outreach_sender_health", body: { p_client_id: "risedtc" } ... });
if (h && typeof h === "object") { riseCap = h.cap || 35; riseWeekly = h.weekly_sends || 0; }
if (weeklyCapOverride) riseCap = weeklyCapOverride; // config-driven weekly cap override (2026-07-23)
```
The workflow reads the RPC's adaptive `cap` (35) **first**, then explicitly **overrides it with `integration_config.risedtc_connect_weekly_cap` (100)** whenever that config key is present (dated 2026-07-23 in the code comment). Since the key is always present, **the real enforced weekly ceiling for Rise's sends is 100, not 35.**

**Live proof this override is active, not dead code:** Rise's `weekly_sends` this week is **57** — already past the RPC's advertised 35, but sending never stopped (no `weekly_cap_35` skip reason has fired this week; mode stayed `normal`). If 35 were the real gate, sends would have halted at 35. They didn't, and they're still under 100. This confirms the config value is the one throttling reality.

Ivan's branch (same workflow, further down) has **no equivalent override** — his RPC `cap` (currently 50, itself adaptively computed from his own mature cohort) is the value actually checked (`if (health.weekly_sends >= (health.cap||35)) return skip`). There is no `integration_config` weekly-cap key for Ivan at all.

**Recommendation:** display **100** for Rise's weekly cap (the config-overridden, actually-enforced value), not the RPC's raw 35. Cleanest fix: extend `inbox_governor()` to read `integration_config.risedtc_connect_weekly_cap` for the `cap` field the same way it already does for `daily_cap` (`008_kpi_governor.sql:63`) and `monthly_cap` (`:66`) — currently only those two consult config; the weekly `cap` field does not, which is the actual root cause of the mismatch.

---

## 3. Ivan accept_rate 16.6% (sender_health) vs 29.3%/20.8% (inbox_accept_v) — reconciled

Reproduced `outreach_sender_health()`'s exact cohort independently from raw tables (no reliance on the RPC as a black box):

- `outreach_engagement_log` rows with `action_type='connection_request', success=true, created_at ∈ [now-18d, now-3d]`, joined to `outreach_prospects`→`outreach_campaigns`: **139 rows, all client_id=null (ivan)**.
- Of those 139 prospects, current `stage` distribution: `connection_sent=76, archived=35, dm_sent=14, replied=6, positive_reply=5, connected=3`.
- `accepted` (stage in `connected|replied|dm_sent`) = 3+6+14 = **23**. `23/139 = 0.16547 → round(...,4) = 0.1655 → ×100 = 16.6%`. **Exact match** to the live RPC output (`cap:50, cohort:139, accepted:23, accept_rate:0.1655`).

This confirms the two numbers are answering genuinely different questions, both correctly computed for their own definition:

| | Governor (`sender_health`) | Acceptance card (`inbox_accept_v`) |
|---|---|---|
| Source table | `outreach_engagement_log` (attempt log) | `outreach_messages` (sent notes) join `outreach_prospects.connected_at` |
| Population | **Matched cohort**: sends aged 3-18 days, judged by current lifecycle stage | **Trailing/independent windows**: sends in last 7/30d (any age) vs. connects in last 7/30d (any age), not the same rows |
| "Accepted" signal | `stage in (connected, replied, dm_sent)` — includes downstream progression, excludes `positive_reply` | `connected_at is not null` only |
| Excludes | Sends <3 days old (too fresh to judge) and >18 days old (stale, out of ramp window) | Nothing — uses full history for `sent_total`/`accepted_total` |
| Result (ivan, this snapshot) | 16.6% | 29.3% (7d) / 20.8% (30d) |

The trailing 7d number (29.3%) is structurally noisier/optimistic: it counts *any* historical accept that lands this week in the numerator (including notes sent 3+ weeks ago) against a denominator of *this week's* sends (many too fresh to have converted yet) — this is the exact "cross-cohort inflation" documented independently in `r1-cohort-acceptance.md` §1c (4 of Ivan's 12 trailing `accepted_7d` are credited to notes sent >7d before the window). The Governor's 16.6% is a cleaner, matured, apples-to-apples cohort rate — but it is also the number the cap-ramp logic in §2 depends on, so it needs to stay a genuine cohort metric even though it reads "lower" than the Acceptance card.

**Neither number is wrong. They must not be placed next to each other without a label**, or they read as contradictory (16.6% vs 29.3% for "the same thing").

---

## 4. Mode logic check

`mode` in `inbox_governor()`:
```sql
mode := case when (h->>'warm_only')::boolean then 'warm_only'
             when coalesce(cohort,0) > 0 and coalesce(accept_rate,1) < 0.12 then 'cold_paused'
             else 'normal' end;
```
- **Ivan**: `cohort=139>0`, `accept_rate=0.1655 >= 0.12` → not `cold_paused` → **`normal`**. Matches live (`mode:"normal"`). ✅
- **Rise**: `cohort=0`, so `cohort>0` is false regardless of rate → never `cold_paused` by this branch → **`normal`** (as long as `warm_only` is false). Matches live. ✅

`warm_only` (from `outreach_sender_health`, computed inside the RPC, not `inbox_governor`): `case when cohort >= 15 and rate < 0.12 then true else false end`.
- Ivan: `cohort=139>=15` but `rate=0.1655` not `<0.12` → `warm_only=false`.
- Rise: `cohort=0`, not `>=15` → `warm_only=false`.

Both confirmed directly from the live RPC call (not inferred): `outreach_sender_health()` → `"warm_only": false`; `outreach_sender_health({"p_client_id":"risedtc"})` → `"warm_only": false`. **Both flags currently false, verified.**

---

## 5. Recommended display semantics

The contradiction isn't a bug to silently fix — it's two legitimately different metrics (matured cohort vs. trailing window) that read as contradictory when unlabeled. Recommended copy:

- **Governor block, accept-rate line:** `"Governor cohort accept: 16.6% (sends 3-18d old, matured)"` — replace bare `"Accept rate: 16.6%"` with an explicit window + maturity qualifier.
- **Acceptance card (existing `inbox_accept_v` consumer):** `"7d window: 29.3% · 30d window: 20.8%"` — already implicitly says "window," but add a one-line caption: `"Trailing — counts any accept landing in the window, even from older sends. See Governor for a matured cohort rate."`
- **Rise-specific, while cohort=0:** show `"Governor cohort: not enough data yet (sends must age 3+ days)"` instead of a bare `0.0%`, so it doesn't read as "Rise's connects are failing" when it actually means "too early to tell." Tie this to `risedtc_first_dispatch_not_before` so the caption can say something concrete like "cohort opens ~2026-07-27."
- **Cap line (Rise):** display `100` (the effective/enforced weekly cap per §2), with a tooltip `"adaptive floor 35, overridden to 100 by config while Rise's own cohort is too new to rate itself"` — do not show the raw RPC `35` unqualified, since it is not the number that gates real sends.
- **Cap line (Ivan):** display the RPC's `cap` (currently 50) as-is — it is real and enforced, no override exists.
- ⚠ **Before any of the above ships:** fix the "ivan" row's `weekly_sends`/`cohort` scoping bug (§1a) — displaying a mislabeled "used: 98" (which is really 41 ivan + 57 rise) under a nicely-worded caption is worse than the current unlabeled state, because the caption would lend it false authority.

---

## Evidence log (queries run, this session)

| Query | Result |
|---|---|
| `POST rpc/outreach_sender_health {}` | `{"cap":50,"cohort":139,"accepted":23,"warm_cap":25,"warm_only":false,"accept_rate":0.1655,"weekly_sends":98,"warm_sends_7d":24}` |
| `POST rpc/outreach_sender_health {"p_client_id":"risedtc"}` | `{"cap":35,"cohort":0,"accepted":0,"warm_cap":25,"warm_only":false,"accept_rate":null,"weekly_sends":57,"warm_sends_7d":0}` |
| `POST rpc/inbox_governor {}` | ivan `{cap:50,used:98,accept_rate:16.6,daily_used:2,daily_cap:20,mode:normal}`; risedtc `{cap:35,used:57,accept_rate:0.0,daily_used:18,daily_cap:20,monthly_cap:400,monthly_used:57,mode:normal}` |
| `GET inbox_accept_v?select=*` | risedtc `sent_7d:57,accepted_7d:3,rate_7d:5.3,rate_30d:5.3`; ivan `sent_7d:41,accepted_7d:12,rate_7d:29.3,sent_30d:250,accepted_30d:52,rate_30d:20.8` |
| `GET integration_config?key=like.risedtc_*` | `risedtc_connect_weekly_cap:"100"`, `risedtc_connect_daily_cap:"20"`, `risedtc_connect_monthly_cap:"400"`, `risedtc_first_dispatch_not_before:"2026-07-21T21:00:00Z"` |
| `GET outreach_engagement_log` (created_at ∈ [now-18d, now-3d], action_type=connection_request, success=true), joined to campaigns | 139 rows total, `{'ivan': 139, 'risedtc': 0}` |
| Same rows joined to `outreach_prospects.stage` | stage census `{connection_sent:76, archived:35, dm_sent:14, replied:6, positive_reply:5, connected:3}` → accepted (connected+replied+dm_sent) = 23 |
| `GET outreach_engagement_log` (created_at >= now-7d, same filters), joined to campaigns | 98 rows total, `{'risedtc': 57, 'ivan': 41}` |
| `GET /api/v1/workflows/5ZXtArhobWrDDpfJ` (n8n REST API, node `Query + Build Notes`) | RISE branch: reads `risedtc_connect_weekly_cap` from `integration_config` and overrides the RPC's adaptive `cap` with it when present (comment: "config-driven weekly cap override (2026-07-23)") |
| Function source | `/Users/ivanmanfredi/Desktop/Ivan - Content System/goal-runs/risedtc-golive-cockpit-2026-07-21/track3-outreach_sender_health-clientid.sql` (full `CREATE OR REPLACE FUNCTION` body, `p_client_id` patch, 2026-07-21) |
