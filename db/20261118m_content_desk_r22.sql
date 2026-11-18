-- Content Desk r22 (Sol r21 P3): desk_undo appends 'taxonomy' with array_append; 'v_keys || text' was read as
-- array concatenation and raised 'malformed array literal' on a SQL NULL vs JSON null taxonomy receipt.
-- Only that line changes; grants are unchanged (CREATE OR REPLACE keeps the ACL).
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
