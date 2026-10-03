-- Rollback for 002: unschedule both jobs and remove the function. Cards already sent stay in the feed (harmless, dismissible).
BEGIN;
SELECT cron.unschedule('cb39-monday-card');
SELECT cron.unschedule('cb39-monday-card-late');
DROP FUNCTION IF EXISTS public.cb39_monday_card(timestamptz);
COMMIT;
