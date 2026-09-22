-- Rollback for 205: restores 032's body verbatim.
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
