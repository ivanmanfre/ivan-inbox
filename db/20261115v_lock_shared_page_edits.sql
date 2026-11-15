-- 20261115v_lock_shared_page_edits: step 2 of 2 (step 1 = 20261115u). Apply only after the two pages on
-- inboundonsteroids.com call shared_page_edits_load / shared_page_edits_save (site commit on main, deployed).
-- Removes the three open anon policies and every anon privilege on the table: the public key can no longer list page
-- slugs and bodies or overwrite a row directly. The two functions of 20261115u are the only way in, one slug per call.
-- authenticated and service_role are untouched (authenticated never had a policy here, so it reads nothing, as before).
-- Rollback: 20261115v_lock_shared_page_edits_rollback.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP POLICY anon_read ON public.shared_page_edits;
DROP POLICY anon_update ON public.shared_page_edits;
DROP POLICY anon_write ON public.shared_page_edits;
REVOKE ALL ON TABLE public.shared_page_edits FROM anon;

COMMIT;
