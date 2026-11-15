-- Rollback of 20261115a_lock_backup_tables.sql: row level security off and the anon / authenticated grants back, exactly as before
-- (relacl was anon=arwdDxtm, authenticated=arwdDxtm on every table).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public._bak_arch_anchors_20260921 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_arch_anchors_20260921 TO anon, authenticated;
ALTER TABLE public._bak_arch_copyvert_20260921 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_arch_copyvert_20260921 TO anon, authenticated;
ALTER TABLE public._bak_arch_expansion_geo_20260922 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_arch_expansion_geo_20260922 TO anon, authenticated;
ALTER TABLE public._bak_arch_promote_20260921 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_arch_promote_20260921 TO anon, authenticated;
ALTER TABLE public._bak_arch_reviewjob_20260922 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_arch_reviewjob_20260922 TO anon, authenticated;
ALTER TABLE public._bak_x422_messages_20260921 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_x422_messages_20260921 TO anon, authenticated;
ALTER TABLE public._bak_x422_prospects_20260921 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_x422_prospects_20260921 TO anon, authenticated;
ALTER TABLE public._bak_x422_rise_messages_20260921 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_x422_rise_messages_20260921 TO anon, authenticated;
ALTER TABLE public._bak_x422_rise_prospects_20260921 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._bak_x422_rise_prospects_20260921 TO anon, authenticated;
ALTER TABLE public._void_post_engagers_ivan_rubric_20260812 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public._void_post_engagers_ivan_rubric_20260812 TO anon, authenticated;
ALTER TABLE public.content_prompts_bak_arch_facts_20260914 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_prompts_bak_arch_facts_20260914 TO anon, authenticated;
ALTER TABLE public.ivan_openprofile_route_backfill_20261020 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.ivan_openprofile_route_backfill_20261020 TO anon, authenticated;
ALTER TABLE public.outreach_templates_backup_20260831 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.outreach_templates_backup_20260831 TO anon, authenticated;
ALTER TABLE public.swishdm_harvest_seen_backfill_20261028 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.swishdm_harvest_seen_backfill_20261028 TO anon, authenticated;
ALTER TABLE public.swishdm_harvest_seen_geo_requeue_20261020 DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.swishdm_harvest_seen_geo_requeue_20261020 TO anon, authenticated;
ALTER TABLE public.cb44_spoken_voice DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.cb44_spoken_voice TO anon, authenticated;
ALTER TABLE public.transcript_chunks_quarantine DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.transcript_chunks_quarantine TO anon, authenticated;

COMMIT;
