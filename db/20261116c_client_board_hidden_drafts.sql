-- 20261116c: client boards stop listing or editing drafts the board cannot see.
--
-- Found 11-15 (owner-rights lock review): client_board_schedule(_v2) listed every scheduled review/scheduled
-- draft of the board's client, including drafts we hid from the board (board_visible false, not on the queue),
-- and client_board_edit_draft(_v2) let an approver read or overwrite one by id.
-- Now a draft must be on the board queue or board_visible true. Checked 11-16: all 21 scheduled client drafts
-- (arch 6, risedtc 9, swishdm 6) are board_visible and on their queue, so nothing a client sees today changes.
-- Readers (who-reads 11-16): personal-site ClientBoardPage + board-app api.ts; public_key_surface_check (by
-- signature, unchanged). Signatures and grants unchanged (CREATE OR REPLACE).
-- Rollback: 20261116c_client_board_hidden_drafts_rollback.sql

begin;
set local lock_timeout = '10s';
grant execute on function public.client_board_edit_draft(text,text,uuid,text) to postgres;
grant execute on function public.client_board_edit_draft_v2(text,text,uuid,text,text) to postgres;
grant execute on function public.client_board_schedule(text,text) to postgres;
grant execute on function public.client_board_schedule_v2(text,text) to postgres;
do $guard$
declare got text;
begin
  got := md5(pg_get_functiondef('public.client_board_edit_draft(text,text,uuid,text)'::regprocedure));
  if got is distinct from 'c4ddbb556716d43ccb974842c4860130' then raise exception 'client_board_edit_draft is not the expected version (md5 %): refused', got; end if;
  got := md5(pg_get_functiondef('public.client_board_edit_draft_v2(text,text,uuid,text,text)'::regprocedure));
  if got is distinct from 'c958480b67a499865248f45115cedaa5' then raise exception 'client_board_edit_draft_v2 is not the expected version (md5 %): refused', got; end if;
  got := md5(pg_get_functiondef('public.client_board_schedule(text,text)'::regprocedure));
  if got is distinct from '35065c65e9289236c821fad1e6a4acc5' then raise exception 'client_board_schedule is not the expected version (md5 %): refused', got; end if;
  got := md5(pg_get_functiondef('public.client_board_schedule_v2(text,text)'::regprocedure));
  if got is distinct from '550f781610470f116aaf68d13a3df982' then raise exception 'client_board_schedule_v2 is not the expected version (md5 %): refused', got; end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.client_board_edit_draft(p_slug text, p_token text, p_draft_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_board public.client_boards%rowtype; v_old text;
begin
  select * into v_board from public.client_boards
   where slug = p_slug and token = p_token and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_body is null or length(p_body) < 20 or length(p_body) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body'); end if;
  select post_body into v_old from public.carousel_drafts
   where id = p_draft_id and client_id = v_board.client_id and status in ('review', 'scheduled')
     -- 20261116c: only a draft the board can see (on its queue, or marked board_visible) is editable.
     and (board_visible is true or p_draft_id::text in (select q->>'id' from jsonb_array_elements(coalesce(v_board.board->'queue','[]'::jsonb)) q));
  if not found then return jsonb_build_object('ok', false, 'error', 'draft_not_editable'); end if;
  perform set_config('app.body_edit_via', 'board', true);
  update public.carousel_drafts set post_body = p_body, updated_at = now() where id = p_draft_id;
  perform set_config('app.body_edit_via', '', true);
  update public.client_boards set board = jsonb_set(board, '{queue}', coalesce((
      select jsonb_agg(case when (q->>'id') = p_draft_id::text
        then jsonb_set(jsonb_set(q, '{post_body}', to_jsonb(p_body)), '{body}', to_jsonb(p_body))
        else q end)
      from jsonb_array_elements(board->'queue') q), board->'queue'))
    where slug = p_slug;
  insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
  values (p_slug, v_board.client_id, 'edit_copy', p_draft_id::text,
          jsonb_build_object('applied', true, 'before', v_old, 'after', p_body));
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.client_board_edit_draft_v2(p_slug text, p_session text, p_draft_id uuid, p_body text, p_base text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_hash text; v_email text; v_board public.client_boards%rowtype; v_old text;
begin
  if coalesce(p_session, '') = '' then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  v_hash := encode(digest(p_session, 'sha256'), 'hex');
  select email into v_email from public.client_board_sessions
   where slug = p_slug and token_hash = v_hash and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  update public.client_board_sessions set last_seen_at = now() where slug = p_slug and token_hash = v_hash;
  if public._board_member_role(p_slug, v_email) = 'viewer' then return jsonb_build_object('ok', false, 'error', 'view_only'); end if;
  select * into v_board from public.client_boards
   where slug = p_slug and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_body is null or length(p_body) < 20 or length(p_body) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body'); end if;
  select post_body into v_old from public.carousel_drafts
   where id = p_draft_id and client_id = v_board.client_id and status in ('review', 'scheduled')
     -- 20261116c: only a draft the board can see (on its queue, or marked board_visible) is editable.
     and (board_visible is true or p_draft_id::text in (select q->>'id' from jsonb_array_elements(coalesce(v_board.board->'queue','[]'::jsonb)) q));
  if not found then return jsonb_build_object('ok', false, 'error', 'draft_not_editable'); end if;
  -- 2026-10-08: the copy the client started editing from. If it is no longer the post's copy (Ivan
  -- edited it in the inbox meanwhile), refuse instead of silently putting the old text back.
  if p_base is not null and btrim(p_base) is distinct from btrim(coalesce(v_old, '')) then
    return jsonb_build_object('ok', false, 'error', 'changed_meanwhile', 'current', v_old);
  end if;
  perform set_config('app.body_edit_via', 'board', true);
  update public.carousel_drafts set post_body = p_body, updated_at = now() where id = p_draft_id;
  perform set_config('app.body_edit_via', '', true);
  update public.client_boards set board = jsonb_set(board, '{queue}', coalesce((
      select jsonb_agg(case when (q->>'id') = p_draft_id::text
        then jsonb_set(jsonb_set(q, '{post_body}', to_jsonb(p_body)), '{body}', to_jsonb(p_body))
        else q end)
      from jsonb_array_elements(board->'queue') q), board->'queue'))
    where slug = p_slug;
  insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
  values (p_slug, v_board.client_id, 'edit_copy', p_draft_id::text,
          jsonb_build_object('applied', true, 'before', v_old, 'after', p_body, 'by', v_email));
  return jsonb_build_object('ok', true);
end
$function$;

CREATE OR REPLACE FUNCTION public.client_board_schedule(p_slug text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare v_board public.client_boards%rowtype; v_items jsonb;
begin
  select * into v_board from public.client_boards
   where slug = p_slug and token = p_token and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', cd.id, 'status', cd.status, 'scheduled_at', cd.scheduled_at, 'funnel_stage', cd.funnel_stage, 'funnel_source', cd.funnel_source, 'title', cd.title)), '[]'::jsonb)
    into v_items
    from public.carousel_drafts cd
   where cd.client_id = v_board.client_id
     and (cd.id::text in (select q->>'id' from jsonb_array_elements(coalesce(v_board.board->'queue','[]'::jsonb)) q)
          or (cd.scheduled_at is not null and cd.status in ('review','scheduled') and cd.board_visible is true));
  -- 20261116c: a scheduled draft shows only when it is on the board queue or marked board_visible.
  return jsonb_build_object('ok', true, 'items', v_items);
end $function$;

CREATE OR REPLACE FUNCTION public.client_board_schedule_v2(p_slug text, p_session text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare v_hash text; v_board public.client_boards%rowtype; v_items jsonb;
begin
  if coalesce(p_session, '') = '' then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  v_hash := encode(digest(p_session, 'sha256'), 'hex');
  perform 1 from public.client_board_sessions
   where slug = p_slug and token_hash = v_hash and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  update public.client_board_sessions set last_seen_at = now() where slug = p_slug and token_hash = v_hash;
  select * into v_board from public.client_boards
   where slug = p_slug and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', cd.id, 'status', cd.status, 'scheduled_at', cd.scheduled_at, 'funnel_stage', cd.funnel_stage, 'funnel_source', cd.funnel_source, 'title', cd.title)), '[]'::jsonb)
    into v_items
    from public.carousel_drafts cd
   where cd.client_id = v_board.client_id
     and (cd.id::text in (select q->>'id' from jsonb_array_elements(coalesce(v_board.board->'queue','[]'::jsonb)) q)
          or (cd.scheduled_at is not null and cd.status in ('review','scheduled') and cd.board_visible is true));
  -- 20261116c: a scheduled draft shows only when it is on the board queue or marked board_visible.
  return jsonb_build_object('ok', true, 'items', v_items);
end $function$;

commit;
