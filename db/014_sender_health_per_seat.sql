-- ⚠ ENFORCEMENT CHANGE (not just display): rewrites outreach_sender_health() so the
-- governor is per-seat. Authorized by Ivan 2026-07-24 ("fix the governor to be per
-- ivan/rise lane... full speed rn").
--
-- What changes vs the live body (read from pg_proc 2026-07-24, byte-compared):
--  1. p_client_id NULL now means 'ivan' (campaigns.client_id IS NULL) instead of
--     "no filter at all". The old NULL path summed Ivan+Rise into one counter, so
--     Rise's 57 sends were consuming Ivan's weekly cap and gating his cold sends
--     (evidence: goal-runs/sends-kpi-elevation-2026-07-24/phase1/r7-governor-crosscheck.md §1a).
--     Caller audit 2026-07-24: exactly ONE n8n caller in all 317 workflows
--     ("Outreach - Connection Request Sender" 5ZXtArhobWrDDpfJ — Ivan branch calls
--     with no arg and WANTS ivan-scope; Rise branch already passes 'risedtc') plus
--     the dashboard's inbox_governor(). Both want per-seat numbers.
--  2. 'cap' honors a per-seat config override: integration_config '<seat>_connect_weekly_cap'
--     beats the adaptive ramp. This moves the override the n8n Rise branch already
--     applies in JS into the function itself, so enforcement and every display agree.
--     (The n8n JS override stays; it now re-applies the same number — harmless.)
-- Everything else (cohort 3-18d, accepted stages, warm_sends, warm_cap 25, warm_only,
-- adaptive ramp) is byte-identical to the live body.
--
-- Full-speed config: both seats get a 100/week ceiling. Daily brakes (20/day) are
-- NOT touched — they are LinkedIn account-safety, not governor throttle.

insert into integration_config (key, value)
values ('ivan_connect_weekly_cap', '100')
on conflict (key) do update set value = excluded.value;

insert into integration_config (key, value)
values ('risedtc_connect_weekly_cap', '100')
on conflict (key) do nothing;  -- already set by the operator 07-23; never overwrite

create or replace function public.outreach_sender_health(p_client_id text default null)
returns jsonb
language sql
stable
as $function$
with cp as (
  -- per-seat prospect scope; 'ivan' = campaigns with NULL client_id (repo convention)
  select p.id as prospect_id
  from outreach_prospects p
  join outreach_campaigns c on c.id = p.campaign_id
  where case when coalesce(p_client_id, 'ivan') = 'ivan'
             then c.client_id is null
             else c.client_id = coalesce(p_client_id, 'ivan') end
),
sent_cohort as (
  -- invites sent 3-18 days ago: old enough to have been accepted/ignored
  select distinct el.prospect_id
  from outreach_engagement_log el
  where el.action_type = 'connection_request' and el.success = true
    and el.created_at between now() - interval '18 days' and now() - interval '3 days'
    and el.prospect_id in (select prospect_id from cp)
),
judged as (
  select (p.stage in ('connected','replied','dm_sent')) as accepted
  from sent_cohort s join outreach_prospects p on p.id = s.prospect_id
),
agg as (
  select
    count(*) as cohort,
    count(*) filter (where accepted) as accepted
  from judged
),
sends as (
  select
    (select count(*) from outreach_engagement_log
       where action_type='connection_request' and success=true
         and created_at >= now() - interval '7 days'
         and prospect_id in (select prospect_id from cp)) as weekly_sends,
    (select count(*) from outreach_engagement_log el
       join outreach_prospects p on p.id = el.prospect_id
       where el.action_type='connection_request' and el.success=true
         and el.created_at >= now() - interval '7 days'
         and coalesce(p.trigger_confidence,0) >= 3
         and el.prospect_id in (select prospect_id from cp)) as warm_sends_7d
),
m as (
  select a.cohort, a.accepted, s.weekly_sends, s.warm_sends_7d,
         case when a.cohort > 0 then a.accepted::numeric / a.cohort else null end as rate
  from agg a cross join sends s
)
select jsonb_build_object(
  'cohort', cohort,
  'accepted', accepted,
  'accept_rate', case when rate is null then null else round(rate,4) end,
  'weekly_sends', weekly_sends,
  'warm_sends_7d', warm_sends_7d,
  'warm_cap', 25,
  'cap', coalesce(
           (select value::int from integration_config
             where key = coalesce(p_client_id, 'ivan') || '_connect_weekly_cap'),
           case
             when cohort < 15 then 35
             when rate >= 0.30 then 100
             when rate >= 0.20 then 70
             when rate >= 0.12 then 50
             when rate >= 0.06 then 35
             else 20 end),
  'warm_only', case when cohort >= 15 and rate < 0.12 then true else false end
) from m;
$function$;

-- Post-apply verification (expected 2026-07-24 ±sliding windows):
--   select outreach_sender_health();                          -- ivan: weekly_sends ≈ 41 (NOT 98), cap 100, cohort ≈ 139
--   select outreach_sender_health(p_client_id => 'risedtc');  -- rise: weekly_sends ≈ 57, cap 100
-- Ivan's sender unblocks on its next hourly run (41 < 100). No n8n change required.
