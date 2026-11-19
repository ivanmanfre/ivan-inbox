-- Rollback for 20261119a: restore desk_approve, desk_delete, desk_pull and desk_undo as they were live before it
-- (pg_get_functiondef on 2026-11-19), then drop the three new helpers. Undo receipts with op pull_v1 written
-- meanwhile stay on their rows; the old desk_undo does not claim them, so they read as nothing to undo.

CREATE OR REPLACE FUNCTION public.desk_approve(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
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
  perform public.desk_mark_done(p_action, p_claim); return jsonb_build_object('ok', true, 'approved', p_draft);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_delete(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_reason text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 200), '');
begin
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
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
    if found then perform public.desk_mark_done(p_action, p_claim); return jsonb_build_object('ok', true, 'outcome', 'deleted'); end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    null;   -- the delete and anything it did are rolled back; archive below
  end;
  update public.carousel_drafts
     set status = 'disqualified', taxonomy = v_tax || jsonb_build_object('deleted_by_operator', true, 'deleted_at', now())
   where id = p_draft;
  perform public.desk_mark_done(p_action, p_claim); return jsonb_build_object('ok', true, 'outcome', 'disqualified');
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_pull(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_queue_ids uuid[], p_next_queue uuid, p_next_slot timestamp with time zone, p_reason text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
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
  perform public.desk_mark_done(p_action, p_claim); return jsonb_build_object('ok', true, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_undo(p_action uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare r public.desk_actions; b jsonb; ap jsonb; d public.carousel_drafts; v_n int; v_draft uuid; v_rev timestamptz; v_keys text[];
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
    -- round 21: the fields the forward write changed (before vs applied), never qa
    v_keys := array(select k from jsonb_object_keys(b) k
                     where k not in ('qa', 'qa_is_null') and (b -> k) is distinct from (ap -> k));
    if 'taxonomy_is_null' = any(v_keys) and not ('taxonomy' = any(v_keys)) then v_keys := array_append(v_keys, 'taxonomy'); end if;
    perform set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    d := public.desk_lock_draft(v_draft);
    if d.id is null then raise exception 'gone'; end if;
    if cardinality(public.desk_queue_ids(v_draft)) > 0 then raise exception 'in_queue'; end if;
    perform set_config('app.schedule_manual', 'on', true);
    -- ONE statement: the applied revision AND the applied whole columns must both still hold
    update public.carousel_drafts c
       set scheduled_at = case when 'scheduled_at' = any(v_keys) then (b->>'scheduled_at')::timestamp at time zone 'UTC' else c.scheduled_at end,
           status = case when 'status' = any(v_keys) then b->>'status' else c.status end,
           taxonomy = case when 'taxonomy' = any(v_keys) then case when (b->>'taxonomy_is_null')::boolean then null else b->'taxonomy' end else c.taxonomy end,
           image_urls = case when 'image_urls' = any(v_keys)
                             then case when jsonb_typeof(b->'image_urls') = 'array' then array(select jsonb_array_elements_text(b->'image_urls')) else null end
                             else c.image_urls end,
           -- qa comes back from the before-image when the receipt has it (older receipts leave qa as it is)
           qa = case when b ? 'qa' then case when (b->>'qa_is_null')::boolean then null else b->'qa' end else c.qa end
     where c.id = v_draft and c.client_id is null and c.updated_at = v_rev
       -- ONE statement: the applied revision and every changed field still at its applied value (qa never compared)
       and coalesce((select bool_and((public.desk_draft_image(c.id) -> k) is not distinct from (ap -> k)) from unnest(v_keys) k), true);
    get diagnostics v_n = row_count;
    perform set_config('app.schedule_manual', '', true);
    if v_n <> 1 then raise exception 'changed_since'; end if;
    -- the guard: a queue row that appeared during the restore rolls it all back
    if cardinality(public.desk_queue_ids(v_draft)) > 0 then raise exception 'changed_since'; end if;
    -- every changed field is back at its before value (qa is not verified: a trigger may stamp it during the restore)
    if not coalesce((select bool_and((public.desk_draft_image(v_draft) -> k) is not distinct from (b -> k)) from unnest(v_keys) k), true) then raise exception 'undo_failed'; end if;
    update public.desk_actions set result = jsonb_set(result, '{state}', '"undone"'), undone_at = now() where id = p_action;
    return jsonb_build_object('ok', true, 'draft_id', v_draft);
  exception
    when lock_not_available or deadlock_detected then return jsonb_build_object('ok', false, 'error', 'changed_since');
    when raise_exception then
      return jsonb_build_object('ok', false, 'error', case when sqlerrm in ('nothing_to_undo', 'gone', 'in_queue', 'changed_since') then sqlerrm else 'undo_failed' end);
    when others then return jsonb_build_object('ok', false, 'error', 'undo_failed');
  end;
end $function$;

DROP FUNCTION IF EXISTS public.desk_undo_pull_v1(uuid, jsonb);
DROP FUNCTION IF EXISTS public.desk_pull_image(uuid);
DROP FUNCTION IF EXISTS public.desk_done_with_undo(uuid, uuid, uuid, jsonb);
