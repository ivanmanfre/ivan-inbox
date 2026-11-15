-- Rollback of 20261115j_lock_service_functions.sql: EXECUTE back to PUBLIC, anon and authenticated as each function
-- had it.
BEGIN;

GRANT EXECUTE ON FUNCTION public._bk_task_card(text, text, jsonb) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_board_hide_apply(client_boards, text, uuid, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._risedtc_outreach_log() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._risedtc_outreach_status() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._swishdm_outreach_log() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._swishdm_outreach_status() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._swishdm_outreach_usage() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_lm_cover(text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arch_block_stale_engagement() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_draft_provenance() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_with_lm_stats(jsonb) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb38_brain_candidates_v3(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_fact_pack_for(text, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_run_number(text, timestamp with time zone) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_supply_for(text, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb44_supply_pack(text, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.idea_source_policy_get() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_inbound_dms(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ios_drip_completed_runs() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.own_engager_identity_matches(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recent_fingerprints(integer, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_reply_exemplars() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_scheduled_inbox_dms() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reply_exemplar_pairs(text, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_anchor_money_share(timestamp with time zone) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_scan_request_submit(text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_storeleads_band(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rise_storeleads_spend_pts(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_block_stale_engagement() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_engagement_age_days(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_exclusion_hit(text, text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_rise_bigstore_open(text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swishdm_rise_bigstore_pool(uuid, integer) TO PUBLIC, anon, authenticated;

COMMIT;
