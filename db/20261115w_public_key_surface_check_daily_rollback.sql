-- Rollback of 20261115w_public_key_surface_check_daily: the daily job and the two functions go. Nothing else depends
-- on them. The manual check file 20261115s then needs its query back (git history of that file).
BEGIN;
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule('public-key-surface-check');
DROP FUNCTION public.public_key_surface_check_alert();
DROP FUNCTION public.public_key_surface_check();

COMMIT;
