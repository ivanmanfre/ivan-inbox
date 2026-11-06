-- STATUS 2026-11-06: built and tested on temp-table copies; NOT applied yet (Sol cross-review pending). Packet: /tmp/sol-review/verdict-log-score-freeze/
-- Rollback for 300. Drops the trigger and function. Keeps the frozen columns and their values (history) unless
-- Ivan says drop; the drop line is below, commented.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS zzzzz_freeze_score_at_send ON public.outreach_prospects;
DROP FUNCTION IF EXISTS public.trg_freeze_score_at_send();
-- ALTER TABLE public.outreach_prospects DROP COLUMN icp_score_at_send, DROP COLUMN scorer_version_at_send,
--   DROP COLUMN scored_at_at_send, DROP COLUMN score_frozen_at;
COMMIT;
