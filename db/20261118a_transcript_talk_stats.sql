-- 20261118a: talk share per call. Adds transcripts.talk_stats jsonb, the pure function transcript_talk_stats(jsonb)
-- and a BEFORE INSERT OR UPDATE OF transcript_json trigger that keeps the column current.
-- Shape: {"words": {"Ivan": 4210, "Petros Fotiadis": 902}, "total": 5112, "ivan_pct": 82}
-- Words are whitespace-split tokens of each utterance's text. The Ivan key is any speaker matching ^iv[aá]n(\s|$) (case-insensitive;
-- Ivana and Ivanka are not Ivan, Ivan Manfredi is).
-- ivan_pct is null when total < 200, when no speaker matches Ivan, when Ivan's labels together have fewer than 5 utterances,
-- or when no non-Ivan speaker has 5+ utterances (the diarization reliability rule): a collapsed label set reads as unknown, never 100%.
-- talk_stats is null when transcript_json is not a non-empty array. The function never raises: odd input gives null.
-- Backfill only sets talk_stats. cb43_transcript_fact_source and cb53_call_enqueue fire on UPDATE OF transcript_text/date/source
-- only, so the backfill enqueues nothing; set_updated_at (BEFORE UPDATE, any column) does bump updated_at on backfilled rows.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.transcripts ADD COLUMN IF NOT EXISTS talk_stats jsonb;

CREATE OR REPLACE FUNCTION public.transcript_talk_stats(tj jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  words jsonb; total bigint; ivan bigint; ivan_n bigint; other_reliable int; pct int;
BEGIN
  IF tj IS NULL OR jsonb_typeof(tj) <> 'array' OR jsonb_array_length(tj) = 0 THEN
    RETURN NULL;
  END IF;

  WITH utt AS (
    SELECT btrim(e->>'speaker') AS spk,
           coalesce(array_length(regexp_split_to_array(btrim(e->>'text'), '\s+'), 1), 0) AS w
      FROM jsonb_array_elements(tj) e
     WHERE jsonb_typeof(e) = 'object'
       AND btrim(coalesce(e->>'speaker', '')) <> ''
       AND btrim(coalesce(e->>'text', '')) <> ''
  ), per AS (
    SELECT spk, sum(w)::bigint AS w, count(*) AS n FROM utt GROUP BY spk
  )
  SELECT jsonb_object_agg(spk, w), sum(w),
         coalesce(sum(w) FILTER (WHERE spk ~* '^iv[aá]n(\s|$)'), 0),
         coalesce(sum(n) FILTER (WHERE spk ~* '^iv[aá]n(\s|$)'), 0),
         count(*) FILTER (WHERE n >= 5 AND spk !~* '^iv[aá]n(\s|$)')
    INTO words, total, ivan, ivan_n, other_reliable
    FROM per;

  IF words IS NULL THEN
    RETURN NULL;
  END IF;

  pct := CASE WHEN total >= 200 AND ivan > 0 AND ivan_n >= 5 AND other_reliable >= 1 THEN round(100.0 * ivan / total)::int END;
  RETURN jsonb_build_object('words', words, 'total', total, 'ivan_pct', pct);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'transcript_talk_stats: %', SQLERRM;
  RETURN NULL;
END
$f$;

CREATE OR REPLACE FUNCTION public.transcripts_talk_stats_set() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  NEW.talk_stats := public.transcript_talk_stats(NEW.transcript_json);
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS transcripts_talk_stats ON public.transcripts;
CREATE TRIGGER transcripts_talk_stats
  BEFORE INSERT OR UPDATE OF transcript_json ON public.transcripts
  FOR EACH ROW EXECUTE FUNCTION public.transcripts_talk_stats_set();

UPDATE public.transcripts
   SET talk_stats = public.transcript_talk_stats(transcript_json)
 WHERE jsonb_typeof(transcript_json) = 'array';

COMMIT;
