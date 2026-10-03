-- Rollback for 001_cb39_verdicts.sql. Verdict rows are exported to O/snapshots before running this.
BEGIN;
DROP FUNCTION IF EXISTS public.cb39_to_judge(text);
DROP FUNCTION IF EXISTS public.cb39_verdicts(text, timestamptz);
DROP FUNCTION IF EXISTS public.cb39_verdict_set(uuid, text, text[], text, uuid);
DROP FUNCTION IF EXISTS public.cb39_lane_ok(text);
DROP TABLE IF EXISTS public.cb39_draft_verdicts;
COMMIT;
