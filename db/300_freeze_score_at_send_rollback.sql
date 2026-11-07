-- STATUS: rollback for the migration applied 2026-11-06T11:05Z. NOT run. Run with: python3 /tmp/sol-review/verdict-log-score-freeze/apply.py <this file> (300 rollback first, then 299)
-- Rollback for 300. Drops the triggers and function. Keeps the frozen columns and their values (history) unless
-- Ivan says drop; the drop line is below, commented. Lock taken first with NOWAIT (retry on 55P03).
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.outreach_prospects IN ACCESS EXCLUSIVE MODE NOWAIT;
DROP TRIGGER IF EXISTS zzzzz_freeze_score_at_send ON public.outreach_prospects;
DROP TRIGGER IF EXISTS zzzzz_freeze_score_at_send_ins ON public.outreach_prospects;
DROP FUNCTION IF EXISTS public.trg_freeze_score_at_send();
-- ALTER TABLE public.outreach_prospects DROP COLUMN icp_score_at_send, DROP COLUMN scorer_version_at_send,
--   DROP COLUMN scored_at_at_send, DROP COLUMN score_frozen_at;
COMMIT;
