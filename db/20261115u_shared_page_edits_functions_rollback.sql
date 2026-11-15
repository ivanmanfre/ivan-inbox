-- Rollback of 20261115u_shared_page_edits_functions. Run it only when 20261115v is rolled back and the two pages on
-- inboundonsteroids.com read and write the table again (site commit before the function change): a page that still
-- calls these functions stops loading and saving edits the moment they are dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.shared_page_edits_save(text, text, text);
DROP FUNCTION public.shared_page_edits_load(text);
DROP TABLE public.shared_page_edit_pages;

COMMIT;
