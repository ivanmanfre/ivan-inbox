-- Rollback of 20261115m_lock_signed_in_functions_from_anon.sql: EXECUTE back to PUBLIC and anon as each function had
-- it. authenticated and service_role were never removed.
BEGIN;

GRANT EXECUTE ON FUNCTION public.inbox_governor() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_schedule_snapshot(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.operator_approve_scan_video(text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.operator_client_comment_cards(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.operator_client_post_stats(text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_edit_outreach_template(text, text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_edit_rise_draft(text, uuid, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_email_lane_status(text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_escalate_rise_draft(text, uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_learned_facts(text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_mark_comment_handled(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.operator_outreach_lane_kpis(text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_outreach_templates(text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_resolve_learned_fact(text, uuid, text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_send_to_lead(text, text, uuid, text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_set_lm_active_cover(text, text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_set_lm_cover(text, text, text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_store_numbers(uuid) TO anon;

COMMIT;
