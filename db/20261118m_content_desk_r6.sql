-- Content Desk, Sol desk-backend r5 fixes (2026-11-18): every desk draft write takes the publisher's locks first.
--
-- One pattern for every write the desk makes to one of Ivan's drafts (date, photos, pull, approve,
-- Brain Keep, delete, and both undos):
--   1. desk_lock_draft: the account advisory lock ('content-plan:ivan'), then every linked queue row
--      FOR UPDATE, then the draft FOR UPDATE. This is the order the publisher claim and
--      content_owner_pull_ivan use, so the desk can neither deadlock with them nor slip between them.
--   2. Check, under those locks: the draft id, Ivan's lane (client_id null), status and
--      updated_at = what was authorized (for a pull also the exact live queue set and Next row),
--      and refuse when any linked queue row is 'posting'.
--   3. Only then run the app's own write (the app RPC, or for approve the same UPDATE as the app
--      button). An app RPC that raises is caught in a subtransaction, so nothing it did survives,
--      and the desk gets a code, never database text.
-- All functions are SECURITY INVOKER: they run as Ivan's session (his JWT), like the app's buttons.
-- The account lock is reentrant inside one transaction, so app RPCs that take it again do not block.

create or replace function public.desk_lock_draft(p_draft uuid, p_cb39 boolean default false)
returns public.carousel_drafts
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare d public.carousel_drafts;
begin
  perform pg_advisory_xact_lock(hashtextextended('content-plan:ivan', 0));
  -- Brain Keep: cb39_verdict_set takes its per-draft lock before the draft row; take it here, before
  -- the row, so an app Keep and the desk Keep wait in the same order
  if p_cb39 then perform pg_advisory_xact_lock(hashtextextended('cb39-verdict:' || p_draft::text, 0)); end if;
  perform 1 from public.scheduled_posts where clickup_task_id = p_draft::text order by id for update;
  select * into d from public.carousel_drafts where id = p_draft and client_id is null for update;
  return d;
end $$;

-- the live queue set of a draft (what a pull or delete must see unchanged)
create or replace function public.desk_queue_ids(p_draft uuid)
returns uuid[]
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(q.id order by q.id), '{}') from public.scheduled_posts q
   where q.clickup_task_id = p_draft::text and q.status in ('pending', 'queued_v2', 'posting')
$$;

create or replace function public.desk_posting(p_draft uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.scheduled_posts q where q.clickup_task_id = p_draft::text and q.status = 'posting')
$$;

create or replace function public.desk_set_date(p_draft uuid, p_expected_updated_at timestamptz,
                                                p_expected_status text, p_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  -- removing the date from a scheduled post is a pull (desk_pull), never this path
  if p_at is null and d.status = 'scheduled' then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  begin
    v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_at);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  select * into a from public.carousel_drafts where id = p_draft;
  return jsonb_build_object('ok', true, 'before', d.scheduled_at, 'applied', a.scheduled_at, 'applied_status', a.status,
                            'applied_updated_at', a.updated_at, 'rpc', v_rpc);
end $$;

create or replace function public.desk_set_photos(p_draft uuid, p_expected_updated_at timestamptz,
                                                  p_expected_status text, p_add_url text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts; v_before text[];
begin
  if p_add_url is null or p_add_url = '' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  v_before := coalesce(d.image_urls, '{}');
  begin
    v_rpc := public.operator_set_draft_photos('clientops', p_draft, v_before || p_add_url);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  select * into a from public.carousel_drafts where id = p_draft;
  return jsonb_build_object('ok', true, 'before', to_jsonb(v_before), 'applied', to_jsonb(coalesce(a.image_urls, '{}')),
                            'applied_status', a.status, 'applied_updated_at', a.updated_at, 'rpc', v_rpc);
end $$;

-- Held pull (p_next_queue set: the Next row's own pull with his reason) and scheduled "remove the date"
-- (p_next_queue null: the calendar's Remove date). Both need the exact live queue set the desk authorized.
create or replace function public.desk_pull(p_draft uuid, p_expected_updated_at timestamptz, p_queue_ids uuid[],
                                            p_next_queue uuid, p_next_slot timestamptz, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at or d.status is distinct from 'scheduled' then
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
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'rpc', v_rpc);
end $$;

-- Approve: the app button's own UPDATE, only on the revision that was authorized.
create or replace function public.desk_approve(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare d public.carousel_drafts; v_n int;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error') then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  update public.carousel_drafts set status = 'approved'
   where id = p_draft and client_id is null and status = p_expected_status and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  return jsonb_build_object('ok', true, 'approved', p_draft);
end $$;

-- Brain Keep: the same checks, then the app's own keep RPC.
create or replace function public.desk_keep(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft, true);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error') then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  begin
    v_rpc := public.cb39_verdict_set(p_draft, 'keep', '{}'::text[], null, null, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'rpc', v_rpc);
end $$;

-- Delete: only an undated draft in review/error with no live queue copy, on the authorized revision.
-- The reason is stamped first (the deletion audit keeps it); if the delete itself fails, the row is
-- archived as disqualified instead, as the app's deleteDraft does.
create or replace function public.desk_delete(p_draft uuid, p_expected_updated_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
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
    null;   -- the delete and anything it did are rolled back; archive below
  end;
  update public.carousel_drafts
     set status = 'disqualified', taxonomy = v_tax || jsonb_build_object('deleted_by_operator', true, 'deleted_at', now())
   where id = p_draft;
  return jsonb_build_object('ok', true, 'outcome', 'disqualified');
end $$;

-- Undo (same signatures as r4): the same locks first, and never while a copy is publishing.
create or replace function public.desk_undo_schedule_v2(p_draft uuid, p_applied timestamptz, p_applied_status text,
                                                        p_applied_updated_at timestamptz, p_prev timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if d.scheduled_at is distinct from p_applied or d.status is distinct from p_applied_status or d.updated_at is distinct from p_applied_updated_at then
    return jsonb_build_object('ok', false, 'error', 'changed_since');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  begin
    v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_prev);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'undo_failed'));
  end;
  return v_rpc;
end $$;

create or replace function public.desk_undo_photos_v2(p_draft uuid, p_applied text[], p_applied_status text,
                                                      p_applied_updated_at timestamptz, p_prev text[])
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if coalesce(d.image_urls, '{}') is distinct from coalesce(p_applied, '{}') or d.status is distinct from p_applied_status
     or d.updated_at is distinct from p_applied_updated_at then
    return jsonb_build_object('ok', false, 'error', 'changed_since');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  begin
    v_rpc := public.operator_set_draft_photos('clientops', p_draft, coalesce(p_prev, '{}'));
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'undo_failed'));
  end;
  return v_rpc;
end $$;

revoke all on function public.desk_lock_draft(uuid, boolean) from public, anon;
grant execute on function public.desk_lock_draft(uuid, boolean) to authenticated;
revoke all on function public.desk_queue_ids(uuid) from public, anon;
grant execute on function public.desk_queue_ids(uuid) to authenticated;
revoke all on function public.desk_posting(uuid) from public, anon;
grant execute on function public.desk_posting(uuid) to authenticated;
revoke all on function public.desk_pull(uuid, timestamptz, uuid[], uuid, timestamptz, text) from public, anon;
grant execute on function public.desk_pull(uuid, timestamptz, uuid[], uuid, timestamptz, text) to authenticated;
revoke all on function public.desk_approve(uuid, timestamptz, text) from public, anon;
grant execute on function public.desk_approve(uuid, timestamptz, text) to authenticated;
revoke all on function public.desk_keep(uuid, timestamptz, text) from public, anon;
grant execute on function public.desk_keep(uuid, timestamptz, text) to authenticated;
revoke all on function public.desk_delete(uuid, timestamptz, text) from public, anon;
grant execute on function public.desk_delete(uuid, timestamptz, text) to authenticated;
revoke all on function public.desk_set_date(uuid, timestamptz, text, timestamptz) from public, anon;
grant execute on function public.desk_set_date(uuid, timestamptz, text, timestamptz) to authenticated;
revoke all on function public.desk_set_photos(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.desk_set_photos(uuid, timestamptz, text, text) to authenticated;
revoke all on function public.desk_undo_schedule_v2(uuid, timestamptz, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.desk_undo_schedule_v2(uuid, timestamptz, text, timestamptz, timestamptz) to authenticated;
revoke all on function public.desk_undo_photos_v2(uuid, text[], text, timestamptz, text[]) from public, anon;
grant execute on function public.desk_undo_photos_v2(uuid, text[], text, timestamptz, text[]) to authenticated;
