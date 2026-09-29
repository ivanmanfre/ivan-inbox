-- Rollback for db/231: restore the grants the function had before (anon and
-- authenticated both held EXECUTE, read 2026-09-29).
GRANT EXECUTE ON FUNCTION public._client_board_apply_media(client_boards, text, uuid, text, text)
  TO anon, authenticated;
