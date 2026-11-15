-- Rollback of 20261115q_narrow_listener_tables_for_anon.sql: the column grants removed and the full table privileges
-- back for anon, exactly as before (relacl was anon=arwdDxtm on every table, no column grants). The row policies were
-- never changed.
BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE SELECT (id, title, date, duration_minutes, participants, meeting_type) ON TABLE public.transcripts FROM anon;
GRANT ALL ON TABLE public.transcripts TO anon;

REVOKE SELECT (prospect_name, onepager_url, audited_at) ON TABLE public.audience_audits FROM anon;
GRANT ALL ON TABLE public.audience_audits TO anon;

REVOKE SELECT (id, title, start_time, end_time, attendees, meeting_type, platform, meeting_url, is_all_day)
  ON TABLE public.calendar_events FROM anon;
GRANT ALL ON TABLE public.calendar_events TO anon;

REVOKE SELECT (id, name, meeting_type, version, is_active, phases) ON TABLE public.sales_scripts FROM anon;
GRANT ALL ON TABLE public.sales_scripts TO anon;

COMMIT;
