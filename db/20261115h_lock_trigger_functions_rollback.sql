-- Rollback of 20261115h_lock_trigger_functions.sql: EXECUTE back to PUBLIC, anon and authenticated as each function
-- had it.
BEGIN;

GRANT EXECUTE ON FUNCTION public.arch_policy_enforce_20261012() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audn_guard_idea_revival() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carousel_drafts_body_guard() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carousel_drafts_deletion_audit_fn() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb39_implicit_delete_tg() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb39_implicit_verdict_tg() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_plan_replan_on_fail() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_preserve_audn_capture() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_project_audn_capture_trigger() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_scheduled_post_duplicate() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hot_now_push() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ivan_fresh_warm_handover() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_inbox_push() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_book_link_their_ask() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_drafts_owner_comment_founder_admit() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_dm_dupe_guard() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_comment_feed_founder_admit() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_comment_member_deleted() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_comment_member_ref_check() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_human_edited_draft() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_mattan_ok_gate_fn() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_prompt_version() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_board_truth_dirty_booking() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_board_truth_dirty_email_reply() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_board_truth_dirty_prospect() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard_booked_prospect() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard_booking() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_client_guard_roster() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_ops_draft_decision() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_prospect_verdicts() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_outreach_post_act_index() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_stamp_scorer_version() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_swishdm_exclusion_guard() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.x_quote_close_card() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.x_quote_from_ops_approval() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zz_idea_icp_visibility_gate() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zz_idea_source_policy_insert() TO PUBLIC, anon, authenticated;

COMMIT;
