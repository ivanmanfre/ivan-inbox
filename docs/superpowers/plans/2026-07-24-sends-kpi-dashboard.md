# Sends KPI Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the inbox **Sends** tab into a dense, per-person (Ivan / Rise) outbound analytics dashboard — per-channel KPIs, connection acceptance rate, live governor throttle state, sendable-ICP pipeline runway by lane, scan-report opens, and a campaigns breakdown — plus fix the recurring auth OTP lockout.

**Architecture:** New Supabase read-only aggregate views + one governor RPC feed a new `Overview` sub-view inside `SendsScreen`. All heavy aggregation is server-side SQL (mirrors the existing `db/003_sends_views.sql` pattern); the client only fetches thin rows and runs small pure derivations (accept math, governor mode/headroom, lane classification, runway). The Sends tab keeps its existing `Lanes` and `Log` sub-views untouched.

**Tech Stack:** React 19 + TypeScript + Vite, `@supabase/supabase-js`, Vitest (unit), oxlint, Playwright (`scripts/shot.mjs`). Supabase project `bjbvqvzbzczjbatgmccb`.

## Global Constraints

- Preserve the phantom-duplicate collapse everywhere sends are counted: `distinct on (prospect_id, message_text, sent_at)` (see `db/003_sends_views.sql`). Never under/over-count real sends.
- New SQL views mirror existing style: `security_invoker = on` for views over `outreach_*` (caller RLS applies); `security definer` + `grant select ... to anon, authenticated` for views over the service-role-only `scan_opens` (mirror `scan_open_stats`).
- Client is a static GitHub Pages PWA — no server code added to this repo. All backend logic is Supabase SQL/RPC applied out-of-band (Supabase SQL editor or MCP).
- `client_id` convention: `'ivan'` (campaigns with null client_id coalesce to `'ivan'`) and `'risedtc'`. UI labels: Ivan / Rise.
- Self-clicks on scans are already excluded server-side via `scan_opens.is_owner` + `owner_ips`. Consume `not is_owner` only — add no new anti-self-click logic.
- Supabase creds for read-only verification queries: URL `https://bjbvqvzbzczjbatgmccb.supabase.co`, service key in the Connection-Sender n8n node (`<SUPABASE_SERVICE_KEY>`). DDL (create view/RPC) is applied via the Supabase SQL editor / MCP, not PostgREST.
- Test command: `npx vitest run <file>`. Lint: `npm run lint`. Build check: `npm run build`.
- Commit after every task. Keep the existing `Ivan / Rise / All` chip semantics.

---

### Task 1: Live data verification pass (findings doc, no UI, no schema changes)

Reconcile the spec's assumed field names against live Supabase before any view is built. Output a findings file that Tasks 2–5 read to fill three genuinely-unknown identifiers.

**Files:**
- Create: `db/NOTES-kpi-verification.md`

**Model:** `opus` — needs judgment to bucket messy `source` values into lanes and reconcile schema reality; may surface a question for Ivan.

**Interfaces:**
- Produces: confirmed values written into `db/NOTES-kpi-verification.md`:
  - `ACCEPT_SIGNAL` — column proving a connection was accepted (expected `outreach_prospects.connected_at`; confirm non-null on `stage='connected'` rows).
  - `PRECONTACT_STAGES` — the stage set meaning "scored, not yet contacted" (expected `('enriched','review')`).
  - `SCORE_FIELD` + floor (expected `score >= 7`).
  - `ARCHIVED_PRED` — how archived/dead is expressed (expected `stage <> 'archived'` and `stage <> 'ballot_hold'`; confirm whether a boolean `archived` column also exists).
  - `MONTHLY_CAP` — the `integration_config` field holding Rise's monthly connection cap, and the row key that scopes it to `client_id='risedtc'`.
  - `SLUG_JOIN` — how `scan_opens.company_slug` maps to a `client_id` (via which table/column: e.g. `outreach_prospects.scan_slug` → `campaign_id` → `outreach_campaigns.client_id`, or a dedicated scans table).
  - `SENDER_HEALTH_FIELDS` — confirmed keys returned by `outreach_sender_health()` (expected `cap, weekly_sends, warm_only, warm_cap, warm_sends_7d, accept_rate`).
  - `LANE_MAP` — per-`client_id` table of distinct `source` values → lane bucket (Cold / Warm / Engager / Other).

- [ ] **Step 1: Enumerate distinct source + stage per client**

Run (uses `q()` helper — define inline):
```bash
SB=https://bjbvqvzbzczjbatgmccb.supabase.co
KEY=<SUPABASE_SERVICE_KEY>
q(){ curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$SB/rest/v1/$1"; }
# distinct sources with counts, per client (via campaign join is not available in PostgREST; pull raw and bucket in the findings doc)
q "outreach_prospects?select=source,stage,score,trigger_confidence,campaign_id&limit=2000" > /tmp/prospects.json
python3 -c "import json,collections; d=json.load(open('/tmp/prospects.json')); print('SOURCES:',collections.Counter(x.get('source') for x in d).most_common(40)); print('STAGES:',collections.Counter(x.get('stage') for x in d).most_common(20))"
```
Expected: prints the live `source` and `stage` frequency tables. Record them.

- [ ] **Step 2: Confirm accept signal, campaign client map, integration_config, scan slug link**

```bash
q "outreach_prospects?stage=eq.connected&select=id,connected_at,stage&limit=5"          # ACCEPT_SIGNAL: connected_at populated?
q "outreach_campaigns?select=id,client_id,name,is_active&limit=50"                        # client_id values + campaign→client
q "integration_config?select=*&limit=20"                                                  # MONTHLY_CAP field name + risedtc row
q "outreach_prospects?select=id,scan_slug,campaign_id&scan_slug=not.is.null&limit=5" || echo "no scan_slug col"   # SLUG_JOIN probe
q "scan_opens?select=company_slug,is_owner,opened_at&limit=5"                             # confirm columns
q "rpc/outreach_sender_health" -X POST -H "Content-Type: application/json" -d '{}'        # SENDER_HEALTH_FIELDS
```
Expected: each returns rows (or a clear 404/empty guiding the mapping). If `scan_slug` doesn't exist on prospects, find the actual join column (search `outreach_*` tables for a `slug`/`company_slug` column).

- [ ] **Step 3: Write findings doc**

Fill `db/NOTES-kpi-verification.md` with each Interface value above, the per-client `LANE_MAP` table, and a one-line flag for anything that differed from the spec's expectation. If a lane bucket is genuinely ambiguous (a `source` that could be Warm or Engager), note it and pick the more conservative bucket, listing it for Ivan to confirm later.

- [ ] **Step 4: Commit**

```bash
git add db/NOTES-kpi-verification.md
git commit -m "docs: KPI dashboard live-data verification findings"
```

---

### Task 2: SQL — widen daily view to 90d + acceptance view

**Files:**
- Create: `db/005_kpi_accept.sql`
- Modify: `db/003_sends_views.sql` (bump the `inbox_sends_daily_v` window 14d → 90d)

**Model:** `sonnet` — SQL from a confirmed spec, single concern.

**Interfaces:**
- Consumes: `ACCEPT_SIGNAL`, `PRECONTACT_STAGES` from Task 1 findings.
- Produces:
  - `inbox_sends_daily_v` now returns up to 90 days (frontend `buildLanes` already slices to what it needs).
  - View `inbox_accept_v(client_id, sent_7d, accepted_7d, rate_7d, sent_30d, accepted_30d, rate_30d, sent_total, accepted_total)` — trailing acceptance per client.

- [ ] **Step 1: Widen the daily window**

In `db/003_sends_views.sql`, change both occurrences of `now() - interval '14 days'` in `inbox_sends_daily_v` to `now() - interval '90 days'`. (Leave `inbox_sends_v` and the dedup logic untouched.)

- [ ] **Step 2: Write `db/005_kpi_accept.sql`**

```sql
-- Connection acceptance per client. Trailing style: accepts whose connected_at
-- falls in the window / connection_notes SENT in the window. Matches the number
-- outreach_sender_health reacts to. Cohort lag (a note sent yesterday hasn't had
-- time to accept) is surfaced in the UI caption, not corrected here.
-- Replace connected_at / stage predicate if Task 1 findings differ (ACCEPT_SIGNAL).
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
)
select
  client_id,
  count(*) filter (where sent_at >= now() - interval '7 days')                          as sent_7d,
  count(*) filter (where connected_at >= now() - interval '7 days')                      as accepted_7d,
  count(*) filter (where sent_at >= now() - interval '30 days')                          as sent_30d,
  count(*) filter (where connected_at >= now() - interval '30 days')                     as accepted_30d,
  count(*)                                                                               as sent_total,
  count(*) filter (where connected_at is not null)                                       as accepted_total,
  round(100.0 * count(*) filter (where connected_at >= now() - interval '7 days')
        / nullif(count(*) filter (where sent_at >= now() - interval '7 days'),0), 1)     as rate_7d,
  round(100.0 * count(*) filter (where connected_at >= now() - interval '30 days')
        / nullif(count(*) filter (where sent_at >= now() - interval '30 days'),0), 1)    as rate_30d
from sends group by client_id;
```

- [ ] **Step 3: Apply + verify against live DB**

Apply both files via the Supabase SQL editor / MCP. Then:
```bash
q "inbox_accept_v?select=*"
q "inbox_sends_daily_v?select=day&order=day.asc&limit=1"   # oldest day should now be ~90d back
```
Expected: one `inbox_accept_v` row per active client with plausible `rate_7d` (0–100 or null), and the daily view's oldest `day` near 90 days ago.

- [ ] **Step 4: Commit**

```bash
git add db/003_sends_views.sql db/005_kpi_accept.sql
git commit -m "feat(db): 90d daily window + inbox_accept_v acceptance view"
```

---

### Task 3: SQL — pipeline runway view (lanes + sendable ICP)

**Files:**
- Create: `db/006_kpi_pipeline.sql`

**Model:** `opus` — encodes the per-client lane classifier + sendable filter; judgment-bearing.

**Interfaces:**
- Consumes: `LANE_MAP`, `PRECONTACT_STAGES`, `SCORE_FIELD`, `ARCHIVED_PRED` from Task 1.
- Produces: view `inbox_pipeline_v(client_id, lane, sendable, sent_7d, sent_30d)` — `sendable` = future runway per lane; `sent_*` = recent sourcing mix per lane.

- [ ] **Step 1: Write `db/006_kpi_pipeline.sql`**

Grounded in `db/NOTES-kpi-verification.md`: prospects have **no `source` column** — lane
derives from `outreach_campaigns.name`; score field is **`icp_score`**; precontact stages
are **`('enriched','identified','review')`** (`review` currently empty but kept for
forward-compat); dead stages `archived`/`skipped`/`ballot_hold` are excluded by the `in`
list; `blacklisted` boolean also excluded. Engager is tested **before** Warm so a campaign
named "Warm - Engagement Harvest" buckets as Engager.

```sql
-- Per client x lane: sendable ICP runway + recent sourcing mix.
-- Lane derives from CAMPAIGN NAME (outreach_prospects has no source column).
-- Client = coalesce(outreach_campaigns.client_id,'ivan'). Score = icp_score.
create or replace function lane_of(camp_name text) returns text
language sql immutable as $$
  select case
    when camp_name ilike '%engager%' or camp_name ilike '%engagement harvest%'
      or camp_name ilike '%anchor%' or camp_name ilike '%profile view%'   then 'engager'
    when camp_name ilike '%warm%' or camp_name ilike '%orbit%'
      or camp_name ilike '%network activation%'                           then 'warm'
    else 'cold'  -- explicit %cold% + bare vertical/industry campaigns
  end
$$;

create or replace view inbox_pipeline_v with (security_invoker = on) as
with runway as (  -- sendable = scored ICP, pre-contact, live campaign, not blacklisted
  select coalesce(c.client_id,'ivan') as client_id, lane_of(c.name) as lane,
         count(*) as sendable
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where pr.icp_score >= 7
    and pr.stage in ('enriched','identified','review')
    and coalesce(pr.blacklisted,false) = false
    and c.is_active = true
  group by 1,2
),
sent as (  -- sourcing mix: connections actually sent, by the prospect's lane
  select coalesce(c.client_id,'ivan') as client_id, lane_of(c.name) as lane,
         count(*) filter (where s.sent_at >= now() - interval '7 days')  as sent_7d,
         count(*) filter (where s.sent_at >= now() - interval '30 days') as sent_30d
  from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at)
      m.prospect_id, m.sent_at
    from outreach_messages m
    where m.direction='outbound' and m.message_type='connection_note' and m.sent_at is not null
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) s
  join outreach_prospects pr on pr.id = s.prospect_id
  join outreach_campaigns c on c.id = pr.campaign_id
  group by 1,2
)
select coalesce(runway.client_id, sent.client_id) as client_id,
       coalesce(runway.lane, sent.lane)           as lane,
       coalesce(runway.sendable, 0)               as sendable,
       coalesce(sent.sent_7d, 0)                  as sent_7d,
       coalesce(sent.sent_30d, 0)                 as sent_30d
from runway full outer join sent
  on runway.client_id = sent.client_id and runway.lane = sent.lane;
```

- [ ] **Step 2: Apply + verify**

```bash
q "inbox_pipeline_v?select=*&order=client_id.asc,lane.asc"
```
Expected: rows per client × lane with sane `sendable` counts. Cross-check the total sendable against a raw count, e.g. `q "outreach_prospects?stage=in.(enriched,identified,review)&icp_score=gte.7&blacklisted=not.eq.true&select=id" -I -H "Prefer: count=exact"` and read the Content-Range header.

- [ ] **Step 3: Commit**

```bash
git add db/006_kpi_pipeline.sql
git commit -m "feat(db): inbox_pipeline_v sendable-ICP runway + sourcing mix by lane"
```

---

### Task 4: SQL — scan opens view (per client, self-clicks excluded)

**Files:**
- Create: `db/007_kpi_scan_opens.sql`

**Model:** `sonnet` — one definer view, mapping confirmed in Task 1.

**Interfaces:**
- Consumes: `SLUG_JOIN` from Task 1.
- Produces: view `inbox_scan_opens_v(client_id, opens_7d, opens_30d, opens_total, distinct_prospects, last_open)`.

- [ ] **Step 1: Write `db/007_kpi_scan_opens.sql`**

Grounded in `db/NOTES-kpi-verification.md` SLUG_JOIN: there is no `scan_slug` column. The
path is 4-hop and only resolves for scans carrying a `prospect_token` (most scans are
`inbound` with a null token) — so use **LEFT joins** and `coalesce(...,'ivan')`, which
attributes token-less/inbound opens to `ivan`, consistent with the repo convention.

```sql
-- Real (non-owner) scan-report opens per client. Definer rights so it reads the
-- service-role-only scan_opens under RLS, exposing only aggregates (mirrors
-- scan_open_stats). Self-clicks already excluded by is_owner + owner_ips.
-- Join: scan_opens.company_slug -> scans.company_slug -> scans.prospect_token
--       -> outreach_prospects.id -> campaign_id -> outreach_campaigns.client_id.
create or replace view inbox_scan_opens_v with (security_invoker = off) as
with j as (
  select so.opened_at, so.company_slug,
         coalesce(c.client_id,'ivan') as client_id
  from scan_opens so
  left join scans sc            on sc.company_slug = so.company_slug
  left join outreach_prospects pr on pr.id = sc.prospect_token
  left join outreach_campaigns  c  on c.id = pr.campaign_id
  where so.is_owner = false
)
select client_id,
  count(*) filter (where opened_at >= now() - interval '7 days')  as opens_7d,
  count(*) filter (where opened_at >= now() - interval '30 days') as opens_30d,
  count(*)                                                        as opens_total,
  count(distinct company_slug)                                    as distinct_prospects,
  max(opened_at)                                                  as last_open
from j group by client_id;

grant select on inbox_scan_opens_v to anon, authenticated;
```

- [ ] **Step 2: Apply + verify**

```bash
q "inbox_scan_opens_v?select=*"
```
Expected: per-client real-open counts. Sanity-check `opens_total <= ` the raw non-owner count from `scan_open_stats` summed.

- [ ] **Step 3: Commit**

```bash
git add db/007_kpi_scan_opens.sql
git commit -m "feat(db): inbox_scan_opens_v per-client real scan opens"
```

---

### Task 5: SQL — normalized governor RPC

**Files:**
- Create: `db/008_kpi_governor.sql`

**Model:** `opus` — reuses `outreach_sender_health()` for Ivan and derives Rise from `integration_config`; cross-source coordination.

**Interfaces:**
- Consumes: `SENDER_HEALTH_FIELDS`, `MONTHLY_CAP` from Task 1.
- Produces: RPC `inbox_governor()` returning rows `(client_id, model, cap, used, window_label, mode, daily_used, daily_cap, accept_rate, headroom_week, headroom_day, monthly_cap, monthly_used)` — one per person.

Grounded in `db/NOTES-kpi-verification.md`: `outreach_sender_health` is **client-parameterized**
(`outreach_sender_health(p_client_id => 'risedtc')`; bare `()` = Ivan's seat) and returns
`accept_rate` as a **fraction** (0.1655 = 16.55%). `integration_config` is a **key/value**
table (no `client_id` column): `risedtc_connect_monthly_cap`=400, `risedtc_connect_daily_cap`=20.
Both people use the adaptive weekly governor (matches "each has a governor that raises/decreases");
Rise additionally surfaces its monthly ceiling as context. Ivan's daily brake is the hard 20/day.
Before writing, confirm the RPC's exact param name via `q "rpc/outreach_sender_health" -X POST -H "Content-Type: application/json" -d '{"p_client_id":"risedtc"}'` (already verified returning 200 in Task 1).

- [ ] **Step 1: Write `db/008_kpi_governor.sql`**

```sql
-- Normalized per-person governor. Both people use the client-parameterized
-- adaptive weekly governor (outreach_sender_health). accept_rate is returned as a
-- fraction by the RPC -> multiply by 100 for a percent. Rise also carries its
-- monthly ceiling from the key/value integration_config table.
create or replace function inbox_governor()
returns table (
  client_id text, model text, cap int, used int, window_label text, mode text,
  daily_used int, daily_cap int, accept_rate numeric, headroom_week int, headroom_day int,
  monthly_cap int, monthly_used int
) language plpgsql security definer as $$
declare h jsonb; today_ct int; mtd int;
begin
  -- helper: count today's / month's connection notes for a client (null client_id => ivan)
  -- ---- Ivan ----
  select to_jsonb(x) into h from outreach_sender_health() x;
  select count(*) into today_ct from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id
    join outreach_campaigns c on c.id=p.campaign_id
    where coalesce(c.client_id,'ivan')='ivan' and m.direction='outbound'
      and m.message_type='connection_note' and m.sent_at >= date_trunc('day', now());
  client_id := 'ivan'; model := 'weekly_adaptive';
  cap := coalesce((h->>'cap')::int,35); used := coalesce((h->>'weekly_sends')::int,0);
  window_label := 'week';
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce((h->>'accept_rate')::numeric,1) < 0.12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct; daily_cap := 20;
  accept_rate := round(coalesce((h->>'accept_rate')::numeric,0) * 100, 1);
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(20 - today_ct, 0);
  monthly_cap := null; monthly_used := null; return next;

  -- ---- Rise ----
  select to_jsonb(x) into h from outreach_sender_health(p_client_id => 'risedtc') x;
  select count(*) into today_ct from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id join outreach_campaigns c on c.id=p.campaign_id
    where c.client_id='risedtc' and m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at >= date_trunc('day', now());
  select count(*) into mtd from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id join outreach_campaigns c on c.id=p.campaign_id
    where c.client_id='risedtc' and m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at >= date_trunc('month', now());
  client_id := 'risedtc'; model := 'weekly_adaptive';
  cap := coalesce((h->>'cap')::int,35); used := coalesce((h->>'weekly_sends')::int,0);
  window_label := 'week';
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce((h->>'accept_rate')::numeric,1) < 0.12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct;
  daily_cap := coalesce((select value::int from integration_config where key='risedtc_connect_daily_cap'),20);
  accept_rate := round(coalesce((h->>'accept_rate')::numeric,0) * 100, 1);
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(daily_cap - today_ct, 0);
  monthly_cap := coalesce((select value::int from integration_config where key='risedtc_connect_monthly_cap'),400);
  monthly_used := mtd; return next;
end $$;

grant execute on function inbox_governor() to anon, authenticated;
```
If Task 1 showed the RPC param name is not `p_client_id`, fix that one call; everything else is confirmed.

- [ ] **Step 2: Apply + verify**

```bash
q "rpc/inbox_governor" -X POST -H "Content-Type: application/json" -d '{}'
```
Expected: two rows; Ivan `cap` 35–100, `daily_cap=20`, `monthly_cap=null`, `accept_rate` as a percent (e.g. 16.6); Rise with `monthly_cap=400`, `monthly_used` = month-to-date sends, `daily_cap=20`.

- [ ] **Step 3: Commit**

```bash
git add db/008_kpi_governor.sql
git commit -m "feat(db): inbox_governor() normalized per-person throttle state"
```

---

### Task 6: Data lib — fetchers + pure derivations (+ unit tests)

**Files:**
- Create: `src/lib/kpis.ts`
- Create: `src/lib/kpis.test.ts`

**Model:** `sonnet` — one module from a complete spec with TDD.

**Interfaces:**
- Consumes: views/RPC from Tasks 2–5 via `supabase`.
- Produces (used by Task 7):
  - Types `AcceptRow`, `PipelineRow`, `GovernorRow`, `ScanOpenRow`.
  - `fetchAccept(): Promise<AcceptRow[]>`, `fetchPipeline(): Promise<PipelineRow[]>`, `fetchGovernor(): Promise<GovernorRow[]>`, `fetchScanOpens(): Promise<ScanOpenRow[]>`.
  - Pure: `acceptRate(sent:number, accepted:number): number`, `runwayDays(sendable:number, dailyRate:number): number`, `governorHeadroomPct(used:number, cap:number): number`, `laneLabel(lane:string): string`.

- [ ] **Step 1: Write the failing test `src/lib/kpis.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { acceptRate, runwayDays, governorHeadroomPct, laneLabel } from './kpis'

describe('acceptRate', () => {
  it('rounds accepted/sent to a whole percent', () => {
    expect(acceptRate(100, 31)).toBe(31)
    expect(acceptRate(3, 1)).toBe(33)
  })
  it('returns 0 when nothing was sent (no divide-by-zero)', () => {
    expect(acceptRate(0, 0)).toBe(0)
  })
})

describe('runwayDays', () => {
  it('floors sendable / daily rate', () => {
    expect(runwayDays(40, 4)).toBe(10)
    expect(runwayDays(9, 4)).toBe(2)
  })
  it('returns Infinity-safe 999 when send rate is 0', () => {
    expect(runwayDays(40, 0)).toBe(999)
  })
})

describe('governorHeadroomPct', () => {
  it('percent of cap used, clamped 0..100', () => {
    expect(governorHeadroomPct(42, 84)).toBe(50)
    expect(governorHeadroomPct(90, 84)).toBe(100)
    expect(governorHeadroomPct(0, 0)).toBe(0)
  })
})

describe('laneLabel', () => {
  it('maps lane keys to display labels', () => {
    expect(laneLabel('cold')).toBe('Cold')
    expect(laneLabel('warm')).toBe('Warm / Orbit')
    expect(laneLabel('engager')).toBe('Engager')
    expect(laneLabel('other')).toBe('Other')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/kpis.test.ts`
Expected: FAIL — cannot resolve `./kpis`.

- [ ] **Step 3: Write `src/lib/kpis.ts`**

```ts
import { supabase } from './supabase'

export type AcceptRow = {
  client_id: string
  sent_7d: number; accepted_7d: number; rate_7d: number | null
  sent_30d: number; accepted_30d: number; rate_30d: number | null
  sent_total: number; accepted_total: number
}
export type PipelineRow = {
  client_id: string; lane: string; sendable: number; sent_7d: number; sent_30d: number
}
export type GovernorRow = {
  client_id: string; model: 'weekly_adaptive' | 'monthly_fixed'
  cap: number; used: number; window_label: string
  mode: 'normal' | 'warm_only' | 'cold_paused'
  daily_used: number; daily_cap: number
  accept_rate: number // already a percent (RPC fraction * 100)
  headroom_week: number; headroom_day: number
  monthly_cap: number | null; monthly_used: number | null
}
export type ScanOpenRow = {
  client_id: string; opens_7d: number; opens_30d: number; opens_total: number
  distinct_prospects: number; last_open: string | null
}

async function selectAll<T>(view: string): Promise<T[]> {
  const { data, error } = await supabase.from(view).select('*')
  if (error) throw error
  return (data ?? []) as T[]
}

export const fetchAccept = () => selectAll<AcceptRow>('inbox_accept_v')
export const fetchPipeline = () => selectAll<PipelineRow>('inbox_pipeline_v')
export const fetchScanOpens = () => selectAll<ScanOpenRow>('inbox_scan_opens_v')

export async function fetchGovernor(): Promise<GovernorRow[]> {
  const { data, error } = await supabase.rpc('inbox_governor')
  if (error) throw error
  return (data ?? []) as GovernorRow[]
}

export function acceptRate(sent: number, accepted: number): number {
  if (sent <= 0) return 0
  return Math.round((accepted / sent) * 100)
}

export function runwayDays(sendable: number, dailyRate: number): number {
  if (dailyRate <= 0) return 999
  return Math.floor(sendable / dailyRate)
}

export function governorHeadroomPct(used: number, cap: number): number {
  if (cap <= 0) return 0
  return Math.min(100, Math.round((used / cap) * 100))
}

const LANE_LABELS: Record<string, string> = {
  cold: 'Cold', warm: 'Warm / Orbit', engager: 'Engager', other: 'Other',
}
export function laneLabel(lane: string): string {
  return LANE_LABELS[lane] ?? lane
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/kpis.test.ts`
Expected: PASS (all 4 describe blocks).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint && git add src/lib/kpis.ts src/lib/kpis.test.ts
git commit -m "feat: kpis data lib — fetchers + accept/runway/headroom derivations"
```

---

### Task 7: UI — Overview sub-view in SendsScreen

**Files:**
- Create: `src/screens/kpi/OverviewView.tsx`
- Modify: `src/screens/SendsScreen.tsx` (add `Overview` segment as default; keep `Lanes`/`Log`)
- Modify: `src/styles.css` (KPI cards, gauges, pipeline bars — follow existing `.sc-*` tokens)

**Model:** `opus` — multiple stacked responsive blocks wired into an existing screen; the design-heavy task.

**Interfaces:**
- Consumes: `fetchAccept/fetchPipeline/fetchGovernor/fetchScanOpens` + pure fns (Task 6); existing `fetchSends/fetchSendsDaily/buildLanes` (`src/lib/sends.ts`) for the KPI-row per-channel counts.
- Produces: `<OverviewView client={Client} timeframe={Timeframe} />`; `Timeframe = '7d'|'30d'|'90d'|'all'`.

- [ ] **Step 1: Build `OverviewView.tsx`**

Render five stacked blocks scoped to `client` + `timeframe`, each guarded for loading/error/empty:
1. **KPI row** — reuse `buildLanes(rows, daily, client)`; one card per lane (Connections/DMs/InMails/Emails) showing the count for the selected timeframe (`sent_7d`/`sent_30d`/`sent_30d`→90 via daily sum/`sent_total`), the 24h figure, and the existing `Spark` sparkline. Desktop: `display:grid; grid-template-columns:repeat(4,1fr)`; mobile: `repeat(2,1fr)`.
2. **Engagement** — from `fetchAccept()` filtered to `client` (for `all`, sum rows): acceptance % (`rate_7d`, `rate_30d`) with `accepted/sent` beneath + cohort-lag caption; and from `fetchScanOpens()`: real scan opens (`opens_7d`/`opens_30d`), `distinct_prospects`, `ago(last_open)`.
3. **Governor** — from `fetchGovernor()` row for `client` (hide for `all`, or show both stacked). Weekly gauge `used/cap` via `governorHeadroomPct`; ramp caption ("cap at {cap} · accept {accept_rate}%" — `accept_rate` is already a percent, do not multiply); daily brake `daily_used/daily_cap` when `daily_cap>0` (both people have it now); `mode` badge (normal/warm-only/cold-paused); headroom line "{headroom_week} left this {window_label}" + "{headroom_day} left today"; and, when `monthly_cap` is non-null (Rise), a monthly-ceiling line "{monthly_used}/{monthly_cap} this month".
4. **Pipeline** — from `fetchPipeline()` grouped by lane for `client`: bar per lane with `sendable`; overall runway `runwayDays(totalSendable, dailyRate)` where `dailyRate` = governor `daily_used` fallback to `sent_7d/7`; amber/red dot when a lane's runway < 5 days (reuse `DOT` colors from SendsScreen). Second strip: sourcing mix from `sent_7d`/`sent_30d` per lane.
5. **Campaigns** — new small fetch: `supabase.from('outreach_campaigns').select('id,name,is_active,client_id')` filtered to client, joined client-side to per-campaign send counts (add a `fetchCampaignSends(client)` to `src/lib/sends.ts` returning `{campaign_id, sent}[]` from `inbox_messages_v` grouped client-side). Table rows: name · active/paused · sends · (accept % optional, from prospects if cheap — else omit per YAGNI).

Use existing style primitives (`.sc`, `.sc-big`, `.sc-dot`, `.rows`, `.chip`, `.seg`). Keep each block a small function component inside the file.

- [ ] **Step 2: Wire the timeframe selector + Overview segment into `SendsScreen.tsx`**

Add `Timeframe` state (default `'7d'`) and a `7d/30d/90d/All` segmented control in the nav (reuse `.seg`/`.sg`). Add `'overview'` to the `view` union, make it the default, render `<OverviewView client={client} timeframe={timeframe} />`. Leave `Lanes` and `Log` branches exactly as-is.

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: `tsc -b` passes, Vite build succeeds, no type errors.

- [ ] **Step 4: Lint + commit**

```bash
npm run lint && git add src/screens/kpi/OverviewView.tsx src/screens/SendsScreen.tsx src/styles.css src/lib/sends.ts
git commit -m "feat: per-person Overview dashboard (KPIs, acceptance, governor, pipeline, scans)"
```

---

### Task 8: Auth lockout fix

**Files:**
- Modify: `src/lib/supabase.ts` (explicit auth persistence + storage-persist call)
- Modify: `src/App.tsx` (foreground re-validation)
- Modify: `src/screens/LoginScreen.tsx` (remembered email + magic-link fallback)

**Model:** `sonnet` — small, well-scoped behavior change across three files.

**Interfaces:**
- Produces: durable session that survives PWA backgrounding; one-tap re-auth.

- [ ] **Step 1: Harden the Supabase client**

Rewrite `src/lib/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,   // needed for magic-link callback
      storageKey: 'inbox-auth',
      flowType: 'pkce',
    },
  },
)

// Ask the browser to stop evicting our token (iOS/Safari 7-day cap).
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist() })
}
```

- [ ] **Step 2: Foreground re-validation in `App.tsx`**

In the existing `useEffect`, after subscribing, add a `visibilitychange` listener that refreshes the session when the app returns to foreground:
```ts
const onVisible = () => {
  if (document.visibilityState === 'visible') {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSession(data.session)
      else supabase.auth.refreshSession()
    })
  }
}
document.addEventListener('visibilitychange', onVisible)
```
Return a cleanup that also removes this listener alongside the existing `sub.subscription.unsubscribe()`.

- [ ] **Step 3: Remembered email + magic-link fallback in `LoginScreen.tsx`**

- Initialize `email` from `localStorage.getItem('inbox-email') ?? ''`; on `sendCode`, persist it (`localStorage.setItem('inbox-email', email)`).
- Add a "Email me a link instead" button that calls `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } })` and shows "Check your email — tap the link."
- Keep the 6-digit code path as the fallback.

- [ ] **Step 4: Build + manual verify**

Run: `npm run build`
Expected: builds clean. Manually: sign in, close the PWA, reopen after the access token would expire — session restores without the code prompt; if forced to re-auth, the email is pre-filled and the magic link signs in in one tap.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint && git add src/lib/supabase.ts src/App.tsx src/screens/LoginScreen.tsx
git commit -m "fix(auth): durable PWA session + foreground refresh + one-tap re-auth"
```

---

### Task 9: Screenshot verification pass

**Files:**
- Use: `scripts/shot.mjs` (existing)

**Model:** `sonnet` — run + eyeball, no logic.

- [ ] **Step 1: Capture mobile + desktop**

Run `node scripts/shot.mjs` (check the script for how it targets the Sends tab + widths; if it takes a URL/route arg, point it at the Sends tab at a mobile width ~390px and a desktop width ~1280px). Capture the Overview for Ivan, Rise, and All.

- [ ] **Step 2: Eyeball against the spec**

Confirm: KPI row is 4 cards (desktop row / mobile 2×2); Engagement shows acceptance + scan opens; Governor shows the correct model per person (Ivan adaptive+daily brake, Rise monthly); Pipeline shows lanes + runway days; Campaigns table renders; no overflow/clipping at either width; Lanes/Log sub-views still work.

- [ ] **Step 3: Commit any CSS fixes**

```bash
git add -A && git commit -m "polish: KPI dashboard responsive fixes from screenshot pass"
```

---

## Notes for the executor

- Tasks 2–5 (SQL) have no vitest coverage by nature; their "test" is the live verification query — run it and confirm sane output before committing.
- If Task 1 findings contradict an assumed identifier, fix the affected SQL in Tasks 2–5 at that identifier only; don't redesign the view.
- The whole-branch final review runs on `fable` per model-routing.
