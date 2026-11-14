BEGIN;

-- 20261114d Ideas that wait for Ivan's data: one whitespace rule (fix-forward of 20261114_idea_needs_ivan_data.sql).
--
-- Cross-review finding: btrim() trims spaces only, so a newline or tab answer was stored as an answer, while the
-- planner's JavaScript trim() saw it as empty and kept skipping the idea; a real answer then got already_answered.
-- Now one rule everywhere: an answer counts only if it has a character other than space, tab, newline, carriage
-- return, form feed or vertical tab. The planner (n8n NcDrN7QXun5s37u0) uses the same character class.
-- A blank answer is refused; one already stored (none today) counts as no answer and can be replaced.
-- Readers: content_idea_waits is called by content_plan_apply only; content_idea_answer_ivan has no callers yet.
-- Rollback: 20261114d_idea_waits_whitespace_rollback.sql (restores both definitions as they were).

create or replace function public.content_idea_waits(p_needs boolean, p_answer text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(p_needs, false) and coalesce(p_answer, '') !~ E'[^ \\t\\n\\r\\f\\v]'
$function$;

create or replace function public.content_idea_answer_ivan(p_idea uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare c public.lm_idea_candidates%rowtype;
  v_answer text := left(regexp_replace(coalesce(p_answer, ''), E'^[ \\t\\n\\r\\f\\v]+|[ \\t\\n\\r\\f\\v]+$', '', 'g'), 1200); ev jsonb;
begin
  if not (public.content_plan_service_ok() or (auth.uid() is not null and public.cb34_p2_operator_lane_allowed('ivan'))) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_idea is null or v_answer !~ E'[^ \\t\\n\\r\\f\\v]' then return jsonb_build_object('ok', false, 'error', 'empty_answer'); end if;
  select * into c from public.lm_idea_candidates where id = p_idea for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not c.needs_ivan_data then return jsonb_build_object('ok', false, 'error', 'no_question'); end if;
  if c.status not in ('pending', 'scored', 'reviewing') then return jsonb_build_object('ok', false, 'error', 'idea_closed'); end if;
  if not public.content_idea_waits(true, c.needs_ivan_answer) then return jsonb_build_object('ok', false, 'error', 'already_answered'); end if;
  ev := case when jsonb_typeof(c.evidence) = 'array' then c.evidence
             when jsonb_typeof(c.evidence) = 'object' then jsonb_build_array(c.evidence) else '[]'::jsonb end;
  update public.lm_idea_candidates
     set needs_ivan_answer = v_answer, needs_ivan_answered_at = now(),
         evidence = ev || jsonb_build_array(jsonb_build_object(
           'who', 'Ivan Manfredi', 'tier', 'FACT', 'quote', v_answer, 'source', 'ivan_answer',
           'instrument', 'His answer to: ' || c.needs_ivan_question))
   where id = p_idea;
  return jsonb_build_object('ok', true, 'idea_id', p_idea);
end $function$;

revoke all on function public.content_idea_waits(boolean, text) from public, anon;
grant execute on function public.content_idea_waits(boolean, text) to authenticated, service_role;
revoke all on function public.content_idea_answer_ivan(uuid, text) from public, anon;
grant execute on function public.content_idea_answer_ivan(uuid, text) to authenticated, service_role;

COMMIT;
