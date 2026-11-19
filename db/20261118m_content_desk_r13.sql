-- Content Desk, Sol desk-backend r12 fixes (2026-11-18).
--
-- 1. Before-images and exact undo (r12 #4). desk_set_date / desk_set_photos capture, in their locked
--    transaction, the before-image of every field the app setter changes and the applied image after it:
--      date:   the draft's scheduled_at, taxonomy.hand_dated_at, and each live queue row (id, scheduled_at, status)
--      photos: image_urls, taxonomy.photo_options, taxonomy.no_photo
--    desk_undo_date_v3 / desk_undo_photos_v3 take the same locks in the same order, compare the CURRENT
--    image with the applied image, and only then restore the before-image exactly (direct UPDATE of those
--    columns). Any mismatch: 'changed_since', nothing undone.
-- 2. Every immediate kind checks, under the lock, revision, status and the source scheduled_at (photos too);
--    removing a date needs an empty live queue (no pending / queued_v2 / posting row), else 'pull_instead' (r12 #3).
-- 3. desk_approve, desk_keep and desk_redo_claim also compare the confirmed source scheduled_at (r12 #5).
--    Old signatures are dropped, so no desk call can skip it.
-- 4. desk_claim_commit: held -> committing only while expires_at > now(), on the DATABASE clock (r12 #6).
-- 5. desk_live_drafts returns each draft's full first line (r12 #7: the receipt shows it whole).

create or replace function public.desk_date_image(p_draft uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'scheduled_at', d.scheduled_at,
    'hand_dated_at', case when jsonb_typeof(d.taxonomy) = 'object' then d.taxonomy->'hand_dated_at' end,
    'queue', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'scheduled_at', q.scheduled_at, 'status', q.status) order by q.id)
                         from public.scheduled_posts q where q.clickup_task_id = p_draft::text and q.status in ('pending', 'queued_v2', 'posting')), '[]'::jsonb))
  from public.carousel_drafts d where d.id = p_draft
$$;

create or replace function public.desk_photo_image(p_draft uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'image_urls', to_jsonb(coalesce(d.image_urls, '{}')),
    'photo_options', case when jsonb_typeof(d.taxonomy) = 'object' then d.taxonomy->'photo_options' end,
    'no_photo', case when jsonb_typeof(d.taxonomy) = 'object' then d.taxonomy->'no_photo' end)
  from public.carousel_drafts d where d.id = p_draft
$$;

drop function if exists public.desk_set_date(uuid, timestamptz, text, timestamptz, timestamptz);
create function public.desk_set_date(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text,
                                     p_at timestamptz, p_expected_scheduled_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
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
end $$;

drop function if exists public.desk_set_photos(uuid, timestamptz, text, text);
create function public.desk_set_photos(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text,
                                       p_add_url text, p_expected_scheduled_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
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
end $$;

-- exact undo of a date write: current == applied image, then the before-image, all under the locks
create or replace function public.desk_undo_date_v3(p_draft uuid, p_before jsonb, p_applied jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
declare d public.carousel_drafts; q jsonb; v_n int;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if public.desk_date_image(p_draft) is distinct from p_applied then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  -- the same manual-date context the calendar's own setter uses (weekday guard, claim gap)
  perform set_config('app.schedule_manual', 'on', true);
  update public.carousel_drafts
     set scheduled_at = (p_before->>'scheduled_at')::timestamptz,
         taxonomy = case
           when jsonb_typeof(taxonomy) is distinct from 'object' then taxonomy
           when p_before->'hand_dated_at' is null or jsonb_typeof(p_before->'hand_dated_at') = 'null' then taxonomy - 'hand_dated_at'
           else jsonb_set(taxonomy, '{hand_dated_at}', p_before->'hand_dated_at') end
   where id = p_draft and client_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'desk_undo_date_v3: draft % not updated', p_draft; end if;
  for q in select * from jsonb_array_elements(coalesce(p_before->'queue', '[]'::jsonb)) loop
    update public.scheduled_posts set scheduled_at = (q->>'scheduled_at')::timestamptz, status = q->>'status'
     where id = (q->>'id')::uuid and clickup_task_id = p_draft::text;
  end loop;
  perform set_config('app.schedule_manual', '', true);
  if public.desk_date_image(p_draft) is distinct from p_before then raise exception 'desk_undo_date_v3: the before-image did not come back'; end if;
  return jsonb_build_object('ok', true);
exception
  when lock_not_available or deadlock_detected then return jsonb_build_object('ok', false, 'error', 'changed_since');
  when others then return jsonb_build_object('ok', false, 'error', 'undo_failed');
end $$;

-- exact undo of a photo write
create or replace function public.desk_undo_photos_v3(p_draft uuid, p_before jsonb, p_applied jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
declare d public.carousel_drafts; v_n int; v_tax jsonb;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if public.desk_photo_image(p_draft) is distinct from p_applied then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  v_tax := case when jsonb_typeof(d.taxonomy) = 'object' then d.taxonomy else d.taxonomy end;
  if jsonb_typeof(v_tax) = 'object' then
    v_tax := case when p_before->'photo_options' is null or jsonb_typeof(p_before->'photo_options') = 'null' then v_tax - 'photo_options'
                  else jsonb_set(v_tax, '{photo_options}', p_before->'photo_options') end;
    v_tax := case when p_before->'no_photo' is null or jsonb_typeof(p_before->'no_photo') = 'null' then v_tax - 'no_photo'
                  else jsonb_set(v_tax, '{no_photo}', p_before->'no_photo') end;
  end if;
  update public.carousel_drafts
     set image_urls = array(select jsonb_array_elements_text(coalesce(p_before->'image_urls', '[]'::jsonb))), taxonomy = v_tax
   where id = p_draft and client_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'desk_undo_photos_v3: draft % not updated', p_draft; end if;
  if public.desk_photo_image(p_draft) is distinct from p_before then raise exception 'desk_undo_photos_v3: the before-image did not come back'; end if;
  return jsonb_build_object('ok', true);
exception
  when lock_not_available or deadlock_detected then return jsonb_build_object('ok', false, 'error', 'changed_since');
  when others then return jsonb_build_object('ok', false, 'error', 'undo_failed');
end $$;

-- the held actions compare the CONFIRMED source date too
drop function if exists public.desk_approve(uuid, timestamptz, text);
create function public.desk_approve(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text, p_expected_scheduled_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
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
end $$;

drop function if exists public.desk_keep(uuid, timestamptz, text);
create function public.desk_keep(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text, p_expected_scheduled_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
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
end $$;

drop function if exists public.desk_redo_claim(uuid, timestamptz, text, text);
create function public.desk_redo_claim(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text, p_started_at text, p_expected_scheduled_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
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
end $$;

-- the commit claim with the deadline on the database clock
create or replace function public.desk_claim_commit(p_action uuid, p_user uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_n int;
begin
  update public.desk_actions set result = jsonb_set(result, '{state}', '"committing"')
   where id = p_action and user_id = p_user and result->>'state' = 'held'
     and (result->>'expires_at') is not null and (result->>'expires_at')::timestamptz > now();
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

create or replace function public.desk_live_drafts(p_fixtures boolean)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $$
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
$$;

revoke all on function public.desk_date_image(uuid) from public, anon;
grant execute on function public.desk_date_image(uuid) to authenticated;
revoke all on function public.desk_photo_image(uuid) from public, anon;
grant execute on function public.desk_photo_image(uuid) to authenticated;
revoke all on function public.desk_set_date(uuid, timestamptz, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.desk_set_date(uuid, timestamptz, text, timestamptz, timestamptz) to authenticated;
revoke all on function public.desk_set_photos(uuid, timestamptz, text, text, timestamptz) from public, anon;
grant execute on function public.desk_set_photos(uuid, timestamptz, text, text, timestamptz) to authenticated;
revoke all on function public.desk_undo_date_v3(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.desk_undo_date_v3(uuid, jsonb, jsonb) to authenticated;
revoke all on function public.desk_undo_photos_v3(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.desk_undo_photos_v3(uuid, jsonb, jsonb) to authenticated;
revoke all on function public.desk_approve(uuid, timestamptz, text, timestamptz) from public, anon;
grant execute on function public.desk_approve(uuid, timestamptz, text, timestamptz) to authenticated;
revoke all on function public.desk_keep(uuid, timestamptz, text, timestamptz) from public, anon;
grant execute on function public.desk_keep(uuid, timestamptz, text, timestamptz) to authenticated;
revoke all on function public.desk_redo_claim(uuid, timestamptz, text, text, timestamptz) from public, anon;
grant execute on function public.desk_redo_claim(uuid, timestamptz, text, text, timestamptz) to authenticated;
revoke all on function public.desk_claim_commit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.desk_claim_commit(uuid, uuid) to service_role;
