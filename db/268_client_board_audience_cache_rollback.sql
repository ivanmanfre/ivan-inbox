-- db/268 rollback: panels compute the audience payload live again.
select cron.unschedule('audn-board-payload-cache');
CREATE OR REPLACE FUNCTION public.client_board_audience(p_slug text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_board public.client_boards%rowtype;
begin
  select * into v_board from public.client_boards
   where slug = p_slug and token = p_token and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if coalesce(btrim(v_board.client_id), '') = '' then
    return jsonb_build_object('ok', true, 'audience', null);
  end if;
  return jsonb_build_object('ok', true, 'audience', public.audn_board_payload(v_board.client_id));
end;
$function$;


CREATE OR REPLACE FUNCTION public.client_board_audience_v2(p_slug text, p_session text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_hash text; v_board public.client_boards%rowtype;
begin
  if coalesce(p_session, '') = '' then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  v_hash := encode(digest(p_session, 'sha256'), 'hex');
  perform 1 from public.client_board_sessions
   where slug = p_slug and token_hash = v_hash and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select * into v_board from public.client_boards
   where slug = p_slug and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if coalesce(btrim(v_board.client_id), '') = '' then
    return jsonb_build_object('ok', true, 'audience', null);
  end if;
  return jsonb_build_object('ok', true, 'audience', public.audn_board_payload(v_board.client_id));
end;
$function$;


drop function if exists public.audn_board_payload_saved(text);
drop function if exists public.audn_board_payload_cache_refresh();
drop table if exists public.audn_board_payload_cache;
