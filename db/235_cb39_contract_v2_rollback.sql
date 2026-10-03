-- Rollback for 003: restore the 001 verdict function and the 002 Monday card, remove the capture/edit helpers.
-- 'edited' rows (if any) are exported to O/snapshots first and re-labelled 'keep' so the old check holds.
BEGIN;
DROP FUNCTION IF EXISTS public.cb39_verdict_set(uuid, text, text[], text, uuid, int);
DROP FUNCTION IF EXISTS public.cb39_capture_origin(uuid);
DROP FUNCTION IF EXISTS public.cb39_edit_chars(text, text);
UPDATE public.cb39_draft_verdicts SET verdict = 'keep' WHERE verdict = 'edited';
ALTER TABLE public.cb39_draft_verdicts DROP CONSTRAINT cb39_draft_verdicts_verdict_check;
ALTER TABLE public.cb39_draft_verdicts ADD CONSTRAINT cb39_draft_verdicts_verdict_check CHECK (verdict IN ('keep','drop'));
COMMIT;
-- then re-apply the function bodies from 001_cb39_verdicts.sql (cb39_verdict_set) and 002_cb39_monday_card.sql (cb39_monday_card).
