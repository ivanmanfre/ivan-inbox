-- Content Desk, round 21 (Sol r20).
-- 1. Holds need confirmation v4 (grammar proof 4): desk_expire_hold cancels anything below v4, and the
--    existing pre-v4 held rows are cancelled below, logged (round-19 move cards without year/offset).
-- 2. desk_pull already compares the Next slot with `=` on timestamptz (full precision) under the lock; the edge
--    now passes the SAVED slot text for a converted remove date (no SQL change needed for it).
-- 3. desk_undo compares and restores only the fields the forward write changed (before vs applied), never qa:
--    qa can be stamped by the rerun trigger during the restore itself. qa is restored from the before-image
--    when the receipt has it (the trigger may then stamp it again; that never fails the undo).

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
          or coalesce(args->'_confirm'->>'v', '') <> '4')
   returning case when coalesce(args->'_confirm'->>'v', '') <> '4' then 'stale' else 'expired' end into v_reason;
  if v_reason is not null then return jsonb_build_object('state', 'cancelled', 'reason', v_reason); end if;
  select result->>'state' into v_state from public.desk_actions where id = p_action and user_id = p_user;
  return jsonb_build_object('state', v_state, 'reason', null);
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
    if 'taxonomy_is_null' = any(v_keys) and not ('taxonomy' = any(v_keys)) then v_keys := v_keys || 'taxonomy'; end if;
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

-- cancel every pre-v4 hold, logged: the row and its message echo
do $$
declare r record; n int := 0;
begin
  for r in select id, message_id from public.desk_actions
            where result->>'state' = 'held' and coalesce(args->'_confirm'->>'v', '') <> '4' for update loop
    update public.desk_actions set result = result || jsonb_build_object('state', 'cancelled', 'cancelled_by', 'r21_pre_v4') where id = r.id;
    if r.message_id is not null then
      perform public.desk_patch_action_echo(r.message_id, r.id::text, jsonb_build_object('state', 'cancelled', 'undo', false, 'label', 'Cancelled: this proposal is from an older version. Ask again.'));
    end if;
    raise notice 'r21 cancelled pre-v4 hold %', r.id;
    n := n + 1;
  end loop;
  raise notice 'r21 cancelled % pre-v4 holds', n;
end $$;
