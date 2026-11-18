-- rollback of db/20261118m_content_desk_r20.sql: the r19 definitions come back. Receipts written by r20 carry
-- qa keys; the r19 desk_undo compares whole images, so it refuses them (changed_since): fail closed.
CREATE OR REPLACE FUNCTION public.desk_draft_image(p_draft uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object('scheduled_at', to_jsonb(d.scheduled_at at time zone 'UTC'), 'status', to_jsonb(d.status),
                            'taxonomy', coalesce(to_jsonb(d.taxonomy), 'null'::jsonb), 'taxonomy_is_null', d.taxonomy is null,
                            'image_urls', coalesce(to_jsonb(d.image_urls), 'null'::jsonb))
    from public.carousel_drafts d where d.id = p_draft
$function$;
CREATE OR REPLACE FUNCTION public.desk_set_date(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_at timestamp with time zone, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts; v_before jsonb; v_applied jsonb; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
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
           result = coalesce(result, '{}'::jsonb) || jsonb_build_object('state', 'done', 'committed_at', now())
     where id = p_action and target_id = p_draft::text and result->>'state' = 'committing' and result->>'claim_token' = p_claim::text;
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
CREATE OR REPLACE FUNCTION public.desk_undo(p_action uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare r public.desk_actions; b jsonb; ap jsonb; d public.carousel_drafts; v_n int; v_draft uuid; v_rev timestamptz;
begin
  begin
    update public.desk_actions set result = jsonb_set(coalesce(result, '{}'::jsonb), '{state}', '"undoing"')
     where id = p_action and result->>'state' = 'done' and undone_at is null and undo->>'op' = 'draft_v4'
     returning * into r;
    if r.id is null then raise exception 'nothing_to_undo'; end if;
    v_draft := r.target_id::uuid; b := r.undo->'before'; ap := r.undo->'applied';
    v_rev := (r.undo->>'applied_updated_at')::timestamptz;
    -- an image without its applied revision (before round 15) is never restored
    if v_draft is null or (r.undo->>'draft_id') is distinct from v_draft::text or b is null or ap is null or v_rev is null
       or (b ? 'taxonomy_is_null') is not true then raise exception 'nothing_to_undo'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    d := public.desk_lock_draft(v_draft);
    if d.id is null then raise exception 'gone'; end if;
    if cardinality(public.desk_queue_ids(v_draft)) > 0 then raise exception 'in_queue'; end if;
    perform set_config('app.schedule_manual', 'on', true);
    -- ONE statement: the applied revision AND the applied whole columns must both still hold
    update public.carousel_drafts c
       set scheduled_at = (b->>'scheduled_at')::timestamp at time zone 'UTC',
           status = b->>'status',
           taxonomy = case when (b->>'taxonomy_is_null')::boolean then null else b->'taxonomy' end,
           image_urls = case when jsonb_typeof(b->'image_urls') = 'array' then array(select jsonb_array_elements_text(b->'image_urls')) else null end
     where c.id = v_draft and c.client_id is null and c.updated_at = v_rev and public.desk_draft_image(c.id) = ap;
    get diagnostics v_n = row_count;
    perform set_config('app.schedule_manual', '', true);
    if v_n <> 1 then raise exception 'changed_since'; end if;
    -- the guard: a queue row that appeared during the restore rolls it all back
    if cardinality(public.desk_queue_ids(v_draft)) > 0 then raise exception 'changed_since'; end if;
    if public.desk_draft_image(v_draft) is distinct from b then raise exception 'undo_failed'; end if;
    update public.desk_actions set result = jsonb_set(result, '{state}', '"undone"'), undone_at = now() where id = p_action;
    return jsonb_build_object('ok', true, 'draft_id', v_draft);
  exception
    when lock_not_available or deadlock_detected then return jsonb_build_object('ok', false, 'error', 'changed_since');
    when raise_exception then
      return jsonb_build_object('ok', false, 'error', case when sqlerrm in ('nothing_to_undo', 'gone', 'in_queue', 'changed_since') then sqlerrm else 'undo_failed' end);
    when others then return jsonb_build_object('ok', false, 'error', 'undo_failed');
  end;
end $function$;
