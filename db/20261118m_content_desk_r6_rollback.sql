-- Rollback for 20261118m_content_desk_r6.sql: drop the new functions, restore the r4/r5 bodies of the four replaced ones.
drop function if exists public.desk_pull(uuid, timestamptz, uuid[], uuid, timestamptz, text);
drop function if exists public.desk_approve(uuid, timestamptz, text);
drop function if exists public.desk_keep(uuid, timestamptz, text);
drop function if exists public.desk_delete(uuid, timestamptz, text);

CREATE OR REPLACE FUNCTION public.desk_set_date(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.desk_set_photos(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_add_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.desk_undo_schedule_v2(p_draft uuid, p_applied timestamp with time zone, p_applied_status text, p_applied_updated_at timestamp with time zone, p_prev timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_cur timestamptz; v_status text; v_upd timestamptz; v_found boolean;
begin
  select true, d.scheduled_at, d.status, d.updated_at into v_found, v_cur, v_status, v_upd
    from public.carousel_drafts d where d.id = p_draft and d.client_id is null for update;
  if not coalesce(v_found, false) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if v_cur is distinct from p_applied or v_status is distinct from p_applied_status or v_upd is distinct from p_applied_updated_at then
    return jsonb_build_object('ok', false, 'error', 'changed_since');
  end if;
  return public.operator_set_schedule_date('clientops', p_draft, p_prev);
end $function$;

CREATE OR REPLACE FUNCTION public.desk_undo_photos_v2(p_draft uuid, p_applied text[], p_applied_status text, p_applied_updated_at timestamp with time zone, p_prev text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;

-- the helpers last: nothing above uses them after the restore
drop function if exists public.desk_lock_draft(uuid, boolean);
drop function if exists public.desk_queue_ids(uuid);
drop function if exists public.desk_posting(uuid);
