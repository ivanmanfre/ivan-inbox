-- Keep the scheduled referral filter aligned with the inbox and the edge function.
DO $migration$
DECLARE
  existing text := pg_get_functiondef('public.inbox_referral_prewarm()'::regprocedure);
  old_filter text := $old$or substring(regexp_replace(l.message_text, $title$,[[:space:]]*(our|my|the|their)[[:space:]]+[[:alpha:]][[:alpha:] &’'-]{0,80},$title$, ' ', 'gi') from '(?i)([[:alpha:]][[:alpha:]''-]*(?:\s+[[:alpha:]][[:alpha:]''-]*){0,3})\s+(?:handles?|does|manages?|runs?|looks after|is responsible for|is in charge of)\M')
             !~* '\m(i|we|you|he|she|they|it)\M'$old$;
  new_filter text := $new$or exists (
            select 1 from regexp_matches(
              regexp_replace(regexp_replace(l.message_text, $title$,[[:space:]]*(our|my|the|their)[[:space:]]+[[:alpha:]][[:alpha:] &’'-]{0,80},$title$, ' ', 'gi'),
                $aux$\m(?:(?:(?:and|but|how much|when|where|why|what|how)\s+does)|does\s+(?:it|this|that)\s+(?:cost|work|include|require|mean|take|cover|apply))\M$aux$, '.', 'gi'),
              $owner$\m([[:alpha:]][[:alpha:]'-]*(?:\s+[[:alpha:]][[:alpha:]'-]*){0,3})\s+(?:handles?|does|manages?|runs?|looks after|is responsible for|is in charge of)\M$owner$, 'gi') as owners(parts)
            where parts[1] !~* '\m(i|we|you|he|she|they|it)\M'
          )$new$;
BEGIN
  IF strpos(existing, new_filter) > 0 THEN RETURN; END IF;
  IF strpos(existing, old_filter) = 0 THEN RAISE EXCEPTION 'Unexpected referral prewarm predicate'; END IF;
  EXECUTE replace(existing, old_filter, new_filter);
END
$migration$;
