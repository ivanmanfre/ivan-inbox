BEGIN;

-- 20261115p_lock_open_policy_internal_tables Batch 1 of 3: tables with an unconditional row policy for the public
-- (anon) key and no public-key caller (5).
--
-- Part of the 2026-11-15 lock of what the public key can reach, after 20261115a-o. Left open by those: 12 tables with
-- row level security ON but a policy that lets anon through with no condition (USING true), plus ALL table privileges
-- for anon from the default grants. This batch closes the five that nothing reads with the public key.
-- Callers checked before writing this: who-reads --no-indirect on every table; the code of ivan-inbox, personal-site,
-- inboundonsteroids-site, ivan-listener, claude-code-railway; 7 days of API gateway logs by role (2026-11-08 to
-- 2026-11-15, 93,466 calls to the 12 tables, 14 windows, none capped); a second 7-day pass for embedded reads and for
-- the invoker-rights functions that read these tables (0 calls without a service key).
--
-- call_reports (181 rows, full call reports): 720 calls in 7 days, all service keys (n8n Call Report Generator
--   NG9LxNPh5FtYZsg3, Fathom ingestor ED3KvNsjKwANZsuf, Post-Call Follow-up mWzrQVgttbHDRq1o, local scripts). The
--   dashboard reads it signed in (policy authenticated_all, kept). Public key: only this audit's own probe.
-- video_ideas (10 rows): n8n video workflows with service keys; dashboard signed in (authenticated_all, kept).
-- own_posts (298 rows): 10,060 calls, all service keys (n8n). No signed-in policy exists and none is added. The public
--   pages get posts through recent_own_posts(integer) and public_engine_metrics(), both owner-rights and public on
--   purpose: they do not use this policy and keep working.
-- content_photos (258 rows): 0 API calls in 7 days. The inbox app's photo search goes through
--   search_content_photos(text, integer) (invoker rights) as the signed-in user: the policy stays for authenticated.
-- outreach_filter_spec (1 row): 537 writes, all service keys (Railway runner, n8n 75IWGiSoUMH9mhTB). The inbox app
--   reads it signed in through inbox_filter_spec_v: the policy stays for authenticated.
--
-- anon loses the policy and every table privilege. authenticated and service_role are untouched. Nothing is dropped
-- except the three anon-only policies. match_transcripts and the other invoker-rights functions are not changed here.
-- Rollback: 20261115p_lock_open_policy_internal_tables_rollback.sql

SET LOCAL lock_timeout = '5s';

DROP POLICY anon_select ON public.call_reports;
REVOKE ALL ON TABLE public.call_reports FROM anon;

DROP POLICY anon_read ON public.video_ideas;
REVOKE ALL ON TABLE public.video_ideas FROM anon;

DROP POLICY anon_select ON public.own_posts;
REVOKE ALL ON TABLE public.own_posts FROM anon;

ALTER POLICY content_photos_read ON public.content_photos TO authenticated;
REVOKE ALL ON TABLE public.content_photos FROM anon;

ALTER POLICY filter_spec_read ON public.outreach_filter_spec TO authenticated;
REVOKE ALL ON TABLE public.outreach_filter_spec FROM anon;

COMMIT;
