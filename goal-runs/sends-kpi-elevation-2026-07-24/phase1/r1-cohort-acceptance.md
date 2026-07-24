# F1 — inbox_accept_v cohort-lag acceptance rate: findings

Source view: `/Users/ivanmanfredi/Desktop/ivan-inbox/db/005_kpi_accept.sql:6-29`
Live query snapshot taken: 2026-07-24T16:00:10Z (`inbox_accept_v` selected live via PostgREST; local machine UTC clock used as `now()` proxy for client-side reproduction).

## 0. Method note (deviation from the brief)

The brief assumed PostgREST can't join, so it prescribes: pull send rows, dedup client-side, then batch `outreach_prospects?id=in.(...)` for `connected_at`. In practice PostgREST resource embedding (auto-detected FKs) performs the join server-side in one call:

```
GET /outreach_messages?select=id,prospect_id,sent_at,message_text,outreach_prospects(connected_at,campaign_id,outreach_campaigns(client_id))&direction=eq.outbound&message_type=eq.connection_note&sent_at=not.is.null&order=id.asc
```

This returns `outreach_messages` rows already carrying `prospect.connected_at` and `prospect.campaign.client_id` — a 2-hop embed (messages → prospects → campaigns). Used this instead of the prescribed 2-step pull/batch; it is equivalent (same rows, same fields) and cheaper (2 paginated calls of 1000 rows vs. N+1). Total rows: 1009 (`Prefer: count=exact` on the filtered query confirmed `0-0/1009`).

## 1a. Trailing reproduction (proves the view's logic, including phantom-dedup)

Client-side dedup applied: group by `(prospect_id, message_text, sent_at)`, keep the row with the lowest `id` per group (mirrors `distinct on (m.prospect_id, m.message_text, m.sent_at) ... order by m.prospect_id, m.message_text, m.sent_at, m.id`). Result: **1009 rows in → 1009 rows out — the phantom-dedup is currently a no-op** (no duplicate `(prospect_id, message_text, sent_at)` triples exist in live data today). Preserve it anyway; it's a correctness guard against future duplicate webhook deliveries, not dead code.

Client-side trailing computation (accepts whose `connected_at` falls in window / sends whose `sent_at` falls in window, independently):

| client | sent_7d | accepted_7d | rate_7d | sent_30d | accepted_30d | rate_30d | sent_total | accepted_total |
|---|---|---|---|---|---|---|---|---|
| ivan | 41 | 12 | 29.3% | 250 | 52 | 20.8% | 952 | 136 |
| risedtc | 57 | 3 | 5.3% | 57 | 3 | 5.3% | 57 | 3 |

**Exact match to the live view** (`GET /inbox_accept_v?select=*` returned identical numbers: ivan 41/12/29.3/250/52/20.8/952/136, risedtc 57/3/5.3/57/3/5.3/57/3). Reproduction confirmed correct.

## 1b. Cohort acceptance (proposed definition)

Cohort definition used: of the send-rows whose `sent_at` falls in the window, how many have `connected_at is not null and connected_at >= sent_at` (i.e., the connection landed at/after the specific note that's being credited — see §2 for why the `>= sent_at` guard, not just `is not null`).

| client | sent_7d | accepted_7d (cohort) | cohort_rate_7d | sent_30d | accepted_30d (cohort) | cohort_rate_30d |
|---|---|---|---|---|---|---|
| ivan | 41 | 8 | **19.5%** | 250 | 52 | 20.8% |
| risedtc | 57 | 3 | 5.3% | 57 | 3 | 5.3% |

Trailing vs. cohort, ivan 7d: **29.3% (trailing) vs. 19.5% (cohort) — trailing overstates by ~10 points (50% relative inflation)** on the exact metric the dashboard currently shows. At 30d the two happen to coincide today (52/250 both ways) — see §1c, this is coincidental to the current data, not structural; the 7d window is short enough that lag effects show up, the 30d window in this snapshot happens to have zero cross-cohort spillover, but that is not guaranteed going forward (any week where a backlog of >30-day-old sends converts would break it too).

## 1c. Concrete cross-cohort cases (row class that inflates the trailing numerator)

Of ivan's 12 trailing `accepted_7d`, exactly **4 are cross-cohort**: `connected_at` in the last 7 days, but the credited note was sent *more than 7 days before "now"* (2026-07-17T16:00:10Z cutoff):

| prospect_id | sent_at | connected_at | gap (sent→connect) |
|---|---|---|---|
| 51af80bc-ab21-43f6-a9c3-209d0a3d9aa2 | 2026-07-13T06:15:23 | 2026-07-19T12:01:23 | 6.2d |
| c533049f-d348-483c-9b78-f0324ddc3192 | 2026-07-17T01:09:37 | 2026-07-21T05:46:00 | 4.2d |
| 15e4dbf5-60fb-47bd-b61e-d41d69cc04dd | 2026-07-17T00:14:09 | 2026-07-17T21:16:05 | 0.9d |
| 04b34d25-b598-4f9a-9ea2-05851ebd80a7 | 2026-07-17T03:21:02 | 2026-07-19T16:01:21 | 2.5d |

So 12 = 8 true same-window accepts + 4 accepts of notes sent before the window opened. The 4 cross-cohort rows are exactly the delta between trailing (12) and cohort (8) accepted_7d for ivan. No risedtc cross-cohort cases exist (risedtc's entire history — 57 rows — sits inside the last 30 days, so there's no "before the window" population yet to spill from at 7d... actually risedtc's `sent_total == sent_7d == sent_30d == 57`? No — `sent_total=57, sent_30d=57, sent_7d=57` per the live view means literally every risedtc send row is within the last 7 days; the whole campaign only started this week).

## 2. Is >100% reachable live?

**Not observed historically in this dataset.** Event-driven simulation (evaluated the trailing formula at every one of the 135 distinct `connected_at` timestamps in the data, using each event time as the hypothetical "now"):

- max trailing rate_7d ever hit: ivan 50.0% (as of 2026-06-17, 13/26), risedtc 18.2%
- max trailing rate_30d ever hit: ivan 23.4% (as of 2026-07-13, 47/201), risedtc 18.2%

So empirically the metric has stayed under 100% throughout this campaign's history. **But it is structurally unbounded, not merely "generally mixes cohorts" as a theoretical concern** — the numerator (accepts by connect-date) and denominator (sends by send-date) are drawn from disjoint, independently-sized populations. Concretely: if sends pause or throttle for a week (e.g., rate-limit lockout — see `outreach-acceptance-cliff-debug` skill / governor clamp incidents in memory) while a backlog of older notes keeps converting, `sent_7d` collapses toward 0-2 while `accepted_7d` keeps counting every prospect who happens to connect that week regardless of when their note went out — trivially >100% (e.g. sent_7d=2, accepted_7d=5 → 250%). This system has documented rate-limit/throttle incidents (`rise-outreach-drought-diagnosis-07-22`, governor clamp history) that are exactly the precondition, so treat ">100% never happened yet" as "hasn't happened yet," not "can't happen."

## 3. `connected_at >= sent_at` guard vs. `connected_at is not null` only

Checked how many send-rows have `connected_at < sent_at` (prospect was already connected *before* this note was sent — almost certainly a re-send/duplicate outreach to an already-connected prospect, not a real "acceptance of this note"):

**1 row out of 1009** (0.1%), client=ivan:

```
prospect_id b7a03d40-65d3-485c-9a18-82afae3ef8c6
sent_at      2026-05-12T17:17:06.639Z
connected_at 2026-05-12T14:21:26.958879Z   (connected ~3h BEFORE this note was sent)
```

Impact today: negligible (`accepted_total` 136 vs. guarded 135 for ivan; risedtc unaffected). **Recommend keeping the guard anyway**: it's a one-line predicate, costs nothing, is more semantically correct (an "acceptance" should be causally attributable to the note being credited), and protects against future skew if resend-to-connected-prospect bugs become more common (this is itself evidence of an upstream send-gating gap worth flagging separately — a note was sent to a prospect who was already connected).

## 4. Recommended replacement SQL for `inbox_accept_v`

Preserves output shape (`client_id, sent_7d, accepted_7d, rate_7d, sent_30d, accepted_30d, rate_30d, sent_total, accepted_total`), preserves the phantom-dedup `distinct on`, switches numerator to cohort semantics (denominator = sends in window; numerator = accepted-of-those-same-rows, not accepted-by-connect-date), and applies the `connected_at >= sent_at` guard:

```sql
-- Connection acceptance per client. Cohort style: for notes SENT in a given
-- window, what fraction of THOSE prospects had connected_at land at/after the
-- note (guards against re-sends to already-connected prospects). Denominator
-- and numerator are drawn from the same row set per window, eliminating the
-- prior cross-cohort inflation where accepted_Nd counted connects by
-- connected_at regardless of when the credited note was sent.
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
  select
    client_id,
    sent_at,
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

Expected values after this change, against today's snapshot: ivan `sent_7d=41, accepted_7d=8, rate_7d=19.5, sent_30d=250, accepted_30d=52, rate_30d=20.8, sent_total=952, accepted_total=135`; risedtc unchanged at `57/3/5.3/57/3/5.3/57/3`.

Note for whoever applies this: the file comment at `005_kpi_accept.sql:1-5` currently says "Cohort lag ... is surfaced in the UI caption, not corrected here" and flags `ACCEPT_SIGNAL` as the place to revisit — this migration is exactly that revisit; update the header comment when the fix lands so it doesn't contradict the new logic.

## Summary table

| metric | ivan 7d | ivan 30d | risedtc 7d | risedtc 30d |
|---|---|---|---|---|
| trailing (current) | 12/41 = 29.3% | 52/250 = 20.8% | 3/57 = 5.3% | 3/57 = 5.3% |
| cohort (proposed) | 8/41 = 19.5% | 52/250 = 20.8% | 3/57 = 5.3% | 3/57 = 5.3% |
| delta | −10 pts (34% relative overstatement) | 0 pts (coincidental, see §1b/§1c) | 0 | 0 |
