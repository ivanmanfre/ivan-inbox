-- Date-only reschedule for the workbench calendar (both lanes).
-- operator_schedule_draft is the ARMING rpc: it forces status='scheduled' +
-- board_visible=true and refuses client_id IS NULL. A calendar date move must
-- do neither — same semantics as client_board_set_schedule_v2 but operator-
-- gated: writes scheduled_at ONLY, status/visibility untouched, and a row that
-- was not armed stays unarmed.
CREATE OR REPLACE FUNCTION public.operator_set_schedule_date(p_gate text, p_draft_id uuid, p_scheduled_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare d carousel_drafts;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select * into d from carousel_drafts where id = p_draft_id;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if d.status not in ('review', 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', d.status);
  end if;
  update carousel_drafts set scheduled_at = p_scheduled_at where id = p_draft_id;
  return jsonb_build_object('ok', true, 'id', p_draft_id, 'scheduled_at', p_scheduled_at, 'status', d.status);
end; $function$;

-- match operator_schedule_draft's grant shape (gate is the real guard; this
-- just keeps the surface identical)
REVOKE EXECUTE ON FUNCTION public.operator_set_schedule_date(text, uuid, timestamptz) FROM public, anon;
