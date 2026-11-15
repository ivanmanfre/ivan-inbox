-- Rollback of 20261115v_lock_shared_page_edits: back to the open state (the public key reads, adds and changes any
-- row), the anon grants as they were before. The functions of 20261115u stay, so both the old pages (table) and the
-- new pages (functions) work after this.
BEGIN;
SET LOCAL lock_timeout = '5s';

GRANT ALL ON TABLE public.shared_page_edits TO anon;
CREATE POLICY anon_read ON public.shared_page_edits FOR SELECT TO anon USING (true);
CREATE POLICY anon_update ON public.shared_page_edits FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_write ON public.shared_page_edits FOR INSERT TO anon WITH CHECK (true);

COMMIT;
