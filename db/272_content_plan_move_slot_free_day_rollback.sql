-- Rollback of db/272: put content_plan_move_slot back to its db/263 body (the exact live body before db/272).
-- create or replace keeps the existing grants.

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
  v_from := s.week_start;
  update public.content_plan_slots set week_start = p_week, updated_at = now() where id = p_slot;
  return jsonb_build_object('ok', true, 'slot_id', p_slot, 'from_week', v_from, 'to_week', p_week);
end $function$;
