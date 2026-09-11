-- 055: 'signal' lane for the content-signal trial campaigns (Signal Trial — S1 x_active_li_quiet, S3 posted_then_stopped,
-- S4 podcast_guest_li_quiet; goal-run content-signal-supply-trial-2026-09-11). Without this branch lane_of() fell through
-- to 'cold', so the 29 armed rows were counted as Cold in Lanes / pipeline / sends. FIRST branch on purpose: the campaign
-- names carry no other lane word. Label 'Signal trial' lives in src/lib/kpis.ts LANE_LABELS.
create or replace function lane_of(camp_name text) returns text
language sql immutable as $$
  select case
    when camp_name ilike 'signal trial%'                                  then 'signal'
    when camp_name ilike '%partner%' or camp_name ilike '%fractional cmo%'   then 'partner'
    when camp_name ilike '%kyle engagers%' or camp_name ilike '%anchor%'
      or camp_name ilike '%engagement harvest%'                          then 'harvest'
    when camp_name ilike '%engager%' or camp_name ilike '%profile view%' then 'engager'
    when camp_name ilike '%warm%' or camp_name ilike '%orbit%'
      or camp_name ilike '%network activation%'                          then 'warm'
    else 'cold'  -- explicit %cold% + bare vertical/industry campaigns
  end
$$;
