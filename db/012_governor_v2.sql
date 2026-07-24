-- Governor v2 — adds true per-client enforcement numbers alongside the raw
-- (contaminated-for-ivan) outreach_sender_health() readout.
-- See goal-runs/sends-kpi-elevation-2026-07-24/phase1/r7-governor-crosscheck.md (F7).
--
-- F7a (real bug, live): outreach_sender_health() with no p_client_id argument
-- applies NO client filter at all — "no filter" is the only meaning of
-- p_client_id IS NULL inside that function, not "campaigns where client_id IS
-- NULL". So the old Ivan row's `used`/`cohort` were secretly Ivan+Rise combined:
-- weekly_sends=98 this week = 41 ivan + 57 rise (verified live 2026-07-24); the
-- 139-row cohort read 100% ivan only by present-day coincidence (Rise's sender
-- only started 07-21, so none of its sends had aged past the cohort's 3-day
-- floor yet — that protection is temporary, not structural).
-- We do NOT touch outreach_sender_health() itself (shared enforcement function,
-- blast radius touches live sending). Instead this function computes true
-- per-client cohort/used/accepted itself, straight from
-- outreach_engagement_log (action_type='connection_request', success=true),
-- scoped by joining prospect -> campaign -> client_id (NULL = ivan,
-- 'risedtc' = rise) — and ALSO returns the raw RPC numbers as gov_used/gov_cap
-- so the UI can show e.g. "41 sent this week · governor counter reads 98/50
-- (shared with Rise — cold sends gated)".
--
-- `used` mirrors outreach_sender_health's own counting basis for weekly_sends:
-- a plain row count in the 7-day window (reproduction matched live 41 ivan /
-- 57 risedtc exactly, r7 §1a/§3). `cohort` mirrors the RPC's sent_cohort CTE:
-- DISTINCT prospect_id in [now-18d, now-3d] (matched live 139 ivan / 0 risedtc).
-- `accepted` = of that cohort, prospects whose CURRENT stage is one of
-- ('connected','replied','dm_sent') (matched live 23 ivan). accept_rate is
-- NULL, never 0, while cohort=0 — Rise's cohort is genuinely empty right now
-- (its oldest sends have not crossed the 3-day floor), which is "no data yet",
-- not "0% acceptance" (F7c).
--
-- F7b (real bug): Rise's actually-enforced weekly cap is 100 — a manual
-- integration_config override the n8n sender has read since 2026-07-23 (proven
-- live: Rise sent 57 past the RPC's raw adaptive 35 without pausing) — not the
-- RPC's cohort<15 "insufficient data" placeholder of 35. `cap` mirrors the same
-- config-override pattern already used for daily_cap/monthly_cap below.
-- Ivan has no such override; his enforced cap IS the RPC's adaptive cap.
--
-- `cohort_opens_at`: NULL for ivan (mature cohort already flowing). For Rise,
-- the date its cohort window starts filling = risedtc_first_dispatch_not_before
-- + 3 days (the cohort floor) — lets the UI say "opens ~2026-07-27" instead of
-- a bare null while cohort=0.
--
-- Return-type change (new trailing columns) — CREATE OR REPLACE VIEW/FUNCTION
-- cannot alter an existing return signature, must drop first.
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
  cap  := gov_cap;  -- no config override exists for ivan; RPC's adaptive cap is the real enforcement
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
