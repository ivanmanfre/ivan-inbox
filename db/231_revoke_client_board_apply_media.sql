-- 231 — close the anon door on _client_board_apply_media (content-images-2026-09-29).
--
-- 🔴 NOT APPLIED. OPTIONAL, SEPARATE FROM 230, for the lead to decide.
--
-- Found while writing 230 (read-only catalog check, 2026-09-29):
--   has_function_privilege('anon', '_client_board_apply_media(...)', 'EXECUTE') = true
-- The function is the INNER half of client_board_set_media(_v2): it trusts its
-- v_board argument and never checks a token. PostgREST exposes it as
-- /rpc/_client_board_apply_media, so anyone holding the public anon key can pass
-- a hand-built board row ({client_id:'arch', slug:'arch-agency'}) and set or
-- clear the picture on any client post at review/scheduled, patch that client's
-- board copy and write a set_media row attributed to whoever they claim.
--
-- Every legitimate caller is SECURITY DEFINER and runs as the owner, so none of
-- them needs the caller to hold EXECUTE on this one:
--   client_board_set_media, client_board_set_media_v2, operator_set_draft_media (230).
-- No app code calls it directly (grep of personal-site + ivan-inbox, 2026-09-29).
--
-- Rollback: db/231_revoke_client_board_apply_media_rollback.sql

REVOKE EXECUTE ON FUNCTION public._client_board_apply_media(client_boards, text, uuid, text, text)
  FROM public, anon, authenticated;
