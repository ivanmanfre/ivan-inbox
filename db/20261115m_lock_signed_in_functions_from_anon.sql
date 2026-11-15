BEGIN;

-- 20261115m_lock_signed_in_functions_from_anon Batch 6 of 7: owner-rights functions the signed-in apps call (18):
-- PUBLIC and anon removed, signed-in grant kept.
--
-- Part of the 2026-11-15 lock of owner-rights (SECURITY DEFINER) functions and views the public (anon) key could still
-- reach after 20261115a-g. Found: 188 owner-rights functions in public were executable by anon (38 of them trigger
-- functions), and 96 views kept an anon grant (65 with SELECT; 15 of those really returned rows to the public key: the
-- 14 owner-rights views and inbox_filter_spec_v).
-- Callers checked before writing this: who-reads --no-indirect on every object; the code of ivan-inbox, personal-site
-- and the built bundles in inboundonsteroids-site, rise-dtc-resources and swishdm-resources, resources,
-- inboundonsteroids-resources, claude-code-railway, outside-watch, n8n-flows; 507 n8n workflows and 112 edge
-- functions; every database function, view, cron job, policy and column default; and 7 days of API gateway logs
-- (2026-11-08 to 2026-11-15, 571,885 calls that did not use a service key). One user exists and sign-up is off.
-- 15 operator_* functions: the operator panel (ivanmanfredi.com/dashboard, behind a Supabase sign-in) and the inbox
-- app call them as the signed-in user; n8n calls two of them with a service key. For 14 of them the only other check
-- is p_gate, and the gate value is a fixed word shipped in the public site bundle, so with the public key anyone could
-- read client outreach templates, lane numbers, comment cards, post stats and learned facts, and edit or escalate a
-- RISE draft, edit an outreach template, mark a comment handled, resolve a learned fact or set a lead-magnet cover.
-- operator_approve_scan_video also checks the signed-in role already. operator_send_to_lead never sends (its send path
-- is not connected). 0 anon calls in 7 days. The gate word itself is not changed here.
-- inbox_governor and prospect_store_numbers: the inbox app calls them signed in (27 and 9 calls).
-- inbox_schedule_snapshot: called by schedule_inbox_dm, which runs with the signed-in user's rights. None has a caller
-- on the public key.
-- Rollback: 20261115m_lock_signed_in_functions_from_anon_rollback.sql

REVOKE EXECUTE ON FUNCTION public.inbox_governor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_governor() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.inbox_schedule_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_schedule_snapshot(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_approve_scan_video(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_approve_scan_video(text, uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_client_comment_cards(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_client_comment_cards(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_client_post_stats(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_client_post_stats(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_edit_outreach_template(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_edit_outreach_template(text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_edit_rise_draft(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_edit_rise_draft(text, uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_email_lane_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_email_lane_status(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_escalate_rise_draft(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_escalate_rise_draft(text, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_learned_facts(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_learned_facts(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_mark_comment_handled(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_mark_comment_handled(text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_outreach_lane_kpis(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_outreach_lane_kpis(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_outreach_templates(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_outreach_templates(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_resolve_learned_fact(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_resolve_learned_fact(text, uuid, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_send_to_lead(text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_send_to_lead(text, text, uuid, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_set_lm_active_cover(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_set_lm_active_cover(text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_set_lm_cover(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_set_lm_cover(text, text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.prospect_store_numbers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_store_numbers(uuid) TO authenticated, service_role;

COMMIT;
