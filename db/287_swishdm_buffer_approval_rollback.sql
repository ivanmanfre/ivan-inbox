-- Removes only the API; existing accepted buffer items and audit history remain.
BEGIN;
DROP FUNCTION IF EXISTS public.swishdm_set_buffer_visibility(uuid,timestamptz,boolean);
COMMIT;
