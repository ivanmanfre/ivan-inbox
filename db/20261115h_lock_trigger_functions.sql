BEGIN;

-- 20261115h_lock_trigger_functions Batch 1 of 7: owner-rights trigger functions (38).
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
-- These 38 functions return trigger. Postgres checks EXECUTE on a trigger function only when the trigger is created,
-- never when it fires, and the REST API cannot call a function that returns trigger. Removing the PUBLIC, anon and
-- authenticated grants changes nothing that runs; it takes them out of every future audit of what the public key can
-- call. Their triggers stay as they are (owner postgres).
-- Rollback: 20261115h_lock_trigger_functions_rollback.sql

REVOKE EXECUTE ON FUNCTION public.arch_policy_enforce_20261012() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arch_policy_enforce_20261012() TO service_role;
REVOKE EXECUTE ON FUNCTION public.audn_guard_idea_revival() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audn_guard_idea_revival() TO service_role;
REVOKE EXECUTE ON FUNCTION public.carousel_drafts_body_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carousel_drafts_body_guard() TO service_role;
REVOKE EXECUTE ON FUNCTION public.carousel_drafts_deletion_audit_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carousel_drafts_deletion_audit_fn() TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb39_implicit_delete_tg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb39_implicit_delete_tg() TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb39_implicit_verdict_tg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb39_implicit_verdict_tg() TO service_role;
REVOKE EXECUTE ON FUNCTION public.content_plan_replan_on_fail() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_plan_replan_on_fail() TO service_role;
REVOKE EXECUTE ON FUNCTION public.editorial_preserve_audn_capture() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_preserve_audn_capture() TO service_role;
REVOKE EXECUTE ON FUNCTION public.editorial_project_audn_capture_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_project_audn_capture_trigger() TO service_role;
REVOKE EXECUTE ON FUNCTION public.guard_scheduled_post_duplicate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_scheduled_post_duplicate() TO service_role;
REVOKE EXECUTE ON FUNCTION public.hot_now_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hot_now_push() TO service_role;
REVOKE EXECUTE ON FUNCTION public.ivan_fresh_warm_handover() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ivan_fresh_warm_handover() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_inbox_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_inbox_push() TO service_role;
REVOKE EXECUTE ON FUNCTION public.ops_book_link_their_ask() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_book_link_their_ask() TO service_role;
REVOKE EXECUTE ON FUNCTION public.ops_drafts_owner_comment_founder_admit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_drafts_owner_comment_founder_admit() TO service_role;
REVOKE EXECUTE ON FUNCTION public.outreach_dm_dupe_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_dm_dupe_guard() TO service_role;
REVOKE EXECUTE ON FUNCTION public.owner_comment_feed_founder_admit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_comment_feed_founder_admit() TO service_role;
REVOKE EXECUTE ON FUNCTION public.owner_comment_member_deleted() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_comment_member_deleted() TO service_role;
REVOKE EXECUTE ON FUNCTION public.owner_comment_member_ref_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_comment_member_ref_check() TO service_role;
REVOKE EXECUTE ON FUNCTION public.protect_human_edited_draft() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_human_edited_draft() TO service_role;
REVOKE EXECUTE ON FUNCTION public.rise_mattan_ok_gate_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_mattan_ok_gate_fn() TO service_role;
REVOKE EXECUTE ON FUNCTION public.snapshot_prompt_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_prompt_version() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_board_truth_dirty_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_board_truth_dirty_booking() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_board_truth_dirty_email_reply() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_board_truth_dirty_email_reply() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_board_truth_dirty_prospect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_board_truth_dirty_prospect() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_client_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_client_guard_booked_prospect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard_booked_prospect() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_client_guard_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard_booking() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_client_guard_roster() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard_roster() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_ops_draft_decision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_ops_draft_decision() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_prospect_verdicts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_prospect_verdicts() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_outreach_post_act_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_outreach_post_act_index() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_stamp_scorer_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_stamp_scorer_version() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_swishdm_exclusion_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_swishdm_exclusion_guard() TO service_role;
REVOKE EXECUTE ON FUNCTION public.x_quote_close_card() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.x_quote_close_card() TO service_role;
REVOKE EXECUTE ON FUNCTION public.x_quote_from_ops_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.x_quote_from_ops_approval() TO service_role;
REVOKE EXECUTE ON FUNCTION public.zz_idea_icp_visibility_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zz_idea_icp_visibility_gate() TO service_role;
REVOKE EXECUTE ON FUNCTION public.zz_idea_source_policy_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zz_idea_source_policy_insert() TO service_role;

COMMIT;
