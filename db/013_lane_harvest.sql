-- Adds a 'harvest' lane, split out from 'engager', for the Overview -> pipeline
-- (sourcing-mix) block. lane_of() was mechanically correct but semantically
-- wrong for Ivan: a skeptic audit proved his "Engager" lane is 0% own-content
-- (Kyle's audience, other creators' LM-anchor posts, competitor-post harvest —
-- sendable/sent_30d all non-zero, none of it people who engaged with IVAN'S
-- content). The operator's mental model of "engager" is own-content engagers;
-- the old bucket credited his content with supply it doesn't produce.
-- See goal-runs/sends-kpi-elevation-2026-07-24/phase1-accuracy.md (F4) and
-- phase1/r4-lane-bucketing.md / phase1/s4-lane-skeptic.md.
--
-- New FIRST branch (checked before 'engager'): campaign names matching
-- '%kyle engagers%' / '%anchor%' / '%engagement harvest%' -> 'harvest'.
-- 'engager' keeps only '%engager%' / '%profile view%' (the now-shadowed
-- '%engagement harvest%'/'%anchor%' patterns are removed from it — they always
-- matched the harvest branch first now, so leaving them in 'engager' would be
-- dead code). This moves "Warm - Kyle Engagers", "Warm - Engagement Harvest",
-- and "Warm - LM Anchor Engagers" to harvest; "Profile View — Ivan",
-- "RiseDTC — Warm (his engagers)", and "RiseDTC — Profile View" stay engager
-- (genuinely own-presence signals: Rise's own post engagers, profile viewers).
-- Label "Harvested" for the new lane lives in kpis.ts laneLabel() (Task F),
-- not in SQL.
--
-- inbox_pipeline_v itself needs no textual change — Postgres resolves the
-- lane_of() call at query time against whatever function currently exists, it
-- is not inlined/baked into the view's stored definition — so recreating
-- lane_of() alone is sufficient for the view to start emitting 'harvest' rows.
-- Not reproduced here for that reason (006_kpi_pipeline.sql / APPLY-kpi-views.sql
-- still hold the canonical inbox_pipeline_v text; only APPLY needs both pieces
-- present, in lane_of-then-view order, since CREATE VIEW does need the function
-- to already exist at creation time).
--
-- Expected at authoring time (2026-07-24): ivan pipeline rows split from
-- engager -> harvest (~92 sendable) / engager (0 sendable).
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
