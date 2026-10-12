-- db/267: client panels lose internal plan text and stale delivery updates.
-- Idempotent cleaner for the two client panels (arch-agency, risedtc-com).
--   1. board.week_plan.text: drop any line that shows internal wording
--      (story bank, eligible, cooldown, pending consent, waiting for ivan, needs ivan).
--      Empty text -> remove the text key only. items and every other key stay.
--   2. board.engine_updates -> [] only when EVERY entry has a parseable date before 2026-09-01.
--      Any entry without a parseable date -> left alone and reported.
--   3. Writes nothing (no updated_at churn) when nothing changes.
-- Writes go through client_board_apply_ops (row-locked per-key set/del).
-- The Weekly Plan Note workflow (LMBLkaBaESa6f6U4) rebuilds week_plan on Mondays; the hourly job removes the line again.

create or replace function public.client_board_clean_internal()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_slug   text;
  v_board  jsonb;
  v_ops    jsonb;
  v_text   text;
  v_kept   text;
  v_eu     jsonb;
  v_e      jsonb;
  v_stale  boolean;
  v_unpars int;
  v_res    jsonb := '{}'::jsonb;
  v_one    jsonb;
  v_cutoff constant date := date '2026-09-01';
begin
  foreach v_slug in array array['arch-agency','risedtc-com'] loop
    -- row lock first so the decision and the write see the same board
    select board into v_board from public.client_boards where slug = v_slug for update;
    if v_board is null then
      v_res := v_res || jsonb_build_object(v_slug, jsonb_build_object('skipped', 'no row'));
      continue;
    end if;
    v_ops := '[]'::jsonb;
    v_one := '{}'::jsonb;

    -- 1. internal plan lines
    if jsonb_typeof(v_board #> '{week_plan,text}') = 'string' then
      v_text := v_board #>> '{week_plan,text}';
      select string_agg(l, E'\n' order by ord) into v_kept
        from regexp_split_to_table(v_text, E'\n') with ordinality as t(l, ord)
       where l !~* '(story bank|eligible|cooldown|pending consent|waiting for ivan|needs ivan)';
      if v_kept is distinct from v_text then
        if v_kept is null or btrim(v_kept) = '' then
          v_ops := v_ops || jsonb_build_array(jsonb_build_object('op','del','path',jsonb_build_array('week_plan','text')));
          v_one := v_one || jsonb_build_object('week_plan_text', 'removed');
        else
          v_ops := v_ops || jsonb_build_array(jsonb_build_object('op','set','path',jsonb_build_array('week_plan','text'),'value',to_jsonb(v_kept)));
          v_one := v_one || jsonb_build_object('week_plan_text',
                     jsonb_build_object('lines_removed',
                       (select count(*) from regexp_split_to_table(v_text, E'\n') l
                         where l ~* '(story bank|eligible|cooldown|pending consent|waiting for ivan|needs ivan)')));
        end if;
      end if;
    end if;

    -- 2. stale delivery updates
    v_eu := v_board -> 'engine_updates';
    if jsonb_typeof(v_eu) = 'array' and jsonb_array_length(v_eu) > 0 then
      v_stale := true;
      v_unpars := 0;
      for v_e in select value from jsonb_array_elements(v_eu) loop
        if jsonb_typeof(v_e) = 'object'
           and (v_e->>'date') ~ '^\d{4}-\d{2}-\d{2}' then
          begin
            if left(v_e->>'date', 10)::date >= v_cutoff then
              v_stale := false;
            end if;
          exception when others then
            v_unpars := v_unpars + 1;
          end;
        else
          v_unpars := v_unpars + 1;
        end if;
      end loop;
      if v_unpars > 0 then
        v_one := v_one || jsonb_build_object('engine_updates', jsonb_build_object('kept', 'unparseable date', 'unparseable', v_unpars));
      elsif v_stale then
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op','set','path',jsonb_build_array('engine_updates'),'value','[]'::jsonb));
        v_one := v_one || jsonb_build_object('engine_updates', jsonb_build_object('cleared', jsonb_array_length(v_eu)));
      end if;
    end if;

    -- 3. write only when something changed
    if jsonb_array_length(v_ops) > 0 then
      perform public.client_board_apply_ops(v_slug, v_ops);
    end if;
    v_res := v_res || jsonb_build_object(v_slug, v_one);
  end loop;
  return v_res;
end;
$fn$;

revoke all on function public.client_board_clean_internal() from public, anon, authenticated;
grant execute on function public.client_board_clean_internal() to service_role;

do $c$
begin
  if not exists (select 1 from cron.job where jobname = 'client-board-clean-internal') then
    perform cron.schedule('client-board-clean-internal', '12 * * * *', 'select public.client_board_clean_internal()');
  end if;
end
$c$;
