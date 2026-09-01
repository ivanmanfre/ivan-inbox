-- 047: teach the Overview about the ARCH seat. Found 2026-09-01 — the dashboard
-- read Arch as "Governor: No data · Runway 0d · 0 sendable · Refill 0.00x" while
-- the ARCH Connection Sender (9FpJ1cUqoEPTCeP2) was picking a real pool and
-- sending 25-26 invites a day.
--
-- Every one of those three tiles was blind for the same reason: the KPI layer has
-- only ever known TWO seats. Its else-branch was written for Rise and hardcodes
-- Rise's arming tell, and inbox_governor() is a two-branch plpgsql function with
-- no arch case at all. ARCH is a third picker with a third arming model:
--
--   ivan     stage='enriched'                  + icp_score >= 7      (+ liveness on cold)
--   risedtc  stage in (enriched, identified)   + rise_note_final     (+ liveness on cold)
--   arch     stage='queued'                    + enrichment_data.lane not null
--            + skip_state is null + connected_at is null
--
-- ARCH arms by PROMOTION, not by score: rows land in stage='ballot_hold' and
-- LAUNCH.md promotes ballot_hold -> queued once Davorin approves them. The picker
-- (9FpJ1cUqoEPTCeP2, node `Query + Build Notes`) never touches ballot_hold, and it
-- has no icp_score gate and writes no rise_note_final — so the old else-branch
-- matched exactly zero arch rows out of 1,065 and printed a 0-day runway on a lane
-- with 64 armed leads.
--
-- Measured at authoring time (2026-09-01):
--   arch cold sendable   0 -> 64   (874 ballot_hold correctly still excluded)
--   arch governor      absent -> 35/35 today, cap reached
--   arch refill        "no data" -> real, keyed on promoted_at
--
-- country / preferred_channel are left in the shared WHERE: they are a no-op for
-- arch today (64 either way), so this stays a one-branch change.
--
-- lane_of() is NOT redefined — 013_lane_harvest.sql owns it. Arch campaign names
-- ("ARCH. Influencer Agency — Cold" / "— Warm (his engagers)") already bucket to
-- cold / engager under the existing patterns. Re-running this file is safe.

-- ============================ 1. inbox_pipeline_v ============================
create or replace view inbox_pipeline_v with (security_invoker = on) as
with cand as (  -- one row per prospect on a live campaign, with its seat + lane
  select coalesce(c.client_id,'ivan') as client_id,
         lane_of(c.name)              as lane,
         coalesce(c.archived,false)   as camp_archived,
         pr.stage, pr.icp_score, pr.country, pr.preferred_channel,
         pr.connection_sent_at, pr.connected_at, pr.last_dm_sent_at,
         pr.liveness_checked_at, pr.skip_state,
         pr.enrichment_data, coalesce(pr.blacklisted,false) as blacklisted
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where c.is_active = true
),
runway as (  -- sendable = what the seat's own picker would accept today
  select client_id, lane, count(*) as sendable
  from cand
  where blacklisted = false
    and country is not null
    and (preferred_channel is null or preferred_channel = 'linkedin')
    and connection_sent_at is null
    and last_dm_sent_at is null
    -- per-name hold: the Rise picker skips these outright (0 volume by design)
    and coalesce(enrichment_data->'name_gate'->>'status','') <> 'blocked_until_mattan_ok'
    and case when client_id = 'ivan'
      -- Ivan: enriched only, ICP floor, cold additionally needs a liveness stamp
      then stage = 'enriched'
           and icp_score >= 7
           and (lane <> 'cold' or liveness_checked_at is not null)
      -- ARCH: promotion-armed. The picker's scope verbatim — stage='queued'
      -- (ballot_hold is pre-approval and unreachable), a lane tag, no skip_state,
      -- not already connected, and the campaign not archived. No score gate and
      -- no liveness gate exist on this path.
      when client_id = 'arch'
      then stage = 'queued'
           and skip_state is null
           and enrichment_data->>'lane' is not null
           and connected_at is null
           and camp_archived = false
      -- Rise/other seats: armed by the seatless gate, so the tell is a composed
      -- note (rise_note_final). Ballot-held rows never carry one.
      else stage in ('enriched','identified')
           and enrichment_data->>'rise_note_final' is not null
           and (lane <> 'cold' or liveness_checked_at is not null)
    end
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

-- ========================== 2. inbox_replacement_v ===========================
-- INFLOW for arch is the PROMOTION, not the score: a row becomes usable the moment
-- Davorin's approval moves it ballot_hold -> queued, stamped in
-- enrichment_data.promoted_at. Using scored_at (the ivan/rise basis) would credit
-- the harvest day and read 0 in / N out forever, which is exactly what the tile
-- printed before this file. Arch rows scored days before anyone could send them.
create or replace view inbox_replacement_v with (security_invoker = on) as
with inflow as (
  select coalesce(c.client_id,'ivan') as client_id,
         lane_of(c.name)              as lane,
         case when coalesce(c.client_id,'ivan') = 'arch'
              then (pr.enrichment_data->>'promoted_at')::timestamptz::date
              else pr.scored_at::date end as day,
         count(*)                     as qualified_in
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where coalesce(pr.blacklisted,false) = false
    and case when coalesce(c.client_id,'ivan') = 'ivan'
      then pr.scored_at is not null
           and pr.scored_at >= now() - interval '30 days'
           and pr.icp_score >= (case when lane_of(c.name) = 'cold' then 7 else 6 end)
      when coalesce(c.client_id,'ivan') = 'arch'
      then pr.enrichment_data->>'promoted_at' is not null
           and (pr.enrichment_data->>'promoted_at')::timestamptz >= now() - interval '30 days'
           and pr.skip_state is null
           and pr.enrichment_data->>'lane' is not null
      else pr.scored_at is not null
           and pr.scored_at >= now() - interval '30 days'
           and pr.enrichment_data->>'rise_note_final' is not null
    end
  group by 1,2,3
),
outflow as (
  select coalesce(c.client_id,'ivan') as client_id,
         lane_of(c.name)              as lane,
         s.sent_at::date              as day,
         count(*)                     as sent_out
  from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at)
      m.prospect_id, m.sent_at
    from outreach_messages m
    where m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at is not null and m.sent_at >= now() - interval '30 days'
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) s
  join outreach_prospects pr on pr.id = s.prospect_id
  join outreach_campaigns c on c.id = pr.campaign_id
  group by 1,2,3
)
select coalesce(i.client_id, o.client_id) as client_id,
       coalesce(i.lane,      o.lane)      as lane,
       coalesce(i.day,       o.day)       as day,
       coalesce(i.qualified_in, 0)        as qualified_in,
       coalesce(o.sent_out,     0)        as sent_out
from inflow i full outer join outflow o
  on i.client_id = o.client_id and i.lane = o.lane and i.day = o.day;

-- ============================ 3. inbox_governor() ============================
-- Adds a third branch. Return signature is UNCHANGED, so create-or-replace is
-- enough (no drop, nothing downstream to migrate).
--
-- ARCH's governor is a DAILY RAMP, not a weekly adaptive cap: day1 20, +5 per
-- weekday, ceiling 40 (integration_config arch_connect_ramp). The sender computes
-- that figure and then SYNCS it into linkedin_daily_actions
-- (seat='arch', action_type='connection_request') so the RPC
-- linkedin_check_and_increment enforces the same number. That row is therefore
-- the enforcement truth, and this branch reads it rather than re-deriving the
-- ramp — a re-derivation could disagree with what is actually blocking sends.
--
-- ⚠ used/daily_used here are the ENFORCEMENT COUNTER, not invites that landed.
-- They diverge, and the gap is real: on 2026-09-01 the counter read 35/35 while
-- only 25 invites existed, because linkedin_check_and_increment fires BEFORE the
-- Unipile call and nothing refunds a failed send. The Governor block answers "am
-- I throttled", so it must show the number that does the throttling; Volume and
-- Funnel show what actually went out. Reading them side by side is how the burn
-- becomes visible at all.
--
-- window_label='day' (arch has no weekly cap key), so headroom_week = headroom_day.
create or replace function inbox_governor()
returns table (
  client_id text, model text, cap int, used int, window_label text, mode text,
  daily_used int, daily_cap int, accept_rate numeric, headroom_week int, headroom_day int,
  monthly_cap int, monthly_used int, cohort int, accepted int, gov_used int, gov_cap int,
  cohort_opens_at date
) language plpgsql security definer as $$
declare
  h jsonb; today_ct int; mtd int;
  c_used int; c_cohort int; c_accepted int; c_rate numeric;
  a_count int; a_limit int;
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

  -- ================= Arch (campaigns.client_id = 'arch') =================
  -- Emitted only once the seat is wired. arch_unipile_account_id absent means the
  -- sender itself refuses to run (reason 'arch_seat_unwired'), so a governor card
  -- would be describing a lane that cannot send — no row is the honest output.
  if exists (select 1 from integration_config
             where key='arch_unipile_account_id' and coalesce(value,'') <> '') then

    select count(*) into c_used
    from outreach_engagement_log el
    join outreach_prospects p on p.id = el.prospect_id
    join outreach_campaigns c on c.id = p.campaign_id
    where el.action_type = 'connection_request' and el.success = true
      and el.created_at >= now() - interval '7 days'
      and c.client_id = 'arch';

    select count(*), count(*) filter (where pr.stage in ('connected','replied','dm_sent'))
      into c_cohort, c_accepted
    from (
      select distinct el.prospect_id
      from outreach_engagement_log el
      join outreach_prospects p on p.id = el.prospect_id
      join outreach_campaigns c on c.id = p.campaign_id
      where el.action_type = 'connection_request' and el.success = true
        and el.created_at between now() - interval '18 days' and now() - interval '3 days'
        and c.client_id = 'arch'
    ) cohort_ids
    join outreach_prospects pr on pr.id = cohort_ids.prospect_id;

    c_rate := case when c_cohort > 0 then round(100.0 * c_accepted / c_cohort, 1) else null end;

    -- Enforcement row for TODAY. Absent before the day's first pick (the sender
    -- creates it), so fall back to the ramp ceiling rather than printing 0/0.
    select coalesce(lda.count,0), coalesce(lda.daily_limit,0) into a_count, a_limit
    from linkedin_daily_actions lda
    where lda.seat='arch' and lda.action_type='connection_request'
      and lda.date = (now() at time zone 'Europe/Berlin')::date;
    if a_limit is null or a_limit = 0 then
      a_count := coalesce(a_count, 0);
      a_limit := coalesce(
        (select (value::jsonb->>'ceiling')::int from integration_config where key='arch_connect_ramp'),
        (select value::int from integration_config where key='arch_connect_daily_cap'),
        0);
    end if;

    select count(*) into mtd from (
      select distinct on (m.prospect_id, m.message_text, m.sent_at) m.id
      from outreach_messages m
      join outreach_prospects p on p.id=m.prospect_id join outreach_campaigns c on c.id=p.campaign_id
      where c.client_id='arch' and m.direction='outbound' and m.message_type='connection_note'
        and m.sent_at >= date_trunc('month', now())
      order by m.prospect_id, m.message_text, m.sent_at, m.id
    ) d;

    client_id := 'arch'; model := 'daily_ramp';
    gov_used := a_count; gov_cap := a_limit;
    used := a_count; cap := a_limit;
    window_label := 'day';
    cohort := c_cohort; accepted := c_accepted; accept_rate := c_rate;
    -- No warm_only equivalent on this seat (no outreach_sender_health branch for
    -- arch); a 12%-floor cold pause is the one adaptive rule that ports.
    mode := case when coalesce(c_cohort,0) > 0 and coalesce(c_rate,100) < 12
                 then 'cold_paused' else 'normal' end;
    daily_used := a_count; daily_cap := a_limit;
    headroom_week := greatest(a_limit - a_count, 0);
    headroom_day  := greatest(a_limit - a_count, 0);
    monthly_cap := null; monthly_used := mtd;
    -- Arch has no first_dispatch_not_before key (the ramp's start_date is when
    -- picking began, not when the first invite actually landed), so derive the
    -- date from the seat's own first successful send + the 3-day cohort floor.
    cohort_opens_at := (
      select (min(el.created_at) + interval '3 days')::date
      from outreach_engagement_log el
      join outreach_prospects p on p.id = el.prospect_id
      join outreach_campaigns c on c.id = p.campaign_id
      where el.action_type='connection_request' and el.success = true and c.client_id='arch');
    return next;
  end if;
end $$;

grant execute on function inbox_governor() to anon, authenticated;

-- Verification (run after applying):
--   select client_id, lane, sendable, sent_7d from inbox_pipeline_v where client_id='arch';
--     -> cold sendable 64 (2026-09-01)
--   select * from inbox_governor() where client_id='arch';
--     -> used/cap 35/35, daily_used/daily_cap 35/35, headroom_day 0
--   select client_id, sum(qualified_in), sum(sent_out) from inbox_replacement_v
--    where client_id='arch' and day >= current_date - 6 group by 1;
