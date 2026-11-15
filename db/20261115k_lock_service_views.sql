BEGIN;

-- 20261115k_lock_service_views Batch 4 of 7: views only service callers read (34).
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
-- Readers are service keys (n8n, Railway, edge functions), cron jobs and owner-rights database functions; the logs
-- show service-key reads only (for example outreach_owed_threads 4,782, outreach_invite_outcomes_v 1,641,
-- outreach_stratum_rates_v 907). No app or site code names them. They lose anon and authenticated. No invoker-rights
-- view or function that a signed-in user can reach reads them (checked from the catalog: a view stays in batch 5 if a
-- security_invoker view that keeps its signed-in grant, or an invoker-rights function authenticated can execute, reads
-- it).
-- Views that returned rows to the public key before this: audn_repeatable_competitor_classification_v,
-- client_post_engager_stats_v, harvest_source_gpp, harvest_source_yield, ivan_anchor_attrib, ivan_cold_signal_measure,
-- scan_video_candidates, storeleads_prospect_brand_v (owner-rights). scan_video_candidates and
-- scheduled_checks_due_for_notify are simple views over one table, so the anon write grants reached the base table.
-- Rollback: 20261115k_lock_service_views_rollback.sql

REVOKE ALL ON TABLE public.audn_classification_coverage_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_classification_source_resolution_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_identity_resolution_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_matched_age_rank_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_measurement_coverage_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_metric_standing_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_monthly_median_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_monthly_metric_trend_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_outcome_assists_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_repeatable_classification_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_repeatable_competitor_classification_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_selected_snapshot_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_snapshot_eligibility_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.audn_topic_people_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.client_post_engager_stats_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.experiments_latest FROM anon, authenticated;
REVOKE ALL ON TABLE public.harvest_source_gpp FROM anon, authenticated;
REVOKE ALL ON TABLE public.harvest_source_yield FROM anon, authenticated;
REVOKE ALL ON TABLE public.ivan_anchor_attrib FROM anon, authenticated;
REVOKE ALL ON TABLE public.ivan_cold_signal_measure FROM anon, authenticated;
REVOKE ALL ON TABLE public.lm_performance FROM anon, authenticated;
REVOKE ALL ON TABLE public.outreach_anchor_names_v FROM authenticated;
REVOKE ALL ON TABLE public.outreach_anchor_outcomes_v FROM authenticated;
REVOKE ALL ON TABLE public.outreach_anchor_protect_v FROM authenticated;
REVOKE ALL ON TABLE public.outreach_invite_base_v FROM authenticated;
REVOKE ALL ON TABLE public.outreach_invite_outcomes_v FROM authenticated;
REVOKE ALL ON TABLE public.outreach_owed_threads FROM anon, authenticated;
REVOKE ALL ON TABLE public.outreach_stratum_rates_v FROM authenticated;
REVOKE ALL ON TABLE public.scan_video_candidates FROM anon, authenticated;
REVOKE ALL ON TABLE public.scheduled_checks_due_for_notify FROM anon, authenticated;
REVOKE ALL ON TABLE public.signal_prospect_links FROM authenticated;
REVOKE ALL ON TABLE public.storeleads_prospect_brand_v FROM anon, authenticated;
REVOKE ALL ON TABLE public.topic_author_outcomes_v FROM authenticated;
REVOKE ALL ON TABLE public.topic_query_outcomes_v FROM authenticated;

COMMIT;
