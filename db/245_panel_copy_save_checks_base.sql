-- The client panel's copy save checks the copy it started from (audit 2026-10-08, gap 2): the save
-- was blind, so a panel open on an old body undid Ivan's inbox edit. p_base is optional, so a panel
-- build that does not send it keeps working exactly as before. Signature change = drop + create.
drop function if exists public.client_board_edit_draft_v2(text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.client_board_edit_draft_v2(p_slug text, p_session text, p_draft_id uuid, p_body text, p_base text DEFAULT NULL)
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
  select * into v_board from public.client_boards
   where slug = p_slug and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_body is null or length(p_body) < 20 or length(p_body) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body'); end if;
  select post_body into v_old from public.carousel_drafts
   where id = p_draft_id and client_id = v_board.client_id and status in ('review', 'scheduled');
  if not found then return jsonb_build_object('ok', false, 'error', 'draft_not_editable'); end if;
  -- 2026-10-08: the copy the client started editing from. If it is no longer the post's copy (Ivan
  -- edited it in the inbox meanwhile), refuse instead of silently putting the old text back.
  if p_base is not null and btrim(p_base) is distinct from btrim(coalesce(v_old, '')) then
    return jsonb_build_object('ok', false, 'error', 'changed_meanwhile', 'current', v_old);
  end if;
  update public.carousel_drafts set post_body = p_body, updated_at = now() where id = p_draft_id;
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
end $function$;
revoke execute on function public.client_board_edit_draft_v2(text, text, uuid, text, text) from public;
grant execute on function public.client_board_edit_draft_v2(text, text, uuid, text, text) to anon, authenticated, service_role;
