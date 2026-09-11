-- 056: campaigns of the content-signal trial renamed from "Signal Trial — S<n> <slug>" to descriptive
-- "Quiet on LinkedIn — <source>" (Ivan 2026-09-11: "signal trial is not descriptive enough"). lane_of()
-- keeps both prefixes so history and the renamed rows land in the same 'signal' lane (label: Quiet on LinkedIn).
create or replace function lane_of(camp_name text) returns text
language sql immutable as $$
  select case
    when camp_name ilike 'signal trial%' or camp_name ilike 'quiet on linkedin%'  then 'signal'
    when camp_name ilike '%partner%' or camp_name ilike '%fractional cmo%'   then 'partner'
    when camp_name ilike '%kyle engagers%' or camp_name ilike '%anchor%'
      or camp_name ilike '%engagement harvest%'                          then 'harvest'
    when camp_name ilike '%engager%' or camp_name ilike '%profile view%' then 'engager'
    when camp_name ilike '%warm%' or camp_name ilike '%orbit%'
      or camp_name ilike '%network activation%'                          then 'warm'
    else 'cold'  -- explicit %cold% + bare vertical/industry campaigns
  end
$$;
