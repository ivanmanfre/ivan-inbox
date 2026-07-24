-- ============================================================
-- KPI dashboard — apply ALL views/RPC in one paste.
-- Run in Supabase SQL editor (project bjbvqvzbzczjbatgmccb).
-- Idempotent: every statement is create-or-replace. Safe to re-run.
-- Order matters: 003 (widened daily) -> 005 -> 006 -> 007 -> 008.
-- ============================================================

-- ===== 003_sends_views.sql (inbox_sends_daily_v widened 14d->90d) =====
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

-- ===== 005_kpi_accept.sql =====
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

-- ===== 006_kpi_pipeline.sql =====
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

-- ===== 007_kpi_scan_opens.sql =====
-- Real (non-owner) scan-report opens per client. Definer rights so it reads the
-- service-role-only scan_opens under RLS, exposing only aggregates (mirrors
-- scan_open_stats). Self-clicks already excluded by is_owner + owner_ips.
-- Join (see db/NOTES-kpi-verification.md SLUG_JOIN): there is no scan_slug column.
--   scan_opens.company_slug -> scans.company_slug -> scans.prospect_token
--   -> outreach_prospects.id -> campaign_id -> outreach_campaigns.client_id.
-- Most scans are inbound with a null prospect_token, so LEFT joins + coalesce
-- attribute token-less/inbound opens to 'ivan' (the repo default-client convention).
create or replace view inbox_scan_opens_v with (security_invoker = off) as
with j as (
  select so.opened_at, so.company_slug,
         coalesce(c.client_id,'ivan') as client_id
  from scan_opens so
  -- Collapse duplicate scans rows per slug (a re-scan inserts another row); the
  -- bare left join would fan out and multi-count every open for that slug.
  left join (
    select distinct on (company_slug) company_slug, prospect_token
    from scans order by company_slug, prospect_token nulls last
  ) sc on sc.company_slug = so.company_slug
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

-- ===== 008_kpi_governor.sql =====
-- Normalized per-person governor. Both people use the client-parameterized
-- adaptive weekly governor (outreach_sender_health). accept_rate is returned as a
-- fraction by the RPC -> multiply by 100 for a percent. Rise also carries its
-- monthly ceiling from the key/value integration_config table.
-- See db/NOTES-kpi-verification.md (SENDER_HEALTH_FIELDS, MONTHLY_CAP).
create or replace function inbox_governor()
returns table (
  client_id text, model text, cap int, used int, window_label text, mode text,
  daily_used int, daily_cap int, accept_rate numeric, headroom_week int, headroom_day int,
  monthly_cap int, monthly_used int
) language plpgsql security definer as $$
declare h jsonb; today_ct int; mtd int;
begin
  -- ---- Ivan ----
  select to_jsonb(x) into h from outreach_sender_health() x;
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
  cap := coalesce((h->>'cap')::int,35); used := coalesce((h->>'weekly_sends')::int,0);
  window_label := 'week';
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce((h->>'cohort')::int,0) > 0
                    and coalesce((h->>'accept_rate')::numeric,1) < 0.12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct; daily_cap := 20;
  accept_rate := round(coalesce((h->>'accept_rate')::numeric,0) * 100, 1);
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(20 - today_ct, 0);
  monthly_cap := null; monthly_used := null; return next;

  -- ---- Rise ----
  select to_jsonb(x) into h from outreach_sender_health(p_client_id => 'risedtc') x;
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
  cap := coalesce((h->>'cap')::int,35); used := coalesce((h->>'weekly_sends')::int,0);
  window_label := 'week';
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce((h->>'cohort')::int,0) > 0
                    and coalesce((h->>'accept_rate')::numeric,1) < 0.12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct;
  daily_cap := coalesce((select value::int from integration_config where key='risedtc_connect_daily_cap'),20);
  accept_rate := round(coalesce((h->>'accept_rate')::numeric,0) * 100, 1);
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(daily_cap - today_ct, 0);
  monthly_cap := coalesce((select value::int from integration_config where key='risedtc_connect_monthly_cap'),400);
  monthly_used := mtd; return next;
end $$;

grant execute on function inbox_governor() to anon, authenticated;
