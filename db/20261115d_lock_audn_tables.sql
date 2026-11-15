BEGIN;

-- 20261115d_lock_audn_tables Batch 4 of 6: the two post-tracking tables (2).
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
-- Only row level security and grants change. Triggers, the trigger functions (editorial_*), columns and data are not
-- touched.
-- audn_post_metric_snapshots: written by the trackers through PostgREST with the n8n service-key credential
--   (32GZupzWbWy2fpu8, F7JHoCI925eSTYar, WdeAmCTQ0ZH65mGs, XMuGMZJlcF9pB3Db, rrprmLeoU0pjpEmq).
-- audn_post_collection_coverage: written by 67ibfU1VFD2rwW6o, W0v3SYUL0RsAOwDS, xJWTsgibXMnG4GfB, same credential.
-- The audn_*_v views over them are security_invoker: anon and authenticated now get "permission denied" through them
-- (no caller used them in 7 days; the board reads through owner-rights functions).
-- Rollback: 20261115d_lock_audn_tables_rollback.sql

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.audn_post_collection_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audn_post_collection_coverage FROM anon, authenticated;
ALTER TABLE public.audn_post_metric_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audn_post_metric_snapshots FROM anon, authenticated;

COMMIT;
