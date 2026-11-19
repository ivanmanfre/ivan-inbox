-- Content Desk, Sol desk-backend r13 fixes (2026-11-18), round 14 scope cut.
--
-- 1. Service role only (r13 #4). Every desk forward and undo function executes only for service_role
--    (revoked from public, anon, authenticated). The edge function calls them after its own JWT user check.
--    Each forward function takes p_action: it acts only while that journaled desk_actions row is in the
--    expected state for exactly this draft, and runs as that row's owner (request.jwt.claims set locally to
--    {sub: owner, role: authenticated}), so the app functions it calls (cb39_verdict_set's auth.uid(), the
--    move ledger) see the same identity as before; no caller-supplied identity exists.
-- 2. Immediate kinds (desk_set_date, desk_set_photos) act only on a draft with NO live queue row
--    (pending / queued_v2 / posting), checked under the lock, else 'in_queue'. The app setter then touches
--    only the draft (a retimed queue row rolls the write back). The before and applied images are the whole
--    columns scheduled_at, status, taxonomy (the full jsonb: photo_options, no_photo and hand_dated_at are
--    keys of it), image_urls (raw, null kept), stored by the SQL itself on the action row (undo.op draft_v4).
-- 3. desk_undo(p_action): claims the owned row done -> undoing, loads target, before and applied from it,
--    requires an empty live queue, and in ONE locked UPDATE compares the current whole columns with applied
--    and restores before. Any refusal rolls the claim back. No queue row is touched.
-- 4. desk_claim_commit returns 'claimed' | 'expired' | 'not_held'; desk_expire_hold cancels a hold only
--    when the DATABASE clock says its deadline passed (or it has no v2 confirmation) and returns the winner.

create or replace function public.desk_act_as(p_action uuid, p_draft uuid, p_states text[])
returns uuid language plpgsql security invoker set search_path = pg_catalog, public as $$
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
end $$;

-- the whole columns an immediate kind changes, in one stable form (timestamps as UTC text)
create or replace function public.desk_draft_image(p_draft uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $$
  select jsonb_build_object('scheduled_at', to_jsonb(d.scheduled_at at time zone 'UTC'), 'status', to_jsonb(d.status),
                            'taxonomy', coalesce(to_jsonb(d.taxonomy), 'null'::jsonb), 'image_urls', coalesce(to_jsonb(d.image_urls), 'null'::jsonb))
    from public.carousel_drafts d where d.id = p_draft
$$;

drop function if exists public.desk_set_date(uuid, timestamptz, text, timestamptz, timestamptz);
create or replace function public.desk_set_date(p_action uuid, p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text,
                                     p_at timestamptz, p_expected_scheduled_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
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
end $$;

drop function if exists public.desk_set_photos(uuid, timestamptz, text, text, timestamptz);
create or replace function public.desk_set_photos(p_action uuid, p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text,
                                       p_add_url text, p_expected_scheduled_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
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
end $$;

-- the exact undo of an immediate draft write: only the action id; everything else comes from the owned row
create or replace function public.desk_undo(p_action uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
declare r public.desk_actions; b jsonb; ap jsonb; d public.carousel_drafts; v_n int; v_draft uuid;
begin
  begin
    update public.desk_actions set result = jsonb_set(coalesce(result, '{}'::jsonb), '{state}', '"undoing"')
     where id = p_action and result->>'state' = 'done' and undone_at is null and undo->>'op' = 'draft_v4'
     returning * into r;
    if r.id is null then raise exception 'nothing_to_undo'; end if;
    v_draft := r.target_id::uuid; b := r.undo->'before'; ap := r.undo->'applied';
    if v_draft is null or (r.undo->>'draft_id') is distinct from v_draft::text or b is null or ap is null then raise exception 'nothing_to_undo'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    d := public.desk_lock_draft(v_draft);
    if d.id is null then raise exception 'gone'; end if;
    if cardinality(public.desk_queue_ids(v_draft)) > 0 then raise exception 'in_queue'; end if;
    -- the same manual-date context the calendar's own setter uses (weekday guard, claim gap, move ledger)
    perform set_config('app.schedule_manual', 'on', true);
    -- ONE statement: the current whole columns must equal the applied image, then before comes back whole
    update public.carousel_drafts c
       set scheduled_at = (b->>'scheduled_at')::timestamp at time zone 'UTC',
           status = b->>'status',
           taxonomy = case when jsonb_typeof(b->'taxonomy') = 'null' then null else b->'taxonomy' end,
           image_urls = case when jsonb_typeof(b->'image_urls') = 'array' then array(select jsonb_array_elements_text(b->'image_urls')) else null end
     where c.id = v_draft and c.client_id is null and public.desk_draft_image(c.id) = ap;
    get diagnostics v_n = row_count;
    perform set_config('app.schedule_manual', '', true);
    if v_n <> 1 then raise exception 'changed_since'; end if;
    if public.desk_draft_image(v_draft) is distinct from b then raise exception 'undo_failed'; end if;
    update public.desk_actions set result = jsonb_set(result, '{state}', '"undone"'), undone_at = now() where id = p_action;
    return jsonb_build_object('ok', true, 'draft_id', v_draft);
  exception
    -- every refusal rolls this block back, the done -> undoing claim included
    when lock_not_available or deadlock_detected then return jsonb_build_object('ok', false, 'error', 'changed_since');
    when raise_exception then
      return jsonb_build_object('ok', false, 'error', case when sqlerrm in ('nothing_to_undo', 'gone', 'in_queue', 'changed_since') then sqlerrm else 'undo_failed' end);
    when others then return jsonb_build_object('ok', false, 'error', 'undo_failed');
  end;
end $$;

drop function if exists public.desk_claim_commit(uuid, uuid);
create or replace function public.desk_claim_commit(p_action uuid, p_user uuid)
returns text language plpgsql security invoker set search_path = pg_catalog, public as $$
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
end $$;

-- held -> cancelled only when the DATABASE clock says the deadline passed, or the hold has no v2 confirmation
create or replace function public.desk_expire_hold(p_action uuid, p_user uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
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
end $$;

drop function if exists public.desk_approve(uuid, timestamptz, text, timestamptz);
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

drop function if exists public.desk_keep(uuid, timestamptz, text, timestamptz);
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

drop function if exists public.desk_pull(uuid, timestamptz, uuid[], uuid, timestamptz, text, timestamptz);
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

drop function if exists public.desk_delete(uuid, timestamptz, text);
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

drop function if exists public.desk_redo_claim(uuid, timestamptz, text, text, timestamptz);
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

drop function if exists public.desk_redo_release(uuid, text, text);
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

-- service role only: every desk forward and undo function, its lock and image helpers, and the older undo versions
revoke execute on function public.desk_act_as(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.desk_act_as(uuid, uuid, text[]) to service_role;
revoke execute on function public.desk_draft_image(uuid) from public, anon, authenticated;
grant execute on function public.desk_draft_image(uuid) to service_role;
revoke execute on function public.desk_set_date(uuid, uuid, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_set_date(uuid, uuid, timestamptz, text, timestamptz, timestamptz) to service_role;
revoke execute on function public.desk_set_photos(uuid, uuid, timestamptz, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_set_photos(uuid, uuid, timestamptz, text, text, timestamptz) to service_role;
revoke execute on function public.desk_undo(uuid) from public, anon, authenticated;
grant execute on function public.desk_undo(uuid) to service_role;
revoke execute on function public.desk_claim_commit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.desk_claim_commit(uuid, uuid) to service_role;
revoke execute on function public.desk_expire_hold(uuid, uuid) from public, anon, authenticated;
grant execute on function public.desk_expire_hold(uuid, uuid) to service_role;
revoke execute on function public.desk_approve(uuid, uuid, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_approve(uuid, uuid, timestamptz, text, timestamptz) to service_role;
revoke execute on function public.desk_keep(uuid, uuid, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_keep(uuid, uuid, timestamptz, text, timestamptz) to service_role;
revoke execute on function public.desk_pull(uuid, uuid, timestamptz, uuid[], uuid, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_pull(uuid, uuid, timestamptz, uuid[], uuid, timestamptz, text, timestamptz) to service_role;
revoke execute on function public.desk_delete(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.desk_delete(uuid, uuid, timestamptz, text) to service_role;
revoke execute on function public.desk_redo_claim(uuid, uuid, timestamptz, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_redo_claim(uuid, uuid, timestamptz, text, text, timestamptz) to service_role;
revoke execute on function public.desk_redo_release(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.desk_redo_release(uuid, uuid, text, text) to service_role;
revoke execute on function public.desk_lock_draft(uuid, boolean) from public, anon, authenticated;
grant execute on function public.desk_lock_draft(uuid, boolean) to service_role;
revoke execute on function public.desk_date_image(uuid) from public, anon, authenticated;
grant execute on function public.desk_date_image(uuid) to service_role;
revoke execute on function public.desk_photo_image(uuid) from public, anon, authenticated;
grant execute on function public.desk_photo_image(uuid) to service_role;
revoke execute on function public.desk_undo_date_v3(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.desk_undo_date_v3(uuid, jsonb, jsonb) to service_role;
revoke execute on function public.desk_undo_photos_v3(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.desk_undo_photos_v3(uuid, jsonb, jsonb) to service_role;
revoke execute on function public.desk_undo_photos_v2(uuid, text[], text, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.desk_undo_photos_v2(uuid, text[], text, timestamptz, text[]) to service_role;
revoke execute on function public.desk_undo_photos(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.desk_undo_photos(uuid, text[], text[]) to service_role;
revoke execute on function public.desk_undo_schedule_v2(uuid, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_undo_schedule_v2(uuid, timestamptz, text, timestamptz, timestamptz) to service_role;
revoke execute on function public.desk_undo_schedule(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.desk_undo_schedule(uuid, timestamptz, timestamptz) to service_role;
