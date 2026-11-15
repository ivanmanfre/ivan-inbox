-- Rollback of 20261115f_lock_booking_attributions.sql: row level security off and the anon / authenticated grants back, exactly as before
-- (relacl was anon=arwdDxtm, authenticated=arwdDxtm on every table).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.booking_attributions DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.booking_attributions TO anon, authenticated;

COMMIT;
