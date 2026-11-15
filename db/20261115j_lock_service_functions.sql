BEGIN;

-- 20261115j_lock_service_functions Batch 3 of 7: owner-rights functions only service callers use (33).
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
-- Every caller of these is a service key (n8n, the Railway runner, edge functions), a cron job, or another owner-
-- rights database function (all run as postgres or service_role). In 7 days of logs the public key and the signed-in
-- user called none of them. They lose PUBLIC, anon and authenticated; service_role keeps its own grant (restated).
-- append_lm_cover is called by the scroll-recorder service with a service key.
-- What the public key could do through them before this: add a task card to the inbox (_bk_task_card); read the RISE
-- DTC and SwishDM outreach log, status and usage with no board token (_risedtc_outreach_*, _swishdm_outreach_*: the
-- client board calls them only after its token check); hide a client-board draft with a forged board row
-- (_client_board_hide_apply); run the scheduled-DM release, which approves messages already due
-- (release_scheduled_inbox_dms, cron 196 does this each minute); park or block prospects (arch_block_stale_engagement,
-- swishdm_block_stale_engagement); read reply exemplars, own-post engager matches, RISE store pools and the content-
-- brain fact packs.
-- Invoker-rights callers checked: oexp_strata calls rise_storeleads_band and is itself not executable by anon or
-- authenticated. inbox_schedule_snapshot is called by schedule_inbox_dm (invoker rights, signed-in app) and is
-- therefore in batch 6, not here.
-- Rollback: 20261115j_lock_service_functions_rollback.sql

REVOKE EXECUTE ON FUNCTION public._bk_task_card(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bk_task_card(text, text, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public._client_board_hide_apply(client_boards, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_board_hide_apply(client_boards, text, uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public._risedtc_outreach_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._risedtc_outreach_log() TO service_role;
REVOKE EXECUTE ON FUNCTION public._risedtc_outreach_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._risedtc_outreach_status() TO service_role;
REVOKE EXECUTE ON FUNCTION public._swishdm_outreach_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._swishdm_outreach_log() TO service_role;
REVOKE EXECUTE ON FUNCTION public._swishdm_outreach_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._swishdm_outreach_status() TO service_role;
REVOKE EXECUTE ON FUNCTION public._swishdm_outreach_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._swishdm_outreach_usage() TO service_role;
REVOKE EXECUTE ON FUNCTION public.append_lm_cover(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_lm_cover(text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.arch_block_stale_engagement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arch_block_stale_engagement() TO service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_draft_provenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_draft_provenance() TO service_role;
REVOKE EXECUTE ON FUNCTION public.board_with_lm_stats(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_with_lm_stats(jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb38_brain_candidates_v3(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb38_brain_candidates_v3(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb44_fact_pack_for(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_fact_pack_for(text, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb44_run_number(text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_run_number(text, timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb44_supply_for(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_supply_for(text, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb44_supply_pack(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_supply_pack(text, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.idea_source_policy_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.idea_source_policy_get() TO service_role;
REVOKE EXECUTE ON FUNCTION public.increment_post_inbound_dms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_inbound_dms(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.ios_drip_completed_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ios_drip_completed_runs() TO service_role;
REVOKE EXECUTE ON FUNCTION public.own_engager_identity_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.own_engager_identity_matches(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.recent_fingerprints(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recent_fingerprints(integer, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.refresh_reply_exemplars() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_reply_exemplars() TO service_role;
REVOKE EXECUTE ON FUNCTION public.release_scheduled_inbox_dms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_scheduled_inbox_dms() TO service_role;
REVOKE EXECUTE ON FUNCTION public.reply_exemplar_pairs(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reply_exemplar_pairs(text, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.rise_anchor_money_share(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_anchor_money_share(timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.rise_scan_request_submit(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_scan_request_submit(text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.rise_storeleads_band(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_storeleads_band(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.rise_storeleads_spend_pts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_storeleads_spend_pts(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.swishdm_block_stale_engagement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_block_stale_engagement() TO service_role;
REVOKE EXECUTE ON FUNCTION public.swishdm_engagement_age_days(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_engagement_age_days(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.swishdm_exclusion_hit(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_exclusion_hit(text, text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.swishdm_rise_bigstore_open(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_rise_bigstore_open(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.swishdm_rise_bigstore_pool(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_rise_bigstore_pool(uuid, integer) TO service_role;

COMMIT;
