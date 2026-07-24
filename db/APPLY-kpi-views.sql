-- ============================================================
-- KPI dashboard — apply ALL views/RPC in one paste.
-- Run in Supabase SQL editor (project bjbvqvzbzczjbatgmccb).
-- Idempotent: every statement is create-or-replace (012's function is
-- drop-then-create because its return type changed — safe to re-run either
-- way). Safe to re-run.
--
-- Apply order: 003 (sends views, unchanged) -> 009 (cohort acceptance,
-- replaces 005) -> 010 (campaign sends, new) -> 011 (scan client attribution,
-- replaces 007) -> 012 (governor v2, drop+recreate, replaces 008) -> 013
-- (harvest lane_of + 006's inbox_pipeline_v, unchanged view text — lane_of
-- must exist before the view is created, hence this file's function-then-view
-- order within its own section).
--
-- 005, 007, 008's ORIGINAL bodies are SUPERSEDED and intentionally NOT pasted
-- below — 009/011/012 create-or-replace the same view/function names, so
-- re-running the old 005/007/008 blocks after this file would silently revert
-- the accuracy fixes. Do not re-paste them.
--
-- This block is the output of goal-runs/sends-kpi-elevation-2026-07-24 —
-- see phase1-accuracy.md for the "why" behind every change below, and
-- phase3/INTERFACES.md for the exact column contracts.
--
-- ---- Post-apply verification (run after pasting, compare to phase1 gates) ----
-- Numbers below are what phase1-accuracy.md's live snapshot measured on
-- 2026-07-24 — they WILL have drifted by the time this is applied (sends and
-- accepts keep accruing); check for "same order of magnitude / same shape",
-- not exact equality.
--
--   -- X1 cohort acceptance (expect ivan ~8/41 accepted/sent_7d, ~19.5% rate_7d;
--   -- ~52/250 accepted/sent_30d):
--   select * from inbox_accept_v order by client_id;
--
--   -- X2 campaign sends (expect Agency-Focused Consultants & Fractionals
--   -- sent_total ~331; Warm - Engagement Harvest ~62; Manufacturing &
--   -- Industrial Ops ~29, no longer a hard zero):
--   select campaign_name, client_id, is_active, sent_total, sent_7d, sent_30d
--   from inbox_campaign_sends_v order by sent_total desc;
--
--   -- X3 scan attribution (expect a risedtc row with opens_total ~3, ivan's
--   -- opens_total dropping by the same amount, ~64):
--   select * from inbox_scan_opens_v order by client_id;
--
--   -- X4 governor v2 (expect ivan used ~41 with gov_used ~98 (the shared,
--   -- contaminated RPC counter) visibly different from used; risedtc cap=100
--   -- (not the RPC's adaptive 35); risedtc accept_rate NULL while cohort=0):
--   select client_id, cap, used, gov_used, gov_cap, cohort, accepted,
--          accept_rate, mode, cohort_opens_at
--   from inbox_governor();
--
--   -- X5 harvest lane (expect ivan's engager-lane sendable supply moved into a
--   -- new harvest row, ~92 sendable; ivan's engager row now ~0 sendable):
--   select client_id, lane, sendable, sent_7d, sent_30d
--   from inbox_pipeline_v where client_id = 'ivan' order by lane;
-- ============================================================

-- ===== 003_sends_views.sql (inbox_sends_daily_v widened 14d->90d; unchanged) =====
-- A historical insert-loop left phantom duplicate sends in outreach_messages:
-- the same message to the same prospect, identical text, stamped at the exact
-- same millisecond (e.g. 587 copies of one DM to Brian Gerstner). They are not
-- real separate sends, so both views collapse them via distinct on
-- (prospect_id, message_text, sent_at) before counting. Two genuinely distinct
-- sends never share all three, so this never under-counts real activity.

create or replace view inbox_sends_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type,
    coalesce(m.channel, 'linkedin') as channel,
    m.sent_at, m.send_blocked_at, m.send_blocked_reason
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type, channel,
  count(*) filter (where sent_at is not null) as sent_total,
  count(*) filter (where sent_at >= now() - interval '24 hours') as sent_24h,
  count(*) filter (where sent_at >= now() - interval '7 days') as sent_7d,
  count(*) filter (where sent_at >= now() - interval '30 days') as sent_30d,
  count(*) filter (where send_blocked_at is not null and send_blocked_reason <> 'discarded_in_inbox') as blocked,
  max(sent_at) as last_sent
from dedup
group by 1, 2, 3;

create or replace view inbox_sends_daily_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type, m.sent_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.sent_at >= now() - interval '90 days'
    and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type,
  to_char(date_trunc('day', sent_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
  count(*) as sent
from dedup
group by 1, 2, 3;

-- ===== 009_accept_cohort.sql (replaces 005_kpi_accept.sql) =====
-- Connection acceptance per client. COHORT style: denominator = connection_notes
-- SENT in the window; numerator = those same rows whose prospect connected at/after
-- the note (connected_at >= sent_at). Replaces the prior trailing style (005), whose
-- numerator (accepts by connected_at) and denominator (sends by sent_at) were drawn
-- from disjoint populations — cross-cohort inflation, structurally unbounded (>100%
-- reachable in a send-throttle week; ivan measured 07-24: trailing 29.3% vs cohort
-- 19.5%, 4 of 12 accepted_7d credited from notes sent before the 7d window).
-- NOTE this number no longer matches the trailing rate outreach_sender_health /
-- inbox_governor react to (see 012 below) — do not "reconcile" them, they answer
-- different questions on purpose.
-- Known, accepted edge semantics (measured 2026-07-24, do not re-litigate without
-- new data — see goal-runs/sends-kpi-elevation-2026-07-24/phase1/s1-cohort-skeptic.md):
--  * connected_at < sent_at (1 row ever): counts as a failed send in the denominator,
--    never in the numerator — a note to an already-connected prospect is a wasted send.
--  * two different notes to one prospect before a single accept (1 prospect ever):
--    both rows count as accepted; per-note over per-note stays <= 100%.
--  * Recent sends are right-censored: window rates are floors that rise as sends
--    mature (median accept lag 0.49d; ~90% of accepts land within 7d) — surfaced in
--    the UI caption, not corrected here.
-- Column shape UNCHANGED from 005 — frontend-safe.
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

-- ===== 010_campaign_sends.sql (new) =====
-- Per-campaign send totals for the Overview -> Campaigns block. Replaces the
-- client-side fetchCampaignSends window (src/lib/sends.ts, querying
-- inbox_messages_v ordered by sent_at desc, limit 4000) — PostgREST silently
-- caps that request's response to the newest 1000 rows server-side regardless
-- of the client .limit(), verified live 2026-07-24 for the app's actual authed
-- role (1409 ground-truth rows vs 1000 fetched). That undercounted 12 of 27
-- campaigns, 8 of them down to a hard zero; worst active campaign
-- ("Agency-Focused Consultants & Fractionals") read 199 vs 331 real. See
-- goal-runs/sends-kpi-elevation-2026-07-24/phase1/r2-campaign-counts.md.
-- Joins on campaign_id (never name); LEFT JOIN from outreach_campaigns so a
-- zero-send campaign still appears with 0s. message_type filter IDENTICAL to
-- inbox_sends_v: ('connection_note','dm','inmail','email').
create or replace view inbox_campaign_sends_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    p.campaign_id, m.sent_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  where m.direction = 'outbound'
    and m.sent_at is not null
    and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select
  c.id as campaign_id,
  c.name as campaign_name,
  coalesce(c.client_id, 'ivan') as client_id,
  c.is_active,
  count(d.sent_at) as sent_total,
  count(d.sent_at) filter (where d.sent_at >= now() - interval '7 days')  as sent_7d,
  count(d.sent_at) filter (where d.sent_at >= now() - interval '30 days') as sent_30d,
  max(d.sent_at) as last_sent
from outreach_campaigns c
left join dedup d on d.campaign_id = c.id
group by c.id, c.name, c.client_id, c.is_active;

-- ===== 011_scan_client_attr.sql (replaces 007_kpi_scan_opens.sql) =====
-- Real (non-owner) scan-report opens per client. Definer rights so it reads the
-- service-role-only scan_opens under RLS, exposing only aggregates.
-- CHANGE from 007 (client derivation only): 47 of 149 live `scans` rows carry
-- Rise's brand block (report_json->'dtc'->'brand'->>'wordmark' = 'RISE DTC')
-- and are prospect_token=null (Rise's own scan funnel, not outreach-sourced) —
-- structurally invisible to the token join, previously silently misattributed
-- to 'ivan'. One, neve-foods-7f, is open-bearing (3 non-owner opens, first
-- landing 25s after a Rise DM) and is a real RiseDTC — Client Orbit prospect.
-- Corrected client_id = coalesce(campaign-derived client, RISE-wordmark branch,
-- 'ivan'). See goal-runs/sends-kpi-elevation-2026-07-24/phase1/s3-joingap-skeptic.md.
create or replace view inbox_scan_opens_v with (security_invoker = off) as
with j as (
  select so.opened_at, so.company_slug,
         coalesce(c.client_id,
                   case when sc.wordmark = 'RISE DTC' then 'risedtc' end,
                   'ivan') as client_id
  from scan_opens so
  left join (
    select distinct on (company_slug) company_slug, prospect_token,
           report_json->'dtc'->'brand'->>'wordmark' as wordmark
    from scans order by company_slug, prospect_token nulls last
  ) sc on sc.company_slug = so.company_slug
  left join outreach_prospects pr on pr.id::text = sc.prospect_token
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

-- Optional operator backfill (NOT auto-run, belt-and-suspenders with the
-- wordmark branch above):
-- update scans set prospect_token='bb842d9a-daa5-42fa-ad62-9336e68e704c' where company_slug='neve-foods-7f' and prospect_token is null;

-- ===== 012_governor_v2.sql (replaces 008_kpi_governor.sql) =====
-- Governor v2 — adds true per-client enforcement numbers alongside the raw
-- (contaminated-for-ivan) outreach_sender_health() readout. See
-- goal-runs/sends-kpi-elevation-2026-07-24/phase1/r7-governor-crosscheck.md (F7).
-- F7a: outreach_sender_health() with no p_client_id applies NO client filter
-- (not "campaigns where client_id IS NULL") — the old ivan row's used/cohort
-- were secretly ivan+rise combined (98 = 41 ivan + 57 rise this week). We do
-- not touch that shared function; this RPC computes true per-client
-- cohort/used/accepted itself from outreach_engagement_log, and also exposes
-- the raw RPC numbers as gov_used/gov_cap so the UI can show both.
-- F7b: Rise's actually-enforced weekly cap is 100 (integration_config
-- override the n8n sender reads since 07-23), not the RPC's adaptive
-- insufficient-data placeholder of 35 — cap := coalesce(config override, RPC cap).
-- F7c: accept_rate is NULL (never 0) while cohort=0 — a cohort too young to
-- have matured is not the same as a cohort that converted at 0%.
-- Return-type change requires DROP + CREATE, not just CREATE OR REPLACE.
drop function if exists inbox_governor();

create function inbox_governor()
returns table (
  client_id text, model text, cap int, used int, window_label text, mode text,
  daily_used int, daily_cap int, accept_rate numeric, headroom_week int, headroom_day int,
  monthly_cap int, monthly_used int, cohort int, accepted int, gov_used int, gov_cap int,
  cohort_opens_at date
) language plpgsql security definer as $$
declare
  h jsonb; today_ct int; mtd int;
  c_used int; c_cohort int; c_accepted int; c_rate numeric;
begin
  -- ================= Ivan (campaigns.client_id IS NULL) =================
  select to_jsonb(x) into h from outreach_sender_health() x;

  select count(*) into c_used
  from outreach_engagement_log el
  join outreach_prospects p on p.id = el.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where el.action_type = 'connection_request' and el.success = true
    and el.created_at >= now() - interval '7 days'
    and c.client_id is null;

  select count(*), count(*) filter (where pr.stage in ('connected','replied','dm_sent'))
    into c_cohort, c_accepted
  from (
    select distinct el.prospect_id
    from outreach_engagement_log el
    join outreach_prospects p on p.id = el.prospect_id
    join outreach_campaigns c on c.id = p.campaign_id
    where el.action_type = 'connection_request' and el.success = true
      and el.created_at between now() - interval '18 days' and now() - interval '3 days'
      and c.client_id is null
  ) cohort_ids
  join outreach_prospects pr on pr.id = cohort_ids.prospect_id;

  c_rate := case when c_cohort > 0 then round(100.0 * c_accepted / c_cohort, 1) else null end;

  select count(*) into today_ct from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at) m.id
    from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id
    join outreach_campaigns c on c.id=p.campaign_id
    where coalesce(c.client_id,'ivan')='ivan' and m.direction='outbound'
      and m.message_type='connection_note' and m.sent_at >= date_trunc('day', now())
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) d;

  client_id := 'ivan'; model := 'weekly_adaptive';
  gov_used := coalesce((h->>'weekly_sends')::int, 0);
  gov_cap  := coalesce((h->>'cap')::int, 35);
  used := c_used;
  cap  := gov_cap;
  window_label := 'week';
  cohort := c_cohort; accepted := c_accepted; accept_rate := c_rate;
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce(c_cohort,0) > 0 and coalesce(c_rate,100) < 12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct; daily_cap := 20;
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(daily_cap - today_ct, 0);
  monthly_cap := null; monthly_used := null;
  cohort_opens_at := null;
  return next;

  -- ================= Rise (campaigns.client_id = 'risedtc') =================
  select to_jsonb(x) into h from outreach_sender_health(p_client_id => 'risedtc') x;

  select count(*) into c_used
  from outreach_engagement_log el
  join outreach_prospects p on p.id = el.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where el.action_type = 'connection_request' and el.success = true
    and el.created_at >= now() - interval '7 days'
    and c.client_id = 'risedtc';

  select count(*), count(*) filter (where pr.stage in ('connected','replied','dm_sent'))
    into c_cohort, c_accepted
  from (
    select distinct el.prospect_id
    from outreach_engagement_log el
    join outreach_prospects p on p.id = el.prospect_id
    join outreach_campaigns c on c.id = p.campaign_id
    where el.action_type = 'connection_request' and el.success = true
      and el.created_at between now() - interval '18 days' and now() - interval '3 days'
      and c.client_id = 'risedtc'
  ) cohort_ids
  join outreach_prospects pr on pr.id = cohort_ids.prospect_id;

  c_rate := case when c_cohort > 0 then round(100.0 * c_accepted / c_cohort, 1) else null end;

  select count(*) into today_ct from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at) m.id
    from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id join outreach_campaigns c on c.id=p.campaign_id
    where c.client_id='risedtc' and m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at >= date_trunc('day', now())
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) d;
  select count(*) into mtd from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at) m.id
    from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id join outreach_campaigns c on c.id=p.campaign_id
    where c.client_id='risedtc' and m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at >= date_trunc('month', now())
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) d;

  client_id := 'risedtc'; model := 'weekly_adaptive';
  gov_used := coalesce((h->>'weekly_sends')::int, 0);
  gov_cap  := coalesce((h->>'cap')::int, 35);
  used := c_used;
  cap  := coalesce((select value::int from integration_config where key='risedtc_connect_weekly_cap'), gov_cap);
  window_label := 'week';
  cohort := c_cohort; accepted := c_accepted; accept_rate := c_rate;
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce(c_cohort,0) > 0 and coalesce(c_rate,100) < 12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct;
  daily_cap := coalesce((select value::int from integration_config where key='risedtc_connect_daily_cap'),20);
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(daily_cap - today_ct, 0);
  monthly_cap := coalesce((select value::int from integration_config where key='risedtc_connect_monthly_cap'),400);
  monthly_used := mtd;
  cohort_opens_at := (select (value::timestamptz + interval '3 days')::date
                       from integration_config where key='risedtc_first_dispatch_not_before');
  return next;
end $$;

grant execute on function inbox_governor() to anon, authenticated;

-- ===== 013_lane_harvest.sql (lane_of) + 006_kpi_pipeline.sql's inbox_pipeline_v (unchanged) =====
-- Adds a 'harvest' lane, split out from 'engager': a skeptic audit proved
-- Ivan's "Engager" lane is 0% own-content (Kyle's audience, other creators'
-- LM-anchor posts, competitor-post harvest). New FIRST branch (checked before
-- 'engager'): '%kyle engagers%' / '%anchor%' / '%engagement harvest%' ->
-- 'harvest'. 'engager' keeps only '%engager%' / '%profile view%' (now-shadowed
-- patterns removed — they always match harvest first). See
-- goal-runs/sends-kpi-elevation-2026-07-24/phase1-accuracy.md (F4).
-- inbox_pipeline_v's own text is unchanged from 006 — it calls lane_of() at
-- query time, not inlined, so it automatically picks up the new buckets once
-- lane_of() is recreated. Function must exist before the view is (re)created,
-- hence lane_of first in this section.
create or replace function lane_of(camp_name text) returns text
language sql immutable as $$
  select case
    when camp_name ilike '%kyle engagers%' or camp_name ilike '%anchor%'
      or camp_name ilike '%engagement harvest%'                          then 'harvest'
    when camp_name ilike '%engager%' or camp_name ilike '%profile view%' then 'engager'
    when camp_name ilike '%warm%' or camp_name ilike '%orbit%'
      or camp_name ilike '%network activation%'                          then 'warm'
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
