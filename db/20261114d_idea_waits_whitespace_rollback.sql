-- Rollback of 20261114d_idea_waits_whitespace.sql: both functions exactly as they were before it (pg_get_functiondef, 2026-11-14).
BEGIN;
CREATE OR REPLACE FUNCTION public.content_idea_waits(p_needs boolean, p_answer text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(p_needs, false) and nullif(btrim(coalesce(p_answer, '')), '') is null
$function$
;

CREATE OR REPLACE FUNCTION public.content_idea_answer_ivan(p_idea uuid, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.lm_idea_candidates%rowtype; v_answer text := left(btrim(coalesce(p_answer, '')), 1200); ev jsonb;
begin
  if not (public.content_plan_service_ok() or (auth.uid() is not null and public.cb34_p2_operator_lane_allowed('ivan'))) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_idea is null or v_answer = '' then return jsonb_build_object('ok', false, 'error', 'empty_answer'); end if;
  select * into c from public.lm_idea_candidates where id = p_idea for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not c.needs_ivan_data then return jsonb_build_object('ok', false, 'error', 'no_question'); end if;
  if c.status not in ('pending', 'scored', 'reviewing') then return jsonb_build_object('ok', false, 'error', 'idea_closed'); end if;
  if nullif(btrim(coalesce(c.needs_ivan_answer, '')), '') is not null then return jsonb_build_object('ok', false, 'error', 'already_answered'); end if;
  ev := case when jsonb_typeof(c.evidence) = 'array' then c.evidence
             when jsonb_typeof(c.evidence) = 'object' then jsonb_build_array(c.evidence) else '[]'::jsonb end;
  update public.lm_idea_candidates
     set needs_ivan_answer = v_answer, needs_ivan_answered_at = now(),
         evidence = ev || jsonb_build_array(jsonb_build_object(
           'who', 'Ivan Manfredi', 'tier', 'FACT', 'quote', v_answer, 'source', 'ivan_answer',
           'instrument', 'His answer to: ' || c.needs_ivan_question))
   where id = p_idea;
  return jsonb_build_object('ok', true, 'idea_id', p_idea);
end $function$
;
COMMIT;
