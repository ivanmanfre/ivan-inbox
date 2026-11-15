-- Rollback of 20261115t_lock_listener_tables_final: back to the state after 20261115q (row policy for anon on every
-- row, SELECT on the columns the old Listener build reads, nothing else). The old build is in
-- ~/Library/Application Support/IvanListener/bak/ (IvanListenerMenuBar.bak.20261115-225912).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE POLICY anon_select ON public.transcripts FOR SELECT TO anon USING (true);
GRANT SELECT (id, title, date, duration_minutes, participants, meeting_type) ON TABLE public.transcripts TO anon;

CREATE POLICY anon_select ON public.audience_audits FOR SELECT TO anon USING (true);
GRANT SELECT (prospect_name, onepager_url, audited_at) ON TABLE public.audience_audits TO anon;

CREATE POLICY anon_select_calendar_events ON public.calendar_events FOR SELECT TO anon USING (true);
GRANT SELECT (id, title, start_time, end_time, attendees, meeting_type, platform, meeting_url, is_all_day)
  ON TABLE public.calendar_events TO anon;

CREATE POLICY anon_read_scripts ON public.sales_scripts FOR SELECT TO anon USING (true);
GRANT SELECT (id, name, meeting_type, version, is_active, phases) ON TABLE public.sales_scripts TO anon;

COMMIT;
