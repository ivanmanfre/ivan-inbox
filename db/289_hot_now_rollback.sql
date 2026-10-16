-- Rollback for 289_hot_now.sql. Drops the Home read, the Skip verb and the push trigger.
-- Events already killed by Skip stay killed and their drafts stay archived (nothing is deleted).
BEGIN;
DROP TRIGGER IF EXISTS hot_now_push ON public.swishdm_trend_events;
DROP FUNCTION IF EXISTS public.hot_now_push();
DROP FUNCTION IF EXISTS public.hot_now_skip(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.hot_now_cards();
COMMIT;
