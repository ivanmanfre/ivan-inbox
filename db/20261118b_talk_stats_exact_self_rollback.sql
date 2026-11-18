-- Rollback for 20261118b: the prefix match and the default execute grants.
CREATE OR REPLACE FUNCTION public.transcript_talk_stats(tj jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
$function$;
grant execute on function public.transcript_talk_stats(jsonb) to public, anon;
