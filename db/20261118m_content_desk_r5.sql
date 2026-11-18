-- Content Desk, Sol desk-backend r4 fixes (2026-11-18): forward date and photo writes in one transaction.
--
-- desk_set_date / desk_set_photos lock the draft row FOR UPDATE, check the version and status the
-- desk authorized, read the value before, call the app's own RPC (operator_set_schedule_date /
-- operator_set_draft_photos, the same calls the calendar and PictureRow make), then read the applied
-- value, status and updated_at, all inside the one transaction that holds the row lock. Undo uses
-- exactly what these return, so a later edit can never be adopted as "what the desk applied".
-- SECURITY INVOKER: runs as Ivan's session (his JWT), like the app's own buttons.
--
-- desk_patch_action_echo now patches only a message whose echo list holds that action id, and
-- returns null otherwise (no message is reported as patched when nothing matched).

create or replace function public.desk_set_date(p_draft uuid, p_expected_updated_at timestamptz,
                                                p_expected_status text, p_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare
  v_found boolean; v_before timestamptz; v_status text; v_upd timestamptz;
  v_rpc jsonb; v_after timestamptz; v_astatus text; v_aupd timestamptz;
begin
  select true, d.scheduled_at, d.status, d.updated_at into v_found, v_before, v_status, v_upd
    from public.carousel_drafts d where d.id = p_draft and d.client_id is null for update;
  if not coalesce(v_found, false) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or v_upd is distinct from p_expected_updated_at
     or v_status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  -- removing the date from a scheduled post is a pull (its own held action), never this path
  if p_at is null and v_status = 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_at);
  if coalesce(v_rpc->>'ok', 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'), 'rpc', v_rpc);
  end if;
  select d.scheduled_at, d.status, d.updated_at into v_after, v_astatus, v_aupd
    from public.carousel_drafts d where d.id = p_draft;
  return jsonb_build_object('ok', true, 'before', v_before, 'applied', v_after, 'applied_status', v_astatus,
                            'applied_updated_at', v_aupd, 'rpc', v_rpc);
end $$;

create or replace function public.desk_set_photos(p_draft uuid, p_expected_updated_at timestamptz,
                                                  p_expected_status text, p_add_url text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare
  v_found boolean; v_before text[]; v_status text; v_upd timestamptz;
  v_rpc jsonb; v_after text[]; v_astatus text; v_aupd timestamptz;
begin
  if p_add_url is null or p_add_url = '' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  select true, coalesce(d.image_urls, '{}'), d.status, d.updated_at into v_found, v_before, v_status, v_upd
    from public.carousel_drafts d where d.id = p_draft and d.client_id is null for update;
  if not coalesce(v_found, false) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or v_upd is distinct from p_expected_updated_at
     or v_status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  v_rpc := public.operator_set_draft_photos('clientops', p_draft, v_before || p_add_url);
  if coalesce(v_rpc->>'ok', 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'), 'rpc', v_rpc);
  end if;
  select coalesce(d.image_urls, '{}'), d.status, d.updated_at into v_after, v_astatus, v_aupd
    from public.carousel_drafts d where d.id = p_draft;
  return jsonb_build_object('ok', true, 'before', to_jsonb(v_before), 'applied', to_jsonb(v_after),
                            'applied_status', v_astatus, 'applied_updated_at', v_aupd, 'rpc', v_rpc);
end $$;

revoke all on function public.desk_set_date(uuid, timestamptz, text, timestamptz) from public, anon;
grant execute on function public.desk_set_date(uuid, timestamptz, text, timestamptz) to authenticated;
revoke all on function public.desk_set_photos(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.desk_set_photos(uuid, timestamptz, text, text) to authenticated;

create or replace function public.desk_patch_action_echo(p_message uuid, p_action text, p_patch jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.desk_messages m
     set meta = jsonb_set(m.meta, '{actions}', coalesce((
           select jsonb_agg(case when x->>'id' = p_action then x || p_patch else x end order by o)
             from jsonb_array_elements(coalesce(m.meta->'actions', '[]'::jsonb)) with ordinality t(x, o)), '[]'::jsonb)),
         updated_at = now()
   where m.id = p_message
     and m.status = 'done'
     and exists (select 1 from jsonb_array_elements(coalesce(m.meta->'actions', '[]'::jsonb)) e where e->>'id' = p_action)
  returning to_jsonb(m.*)
$$;
revoke all on function public.desk_patch_action_echo(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_patch_action_echo(uuid, text, jsonb) to service_role;
