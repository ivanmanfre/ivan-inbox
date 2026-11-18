-- rollback of db/20261118m_content_desk_r15.sql: the r14 definitions and grants come back
drop function if exists public.desk_claim_commit(uuid, uuid, uuid);
drop function if exists public.desk_mark_done(uuid, uuid);
drop function if exists public.desk_approve(uuid, uuid,uuid,timestamp with time zone,text,timestamp with time zone);
drop function if exists public.desk_keep(uuid, uuid,uuid,timestamp with time zone,text,timestamp with time zone);
drop function if exists public.desk_pull(uuid, uuid,uuid,timestamp with time zone,uuid[],uuid,timestamp with time zone,text,timestamp with time zone);
drop function if exists public.desk_delete(uuid, uuid,uuid,timestamp with time zone,text);
drop function if exists public.desk_redo_claim(uuid, uuid,uuid,timestamp with time zone,text,text,timestamp with time zone);
drop function if exists public.desk_redo_release(uuid, uuid,uuid,text,text);
drop function if exists public.desk_act_as(uuid, uuid, text[], uuid);
CREATE OR REPLACE FUNCTION public.desk_act_as(p_action uuid, p_draft uuid, p_states text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_user uuid;
begin
  -- the action row the edge journaled for exactly this draft, in the state this call may act in
  select user_id into v_user from public.desk_actions
   where id = p_action and target_id = p_draft::text and result->>'state' = any(p_states);
  if v_user is null then return null; end if;
  -- act as that row's owner for this transaction only
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  return v_user;
end $function$;
revoke execute on function public.desk_act_as(uuid,uuid,text[]) from public, anon, authenticated;
grant execute on function public.desk_act_as(uuid,uuid,text[]) to service_role;
-- (r16 #7) desk_draft_image is NOT rolled back: the r15 image (with taxonomy_is_null) is what the kept r15
-- Undo compares against; the r14 forward functions call it unchanged.
CREATE OR REPLACE FUNCTION public.desk_set_date(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_at timestamp with time zone, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts; v_before jsonb; v_applied jsonb; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['pending']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  -- an immediate kind acts only on a draft with no live queue row: a queued post moves in the calendar
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'in_queue'); end if;
  if p_at is null and d.status = 'scheduled' then return jsonb_build_object('ok', false, 'error', 'pull_instead'); end if;
  v_before := public.desk_draft_image(p_draft);
  begin
    v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_at);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
    -- only the draft's own columns: a queue row it retimed (none existed under the lock) rolls it all back
    if coalesce((v_rpc->>'queue_retimed')::int, 0) <> 0 then raise exception 'desk_in_queue'; end if;
    v_applied := public.desk_draft_image(p_draft);
    update public.desk_actions
       set undo = jsonb_build_object('op', 'draft_v4', 'draft_id', p_draft, 'before', v_before, 'applied', v_applied),
           result = coalesce(result, '{}'::jsonb) || jsonb_build_object('state', 'done')
     where id = p_action and target_id = p_draft::text and result->>'state' = 'pending';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'desk_no_action'; end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
    if sqlerrm = 'desk_in_queue' then return jsonb_build_object('ok', false, 'error', 'in_queue'); end if;
    if sqlerrm = 'desk_no_action' then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  select * into a from public.carousel_drafts where id = p_draft;
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
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; v_before jsonb; v_applied jsonb; v_n int;
begin
  if p_add_url is null or p_add_url = '' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  if public.desk_act_as(p_action, p_draft, array['pending']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
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
    v_applied := public.desk_draft_image(p_draft);
    update public.desk_actions
       set undo = jsonb_build_object('op', 'draft_v4', 'draft_id', p_draft, 'before', v_before, 'applied', v_applied),
           result = coalesce(result, '{}'::jsonb) || jsonb_build_object('state', 'done')
     where id = p_action and target_id = p_draft::text and result->>'state' = 'pending';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'desk_no_action'; end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
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
-- (r16 #7) desk_undo is NOT rolled back: the r15 Undo (applied-revision check + taxonomy_is_null flag) stays,
-- so an Undo of a payload written by r15 keeps its full checks. A payload without applied_updated_at
-- (written after this rollback by the r14 forward functions) is refused as nothing_to_undo: fail closed.
CREATE OR REPLACE FUNCTION public.desk_claim_commit(p_action uuid, p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_n int; v_state text; v_deadline timestamptz;
begin
  update public.desk_actions set result = jsonb_set(result, '{state}', '"committing"')
   where id = p_action and user_id = p_user and result->>'state' = 'held'
     and coalesce((result->>'expires_at')::timestamptz, created_at + interval '24 hours') > now();
  get diagnostics v_n = row_count;
  if v_n = 1 then return 'claimed'; end if;
  select result->>'state', coalesce((result->>'expires_at')::timestamptz, created_at + interval '24 hours') into v_state, v_deadline
    from public.desk_actions where id = p_action and user_id = p_user;
  if v_state = 'held' and v_deadline <= now() then return 'expired'; end if;
  return 'not_held';
end $function$;
revoke execute on function public.desk_claim_commit(uuid,uuid) from public, anon, authenticated;
grant execute on function public.desk_claim_commit(uuid,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.desk_expire_hold(p_action uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_reason text; v_state text;
begin
  update public.desk_actions set result = jsonb_set(result, '{state}', '"cancelled"')
   where id = p_action and user_id = p_user and result->>'state' = 'held'
     and (coalesce((result->>'expires_at')::timestamptz, created_at + interval '24 hours') <= now()
          or coalesce(args->'_confirm'->>'v', '') <> '2')
   returning case when coalesce(args->'_confirm'->>'v', '') <> '2' then 'stale' else 'expired' end into v_reason;
  if v_reason is not null then return jsonb_build_object('state', 'cancelled', 'reason', v_reason); end if;
  select result->>'state' into v_state from public.desk_actions where id = p_action and user_id = p_user;
  return jsonb_build_object('state', v_state, 'reason', null);
end $function$;
revoke execute on function public.desk_expire_hold(uuid,uuid) from public, anon, authenticated;
grant execute on function public.desk_expire_hold(uuid,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.desk_approve(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['committing']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error')
     or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  update public.carousel_drafts set status = 'approved'
   where id = p_draft and client_id is null and status = p_expected_status and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  return jsonb_build_object('ok', true, 'approved', p_draft);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
revoke execute on function public.desk_approve(uuid,uuid,timestamp with time zone,text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.desk_approve(uuid,uuid,timestamp with time zone,text,timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION public.desk_keep(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  if public.desk_act_as(p_action, p_draft, array['committing']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft, true);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error')
     or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  begin
    v_rpc := public.cb39_verdict_set(p_draft, 'keep', '{}'::text[], null, null, null);
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
revoke execute on function public.desk_keep(uuid,uuid,timestamp with time zone,text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.desk_keep(uuid,uuid,timestamp with time zone,text,timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION public.desk_pull(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_queue_ids uuid[], p_next_queue uuid, p_next_slot timestamp with time zone, p_reason text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  if public.desk_act_as(p_action, p_draft, array['committing']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at or d.status is distinct from 'scheduled'
     or d.scheduled_at is distinct from p_expected_scheduled_at then   -- the source date the card showed (round 12)
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_queue_ids(p_draft) is distinct from coalesce((select array_agg(x order by x) from unnest(p_queue_ids) x), '{}') then
    return jsonb_build_object('ok', false, 'error', 'queue_changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  begin
    if p_next_queue is not null then
      if not exists (select 1 from public.scheduled_posts q where q.id = p_next_queue and q.clickup_task_id = p_draft::text
                        and q.platform = 'linkedin' and q.status = 'pending' and coalesce(q.is_repost, false) = false
                        and q.scheduled_at = p_next_slot) then
        return jsonb_build_object('ok', false, 'error', 'queue_changed');
      end if;
      v_rpc := public.content_next_pull(p_next_queue, p_next_slot, p_reason);
    else
      v_rpc := public.operator_set_schedule_date('clientops', p_draft, null);
    end if;
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
revoke execute on function public.desk_pull(uuid,uuid,timestamp with time zone,uuid[],uuid,timestamp with time zone,text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.desk_pull(uuid,uuid,timestamp with time zone,uuid[],uuid,timestamp with time zone,text,timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION public.desk_delete(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_reason text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 200), '');
begin
  if public.desk_act_as(p_action, p_draft, array['committing']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status not in ('review', 'error') or d.scheduled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'queue_still_live'); end if;
  v_tax := case jsonb_typeof(d.taxonomy)
             when 'object' then d.taxonomy
             when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                     else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
             else '{}'::jsonb end;
  if v_reason is not null then
    v_tax := v_tax || jsonb_build_object('delete_reason', v_reason);
    update public.carousel_drafts set taxonomy = v_tax where id = p_draft;
  end if;
  begin
    delete from public.carousel_drafts where id = p_draft;
    if found then return jsonb_build_object('ok', true, 'outcome', 'deleted'); end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    null;   -- the delete and anything it did are rolled back; archive below
  end;
  update public.carousel_drafts
     set status = 'disqualified', taxonomy = v_tax || jsonb_build_object('deleted_by_operator', true, 'deleted_at', now())
   where id = p_draft;
  return jsonb_build_object('ok', true, 'outcome', 'disqualified');
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
revoke execute on function public.desk_delete(uuid,uuid,timestamp with time zone,text) from public, anon, authenticated;
grant execute on function public.desk_delete(uuid,uuid,timestamp with time zone,text) to service_role;
CREATE OR REPLACE FUNCTION public.desk_redo_claim(p_action uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_started_at text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['committing']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error', 'approved')
     or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'queue_still_live'); end if;
  if coalesce(d.taxonomy->>'human_edited', '') = 'true' then return jsonb_build_object('ok', false, 'error', 'human_edited'); end if;
  v_tax := case jsonb_typeof(d.taxonomy)
             when 'object' then d.taxonomy
             when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                     else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
             else '{}'::jsonb end;
  update public.carousel_drafts set status = 'generating', taxonomy = v_tax || jsonb_build_object('generating_started_at', p_started_at)
   where id = p_draft and client_id is null and status = p_expected_status and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  return jsonb_build_object('ok', true, 'before_status', d.status, 'type', d.type, 'topic', d.topic, 'title', d.title);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
revoke execute on function public.desk_redo_claim(uuid,uuid,timestamp with time zone,text,text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.desk_redo_claim(uuid,uuid,timestamp with time zone,text,text,timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION public.desk_redo_release(p_action uuid, p_draft uuid, p_started_at text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['committing']) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  if p_status not in ('review', 'error', 'approved') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if d.status is distinct from 'generating' or d.taxonomy->>'generating_started_at' is distinct from p_started_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  update public.carousel_drafts set status = p_status, taxonomy = taxonomy - 'generating_started_at'
   where id = p_draft and status = 'generating' and taxonomy->>'generating_started_at' = p_started_at;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'busy');
end $function$;
revoke execute on function public.desk_redo_release(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.desk_redo_release(uuid,uuid,text,text) to service_role;
CREATE OR REPLACE FUNCTION public.desk_brief_core(p_fixtures boolean DEFAULT false, p_with_panel boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
declare
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Europe/Warsaw')::date;
  v_this_mon   date := date_trunc('week', (now() at time zone 'Europe/Warsaw'))::date;
  v_panel      jsonb;
  v_drafts     jsonb;
  v_queue      jsonb;
  v_posts      jsonb;
  v_calls      jsonb;
  v_lines      jsonb;
  v_beliefs    jsonb;
  v_rulings    jsonb;
  v_autopilot  jsonb;
  v_ideas      jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'desk_brief_ivan: service role only' using errcode = '42501';
  end if;

  if p_with_panel then
    begin
      v_panel := public.cp17_calendar_panel_ivan();
    exception when others then
      v_panel := jsonb_build_object('ok', false, 'error', left(sqlerrm, 200));
    end;
  else
    v_panel := jsonb_build_object('omitted', true);
  end if;

  -- Ivan's live drafts: everything not finished, plus anything published in
  -- the last 14 days.
  select coalesce(jsonb_agg(x order by x->>'sort'), '[]'::jsonb) into v_drafts from (
    select jsonb_build_object(
      'id', d.id,
      'status', d.status,
      'updated_at', d.updated_at,   -- round 12: numbered rows carry the brief revision the answer was built from
      'type', d.type,
      'scheduled_at', d.scheduled_at,
      'published_at', d.published_at,
      'first_line', public.desk_first_line(d.post_body),
      'title', left(coalesce(d.title, d.topic, ''), 120),
      -- belief / vehicle: the draft's own taxonomy, else the post labeler (published posts)
      'belief', coalesce(case when d.taxonomy->>'belief' ~ '^[1-5]$' then (d.taxonomy->>'belief')::int end, lb.belief::int),
      'vehicle', coalesce(nullif(d.taxonomy->>'vehicle', ''), lb.vehicle),
      'recipe', d.qa->>'recipe',
      'qa_verdict', d.qa->>'verdict',
      'is_copy', (d.taxonomy->>'outlier_copy' = 'true'
                  or d.taxonomy->>'source' in ('linkedin_outlier_copy', 'x_tracked_outlier')
                  or coalesce(d.source_ref, '') like 'outlier:%'),
      'photos', coalesce(array_length(d.image_urls, 1), 0),
      'brain', (d.taxonomy->>'source' = 'content-brain'
                or (d.status in ('review', 'error')
                    and coalesce((select v.cb34_p2_member from public.cb34_p2_safe_drafts v where v.id = d.id), false))),
      'human_edited', d.taxonomy->>'human_edited' = 'true',
      'slot_kind', nullif(d.taxonomy->>'slot_kind', ''),
      -- same selling marker cp17_belief_quota_check reads
      'selling', (coalesce(d.taxonomy->>'slot_kind', '') = 'selling_claim' or coalesce(d.taxonomy->>'kind', '') = 'selling_claim'
                  or coalesce(d.taxonomy->>'selling_claim', '') = 'true'
                  or (d.taxonomy->>'source' = 'manual' and d.taxonomy ? 'hand_dated_at' and coalesce(d.taxonomy->>'approval', '') like 'explicit-user-%')),
      'chars', length(coalesce(d.post_body, '')),
      'created_at', d.created_at,
      'fixture', d.taxonomy->>'desk_eval_fixture',
      'sort', coalesce(to_char(d.scheduled_at, 'YYYY-MM-DD"T"HH24:MI'), '9999') || to_char(d.created_at, 'YYYYMMDDHH24MISS')
    ) as x
    from public.carousel_drafts d
    left join lateral (select l.belief, l.vehicle from public.cp17_post_labels l
                        where l.draft_id = d.id order by l.labeled_at desc limit 1) lb on true
    where d.client_id is null
      and coalesce(d.taxonomy->>'deleted_by_operator', '') = ''
      and (
        (coalesce(d.taxonomy->>'internal_test', '') <> 'true' and d.taxonomy->>'desk_eval_fixture' is null)
        or (p_fixtures and d.taxonomy->>'desk_eval_fixture' is not null)
      )
      and (
        d.status in ('review', 'approved', 'scheduled', 'generating', 'error')
        or (d.status = 'published' and d.published_at > v_now - interval '14 days')
      )
    order by d.created_at desc
    limit 120
  ) s;

  -- The publish queue for the next 21 days (the Next rows), with the
  -- autopilot / own origin the app shows.
  select coalesce(jsonb_agg(jsonb_build_object(
      'queue_id', q.id, 'draft_id', d.id, 'slot_at', q.scheduled_at,
      'origin', case when coalesce((public.content_autonomy_publish_state_ivan(q.id)->>'required')::boolean, false)
                     then 'autopilot' else 'own' end,
      'first_line', public.desk_first_line(d.post_body)
    ) order by q.scheduled_at), '[]'::jsonb) into v_queue
  from public.scheduled_posts q
  join public.carousel_drafts d on d.id::text = q.clickup_task_id
  where q.platform = 'linkedin' and q.status = 'pending' and coalesce(q.is_repost, false) = false
    and d.client_id is null and q.scheduled_at > v_now and q.scheduled_at < v_now + interval '21 days';

  begin
    v_posts := public.ivan_week_posts_worked(v_now - interval '31 days', v_now);
  exception when others then
    v_posts := jsonb_build_object('error', left(sqlerrm, 200));
  end;

  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) into v_calls from (
    select jsonb_build_object(
      'id', t.id, 'date', t.date, 'title', left(coalesce(t.title, ''), 80),
      'call_kind', t.call_review->>'call_kind',
      'booked', t.call_review->'next_step'->>'booked',
      'next_when', t.call_review->'next_step'->>'when',
      'next_note', left(coalesce(t.call_review->'next_step'->>'note', ''), 200)
    ) as x
    from public.transcripts t
    -- Ivan's own calls only (his Mac listener), never a client's recordings
    where t.source = 'ivan-listener' and t.call_review is not null and t.call_review->>'status' is null
    order by t.date desc nulls last
    limit 5
  ) s;

  -- Postable lines from calls: the call extractor's lines in Ivan's own words (r6, eval E1). Only rows
  -- that carry his words ('said') and the call date ('when'): rows without them never take a slot, so
  -- newer dated calls are never pushed out by lines that have no text. Picked like the app's call-line
  -- list (newest ingest, then score), then shown newest call first.
  select coalesce(jsonb_agg(x order by x->>'when' desc, (x->>'score')::numeric desc nulls last), '[]'::jsonb) into v_lines from (
    select jsonb_build_object(
      'id', i.id, 'ingested_at', i.ingested_at, 'status', i.status,
      'topic', left(coalesce(i.raw_topic, ''), 200),
      'said', left(i.evidence->0->>'said', 400),
      'when', i.evidence->0->>'when',
      'belief', i.evidence->0->>'belief', 'vehicle', i.evidence->0->>'vehicle',
      'score', i.composite_score,
      'draft_id', i.promoted_draft_id
    ) as x
    from public.lm_idea_candidates i
    where i.source = 'ivan_call'
      -- the app's ideaDecidable lane guard: own workspace, no campaign
      and lower(btrim(coalesce(i.workspace_type, ''))) in ('', 'own') and i.campaign_id is null
      and i.status in ('scored', 'reviewing', 'promoted')  -- scored lines only; pending ones are not yet judged
      and i.ingested_at > v_now - interval '21 days'
      and coalesce(btrim(i.evidence->0->>'said'), '') <> ''
      and coalesce(i.evidence->0->>'when', '') ~ '^\d{4}-\d{2}-\d{2}'
    order by i.ingested_at desc, i.composite_score desc nulls last
    limit 12
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('n', regexp_replace(b.id, '^.*-', ''), 'belief', b.belief, 'why', left(coalesce(b.why_disagreeable, ''), 240)) order by b.id), '[]'::jsonb)
    into v_beliefs
  from public.cb44_beliefs b where b.client_id = 'ivan' and b.status = 'kept';

  -- Ivan's dated rulings that touch content: feedback notes whose NAME is about
  -- content work, newest ruling date first (the date in the file name).
  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_rulings from (
    select jsonb_build_object(
      'note', regexp_replace(m.file_path, '^.*/|\.md$', '', 'g'),
      'at', coalesce(substring(m.file_path from '(\d{4}-\d{2}-\d{2})'), to_char(m.updated_at, 'YYYY-MM-DD')),
      'rule', left(btrim(coalesce(substring(m.content from 'description:[ \t]*([^\n]*)'), ''), ' "'), 300)
    ) as x
    from public.claude_memory m
    where m.client_id = 'ivan' and m.file_path like 'project/feedback-%'
      and m.file_path ~* '(post|content|voice|copy|hook|carousel|lm-|writer|belief|calendar|photo|poland|feed|draft|caption|story|angle|outlier|selfie)'
      and m.file_path !~* '(rise|arch|swishdm|dm-|scan|outreach|invite|follow-?up|apollo|harvest|reply)'
    order by coalesce(substring(m.file_path from '(\d{4}-\d{2}-\d{2})'), to_char(m.updated_at, 'YYYY-MM-DD')) desc
    limit 14
  ) s;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_autopilot from (
    select jsonb_build_object('ran_at', r.ran_at, 'week_start', r.week_start, 'mode', r.mode,
      'picked', r.picked, 'scheduled', r.scheduled, 'open_before', r.open_before, 'outcome', r.outcome,
      'summary', left(coalesce(r.summary, ''), 400)) as x
    from public.content_autopilot_runs r
    where r.account = 'ivan'
    order by r.ran_at desc limit 3
  ) s;

  select jsonb_build_object(
    -- the same lane guard as the app's ideaDecidable: own workspace, no campaign
    'reviewing', (select count(*) from public.lm_idea_candidates where status = 'reviewing'
                    and lower(btrim(coalesce(workspace_type, ''))) in ('', 'own') and campaign_id is null),
    'newest', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'source', i.source, 'topic', left(coalesce(i.raw_topic, ''), 140), 'at', i.ingested_at) order by i.ingested_at desc)
       from (select * from public.lm_idea_candidates where status in ('reviewing', 'pending', 'scored')
               and lower(btrim(coalesce(workspace_type, ''))) in ('', 'own') and campaign_id is null
             order by ingested_at desc limit 6) i), '[]'::jsonb)
  ) into v_ideas;

  return jsonb_build_object(
    'as_of', v_now,
    'today', v_today,
    'this_monday', v_this_mon,
    'panel', v_panel,
    'drafts', v_drafts,
    'queue', v_queue,
    'posts', v_posts,
    'calls', v_calls,
    'call_lines', v_lines,
    'beliefs', v_beliefs,
    'rulings', v_rulings,
    'autopilot', v_autopilot,
    'ideas', v_ideas
  );
end $function$;
revoke execute on function public.desk_brief_core(boolean,boolean) from public, anon, authenticated;
grant execute on function public.desk_brief_core(boolean,boolean) to service_role;
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
          or (d.status = 'published' and d.published_at > now() - interval '31 days'))
     and ((d.taxonomy->>'desk_eval_fixture') is not null) = coalesce(p_fixtures, false)
     and (d.status not in ('review', 'approved', 'error', 'generating')
          or (d.taxonomy->>'desk_eval_fixture') is not null
          or exists (select 1 from public.cb34_p2_safe_drafts v where v.id = d.id))
$function$;
revoke execute on function public.desk_live_drafts(boolean) from public, anon, authenticated;
grant execute on function public.desk_live_drafts(boolean) to authenticated, service_role;
