-- ARCH Fill next week, cross-review r6 (gpt-6.1-sol): arch_fill_undo took the post's approval advisory lock before
-- the draft row lock. A body edit takes the row lock first (UPDATE) and the advisory lock second (AFTER trigger
-- arch_fill_body_changed), so an edit and an Undo running together could deadlock and Postgres would abort one.
-- Fix: row lock first, then the advisory lock, still before the latest-approval read. Only the lock order changes.
-- Rollback: 20261107_arch_fill_next_week_sol_r6_rollback.sql (puts back the r5 order).
create or replace function public.arch_fill_undo(p_gate text, p_batch uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare a record; d public.carousel_drafts; v_last public.client_board_actions.id%type; v_undone int := 0; v_posted int := 0; v_changed int := 0; v_late int := 0;
  v_found int := 0; v_res jsonb; v_prev jsonb;
begin
  if auth.uid() is null or not public.operator_gate_ok(p_gate) then return jsonb_build_object('ok', false, 'error', 'bad_gate'); end if;
  perform pg_advisory_xact_lock(hashtext('arch_fill_calendar'));
  for a in select * from public.client_board_actions
            where client_id = 'arch' and action = 'approve' and payload->>'batch' = p_batch::text order by created_at, id loop
    v_found := v_found + 1;
    -- Lock order, the same on every path: the draft row first, then the post's approval lock (commit and the
    -- body-change trigger take them in that order; review r6 found the reverse order here deadlocks with an edit).
    -- The approval lock is still taken before the latest approval is read and held to the end (review r5), so a
    -- board approve or undo still in flight finishes first and the check below sees it.
    select * into d from public.carousel_drafts where id::text = a.ref and client_id = 'arch' for update;
    perform pg_advisory_xact_lock(hashtext('arch_approval:' || a.ref));
    if d.id is null then v_changed := v_changed + 1; continue; end if;
    if d.published_at is not null then v_posted := v_posted + 1; continue; end if;
    select id into v_last from public.client_board_actions
     where ref = a.ref and (action in ('approve', 'undo_approve') or (action = 'note' and payload->>'event' in ('approve', 'undo_approve')))
     order by created_at desc, id desc limit 1;
    if v_last is distinct from a.id
       or exists (select 1 from public.client_board_actions u where u.ref = a.ref and u.payload->>'undone_batch' = p_batch::text)
       or d.scheduled_at is distinct from (a.payload->>'scheduled_at')::timestamptz
       or encode(digest(coalesce(d.post_body, ''), 'sha256'), 'hex') is distinct from a.payload->>'approved_body_sha256'
       or d.board_visible is not true or d.status <> 'review' then
      v_changed := v_changed + 1; continue; end if;
    if d.scheduled_at <= now() + interval '15 minutes' then v_late := v_late + 1; continue; end if;
    v_prev := a.payload->'prev_approval';
    if v_prev is not null and (v_prev->>'action' = 'approve' or (v_prev->>'action' = 'note' and v_prev->'payload'->>'event' = 'approve')) then
      insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
      values ('arch-agency', 'arch', 'approve', a.ref, coalesce(v_prev->'payload', '{}'::jsonb) - 'batch'
              || jsonb_build_object('restored_by', 'inbox fill next week undo', 'undone_batch', p_batch));
    else
      insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
      values ('arch-agency', 'arch', 'undo_approve', a.ref, jsonb_build_object('by', 'Ivan', 'via', 'inbox fill next week', 'event', 'fill_undo', 'undone_batch', p_batch));
    end if;
    v_res := public.operator_set_schedule_date(p_gate, d.id, null);
    if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'arch_fill_undo: date clear refused for %: %', d.id, v_res::text; end if;
    if (a.payload->>'prev_board_visible')::boolean is false then
      v_res := public.operator_set_board_visible(p_gate, d.id, false);
      if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'arch_fill_undo: board refused for %: %', d.id, v_res::text; end if;
    end if;
    v_undone := v_undone + 1;
  end loop;
  if v_found = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'undone', v_undone, 'posted', v_posted, 'changed', v_changed, 'too_late', v_late);
end $$;
