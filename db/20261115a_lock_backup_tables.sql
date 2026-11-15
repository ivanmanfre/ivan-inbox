BEGIN;

-- 20261115a_lock_backup_tables Batch 1 of 6: backup and unused tables (17).
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
-- These 17 tables have no reader or writer anywhere (n8n, edge functions, repos, database objects). One old SQL
-- script in claude-code-railway (runner/sql/swishdm_size_backfill_20261028.sql) names a backfill table; it runs as
-- postgres. Backup tables are locked, never dropped.
-- Rollback: 20261115a_lock_backup_tables_rollback.sql

SET LOCAL lock_timeout = '5s';

ALTER TABLE public._bak_arch_anchors_20260921 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_arch_anchors_20260921 FROM anon, authenticated;
ALTER TABLE public._bak_arch_copyvert_20260921 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_arch_copyvert_20260921 FROM anon, authenticated;
ALTER TABLE public._bak_arch_expansion_geo_20260922 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_arch_expansion_geo_20260922 FROM anon, authenticated;
ALTER TABLE public._bak_arch_promote_20260921 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_arch_promote_20260921 FROM anon, authenticated;
ALTER TABLE public._bak_arch_reviewjob_20260922 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_arch_reviewjob_20260922 FROM anon, authenticated;
ALTER TABLE public._bak_x422_messages_20260921 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_x422_messages_20260921 FROM anon, authenticated;
ALTER TABLE public._bak_x422_prospects_20260921 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_x422_prospects_20260921 FROM anon, authenticated;
ALTER TABLE public._bak_x422_rise_messages_20260921 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_x422_rise_messages_20260921 FROM anon, authenticated;
ALTER TABLE public._bak_x422_rise_prospects_20260921 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_x422_rise_prospects_20260921 FROM anon, authenticated;
ALTER TABLE public._void_post_engagers_ivan_rubric_20260812 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._void_post_engagers_ivan_rubric_20260812 FROM anon, authenticated;
ALTER TABLE public.content_prompts_bak_arch_facts_20260914 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.content_prompts_bak_arch_facts_20260914 FROM anon, authenticated;
ALTER TABLE public.ivan_openprofile_route_backfill_20261020 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ivan_openprofile_route_backfill_20261020 FROM anon, authenticated;
ALTER TABLE public.outreach_templates_backup_20260831 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.outreach_templates_backup_20260831 FROM anon, authenticated;
ALTER TABLE public.swishdm_harvest_seen_backfill_20261028 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.swishdm_harvest_seen_backfill_20261028 FROM anon, authenticated;
ALTER TABLE public.swishdm_harvest_seen_geo_requeue_20261020 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.swishdm_harvest_seen_geo_requeue_20261020 FROM anon, authenticated;
ALTER TABLE public.cb44_spoken_voice ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb44_spoken_voice FROM anon, authenticated;
ALTER TABLE public.transcript_chunks_quarantine ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transcript_chunks_quarantine FROM anon, authenticated;

COMMIT;
