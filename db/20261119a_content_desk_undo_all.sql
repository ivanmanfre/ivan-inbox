-- Content Desk 2026-11-19: Undo after "Do it now" for Approve, Delete and Pull.
--
-- Before this, only date, remove date and photo kept an exact Undo. Approve, Pull and Delete ran with
-- none, and Delete was permanent. Now:
--   approve -> the same status write as before; the action row stores the draft's before/applied images
--              (op draft_v4), so the existing desk_undo puts the status (and qa) back exactly.
--              Brain Keep (desk_keep) is unchanged and keeps no Undo: its verdict is a cb39 ledger row.
--   delete  -> the app's archive path (status 'disqualified' + taxonomy.deleted_by_operator, the row
--              leaves every list) instead of the hard DELETE, so it can come back; op draft_v4 again.
--   pull    -> the same content_owner_pull_ivan call; the action row stores a pull_v1 image of the draft,
--              every queue row, the autopilot pick, the owner-pull stamp and the owner keeps (a revoked keep is
--              immutable, so Undo writes the same keep again as its owner). desk_undo
--              restores all of it only while every part still matches what the pull left, and only when
--              the post's time is at least 15 minutes away (the publisher polls every 10 minutes).
-- Every refusal rolls the whole undo back, and the claim on the action row with it.
-- Readers: only the content-desk edge function calls these (service_role); no view, cron or n8n caller.
-- Grants: service_role only, like every desk_* function (CREATE OR REPLACE keeps the existing ACLs).

-- The done receipt with its exact undo images, in the commit's own transaction (desk_set_date does the same inline).
CREATE OR REPLACE FUNCTION public.desk_done_with_undo(p_action uuid, p_claim uuid, p_draft uuid, p_before jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_rev timestamptz; v_n int;
begin
  select updated_at into v_rev from public.carousel_drafts where id = p_draft;
  if v_rev is null or p_before is null then raise exception 'desk_claim_lost'; end if;
  update public.desk_actions
     set undo = jsonb_build_object('op', 'draft_v4', 'draft_id', p_draft, 'before', p_before,
                                   'applied', public.desk_draft_image(p_draft), 'applied_updated_at', v_rev),
         result = coalesce(result, '{}'::jsonb) || jsonb_build_object('state', 'done', 'committed_at', now())
   where id = p_action and target_id = p_draft::text and result->>'state' = 'committing' and result->>'claim_token' = p_claim::text;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'desk_claim_lost'; end if;
end $function$;

-- Everything a pull changes, in one comparable image (UTC text for every instant).
CREATE OR REPLACE FUNCTION public.desk_pull_image(p_draft uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
  select jsonb_build_object(
    'draft', public.desk_draft_image(p_draft),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'status', q.status,
                                 'scheduled_at', to_jsonb(q.scheduled_at at time zone 'UTC'), 'error_message', q.error_message,
                                 -- every other column the publisher reads (copy, format, media, kind, funnel...), nulls kept
                                 'payload_md5', md5((to_jsonb(q) - 'status' - 'error_message' - 'updated_at')::text)) order by q.id)
                         from public.scheduled_posts q where q.clickup_task_id = p_draft::text), '[]'::jsonb),
    'pick', coalesce((select to_jsonb(p) from public.content_autopilot_picks p where p.draft_id = p_draft), 'null'::jsonb),
    'owner_pull', coalesce((select to_jsonb(o) from public.content_owner_pulls o where o.draft_id = p_draft), 'null'::jsonb),
    'keeps', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'revoked_at', to_jsonb(k.revoked_at at time zone 'UTC'), 'row', to_jsonb(k)) order by k.id)
                         from public.content_owner_keeps k where k.draft_id = p_draft), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.desk_approve(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int; v_before jsonb;
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
  v_before := public.desk_draft_image(p_draft);
  update public.carousel_drafts set status = 'approved'
   where id = p_draft and client_id is null and status = p_expected_status and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  -- 2026-11-19: the done receipt carries the exact before/applied images, so Undo puts it back to Review
  perform public.desk_done_with_undo(p_action, p_claim, p_draft, v_before);
  return jsonb_build_object('ok', true, 'approved', p_draft);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_delete(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_before jsonb; v_n int;
        v_reason text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 200), '');
begin
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status not in ('review', 'error') or d.scheduled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'queue_still_live'); end if;
  v_before := public.desk_draft_image(p_draft);
  v_tax := case jsonb_typeof(d.taxonomy)
             when 'object' then d.taxonomy
             when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                     else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
             else '{}'::jsonb end;
  if v_reason is not null then v_tax := v_tax || jsonb_build_object('delete_reason', v_reason); end if;
  -- 2026-11-19: the app's archive path (deleteDraft's fallback), never the hard DELETE, so Undo can bring it back.
  -- status 'disqualified' + deleted_by_operator takes it out of every list the app and the autopilot read.
  update public.carousel_drafts
     set status = 'disqualified', taxonomy = v_tax || jsonb_build_object('deleted_by_operator', true, 'deleted_at', now())
   where id = p_draft and client_id is null and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  perform public.desk_done_with_undo(p_action, p_claim, p_draft, v_before);
  return jsonb_build_object('ok', true, 'outcome', 'disqualified');
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
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; v_before jsonb; v_rev timestamptz; v_n int;
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
  v_before := public.desk_pull_image(p_draft);
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
  -- 2026-11-19: the done receipt carries everything the pull changed (op pull_v1), so Undo can put it back
  select updated_at into v_rev from public.carousel_drafts where id = p_draft;
  update public.desk_actions
     set undo = jsonb_build_object('op', 'pull_v1', 'draft_id', p_draft, 'before', v_before,
                                   'applied', public.desk_pull_image(p_draft), 'applied_updated_at', v_rev),
         result = coalesce(result, '{}'::jsonb) || jsonb_build_object('state', 'done', 'committed_at', now())
   where id = p_action and target_id = p_draft::text and result->>'state' = 'committing' and result->>'claim_token' = p_claim::text;
  get diagnostics v_n = row_count;
  if v_rev is null or v_n <> 1 then raise exception 'desk_claim_lost'; end if;
  return jsonb_build_object('ok', true, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

-- Undo of a pull. Raises a named exception on any refusal; desk_undo maps it and rolls everything back.
CREATE OR REPLACE FUNCTION public.desk_undo_pull_v1(p_draft uuid, p_undo jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare b jsonb := p_undo->'before'; ap jsonb := p_undo->'applied'; v_rev timestamptz := (p_undo->>'applied_updated_at')::timestamptz;
        d public.carousel_drafts; v_n int; v_at timestamptz; q jsonb; k jsonb;
begin
  if b is null or ap is null or v_rev is null or jsonb_typeof(b->'draft') is distinct from 'object'
     or jsonb_typeof(b->'queue') is distinct from 'array' or b->'draft'->>'status' is distinct from 'scheduled' then
    raise exception 'nothing_to_undo';
  end if;
  v_at := (b->'draft'->>'scheduled_at')::timestamp at time zone 'UTC';
  d := public.desk_lock_draft(p_draft);
  if d.id is null then raise exception 'gone'; end if;
  -- everything must still be exactly as the pull left it (the draft's qa aside: a trigger may stamp it)
  if d.updated_at is distinct from v_rev
     or (public.desk_draft_image(p_draft) - 'qa' - 'qa_is_null') is distinct from ((ap->'draft') - 'qa' - 'qa_is_null')
     or (public.desk_pull_image(p_draft) - 'draft') is distinct from (ap - 'draft') then
    raise exception 'changed_since';
  end if;
  if public.desk_posting(p_draft) then raise exception 'changed_since'; end if;
  -- the post must not come back so close to its time that the publisher could take it before Ivan sees the card
  if v_at is null or v_at < now() + interval '15 minutes' then raise exception 'too_late'; end if;
  for q in select * from jsonb_array_elements(b->'queue') loop
    if q->>'status' in ('pending', 'queued_v2', 'posting') then
      if q->>'status' <> 'pending' then raise exception 'changed_since'; end if;
      if ((q->>'scheduled_at')::timestamp at time zone 'UTC') < now() + interval '15 minutes' then raise exception 'too_late'; end if;
    end if;
  end loop;
  perform set_config('app.schedule_manual', 'on', true);
  begin
    update public.carousel_drafts c
       set status = b->'draft'->>'status', scheduled_at = v_at,
           taxonomy = case when (b->'draft'->>'taxonomy_is_null')::boolean then null else b->'draft'->'taxonomy' end
     where c.id = p_draft and c.client_id is null and c.updated_at = v_rev and c.published_at is null;
    get diagnostics v_n = row_count;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;
    raise exception 'slot_taken';   -- a date guard (one a day, weekday, re-run gate) refused the old slot
  end;
  perform set_config('app.schedule_manual', '', true);
  if v_n <> 1 then raise exception 'changed_since'; end if;
  -- the queue rows the pull cancelled come back as they were (same id, same slot, same copy)
  for q in select * from jsonb_array_elements(b->'queue') loop
    update public.scheduled_posts s set status = q->>'status', error_message = q->>'error_message'
     where s.id = (q->>'id')::uuid and s.clickup_task_id = p_draft::text
       and (s.status is distinct from q->>'status' or s.error_message is distinct from q->>'error_message');
  end loop;
  -- the autopilot pick and the owner-pull stamp
  if jsonb_typeof(b->'pick') = 'object' then
    update public.content_autopilot_picks set state = b->'pick'->>'state'
     where draft_id = p_draft and state is distinct from b->'pick'->>'state';
  end if;
  if jsonb_typeof(b->'owner_pull') = 'object' then
    update public.content_owner_pulls
       set was_at = (b->'owner_pull'->>'was_at')::timestamptz, reason = b->'owner_pull'->>'reason',
           actor = b->'owner_pull'->'actor', pulled_at = (b->'owner_pull'->>'pulled_at')::timestamptz
     where draft_id = p_draft;
  else
    delete from public.content_owner_pulls where draft_id = p_draft;
  end if;
  -- an owner keep the pull revoked comes back last (the draft and queue writes above revoke live keeps). A keep is
  -- immutable once revoked (content_owner_keeps_guard), so the same keep is written again, by its owner, as the app does.
  for k in select * from jsonb_array_elements(coalesce(b->'keeps', '[]'::jsonb)) loop
    if jsonb_typeof(k->'revoked_at') = 'null' then
      insert into public.content_owner_keeps (draft_id, queue_id, slot_at, body_sha256, post_format, media_urls, files, actor_uid, kept_at)
      select x.draft_id, x.queue_id, x.slot_at, x.body_sha256, x.post_format, x.media_urls, x.files, x.actor_uid, now()
        from jsonb_populate_record(null::public.content_owner_keeps, k->'row') x
       where x.draft_id = p_draft;
    end if;
  end loop;
  -- every part is back at its before value, or nothing is (a re-written keep is compared by its content)
  if (public.desk_draft_image(p_draft) - 'qa' - 'qa_is_null') is distinct from ((b->'draft') - 'qa' - 'qa_is_null')
     or (public.desk_pull_image(p_draft) - 'draft' - 'keeps') is distinct from (b - 'draft' - 'keeps')
     or (select coalesce(jsonb_agg(to_jsonb(k2) - 'id' - 'kept_at' - 'revoked_at'), '[]'::jsonb)
           from public.content_owner_keeps k2 where k2.draft_id = p_draft and k2.revoked_at is null)
        is distinct from
        (select coalesce(jsonb_agg((x->'row') - 'id' - 'kept_at' - 'revoked_at'), '[]'::jsonb)
           from jsonb_array_elements(coalesce(b->'keeps', '[]'::jsonb)) x where jsonb_typeof(x->'revoked_at') = 'null') then
    raise exception 'undo_failed';
  end if;
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
     where id = p_action and result->>'state' = 'done' and undone_at is null and undo->>'op' in ('draft_v4', 'pull_v1')
     returning * into r;
    if r.id is null then raise exception 'nothing_to_undo'; end if;
    v_draft := r.target_id::uuid;
    if v_draft is null or (r.undo->>'draft_id') is distinct from v_draft::text then raise exception 'nothing_to_undo'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    if r.undo->>'op' = 'pull_v1' then
      -- 2026-11-19: back on the schedule exactly as it was, or nothing changes
      perform public.desk_undo_pull_v1(v_draft, r.undo);
      update public.desk_actions set result = jsonb_set(result, '{state}', '"undone"'), undone_at = now() where id = p_action;
      return jsonb_build_object('ok', true, 'draft_id', v_draft);
    end if;
    b := r.undo->'before'; ap := r.undo->'applied';
    v_rev := (r.undo->>'applied_updated_at')::timestamptz;
    -- an image without its applied revision (before round 15) is never restored
    if b is null or ap is null or v_rev is null or (b ? 'taxonomy_is_null') is not true then raise exception 'nothing_to_undo'; end if;
    -- round 21: the fields the forward write changed (before vs applied), never qa
    v_keys := array(select k from jsonb_object_keys(b) k
                     where k not in ('qa', 'qa_is_null') and (b -> k) is distinct from (ap -> k));
    if 'taxonomy_is_null' = any(v_keys) and not ('taxonomy' = any(v_keys)) then v_keys := array_append(v_keys, 'taxonomy'); end if;
    d := public.desk_lock_draft(v_draft);
    if d.id is null then raise exception 'gone'; end if;
    if cardinality(public.desk_queue_ids(v_draft)) > 0 then raise exception 'in_queue'; end if;
    -- 2026-11-19 (Sol r1): an undo that leaves the post Scheduled (Remove date undone, a scheduled post's move undone)
    -- arms it to publish, so its time must be 15+ minutes away, as for a pull's Undo
    if (case when 'status' = any(v_keys) then b->>'status' else d.status end) = 'scheduled'
       and ('status' = any(v_keys) or 'scheduled_at' = any(v_keys))
       and coalesce((case when 'scheduled_at' = any(v_keys) then (b->>'scheduled_at')::timestamp at time zone 'UTC' else d.scheduled_at end)
                    < now() + interval '15 minutes', true) then
      raise exception 'too_late';
    end if;
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
      return jsonb_build_object('ok', false, 'error', case when sqlerrm in ('nothing_to_undo', 'gone', 'in_queue', 'changed_since', 'too_late', 'slot_taken') then sqlerrm else 'undo_failed' end);
    when others then return jsonb_build_object('ok', false, 'error', 'undo_failed');
  end;
end $function$;

REVOKE ALL ON FUNCTION public.desk_done_with_undo(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_pull_image(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_undo_pull_v1(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_done_with_undo(uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.desk_pull_image(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.desk_undo_pull_v1(uuid, jsonb) TO service_role;
