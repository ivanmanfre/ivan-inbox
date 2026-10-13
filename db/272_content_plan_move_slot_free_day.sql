-- db/272: Move day refuses a week with no free weekday left.
-- content_plan_move_slot checked only filled < target. A week whose remaining weekdays (Mon-Fri, on or after today in
-- Europe/Warsaw) are all taken by dated posts, or that is mostly past, accepted the move and then content_plan_week showed the
-- slot with day null and the warning "has no free weekday". The move now counts the free weekdays by content_plan_week's own
-- rule and answers {ok:false, error:'no_free_day'} when the week cannot give this slot a day.
-- Additive: create or replace of one function, grants unchanged. Rollback: db/272_content_plan_move_slot_free_day_rollback.sql.

CREATE OR REPLACE FUNCTION public.content_plan_move_slot(p_gate text, p_slot uuid, p_week date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s public.content_plan_slots;
  v_read jsonb;
  v_to jsonb;
  v_first date;
  v_from date;
  v_today date;
  v_free int;
  v_planned int;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select * into s from public.content_plan_slots where id = p_slot;
  if s.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('content-plan:' || s.account, 0));
  select * into s from public.content_plan_slots where id = p_slot for update;
  if s.status not in ('planned', 'proposal', 'requested') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', s.status);
  end if;
  if p_week is null or extract(isodow from p_week) <> 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_week');
  end if;
  if p_week = s.week_start then
    return jsonb_build_object('ok', false, 'error', 'same_week');
  end if;
  -- The plan as the panel reads it: the three weeks, each with filled and target.
  v_read := public.content_plan_week(s.account);
  v_first := (v_read->'weeks'->0->>'start')::date;
  if s.week_start < v_first then
    return jsonb_build_object('ok', false, 'error', 'out_of_horizon', 'from_week', s.week_start);
  end if;
  select w into v_to from jsonb_array_elements(v_read->'weeks') w where (w->>'start')::date = p_week;
  if v_to is null then
    return jsonb_build_object('ok', false, 'error', 'out_of_horizon', 'to_week', p_week);
  end if;
  if (v_to->>'filled')::int >= (v_to->>'target')::int then
    return jsonb_build_object('ok', false, 'error', 'no_room', 'filled', (v_to->>'filled')::int, 'target', (v_to->>'target')::int);
  end if;
  -- db/272: content_plan_week gives each planned slot the first free weekday of its week: Mon-Fri, on or after today
  -- (Warsaw), not taken by a dated post, one slot per day. A week with fewer free weekdays than slots (counting this one)
  -- would show the slot with no day, so it is refused here.
  v_today := (v_read->>'today')::date;
  select count(*) into v_free from generate_series((v_to->>'start')::date::timestamp, ((v_to->>'start')::date + 4)::timestamp, interval '1 day') g
   where g::date >= v_today
     and not exists (select 1 from jsonb_array_elements(v_to->'posts') pp where (pp->>'day')::date = g::date);
  v_planned := jsonb_array_length(v_to->'planned');
  if v_planned + 1 > v_free then
    return jsonb_build_object('ok', false, 'error', 'no_free_day', 'free_days', v_free, 'planned', v_planned);
  end if;
  v_from := s.week_start;
  update public.content_plan_slots set week_start = p_week, updated_at = now() where id = p_slot;
  return jsonb_build_object('ok', true, 'slot_id', p_slot, 'from_week', v_from, 'to_week', p_week);
end $function$;
