-- Content Desk, round 19 (GRAMMAR.md section 3): every draft write is held.
-- 1. desk_set_date / desk_set_photos run at COMMIT time: they act only for the claim token of the commit
--    (state 'committing'), keep every check (lock, revision, status, source date, no live queue row under the
--    lock and after the write), store the exact undo images on the action row and mark it done, all in one
--    transaction.
-- 2. desk_expire_hold cancels any hold without the grammar proof v3; the pre-v3 held test rows are cancelled
--    below, logged (each id and its message echo).
-- 3. desk_live_drafts returns 'queued' (a live queue row exists), so queue eligibility is counted before
--    uniqueness.

drop function if exists public.desk_set_date(uuid,uuid,timestamp with time zone,text,timestamp with time zone,timestamp with time zone);
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

drop function if exists public.desk_set_photos(uuid,uuid,timestamp with time zone,text,text,timestamp with time zone);
CREATE OR REPLACE FUNCTION public.desk_set_photos(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_add_url text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; v_before jsonb; v_applied jsonb; v_n int; v_rev timestamptz;
begin
  if p_add_url is null or p_add_url = '' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
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
  return jsonb_build_object('ok', true, 'before', v_before->'image_urls', 'applied', v_applied->'image_urls', 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

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
          or coalesce(args->'_confirm'->>'v', '') <> '3')
   returning case when coalesce(args->'_confirm'->>'v', '') <> '3' then 'stale' else 'expired' end into v_reason;
  if v_reason is not null then return jsonb_build_object('state', 'cancelled', 'reason', v_reason); end if;
  select result->>'state' into v_state from public.desk_actions where id = p_action and user_id = p_user;
  return jsonb_build_object('state', v_state, 'reason', null);
end $function$;

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
           'fixture', d.taxonomy->>'desk_eval_fixture',
           'queued', exists (select 1 from public.scheduled_posts q where q.clickup_task_id = d.id::text and q.status in ('pending', 'queued_v2', 'posting'))) order by d.id), '[]'::jsonb)
    from public.carousel_drafts d
   where d.client_id is null
     and (d.status in ('review', 'approved', 'error', 'generating', 'scheduled')
          or (d.status = 'published' and d.published_at > now() - interval '30 days'))
     and ((d.taxonomy->>'desk_eval_fixture') is not null) = coalesce(p_fixtures, false)
     and (d.status not in ('review', 'approved', 'error', 'generating')
          or (d.taxonomy->>'desk_eval_fixture') is not null
          or exists (select 1 from public.cb34_p2_safe_drafts v where v.id = d.id))
$function$;

-- service role only (the forward functions, as since round 14)
revoke execute on function public.desk_set_date(uuid, uuid, uuid, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_set_date(uuid, uuid, uuid, timestamptz, text, timestamptz, timestamptz) to service_role;
revoke execute on function public.desk_set_photos(uuid, uuid, uuid, timestamptz, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_set_photos(uuid, uuid, uuid, timestamptz, text, text, timestamptz) to service_role;

-- cancel every pre-v3 hold (test rows), logged: the row and its message echo
do $$
declare r record; n int := 0;
begin
  for r in select id, message_id from public.desk_actions
            where result->>'state' = 'held' and coalesce(args->'_confirm'->>'v', '') <> '3' for update loop
    update public.desk_actions set result = result || jsonb_build_object('state', 'cancelled', 'cancelled_by', 'r19_pre_v3') where id = r.id;
    if r.message_id is not null then
      perform public.desk_patch_action_echo(r.message_id, r.id::text, jsonb_build_object('state', 'cancelled', 'undo', false, 'label', 'Cancelled: this proposal is from an older version. Ask again.'));
    end if;
    raise notice 'r19 cancelled pre-v3 hold %', r.id;
    n := n + 1;
  end loop;
  raise notice 'r19 cancelled % pre-v3 holds', n;
end $$;
