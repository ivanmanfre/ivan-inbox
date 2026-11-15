-- 20261115t_lock_listener_tables_final: the last step for the four tables Ivan Listener reads. After 20261115q the
-- public (anon) key still read a fixed column list on every row of transcripts, audience_audits, calendar_events and
-- sales_scripts, because the Listener menu-bar app read them with that key. The app now uses the service key it
-- already carried (ivan-listener commit 489572c, deployed 2026-11-15 21:59 UTC), so this removes the row policy and
-- the column grants: the public key reads nothing there. authenticated and service_role are untouched.
-- A table-level REVOKE also removes the column grants of 20261115q.
-- The statements are byte-identical to docs/2026-11-15-listener-tables-final-lock/final_lock.sql (reviewed and
-- tested rolled-back with 20261115p-r).
-- Rollback (back to the 20261115q state): 20261115t_lock_listener_tables_final_rollback.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP POLICY anon_select ON public.transcripts;
REVOKE ALL ON TABLE public.transcripts FROM anon;

DROP POLICY anon_select ON public.audience_audits;
REVOKE ALL ON TABLE public.audience_audits FROM anon;

DROP POLICY anon_select_calendar_events ON public.calendar_events;
REVOKE ALL ON TABLE public.calendar_events FROM anon;

DROP POLICY anon_read_scripts ON public.sales_scripts;
REVOKE ALL ON TABLE public.sales_scripts FROM anon;

COMMIT;
