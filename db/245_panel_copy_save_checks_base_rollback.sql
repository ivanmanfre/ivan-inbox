drop function if exists public.client_board_edit_draft_v2(text, text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.client_board_edit_draft_v2(p_slug text, p_session text, p_draft_id uuid, p_body text)
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
grant execute on function public.client_board_edit_draft_v2(text, text, uuid, text) to anon, authenticated;
