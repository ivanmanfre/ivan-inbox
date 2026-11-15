BEGIN;

-- 20261115e_lock_booking_functions Batch 5 of 6: owner-rights functions the public key could call (12).
--
-- Part of the 2026-11-15 lock of objects the public (anon) key could read or change. Found 2026-11-14: 26 tables in
-- public had row level security OFF and ALL privileges for anon and authenticated (Supabase default grants on tables
-- made by SQL), and the cb37 views run with owner rights with the same grants.
-- Roles checked before writing this (7 days of API gateway logs, 2026-11-08 to 2026-11-15, plus who-reads --no-indirect
-- on every object): every request to these objects used a service key (57,000+ calls: n8n, the Railway runner, edge
-- functions); 0 came from the public key or a signed-in user, directly or embedded. Sign-up is disabled on the project.
-- service_role and postgres bypass row level security and keep their grants, so no policy is added (same as the
-- content_outcome_* tables locked on 2026-11-14). Nothing is dropped or deleted.
--
-- These 12 SECURITY DEFINER functions read or write the locked tables with owner rights and were executable by PUBLIC,
-- anon and authenticated (the Postgres default). Through the REST API the public key could cancel a booking
-- (_bk_cancel_row), rebuild the booked-company keys (client_guard_booked_refresh), mark a board dirty, or probe who booked
-- (the guard functions, lane_chain_weekly).
-- Callers checked: every database caller is itself SECURITY DEFINER and owned by postgres (booking_ingest_event,
-- client_guard_sweep, trg_client_guard*, trg_board_truth_dirty*, rise_company_contact_claim, _client_board_report_payload),
-- so it still executes them as postgres. Through the API only service keys call them (cold_send_guard 1,810 calls and
-- lane_chain_weekly 3 calls in 7 days, n8n). service_role already holds its own EXECUTE grant; it is restated here.
-- Left as they are: client_board_audience / client_board_audience_v2 (the client board calls them with the public key
-- by design). Trigger functions cannot be called through the API.
-- Rollback: 20261115e_lock_booking_functions_rollback.sql

REVOKE EXECUTE ON FUNCTION public._bk_cancel_row(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bk_cancel_row(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public._client_guard_booked_doms(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_booked_doms(text, uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public._client_guard_colleague(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_colleague(text, uuid, text, text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public._client_guard_core(text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_core(text, uuid, text, text, text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public._client_guard_core8(text, uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_core8(text, uuid, text, text, text, text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public._client_guard_sweep_company(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_guard_sweep_company(text, uuid, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.board_truth_mark_dirty(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_truth_mark_dirty(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.client_guard_booked_refresh(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_guard_booked_refresh(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.client_guard_colleague_warm(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_guard_colleague_warm(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.client_guard_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_guard_reason(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cold_send_guard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cold_send_guard(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.lane_chain_weekly(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lane_chain_weekly(text, date) TO service_role;

COMMIT;
