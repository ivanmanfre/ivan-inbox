-- db/264: Accept / Dismiss / Undo for the brain strip on the Plan tab (spec 2026-10-12 R3.1, Task 9).
-- brain_proposal_accept, brain_proposal_dismiss and brain_rule_undo are SECURITY DEFINER but are not executable by
-- `authenticated` (checked live 2026-10-13), so the browser cannot call them. These two thin wrappers add the same
-- operator gate as content_plan_move_slot / operator_set_schedule_date (operator_gate_ok first, 'bad_gate') and pass the
-- underlying result through unchanged. Errors are never swallowed: brain_proposal_accept raises when the proposal is not
-- open (or is a direction change, which is edited by hand), and that exception reaches the caller.
--   operator_brain_proposal_decide(gate, id, true)  -> brain_proposal_accept(id, 'ivan')   -> rule change jsonb + proposal id
--   operator_brain_proposal_decide(gate, id, false) -> brain_proposal_dismiss(id, 'ivan')  -> {dismissed, proposal}
--   operator_brain_rule_undo(gate, token)           -> brain_rule_undo(token)              -> rollback jsonb or {error:'unknown_token'}
-- Additive: two new functions only. Rollback: db/264_plan_brain_actions_rollback.sql.

create or replace function public.operator_brain_proposal_decide(p_gate text, p_id bigint, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  if p_id is null or p_accept is null then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  if p_accept then
    return public.brain_proposal_accept(p_id, 'ivan');
  end if;
  return public.brain_proposal_dismiss(p_id, 'ivan');
end $function$;

create or replace function public.operator_brain_rule_undo(p_gate text, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  if p_token is null then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  return public.brain_rule_undo(p_token);
end $function$;

revoke all on function public.operator_brain_proposal_decide(text, bigint, boolean) from public, anon;
grant execute on function public.operator_brain_proposal_decide(text, bigint, boolean) to authenticated, service_role;
revoke all on function public.operator_brain_rule_undo(text, uuid) from public, anon;
grant execute on function public.operator_brain_rule_undo(text, uuid) to authenticated, service_role;
