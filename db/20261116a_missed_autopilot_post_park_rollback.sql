-- Rollback of 20261116a_missed_autopilot_post_park.sql.
-- Stops the sweep and removes its function. The receipts table is kept under a new name (no history is lost).
-- Rows already parked stay as they are: queue row cancelled, draft in Review with no date, pick released. That is a safe
-- state (nothing publishes from it). Do NOT set those queue rows back to pending: that restarts the 5-minute refusal loop.
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-missed-post-park') THEN
    PERFORM cron.unschedule('content-missed-post-park');
  END IF;
END $rb$;
DROP FUNCTION IF EXISTS public.content_autonomy_park_missed_ivan(timestamptz);
ALTER TABLE IF EXISTS public.content_missed_posts RENAME TO content_missed_posts_rolled_back_20261116;
