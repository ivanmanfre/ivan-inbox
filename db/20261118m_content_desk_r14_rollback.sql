-- rollback of db/20261118m_content_desk_r14.sql: the r13 definitions and grants come back
drop function if exists public.desk_set_date(uuid, uuid, timestamptz, text, timestamptz, timestamptz);
drop function if exists public.desk_set_photos(uuid, uuid, timestamptz, text, text, timestamptz);
drop function if exists public.desk_undo(uuid);
drop function if exists public.desk_claim_commit(uuid, uuid);
drop function if exists public.desk_expire_hold(uuid, uuid);
drop function if exists public.desk_approve(uuid, uuid, timestamptz, text, timestamptz);
drop function if exists public.desk_keep(uuid, uuid, timestamptz, text, timestamptz);
drop function if exists public.desk_pull(uuid, uuid, timestamptz, uuid[], uuid, timestamptz, text, timestamptz);
drop function if exists public.desk_delete(uuid, uuid, timestamptz, text);
drop function if exists public.desk_redo_claim(uuid, uuid, timestamptz, text, text, timestamptz);
drop function if exists public.desk_redo_release(uuid, uuid, text, text);
drop function if exists public.desk_draft_image(uuid);
drop function if exists public.desk_act_as(uuid, uuid, text[]);
CREATE OR REPLACE FUNCTION public.desk_set_date(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_at timestamp with time zone, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts; v_before jsonb; v_applied jsonb;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  if p_at is null and d.status = 'scheduled' then return jsonb_build_object('ok', false, 'error', 'pull_instead'); end if;
  -- removing a date needs an empty live queue: a queued copy is the Pull's job
  if p_at is null and cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'pull_instead'); end if;
  v_before := public.desk_date_image(p_draft);
  begin
    v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_at);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  select * into a from public.carousel_drafts where id = p_draft;
  v_applied := public.desk_date_image(p_draft);
  return jsonb_build_object('ok', true, 'before', d.scheduled_at, 'applied', a.scheduled_at, 'applied_status', a.status,
                            'applied_updated_at', a.updated_at, 'before_image', v_before, 'applied_image', v_applied, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
CREATE OR REPLACE FUNCTION public.desk_set_photos(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_add_url text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts; v_before jsonb; v_applied jsonb;
begin
  if p_add_url is null or p_add_url = '' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  v_before := public.desk_photo_image(p_draft);
  begin
    v_rpc := public.operator_set_draft_photos('clientops', p_draft, coalesce(d.image_urls, '{}') || p_add_url);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  select * into a from public.carousel_drafts where id = p_draft;
  v_applied := public.desk_photo_image(p_draft);
  return jsonb_build_object('ok', true, 'before', to_jsonb(coalesce(d.image_urls, '{}')), 'applied', to_jsonb(coalesce(a.image_urls, '{}')),
                            'applied_status', a.status, 'applied_updated_at', a.updated_at, 'before_image', v_before, 'applied_image', v_applied, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;
CREATE OR REPLACE FUNCTION public.desk_claim_commit(p_action uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_n int;
begin
  update public.desk_actions set result = jsonb_set(result, '{state}', '"committing"')
   where id = p_action and user_id = p_user and result->>'state' = 'held'
     and (result->>'expires_at') is not null and (result->>'expires_at')::timestamptz > now();
  get diagnostics v_n = row_count;
  return v_n = 1;
end $function$;
CREATE OR REPLACE FUNCTION public.desk_approve(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int;
begin
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
CREATE OR REPLACE FUNCTION public.desk_keep(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
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
CREATE OR REPLACE FUNCTION public.desk_pull(p_draft uuid, p_expected_updated_at timestamp with time zone, p_queue_ids uuid[], p_next_queue uuid, p_next_slot timestamp with time zone, p_reason text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
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
CREATE OR REPLACE FUNCTION public.desk_delete(p_draft uuid, p_expected_updated_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_reason text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 200), '');
begin
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
CREATE OR REPLACE FUNCTION public.desk_redo_claim(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_started_at text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_n int;
begin
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
CREATE OR REPLACE FUNCTION public.desk_redo_release(p_draft uuid, p_started_at text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int;
begin
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
revoke execute on function public.desk_approve(uuid,timestamp with time zone,text,timestamp with time zone) from public, anon;
grant execute on function public.desk_approve(uuid,timestamp with time zone,text,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_date_image(uuid) from public, anon;
grant execute on function public.desk_date_image(uuid) to authenticated, service_role;
revoke execute on function public.desk_delete(uuid,timestamp with time zone,text) from public, anon;
grant execute on function public.desk_delete(uuid,timestamp with time zone,text) to authenticated, service_role;
revoke execute on function public.desk_keep(uuid,timestamp with time zone,text,timestamp with time zone) from public, anon;
grant execute on function public.desk_keep(uuid,timestamp with time zone,text,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_lock_draft(uuid,boolean) from public, anon;
grant execute on function public.desk_lock_draft(uuid,boolean) to authenticated, service_role;
revoke execute on function public.desk_photo_image(uuid) from public, anon;
grant execute on function public.desk_photo_image(uuid) to authenticated, service_role;
revoke execute on function public.desk_pull(uuid,timestamp with time zone,uuid[],uuid,timestamp with time zone,text,timestamp with time zone) from public, anon;
grant execute on function public.desk_pull(uuid,timestamp with time zone,uuid[],uuid,timestamp with time zone,text,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_redo_claim(uuid,timestamp with time zone,text,text,timestamp with time zone) from public, anon;
grant execute on function public.desk_redo_claim(uuid,timestamp with time zone,text,text,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_redo_release(uuid,text,text) from public, anon;
grant execute on function public.desk_redo_release(uuid,text,text) to authenticated, service_role;
revoke execute on function public.desk_set_date(uuid,timestamp with time zone,text,timestamp with time zone,timestamp with time zone) from public, anon;
grant execute on function public.desk_set_date(uuid,timestamp with time zone,text,timestamp with time zone,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_set_photos(uuid,timestamp with time zone,text,text,timestamp with time zone) from public, anon;
grant execute on function public.desk_set_photos(uuid,timestamp with time zone,text,text,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_undo_date_v3(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.desk_undo_date_v3(uuid,jsonb,jsonb) to authenticated, service_role;
revoke execute on function public.desk_undo_photos(uuid,text[],text[]) from public, anon;
grant execute on function public.desk_undo_photos(uuid,text[],text[]) to authenticated, service_role;
revoke execute on function public.desk_undo_photos_v2(uuid,text[],text,timestamp with time zone,text[]) from public, anon;
grant execute on function public.desk_undo_photos_v2(uuid,text[],text,timestamp with time zone,text[]) to authenticated, service_role;
revoke execute on function public.desk_undo_photos_v3(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.desk_undo_photos_v3(uuid,jsonb,jsonb) to authenticated, service_role;
revoke execute on function public.desk_undo_schedule(uuid,timestamp with time zone,timestamp with time zone) from public, anon;
grant execute on function public.desk_undo_schedule(uuid,timestamp with time zone,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_undo_schedule_v2(uuid,timestamp with time zone,text,timestamp with time zone,timestamp with time zone) from public, anon;
grant execute on function public.desk_undo_schedule_v2(uuid,timestamp with time zone,text,timestamp with time zone,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.desk_claim_commit(uuid,uuid) from public, anon, authenticated;
grant execute on function public.desk_claim_commit(uuid,uuid) to service_role;
