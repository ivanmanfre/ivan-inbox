-- rollback of db/20261118m_content_desk_r19.sql: the r18 (=r17/r15) definitions come back. The cancelled
-- pre-v3 test holds stay cancelled (their ids are in snapshots/20261118m_r19_held.json).
drop function if exists public.desk_set_date(uuid, uuid, uuid, timestamptz, text, timestamptz, timestamptz);
drop function if exists public.desk_set_photos(uuid, uuid, uuid, timestamptz, text, text, timestamptz);
CREATE OR REPLACE FUNCTION public.desk_set_date(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_at timestamp with time zone, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts; v_before jsonb; v_applied jsonb; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['pending'], null) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'in_queue'); end if;
  if p_at is null and d.status = 'scheduled' then return jsonb_build_object('ok', false, 'error', 'pull_instead'); end if;
  v_before := public.desk_draft_image(p_draft);
  begin
    v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_at);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
    if coalesce((v_rpc->>'queue_retimed')::int, 0) <> 0 then raise exception 'desk_queue_appeared'; end if;
    -- the guard: queue writers outside the desk take no advisory lock, so re-check AFTER the write
    if cardinality(public.desk_queue_ids(p_draft)) > 0 then raise exception 'desk_queue_appeared'; end if;
    select * into a from public.carousel_drafts where id = p_draft;
    v_applied := public.desk_draft_image(p_draft);
    update public.desk_actions
       set undo = jsonb_build_object('op', 'draft_v4', 'draft_id', p_draft, 'before', v_before, 'applied', v_applied, 'applied_updated_at', a.updated_at),
           result = coalesce(result, '{}'::jsonb) || jsonb_build_object('state', 'done')
     where id = p_action and target_id = p_draft::text and result->>'state' = 'pending';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'desk_no_action'; end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
    if sqlerrm = 'desk_queue_appeared' then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
    if sqlerrm = 'desk_no_action' then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'before', d.scheduled_at, 'applied', a.scheduled_at, 'applied_status', a.status, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
revoke execute on function public.desk_set_date(uuid,uuid,timestamp with time zone,text,timestamp with time zone,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.desk_set_date(uuid,uuid,timestamp with time zone,text,timestamp with time zone,timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION public.desk_set_photos(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_add_url text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; v_before jsonb; v_applied jsonb; v_n int; v_rev timestamptz;
begin
  if p_add_url is null or p_add_url = '' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  if public.desk_act_as(p_action, p_draft, array['pending'], null) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'in_queue'); end if;
  v_before := public.desk_draft_image(p_draft);
  begin
    v_rpc := public.operator_set_draft_photos('clientops', p_draft, coalesce(d.image_urls, '{}') || p_add_url);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
    -- the guard (the media propagation trigger writes queue rows): re-check AFTER the write, same block
    if cardinality(public.desk_queue_ids(p_draft)) > 0 then raise exception 'desk_queue_appeared'; end if;
    select updated_at into v_rev from public.carousel_drafts where id = p_draft;
    v_applied := public.desk_draft_image(p_draft);
    update public.desk_actions
       set undo = jsonb_build_object('op', 'draft_v4', 'draft_id', p_draft, 'before', v_before, 'applied', v_applied, 'applied_updated_at', v_rev),
           result = coalesce(result, '{}'::jsonb) || jsonb_build_object('state', 'done')
     where id = p_action and target_id = p_draft::text and result->>'state' = 'pending';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'desk_no_action'; end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
    if sqlerrm = 'desk_queue_appeared' then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
    if sqlerrm = 'desk_no_action' then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'before', v_before->'image_urls', 'applied', v_applied->'image_urls', 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
revoke execute on function public.desk_set_photos(uuid,uuid,timestamp with time zone,text,text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.desk_set_photos(uuid,uuid,timestamp with time zone,text,text,timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION public.desk_expire_hold(p_action uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_reason text; v_state text;
begin
  update public.desk_actions set result = jsonb_set(result, '{state}', '"cancelled"')
   where id = p_action and user_id = p_user
     and (result->>'state' = 'held'
          or (result->>'state' = 'committing' and coalesce((result->>'claim_at')::timestamptz, '-infinity'::timestamptz) < now() - interval '2 minutes'))
     and (coalesce((result->>'expires_at')::timestamptz, created_at + interval '24 hours') <= now()
          or coalesce(args->'_confirm'->>'v', '') <> '2')
   returning case when coalesce(args->'_confirm'->>'v', '') <> '2' then 'stale' else 'expired' end into v_reason;
  if v_reason is not null then return jsonb_build_object('state', 'cancelled', 'reason', v_reason); end if;
  select result->>'state' into v_state from public.desk_actions where id = p_action and user_id = p_user;
  return jsonb_build_object('state', v_state, 'reason', null);
end $function$;
revoke execute on function public.desk_expire_hold(uuid,uuid) from public, anon, authenticated;
grant execute on function public.desk_expire_hold(uuid,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.desk_live_drafts(p_fixtures boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'status', d.status, 'type', d.type, 'scheduled_at', d.scheduled_at, 'published_at', d.published_at,
           'body_head', (select btrim(l) from regexp_split_to_table(coalesce(d.post_body, ''), E'\n') as l where btrim(l) <> '' limit 1),
           'updated_at', d.updated_at, 'created_at', d.created_at,
           'fixture', d.taxonomy->>'desk_eval_fixture') order by d.id), '[]'::jsonb)
    from public.carousel_drafts d
   where d.client_id is null
     and (d.status in ('review', 'approved', 'error', 'generating', 'scheduled')
          or (d.status = 'published' and d.published_at > now() - interval '30 days'))
     and ((d.taxonomy->>'desk_eval_fixture') is not null) = coalesce(p_fixtures, false)
     and (d.status not in ('review', 'approved', 'error', 'generating')
          or (d.taxonomy->>'desk_eval_fixture') is not null
          or exists (select 1 from public.cb34_p2_safe_drafts v where v.id = d.id))
$function$;
revoke execute on function public.desk_live_drafts(boolean) from public, anon, authenticated;
grant execute on function public.desk_live_drafts(boolean) to authenticated, service_role;
