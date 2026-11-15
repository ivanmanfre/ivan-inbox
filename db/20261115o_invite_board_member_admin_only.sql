BEGIN;

-- 20261115o_invite_board_member_admin_only: a public client-board function let any signed-in board member widen who
-- can sign in.
--
-- Found in the cross-review of the 2026-11-15 function lock. invite_board_member(p_slug, p_session, p_email) is one of
-- the client-board functions the public key may call on purpose; it checks the board session and then adds the email
-- to the board's sign-in allow-list (client_registry.platform -> board.auth.allowed_emails, 10 at most). It never
-- checked the caller's role. A member with the viewer role could add an address of their own, sign in through it, and
-- come back with the default approver role, which may approve, edit and schedule posts.
-- board_team_add_v2, which the current board uses for the same job, already answers admin_only unless
-- _board_member_role(slug, caller) is admin. This adds the same check. Nothing else in the function changes; its
-- grants stay as they are (CREATE OR REPLACE keeps them).
-- Callers: no current code. Only older built board bundles under inboundonsteroids-site scan/assets name it; 0 calls
-- by any role in 7 days of logs. An admin who still reached it would be let through as before.
-- Rollback: 20261115o_invite_board_member_admin_only_rollback.sql

CREATE OR REPLACE FUNCTION public.invite_board_member(p_slug text, p_session text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash    text;
  v_inviter text;
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_client  text;
  v_list    jsonb;
begin
  -- 1. Session auth — identical checks to client_board_action_v2.
  if coalesce(p_session, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  v_hash := encode(digest(p_session, 'sha256'), 'hex');

  select email into v_inviter
  from public.client_board_sessions
  where slug = p_slug
    and token_hash = v_hash
    and revoked_at is null
    and expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  update public.client_board_sessions set last_seen_at = now()
    where slug = p_slug and token_hash = v_hash;

  -- 1b. Only a board admin may change who can sign in (the rule board_team_add_v2 already applies).
  if public._board_member_role(p_slug, v_inviter) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', 'admin_only');
  end if;

  -- 2. Email validation (mirror the edge fn's shape check).
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;

  -- 3. Lock the registry row (concurrent invites must not clobber each other),
  --    require magic_link armed (invites are meaningless without the email door).
  select r.client_id,
         coalesce(r.platform->'board'->'auth'->'allowed_emails', '[]'::jsonb)
  into v_client, v_list
  from public.client_registry r
  where r.platform->'board'->>'slug' = p_slug
    and coalesce((r.platform->'board'->'auth'->>'magic_link') = 'true', false)
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  -- 4. Dedup (idempotent) + hard cap.
  if exists (
    select 1 from jsonb_array_elements_text(v_list) e where lower(trim(e)) = v_email
  ) then
    return jsonb_build_object('ok', true, 'already_member', true, 'allowed_emails', v_list);
  end if;
  if jsonb_array_length(v_list) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'list_full');
  end if;

  v_list := v_list || to_jsonb(v_email);
  update public.client_registry
    set platform = jsonb_set(platform, '{board,auth,allowed_emails}', v_list)
    where client_id = v_client;

  -- 5. Record the invite (operator audit trail).
  insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
  values (p_slug, v_client, 'invite', v_email,
          jsonb_build_object('invited', v_email, 'invited_by', v_inviter));

  return jsonb_build_object('ok', true, 'already_member', false, 'allowed_emails', v_list);
end;
$function$;

COMMIT;
