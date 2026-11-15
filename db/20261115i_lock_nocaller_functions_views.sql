BEGIN;

-- 20261115i_lock_nocaller_functions_views Batch 2 of 7: functions (10) and views (22) with no caller found.
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
-- No reader or writer was found for these in any source above, and the 7-day logs show 0 calls by any role. Functions
-- lose PUBLIC, anon and authenticated; views lose anon and authenticated. service_role and postgres keep their rights.
-- Nothing is dropped.
-- Functions: lm_brain_arm, lm_mods_arm, lm_preview_arm, cb44_freeze_house_numbers, cb44_freeze_outreach_funnels (no
-- cron job or workflow calls them), recording_add_comment and both recording_increment_view (the video page calls only
-- recording_view_by_token, which stays public), rise_scan_request_list (no page calls it; the run-scan link page uses
-- rise_scan_link_list, which stays public), swishdm_restore_age_limit_20d.
-- Views that returned rows to the public key before this: lm_funnel_by_slug, rise_format_test_results_v,
-- rise_sl_outcomes_v, storeleads_anchor_density_v (owner-rights). lm_funnel_by_slug and v_client_proposals are also
-- simple views over one table, so their anon INSERT, UPDATE and DELETE grants let the public key write the base table
-- with the owner's rights.
-- Rollback: 20261115i_lock_nocaller_functions_views_rollback.sql

REVOKE EXECUTE ON FUNCTION public.cb44_freeze_house_numbers(date, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_freeze_house_numbers(date, timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb44_freeze_outreach_funnels(date, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_freeze_outreach_funnels(date, timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.lm_brain_arm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lm_brain_arm() TO service_role;
REVOKE EXECUTE ON FUNCTION public.lm_mods_arm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lm_mods_arm() TO service_role;
REVOKE EXECUTE ON FUNCTION public.lm_preview_arm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lm_preview_arm() TO service_role;
REVOKE EXECUTE ON FUNCTION public.recording_add_comment(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recording_add_comment(uuid, text, text, numeric, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.recording_increment_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recording_increment_view(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.recording_increment_view(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recording_increment_view(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.rise_scan_request_list(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_scan_request_list(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.swishdm_restore_age_limit_20d() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_restore_age_limit_20d() TO service_role;
REVOKE ALL ON TABLE public.audn_classification_source_exceptions_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_company_outcomes_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_person_cohorts_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_rise_reconciliation_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_window_counts_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.content_lint_detector_stats FROM anon, authenticated;
REVOKE ALL ON TABLE public.inbox_accept_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.industry_post_buyer_share_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.lm_funnel_by_slug FROM anon, authenticated;
REVOKE ALL ON TABLE public.lm_vertical_density FROM anon, authenticated;
REVOKE ALL ON TABLE public.outreach_anchor_coverage_v FROM authenticated;
REVOKE ALL ON TABLE public.outreach_dm_variant_clicks FROM anon, authenticated;
REVOKE ALL ON TABLE public.outreach_note_variant_readout FROM anon, authenticated;
REVOKE ALL ON TABLE public.outreach_seniority_share_30d FROM anon, authenticated;
REVOKE ALL ON TABLE public.post_consideration_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.rise_format_test_results_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.rise_sl_outcomes_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.scan_open_stats FROM anon, authenticated;
REVOKE ALL ON TABLE public.storeleads_anchor_density_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_claude_memory_link_counts FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_client_proposals FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_n8nclaw_tool_usage_7d FROM anon, authenticated;

COMMIT;
