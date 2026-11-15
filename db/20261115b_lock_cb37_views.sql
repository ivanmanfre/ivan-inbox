BEGIN;

-- 20261115b_lock_cb37_views Batch 2 of 6: owner-rights views the public key could read (17).
--
-- Part of the 2026-11-15 lock of objects the public (anon) key could read or change. Found 2026-11-14: 26 tables in
-- public had row level security OFF and ALL privileges for anon and authenticated (Supabase default grants on tables
-- made by SQL), and the cb37 views run with owner rights with the same grants.
-- Roles checked before writing this (7 days of API gateway logs, 2026-11-08 to 2026-11-15, plus who-reads --no-indirect
-- on every object): every request to these objects used a service key (57,000+ calls: n8n, the Railway runner, edge
-- functions); 0 came from the public key or a signed-in user, directly or embedded. Sign-up is disabled on the project.
-- service_role and postgres bypass row level security and keep their grants, so no policy is added (same as the
-- content_outcome_* tables locked on 2026-11-14). Nothing is dropped or deleted.
--
-- The 13 cb37_*_v views and ivan_post_outcome_spine run with their owner's rights, so the anon grant let the public key
-- read bookings, engagers and post results straight through them even with the tables locked. The 3
-- cb44_house_numbers_*_v views are security_invoker (anon already got 0 rows); their grants are removed to match.
-- Readers: database objects only (cb37_refresh, cb37_results, cb37_weekly, cb39_monday_card, cb52_*, content_*; crons
-- 205, 206, 211, 224), which run as postgres, and service-key callers. service_role keeps its grants.
-- cb37_results() and cb37_weekly() are invoker-rights functions: anon and authenticated now get "permission denied"
-- from them; their real callers are cb37_refresh and cb39_monday_card (owner rights).
-- Rollback: 20261115b_lock_cb37_views_rollback.sql

REVOKE ALL ON TABLE public.cb37_booking_coverage_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_booking_name_candidates_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_booking_post_links_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_brain_draft_versions_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_brain_fates_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_draft_fates_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_draft_post_links_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_engager_fit_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_engager_journey_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_post_base_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_post_engagers_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_post_results_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb37_post_snapshots_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb44_house_numbers_arch_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb44_house_numbers_ivan_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.cb44_house_numbers_risedtc_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.ivan_post_outcome_spine FROM anon, authenticated;

COMMIT;
