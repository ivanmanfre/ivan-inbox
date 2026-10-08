-- What the client said on their panel, per post, for the inbox (Ivan 2026-10-08: compatibility between
-- the inbox Content section and the client panels). The panel writes approvals, removals and change
-- requests only to client_board_actions, which nothing in the inbox read, so an ARCH post waiting on
-- Davorin (the ARCH publisher needs his approve as the latest approve/undo event) looked scheduled, and
-- his notes ("This one we have to discuss on a call...", 3192f66b, 10-06) never reached Ivan.
-- Read only, gated like every operator_* call. Events: the action, or payload.event on a 'note' row
-- (how operator-side approvals are withdrawn).
create or replace function public.operator_client_board_state(p_gate text, p_client text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    with a as (
      select ref, created_at,
             case when action = 'note' then coalesce(payload->>'event', 'note') else action end as ev,
             nullif(btrim(payload->>'note'), '') as note, payload->>'by' as who
        from client_board_actions
       where client_id = p_client and ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'),
    ap as (select distinct on (ref) ref, ev, created_at from a where ev in ('approve', 'undo_approve') order by ref, created_at desc),
    ve as (select distinct on (ref) ref, ev, created_at from a
            where ev in ('post_removed', 'post_restored', 'angle_swap', 'angle_swap_undone') order by ref, created_at desc),
    rc as (select distinct on (ref) ref, note, who, created_at from a where ev = 'request_changes' and note is not null order by ref, created_at desc),
    refs as (select ref from ap union select ref from ve union select ref from rc)
    select jsonb_agg(jsonb_build_object(
      'id', r.ref, 'approval', ap.ev, 'approval_at', ap.created_at, 'veto', ve.ev, 'veto_at', ve.created_at,
      'note', rc.note, 'note_by', rc.who, 'note_at', rc.created_at))
      from refs r left join ap using (ref) left join ve using (ref) left join rc using (ref)), '[]'::jsonb));
end $$;
revoke execute on function public.operator_client_board_state(text, text) from public, anon;
grant execute on function public.operator_client_board_state(text, text) to authenticated;
