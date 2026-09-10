-- 2026-09-10 partner lane: "RiseDTC — Fractional CMO Partners" fell into the else branch (= cold).
-- Adds 'partner' BEFORE the cold fallback. Every other branch is byte-identical to db/013_lane_harvest.sql.
create or replace function lane_of(camp_name text) returns text
language sql immutable as $$
  select case
    when camp_name ilike '%partner%' or camp_name ilike '%fractional cmo%'   then 'partner'
    when camp_name ilike '%kyle engagers%' or camp_name ilike '%anchor%'
      or camp_name ilike '%engagement harvest%'                          then 'harvest'
    when camp_name ilike '%engager%' or camp_name ilike '%profile view%' then 'engager'
    when camp_name ilike '%warm%' or camp_name ilike '%orbit%'
      or camp_name ilike '%network activation%'                          then 'warm'
    else 'cold'  -- explicit %cold% + bare vertical/industry campaigns
  end
$$;
