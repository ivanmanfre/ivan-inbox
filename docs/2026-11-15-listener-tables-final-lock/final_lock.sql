-- NOT APPLIED. Do not run until the patched Ivan Listener build is installed and its reads show up in the API
-- gateway logs with the service key (see README.md in this folder). It lives in docs/, not db/, for that reason.
--
-- Final lock of the four tables Ivan Listener reads: after 20261115q the public (anon) key still reads a fixed column
-- list on every row of transcripts, audience_audits, calendar_events and sales_scripts. This removes the row policy
-- and the column grants, so the public key reads nothing there. authenticated and service_role are untouched.
-- A table-level REVOKE also removes the column grants of 20261115q.
-- Rollback (back to the 20261115q state): final_lock_rollback.sql
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
