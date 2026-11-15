-- Rollback of 20261115e_lock_booking_functions.sql: EXECUTE back to PUBLIC, anon and authenticated (proacl was
-- =X/postgres, anon=X, authenticated=X, service_role=X on every function).
BEGIN;

GRANT EXECUTE ON FUNCTION public._bk_cancel_row(text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_booked_doms(text, uuid, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_colleague(text, uuid, text, text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_core(text, uuid, text, text, text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_core8(text, uuid, text, text, text, text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_sweep_company(text, uuid, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_truth_mark_dirty(text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_guard_booked_refresh(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_guard_colleague_warm(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_guard_reason(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cold_send_guard(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lane_chain_weekly(text, date) TO PUBLIC, anon, authenticated;

COMMIT;
