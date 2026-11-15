BEGIN;

-- 20261115l_lock_signed_in_views_from_anon Batch 5 of 7: views the signed-in apps read (50): anon grant removed,
-- signed-in grant kept.
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
-- The inbox app (ivanmanfre.github.io) and the dashboard on ivanmanfredi.com read these as the signed-in user
-- (authenticated): 15,000+ reads in 7 days. The public key read none of them (the only anon requests were this audit's
-- own probes). anon loses every privilege; authenticated and service_role are untouched.
-- inbox_replacement_v and inbox_scan_opens_v are owner-rights and returned rows to the public key; inbox_filter_spec_v
-- returned its constants. The other inbox_*_v and audn_*_v here are security_invoker, so anon got 0 rows or permission
-- denied already; their grants are removed to match. client_instances_safe, kyle_steal_box and scheduled_checks_status
-- are simple owner-rights views: the anon INSERT, UPDATE and DELETE grants reached their base tables.
-- Kept for authenticated because the catalog shows a signed-in path through them even without a direct app read:
-- audn_canonical_post_identity_v, audn_post_identity_v, audn_classification_v, audn_excluded_person_v,
-- audn_interaction_events_v, audn_person_activity_v, claude_usage_daily, inbox_arch_copy_route_v.
-- Rollback: 20261115l_lock_signed_in_views_from_anon_rollback.sql

REVOKE ALL ON TABLE public.assessment_weakest_rollup FROM anon;
REVOKE ALL ON TABLE public.audn_canonical_post_identity_v FROM anon;
REVOKE ALL ON TABLE public.audn_classification_v FROM anon;
REVOKE ALL ON TABLE public.audn_excluded_person_v FROM anon;
REVOKE ALL ON TABLE public.audn_interaction_events_v FROM anon;
REVOKE ALL ON TABLE public.audn_outcomes_v FROM anon;
REVOKE ALL ON TABLE public.audn_person_activity_v FROM anon;
REVOKE ALL ON TABLE public.audn_person_label_v FROM anon;
REVOKE ALL ON TABLE public.audn_post_identity_v FROM anon;
REVOKE ALL ON TABLE public.audn_recommendation_links_v FROM anon;
REVOKE ALL ON TABLE public.audn_relationship_v FROM anon;
REVOKE ALL ON TABLE public.claude_usage_daily FROM anon;
REVOKE ALL ON TABLE public.client_instances_safe FROM anon;
REVOKE ALL ON TABLE public.client_monitored_workflows_view FROM anon;
REVOKE ALL ON TABLE public.editorial_eligible_outcome_snapshots_v FROM anon;
REVOKE ALL ON TABLE public.gate_keyword_performance FROM anon;
REVOKE ALL ON TABLE public.inbox_accept_v2 FROM anon;
REVOKE ALL ON TABLE public.inbox_arch_copy_route_v FROM anon;
REVOKE ALL ON TABLE public.inbox_campaign_perf_v FROM anon;
REVOKE ALL ON TABLE public.inbox_campaign_sends_v FROM anon;
REVOKE ALL ON TABLE public.inbox_day_ledger_v FROM anon;
REVOKE ALL ON TABLE public.inbox_filter_spec_v FROM anon;
REVOKE ALL ON TABLE public.inbox_inbound_daily_v FROM anon;
REVOKE ALL ON TABLE public.inbox_inbound_decisions_v FROM anon;
REVOKE ALL ON TABLE public.inbox_inbound_v FROM anon;
REVOKE ALL ON TABLE public.inbox_interest_perf_v FROM anon;
REVOKE ALL ON TABLE public.inbox_interest_prospects_v FROM anon;
REVOKE ALL ON TABLE public.inbox_interest_replacement_v FROM anon;
REVOKE ALL ON TABLE public.inbox_messages_v FROM anon;
REVOKE ALL ON TABLE public.inbox_outcomes_v FROM anon;
REVOKE ALL ON TABLE public.inbox_pipeline_v FROM anon;
REVOKE ALL ON TABLE public.inbox_replacement_v FROM anon;
REVOKE ALL ON TABLE public.inbox_reply_v FROM anon;
REVOKE ALL ON TABLE public.inbox_scan_opens_v FROM anon;
REVOKE ALL ON TABLE public.inbox_sends_daily_v FROM anon;
REVOKE ALL ON TABLE public.inbox_sends_v FROM anon;
REVOKE ALL ON TABLE public.kyle_steal_box FROM anon;
REVOKE ALL ON TABLE public.lm_dashboard_performance FROM anon;
REVOKE ALL ON TABLE public.lm_today_activity FROM anon;
REVOKE ALL ON TABLE public.nurture_performance FROM anon;
REVOKE ALL ON TABLE public.own_posts_scored FROM anon;
REVOKE ALL ON TABLE public.pageviews_daily FROM anon;
REVOKE ALL ON TABLE public.pageviews_device_split FROM anon;
REVOKE ALL ON TABLE public.pageviews_top_paths FROM anon;
REVOKE ALL ON TABLE public.pageviews_top_referrers FROM anon;
REVOKE ALL ON TABLE public.pageviews_top_utm FROM anon;
REVOKE ALL ON TABLE public.scheduled_checks_status FROM anon;
REVOKE ALL ON TABLE public.scheduled_ops_status FROM anon;
REVOKE ALL ON TABLE public.v_claude_memory_embedding_status FROM anon;
REVOKE ALL ON TABLE public.v_n8nclaw_tool_usage_14d FROM anon;

COMMIT;
