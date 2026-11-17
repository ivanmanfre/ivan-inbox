-- Rollback of 20261118a_transcript_talk_stats.sql: drop the trigger, both functions and the column (the values are derived
-- from transcript_json and come back by re-applying the migration).
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS transcripts_talk_stats ON public.transcripts;
DROP FUNCTION IF EXISTS public.transcripts_talk_stats_set();
DROP FUNCTION IF EXISTS public.transcript_talk_stats(jsonb);
ALTER TABLE public.transcripts DROP COLUMN IF EXISTS talk_stats;

COMMIT;
