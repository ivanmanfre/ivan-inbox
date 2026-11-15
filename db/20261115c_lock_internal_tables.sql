BEGIN;

-- 20261115c_lock_internal_tables Batch 3 of 6: internal tables written by the database and service callers (6).
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
-- board_truth_dirty: written by board_truth_mark_dirty / board_truth_flush (owner rights; cron 143).
-- booking_sync_log: written by booking_ingest_event (owner rights).
-- client_guard_booked_keys: written by client_guard_booked_refresh (owner rights; cron 147), read by the guard functions.
-- draft_deletions: written by the carousel_drafts delete trigger (owner rights), read by cb37_draft_fates_v.
-- client_generator_config: read by n8n ULWz3DbYF0oSv2G8 (Post Generation ONE) with a service key.
-- outreach_enrich_rejects (~195k rows): read and written by the Railway runner lanes (arch-engager-harvest,
--   rise-warm-engager, rise_company_refill) with a service key, ~5,400 reads and ~80 writes a day.
-- Rollback: 20261115c_lock_internal_tables_rollback.sql

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.board_truth_dirty ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.board_truth_dirty FROM anon, authenticated;
ALTER TABLE public.booking_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_sync_log FROM anon, authenticated;
ALTER TABLE public.client_guard_booked_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_guard_booked_keys FROM anon, authenticated;
ALTER TABLE public.draft_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.draft_deletions FROM anon, authenticated;
ALTER TABLE public.client_generator_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_generator_config FROM anon, authenticated;
ALTER TABLE public.outreach_enrich_rejects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.outreach_enrich_rejects FROM anon, authenticated;

COMMIT;
