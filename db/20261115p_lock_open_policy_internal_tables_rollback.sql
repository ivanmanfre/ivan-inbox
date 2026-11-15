-- Rollback of 20261115p_lock_open_policy_internal_tables.sql: the anon policies and table privileges back, exactly as
-- before (relacl was anon=arwdDxtm on every table; the three anon-only policies were FOR SELECT TO anon USING (true);
-- content_photos_read and filter_spec_read were TO anon, authenticated).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE POLICY anon_select ON public.call_reports FOR SELECT TO anon USING (true);
GRANT ALL ON TABLE public.call_reports TO anon;

CREATE POLICY anon_read ON public.video_ideas FOR SELECT TO anon USING (true);
GRANT ALL ON TABLE public.video_ideas TO anon;

CREATE POLICY anon_select ON public.own_posts FOR SELECT TO anon USING (true);
GRANT ALL ON TABLE public.own_posts TO anon;

ALTER POLICY content_photos_read ON public.content_photos TO anon, authenticated;
GRANT ALL ON TABLE public.content_photos TO anon;

ALTER POLICY filter_spec_read ON public.outreach_filter_spec TO anon, authenticated;
GRANT ALL ON TABLE public.outreach_filter_spec TO anon;

COMMIT;
