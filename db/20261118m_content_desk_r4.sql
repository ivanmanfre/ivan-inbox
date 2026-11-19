-- Content Desk, Sol desk-backend r3 fixes (2026-11-18): undo compares the full applied state.
--
-- A date or photo undo restores the previous value only while the row is still exactly as the desk
-- left it: same value, same status, same updated_at, checked under a row lock in the same statement
-- that calls the app's own RPC. A post that was scheduled, armed or edited since is never touched.
-- SECURITY INVOKER: runs as Ivan's session, like the app's own buttons. The r3 v1 functions stay
-- (nothing calls them after this deploy) so no object is dropped in place.

create or replace function public.desk_undo_schedule_v2(p_draft uuid, p_applied timestamptz, p_applied_status text,
                                                        p_applied_updated_at timestamptz, p_prev timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_cur timestamptz; v_status text; v_upd timestamptz; v_found boolean;
begin
  select true, d.scheduled_at, d.status, d.updated_at into v_found, v_cur, v_status, v_upd
    from public.carousel_drafts d where d.id = p_draft and d.client_id is null for update;
  if not coalesce(v_found, false) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if v_cur is distinct from p_applied or v_status is distinct from p_applied_status or v_upd is distinct from p_applied_updated_at then
    return jsonb_build_object('ok', false, 'error', 'changed_since');
  end if;
  return public.operator_set_schedule_date('clientops', p_draft, p_prev);
end $$;

create or replace function public.desk_undo_photos_v2(p_draft uuid, p_applied text[], p_applied_status text,
                                                      p_applied_updated_at timestamptz, p_prev text[])
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_cur text[]; v_status text; v_upd timestamptz; v_found boolean;
begin
  select true, d.image_urls, d.status, d.updated_at into v_found, v_cur, v_status, v_upd
    from public.carousel_drafts d where d.id = p_draft and d.client_id is null for update;
  if not coalesce(v_found, false) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if coalesce(v_cur, '{}') is distinct from coalesce(p_applied, '{}') or v_status is distinct from p_applied_status
     or v_upd is distinct from p_applied_updated_at then
    return jsonb_build_object('ok', false, 'error', 'changed_since');
  end if;
  return public.operator_set_draft_photos('clientops', p_draft, coalesce(p_prev, '{}'));
end $$;

revoke all on function public.desk_undo_schedule_v2(uuid, timestamptz, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.desk_undo_schedule_v2(uuid, timestamptz, text, timestamptz, timestamptz) to authenticated;
revoke all on function public.desk_undo_photos_v2(uuid, text[], text, timestamptz, text[]) from public, anon;
grant execute on function public.desk_undo_photos_v2(uuid, text[], text, timestamptz, text[]) to authenticated;
