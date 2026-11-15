-- Rolled-back test of 20261115h..o on live data: apply all eight batches, check both ways, apply the eight rollbacks,
-- check the old state is back, then RAISE so nothing stays. The runner replaces each MIG / RB placeholder (letters H
-- to O, wrapped in double underscores) with that file's body, BEGIN; / COMMIT; lines removed. The result is the RAISE text.
-- The test only does fast checks. Six functions that take no arguments and write (release_scheduled_inbox_dms,
-- arch_block_stale_engagement, swishdm_block_stale_engagement, refresh_reply_exemplars, backfill_draft_provenance,
-- swishdm_restore_age_limit_20d) are never executed here, not even as a role that should be refused: for them the
-- catalog check stands in. No function that sends anything is called. Real requests with the real public key through
-- the REST API, and the app's real screens, are checked after each batch is applied.
DO $t$
DECLARE
  res jsonb := '{}'::jsonb; fn0 jsonb; fn1 jsonb; fn2 jsonb; vw0 jsonb; vw1 jsonb; vw2 jsonb;
  f text; rel text; n int; m int; uid uuid; pid uuid; did uuid; e0 text; e1 text; x text; j jsonb;
  blocked int; leaks jsonb; bc0 jsonb; bc1 jsonb; brd record; src0 text; adm text; inv0 text;
  fn_locked text[] := ARRAY['cb44_freeze_house_numbers(date, timestamp with time zone)', 'cb44_freeze_outreach_funnels(date, timestamp with time zone)', 'lm_brain_arm()',
    'lm_mods_arm()', 'lm_preview_arm()', 'recording_add_comment(uuid, text, text, numeric, text)',
    'recording_increment_view(uuid)', 'recording_increment_view(text)', 'rise_scan_request_list(text, text)',
    'swishdm_restore_age_limit_20d()', '_bk_task_card(text, text, jsonb)', '_client_board_hide_apply(client_boards, text, uuid, text)',
    '_risedtc_outreach_log()', '_risedtc_outreach_status()', '_swishdm_outreach_log()',
    '_swishdm_outreach_status()', '_swishdm_outreach_usage()', 'append_lm_cover(text, text, text)',
    'arch_block_stale_engagement()', 'backfill_draft_provenance()', 'board_with_lm_stats(jsonb)',
    'cb38_brain_candidates_v3(text)', 'cb44_fact_pack_for(text, boolean)', 'cb44_run_number(text, timestamp with time zone)',
    'cb44_supply_for(text, boolean)', 'cb44_supply_pack(text, boolean)', 'idea_source_policy_get()',
    'increment_post_inbound_dms(uuid)', 'ios_drip_completed_runs()', 'own_engager_identity_matches(text, text)',
    'recent_fingerprints(integer, text)', 'refresh_reply_exemplars()', 'release_scheduled_inbox_dms()',
    'reply_exemplar_pairs(text, integer)', 'rise_anchor_money_share(timestamp with time zone)', 'rise_scan_request_submit(text, text, text)',
    'rise_storeleads_band(text)', 'rise_storeleads_spend_pts(text)', 'swishdm_block_stale_engagement()',
    'swishdm_engagement_age_days(uuid)', 'swishdm_exclusion_hit(text, text, text, text)', 'swishdm_rise_bigstore_open(text, text)',
    'swishdm_rise_bigstore_pool(uuid, integer)', 'arch_policy_enforce_20261012()', 'audn_guard_idea_revival()',
    'carousel_drafts_body_guard()', 'carousel_drafts_deletion_audit_fn()', 'cb39_implicit_delete_tg()',
    'cb39_implicit_verdict_tg()', 'content_plan_replan_on_fail()', 'editorial_preserve_audn_capture()',
    'editorial_project_audn_capture_trigger()', 'guard_scheduled_post_duplicate()', 'hot_now_push()',
    'ivan_fresh_warm_handover()', 'notify_inbox_push()', 'ops_book_link_their_ask()',
    'ops_drafts_owner_comment_founder_admit()', 'outreach_dm_dupe_guard()', 'owner_comment_feed_founder_admit()',
    'owner_comment_member_deleted()', 'owner_comment_member_ref_check()', 'protect_human_edited_draft()',
    'rise_mattan_ok_gate_fn()', 'snapshot_prompt_version()', 'trg_board_truth_dirty_booking()',
    'trg_board_truth_dirty_email_reply()', 'trg_board_truth_dirty_prospect()', 'trg_client_guard()',
    'trg_client_guard_booked_prospect()', 'trg_client_guard_booking()', 'trg_client_guard_roster()',
    'trg_log_ops_draft_decision()', 'trg_log_prospect_verdicts()', 'trg_outreach_post_act_index()',
    'trg_stamp_scorer_version()', 'trg_swishdm_exclusion_guard()', 'x_quote_close_card()',
    'x_quote_from_ops_approval()', 'zz_idea_icp_visibility_gate()', 'zz_idea_source_policy_insert()']::text[];
  fn_signed text[] := ARRAY['inbox_governor()', 'inbox_schedule_snapshot(uuid)', 'operator_approve_scan_video(text, uuid, text)',
    'operator_client_comment_cards(text, text)', 'operator_client_post_stats(text, text)', 'operator_edit_outreach_template(text, text, text)',
    'operator_edit_rise_draft(text, uuid, text)', 'operator_email_lane_status(text)', 'operator_escalate_rise_draft(text, uuid)',
    'operator_learned_facts(text, text)', 'operator_mark_comment_handled(text, text, text)', 'operator_outreach_lane_kpis(text, text)',
    'operator_outreach_templates(text, text)', 'operator_resolve_learned_fact(text, uuid, text, text)', 'operator_send_to_lead(text, text, uuid, text, text)',
    'operator_set_lm_active_cover(text, text, text)', 'operator_set_lm_cover(text, text, text, text)', 'prospect_store_numbers(uuid)']::text[];
  fn_public text[] := ARRAY['board_activity(text, text, text, timestamp with time zone, uuid)', 'board_comment_add(text, text, text, text, text)', 'board_comment_add_v2(text, text, text, text, text, text[])',
    'board_comment_resolve(text, text, boolean, text)', 'board_comments_list(text, text, text)', 'board_comments_list_v2(text, text, text)',
    'board_photo_added(text, text, text, text, text)', 'board_photo_operation(text, text, text, text, uuid, text, text, text)', 'board_slot_notes(text, jsonb, text, text)',
    'board_team_add(text, text, text, text)', 'board_team_add_v2(text, text, text, text, text, text)', 'board_team_list(text, text, text)',
    'board_team_remove(text, text, text, text)', 'board_team_set_role(text, text, text, text, text)', 'board_track(text, jsonb, text, text)',
    'cb35_plugin_finish(text, bigint, text, integer)', 'cb35_plugin_freeze_v1(text, uuid)', 'cb35_plugin_import_v1(text, jsonb)',
    'cb35_plugin_read(text, text, integer, jsonb)', 'cb35_plugin_snapshot_v1(text, text, integer)', 'cb35_plugin_usage(text, text, text, boolean, text, integer)',
    'cb35_plugin_watermark_v1(text, uuid, bigint, timestamp with time zone)', 'client_board_action(text, text, text, text, jsonb)', 'client_board_action_v2(text, text, text, text, jsonb)',
    'client_board_archive_draft(text, text, uuid, boolean)', 'client_board_archive_draft_v2(text, text, uuid, boolean)', 'client_board_audience(text, text)',
    'client_board_audience_decide(text, text, text, text, text)', 'client_board_audience_decide_v2(text, text, text, text, text)', 'client_board_audience_v2(text, text)',
    'client_board_draft_history(text, text, text)', 'client_board_draft_history_v2(text, text, text)', 'client_board_edit_draft(text, text, uuid, text)',
    'client_board_edit_draft_v2(text, text, uuid, text, text)', 'client_board_edit_lm_promo(text, text, text, text, jsonb)', 'client_board_edit_lm_promo_v2(text, text, text, text, jsonb)',
    'client_board_edit_title(text, text, uuid, text)', 'client_board_edit_title_v2(text, text, uuid, text)', 'client_board_funnel_signals(text, text)',
    'client_board_funnel_signals_v2(text, text)', 'client_board_hide_draft(text, text, uuid)', 'client_board_hide_draft_v2(text, text, uuid)',
    'client_board_outreach_log(text, text)', 'client_board_outreach_log_v2(text, text)', 'client_board_outreach_status(text, text)',
    'client_board_outreach_status_v2(text, text)', 'client_board_outreach_usage(text, text)', 'client_board_outreach_usage_v2(text, text)',
    'client_board_post_people(text, text)', 'client_board_post_people_v2(text, text)', 'client_board_post_viewers(text, text)',
    'client_board_post_viewers_v2(text, text)', 'client_board_public_brand(text)', 'client_board_replacement_pool(text, text)',
    'client_board_replacement_pool_v2(text, text)', 'client_board_reply_source(text, text, uuid)', 'client_board_reply_source_v2(text, text, uuid)',
    'client_board_reply_sources(text, text, integer)', 'client_board_reply_sources_v2(text, text, integer)', 'client_board_report(text, text)',
    'client_board_report_v2(text, text)', 'client_board_schedule(text, text)', 'client_board_schedule_v2(text, text)',
    'client_board_set_media(text, text, uuid, text)', 'client_board_set_media_v2(text, text, uuid, text)', 'client_board_set_schedule(text, text, uuid, timestamp with time zone)',
    'client_board_set_schedule_v2(text, text, uuid, timestamp with time zone)', 'client_board_slot_state(text, text)', 'client_board_slot_state_v2(text, text)',
    'client_plan_review_load(text)', 'client_plan_review_save(text, integer, jsonb, text)', 'dtc_comparison_visible(text, uuid)',
    'get_board_team(text, text)', 'get_client_board(text, text)', 'get_client_board_by_session(text, text)',
    'invite_board_member(text, text, text)', 'ios_drip_page(text, text)', 'ios_drip_track(text, text, text, smallint, text, text, text, text, text)',
    'log_outreach_click(text, text, text, text)', 'outlier_gold_label_save(text, text, text, text, text, text)', 'outlier_gold_progress(text)',
    'outside_health(text)', 'peer_scan_track(text, text, jsonb, jsonb)', 'public_engine_metrics()',
    'recent_own_posts(integer)', 'recording_view_by_token(text)', 'redeem_board_login(text, text, text)',
    'rise_scan_link_list(text)', 'rise_scan_link_submit(text, text)']::text[];
  vw_locked text[] := ARRAY['audn_classification_source_exceptions_v', 'audn_company_outcomes_v', 'audn_person_cohorts_v', 'audn_rise_reconciliation_v',
    'audn_window_counts_v', 'content_lint_detector_stats', 'inbox_accept_v', 'industry_post_buyer_share_v',
    'lm_funnel_by_slug', 'lm_vertical_density', 'outreach_anchor_coverage_v', 'outreach_dm_variant_clicks',
    'outreach_note_variant_readout', 'outreach_seniority_share_30d', 'post_consideration_v', 'rise_format_test_results_v',
    'rise_sl_outcomes_v', 'scan_open_stats', 'storeleads_anchor_density_v', 'v_claude_memory_link_counts',
    'v_client_proposals', 'v_n8nclaw_tool_usage_7d', 'audn_classification_coverage_v', 'audn_classification_source_resolution_v',
    'audn_identity_resolution_v', 'audn_matched_age_rank_v', 'audn_measurement_coverage_v', 'audn_metric_standing_v',
    'audn_monthly_median_v', 'audn_monthly_metric_trend_v', 'audn_outcome_assists_v', 'audn_repeatable_classification_v',
    'audn_repeatable_competitor_classification_v', 'audn_selected_snapshot_v', 'audn_snapshot_eligibility_v', 'audn_topic_people_v',
    'client_post_engager_stats_v', 'experiments_latest', 'harvest_source_gpp', 'harvest_source_yield',
    'ivan_anchor_attrib', 'ivan_cold_signal_measure', 'lm_performance', 'outreach_anchor_names_v',
    'outreach_anchor_outcomes_v', 'outreach_anchor_protect_v', 'outreach_invite_base_v', 'outreach_invite_outcomes_v',
    'outreach_owed_threads', 'outreach_stratum_rates_v', 'scan_video_candidates', 'scheduled_checks_due_for_notify',
    'signal_prospect_links', 'storeleads_prospect_brand_v', 'topic_author_outcomes_v', 'topic_query_outcomes_v']::text[];
  vw_signed text[] := ARRAY['assessment_weakest_rollup', 'audn_canonical_post_identity_v', 'audn_classification_v', 'audn_excluded_person_v',
    'audn_interaction_events_v', 'audn_outcomes_v', 'audn_person_activity_v', 'audn_person_label_v',
    'audn_post_identity_v', 'audn_recommendation_links_v', 'audn_relationship_v', 'claude_usage_daily',
    'client_instances_safe', 'client_monitored_workflows_view', 'editorial_eligible_outcome_snapshots_v', 'gate_keyword_performance',
    'inbox_accept_v2', 'inbox_arch_copy_route_v', 'inbox_campaign_perf_v', 'inbox_campaign_sends_v',
    'inbox_day_ledger_v', 'inbox_filter_spec_v', 'inbox_inbound_daily_v', 'inbox_inbound_decisions_v',
    'inbox_inbound_v', 'inbox_interest_perf_v', 'inbox_interest_prospects_v', 'inbox_interest_replacement_v',
    'inbox_messages_v', 'inbox_outcomes_v', 'inbox_pipeline_v', 'inbox_replacement_v',
    'inbox_reply_v', 'inbox_scan_opens_v', 'inbox_sends_daily_v', 'inbox_sends_v',
    'kyle_steal_box', 'lm_dashboard_performance', 'lm_today_activity', 'nurture_performance',
    'own_posts_scored', 'pageviews_daily', 'pageviews_device_split', 'pageviews_top_paths',
    'pageviews_top_referrers', 'pageviews_top_utm', 'scheduled_checks_status', 'scheduled_ops_status',
    'v_claude_memory_embedding_status', 'v_n8nclaw_tool_usage_14d']::text[];
  vw_signed_noanon text[] := ARRAY['engine_counter_day_v', 'signal_events']::text[];
  calls_locked text[] := ARRAY['cb44_freeze_house_numbers(null::date, null::timestamp with time zone)', 'cb44_freeze_outreach_funnels(null::date, null::timestamp with time zone)', 'lm_brain_arm()',
    'lm_mods_arm()', 'lm_preview_arm()', 'recording_add_comment(null::uuid, null::text, null::text, null::numeric, null::text)',
    'recording_increment_view(null::uuid)', 'recording_increment_view(null::text)', 'rise_scan_request_list(null::text, null::text)',
    '_bk_task_card(null::text, null::text, null::jsonb)', '_client_board_hide_apply(null::client_boards, null::text, null::uuid, null::text)', '_risedtc_outreach_log()',
    '_risedtc_outreach_status()', '_swishdm_outreach_log()', '_swishdm_outreach_status()',
    '_swishdm_outreach_usage()', 'append_lm_cover(null::text, null::text, null::text)', 'board_with_lm_stats(null::jsonb)',
    'cb38_brain_candidates_v3(null::text)', 'cb44_fact_pack_for(null::text, null::boolean)', 'cb44_run_number(null::text, null::timestamp with time zone)',
    'cb44_supply_for(null::text, null::boolean)', 'cb44_supply_pack(null::text, null::boolean)', 'idea_source_policy_get()',
    'increment_post_inbound_dms(null::uuid)', 'ios_drip_completed_runs()', 'own_engager_identity_matches(null::text, null::text)',
    'recent_fingerprints(null::integer, null::text)', 'reply_exemplar_pairs(null::text, null::integer)', 'rise_anchor_money_share(null::timestamp with time zone)',
    'rise_scan_request_submit(null::text, null::text, null::text)', 'rise_storeleads_band(null::text)', 'rise_storeleads_spend_pts(null::text)',
    'swishdm_engagement_age_days(null::uuid)', 'swishdm_exclusion_hit(null::text, null::text, null::text, null::text)', 'swishdm_rise_bigstore_open(null::text, null::text)',
    'swishdm_rise_bigstore_pool(null::uuid, null::integer)']::text[];
  calls_signed text[] := ARRAY['inbox_governor()', 'inbox_schedule_snapshot(null::uuid)', 'operator_approve_scan_video(null::text, null::uuid, null::text)',
    'operator_client_comment_cards(null::text, null::text)', 'operator_client_post_stats(null::text, null::text)', 'operator_edit_outreach_template(null::text, null::text, null::text)',
    'operator_edit_rise_draft(null::text, null::uuid, null::text)', 'operator_email_lane_status(null::text)', 'operator_escalate_rise_draft(null::text, null::uuid)',
    'operator_learned_facts(null::text, null::text)', 'operator_mark_comment_handled(null::text, null::text, null::text)', 'operator_outreach_lane_kpis(null::text, null::text)',
    'operator_outreach_templates(null::text, null::text)', 'operator_resolve_learned_fact(null::text, null::uuid, null::text, null::text)', 'operator_send_to_lead(null::text, null::text, null::uuid, null::text, null::text)',
    'operator_set_lm_active_cover(null::text, null::text, null::text)', 'operator_set_lm_cover(null::text, null::text, null::text, null::text)', 'prospect_store_numbers(null::uuid)']::text[];
  fn_all text[]; vw_all text[];
BEGIN
  fn_all := fn_locked || fn_signed || fn_public || ARRAY['detector_name_key(text)', 'detector_name_norm(text)'];
  vw_all := vw_locked || vw_signed || vw_signed_noanon;

  -- State before: the sorted grant list of every function and view the batches touch or deliberately leave.
  SELECT jsonb_object_agg(p.oid::regprocedure::text, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a)) INTO fn0
    FROM pg_proc p WHERE p.oid = ANY (SELECT ('public.' || q)::regprocedure::oid FROM unnest(fn_all) q);
  SELECT jsonb_object_agg(c.relname, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a)) INTO vw0
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (vw_all);
  res := res || jsonb_build_object(
    's00_functions_found', (SELECT count(*) FROM jsonb_object_keys(fn0)), 's00_views_found', (SELECT count(*) FROM jsonb_object_keys(vw0)),
    's00_owner_rights_functions_anon_can_call_before', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')),
    's00_views_with_an_anon_grant_before', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm') AND c.relacl::text ~ '[{,]anon='));

  SELECT p.id INTO pid FROM public.outreach_prospects p WHERE p.name IS NOT NULL ORDER BY p.created_at DESC LIMIT 1;
  SELECT u.id INTO uid FROM auth.users u ORDER BY u.created_at LIMIT 1;
  SELECT d.id INTO did FROM public.carousel_drafts d ORDER BY d.created_at DESC LIMIT 1;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);

  -- Before the lock, as the public key: the leak is real. Read-only calls only.
  SET LOCAL ROLE anon;
  BEGIN
    res := res || jsonb_build_object('s00_before_anon_operator_templates_with_the_shipped_gate_word',
      (public.operator_outreach_templates('clientops', 'risedtc')->>'ok'));
  EXCEPTION WHEN OTHERS THEN res := res || jsonb_build_object('s00_before_anon_operator_templates_with_the_shipped_gate_word', SQLSTATE);
  END;
  BEGIN
    SELECT count(*) INTO n FROM (SELECT 1 FROM public.inbox_scan_opens_v LIMIT 3) z;
    res := res || jsonb_build_object('s00_before_anon_rows_from_inbox_scan_opens_v', n);
  EXCEPTION WHEN OTHERS THEN res := res || jsonb_build_object('s00_before_anon_rows_from_inbox_scan_opens_v', SQLSTATE);
  END;
  BEGIN
    DELETE FROM public.kyle_steal_box WHERE false;
    res := res || jsonb_build_object('s00_before_anon_may_delete_through_kyle_steal_box', true);
  EXCEPTION WHEN OTHERS THEN res := res || jsonb_build_object('s00_before_anon_may_delete_through_kyle_steal_box', SQLSTATE);
  END;
  RESET ROLE;
  -- The client boards' real calls with a real board link, as the public key (token variants; the token never leaves
  -- the database). These reach the helpers that lose their grants: get_client_board -> board_with_lm_stats, outreach
  -- status/log/usage -> _risedtc_* / _swishdm_*, hide_draft -> _client_board_hide_apply (unknown draft: no write).
  bc0 := '{}'::jsonb;
  FOR brd IN SELECT cb.slug, cb.token FROM public.client_boards cb WHERE cb.slug IN ('risedtc-com', 'swishdm-live', 'arch-agency') AND cb.token IS NOT NULL ORDER BY cb.slug LOOP
    SET LOCAL ROLE anon;
    FOREACH x IN ARRAY ARRAY['get_client_board($1, $2)', 'client_board_outreach_status($1, $2)', 'client_board_outreach_log($1, $2)', 'client_board_outreach_usage($1, $2)',
        'client_board_report($1, $2)', 'client_board_schedule($1, $2)', 'client_board_hide_draft($1, $2, ''00000000-0000-0000-0000-000000000000''::uuid)'] LOOP
      BEGIN
        EXECUTE 'select public.' || x USING brd.slug, brd.token INTO j;
        bc0 := bc0 || jsonb_build_object(brd.slug || ' ' || split_part(x, '(', 1),
          CASE WHEN x LIKE 'get_client_board%' THEN (j IS NOT NULL)::text ELSE coalesce(j->>'ok', 'null') || coalesce(' ' || (j->>'error'), '') END || ' ' || md5(j::text));
      EXCEPTION WHEN OTHERS THEN bc0 := bc0 || jsonb_build_object(brd.slug || ' ' || split_part(x, '(', 1), 'raised ' || SQLSTATE || ' ' || SQLERRM);
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
  -- Before batch o: a board member who is not an admin gets past the session check of invite_board_member (the bad
  -- email stops it one step later, so nothing is written).
  INSERT INTO public.client_board_sessions (slug, email, token_hash, expires_at)
  VALUES ('risedtc-com', 'zz-locktest-member@example.invalid', encode(extensions.digest('zz-locktest-member', 'sha256'), 'hex'), now() + interval '5 minutes');
  SELECT (public._board_owner_emails(r.platform))[1] INTO adm FROM public.client_registry r WHERE r.platform->'board'->>'slug' = 'risedtc-com' LIMIT 1;
  IF adm IS NOT NULL THEN
    INSERT INTO public.client_board_sessions (slug, email, token_hash, expires_at)
    VALUES ('risedtc-com', adm, encode(extensions.digest('zz-locktest-admin', 'sha256'), 'hex'), now() + interval '5 minutes');
  END IF;
  SELECT md5(p.prosrc) INTO src0 FROM pg_proc p WHERE p.oid = 'public.invite_board_member(text, text, text)'::regprocedure;
  SET LOCAL ROLE anon;
  inv0 := public.invite_board_member('risedtc-com', 'zz-locktest-member', 'zz')->>'error';
  RESET ROLE;
  res := res || jsonb_build_object('s00_before_invite_by_a_non_admin_member', inv0);
  -- Before the fix, as the signed-in user: the prospect name edit fails.
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.outreach_prospects SET name = name || ' zz' WHERE id = pid;
    GET DIAGNOSTICS n = ROW_COUNT; e0 := 'ok rows=' || n;
  EXCEPTION WHEN OTHERS THEN e0 := SQLSTATE || ' ' || SQLERRM;
  END;
  BEGIN
    UPDATE public.carousel_drafts SET updated_at = updated_at WHERE id = did;
    GET DIAGNOSTICS n = ROW_COUNT; x := 'ok rows=' || n;
  EXCEPTION WHEN OTHERS THEN x := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  res := res || jsonb_build_object('s00_before_signed_in_prospect_name_edit', e0, 's00_before_signed_in_draft_update', x);

  EXECUTE $mig$ __MIG_H__ $mig$;
  EXECUTE $mig$ __MIG_I__ $mig$;
  EXECUTE $mig$ __MIG_J__ $mig$;
  EXECUTE $mig$ __MIG_K__ $mig$;
  EXECUTE $mig$ __MIG_L__ $mig$;
  EXECUTE $mig$ __MIG_M__ $mig$;
  EXECUTE $mig$ __MIG_N__ $mig$;
  EXECUTE $mig$ __MIG_O__ $mig$;

  SELECT jsonb_object_agg(p.oid::regprocedure::text, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a)) INTO fn1
    FROM pg_proc p WHERE p.oid = ANY (SELECT ('public.' || q)::regprocedure::oid FROM unnest(fn_all) q);
  SELECT jsonb_object_agg(c.relname, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a)) INTO vw1
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (vw_all);

  -- 1. Catalog after the lock.
  res := res || jsonb_build_object(
    's01_owner_rights_functions_anon_can_call_after', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')),
    's01_of_them_not_on_the_public_list', (SELECT coalesce(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
        AND has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT p.oid = ANY (SELECT ('public.' || q)::regprocedure::oid FROM unnest(fn_public) q)),
    's01_public_list_still_callable_by_anon_of_89', (SELECT count(*) FROM unnest(fn_public) q WHERE has_function_privilege('anon', ('public.' || q)::regprocedure, 'EXECUTE')),
    's01_locked_functions_anon_or_signed_in_can_call_of_81', (SELECT count(*) FROM unnest(fn_locked) q WHERE has_function_privilege('anon', ('public.' || q)::regprocedure, 'EXECUTE') OR has_function_privilege('authenticated', ('public.' || q)::regprocedure, 'EXECUTE')),
    's01_locked_functions_service_role_can_call_of_81', (SELECT count(*) FROM unnest(fn_locked) q WHERE has_function_privilege('service_role', ('public.' || q)::regprocedure, 'EXECUTE')),
    's01_signed_in_functions_anon_can_call_of_18', (SELECT count(*) FROM unnest(fn_signed) q WHERE has_function_privilege('anon', ('public.' || q)::regprocedure, 'EXECUTE')),
    's01_signed_in_functions_signed_in_and_service_can_call_of_18', (SELECT count(*) FROM unnest(fn_signed) q WHERE has_function_privilege('authenticated', ('public.' || q)::regprocedure, 'EXECUTE') AND has_function_privilege('service_role', ('public.' || q)::regprocedure, 'EXECUTE')),
    's01_functions_with_a_public_grant_left', (SELECT count(*) FROM unnest(fn_locked || fn_signed) q WHERE fn1->>(('public.' || q)::regprocedure::text) ~ '"=X/'),
    's01_views_with_an_anon_grant_after', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm') AND c.relacl::text ~ '[{,]anon='),
    's01_locked_views_with_anon_or_signed_in_grant_of_56', (SELECT count(*) FROM unnest(vw_locked) q WHERE vw1->>q ~ '"(anon|authenticated)='),
    's01_signed_in_views_keep_signed_in_read', (SELECT count(*) FROM unnest(vw_signed || vw_signed_noanon) q WHERE has_table_privilege('authenticated', ('public.' || q)::regclass, 'SELECT')),
    's01_views_service_role_can_read', (SELECT count(*) FROM unnest(vw_all) q WHERE has_table_privilege('service_role', ('public.' || q)::regclass, 'SELECT')),
    's01_trigger_functions_in_locked_list', 38,
    's01_triggers_still_enabled_on_them', (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype
        AND p.oid = ANY (SELECT ('public.' || q)::regprocedure::oid FROM unnest(fn_locked) q) AND t.tgenabled::text <> 'D'));

  -- 2. Blocked, as the public key (anon): every locked view, every locked function that is safe to call.
  SET LOCAL ROLE anon;
  blocked := 0; leaks := '[]'::jsonb;
  FOREACH rel IN ARRAY vw_locked || vw_signed LOOP
    FOREACH x IN ARRAY ARRAY['select 1 from public.%I limit 1', 'delete from public.%I where false'] LOOP
      BEGIN
        EXECUTE format(x, rel);
        leaks := leaks || to_jsonb(rel || ': ' || split_part(x, ' ', 1));
      EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1;
                -- a view that takes no writes refuses a delete with 55000 before the permission check: still no way in
                WHEN object_not_in_prerequisite_state THEN IF x LIKE 'delete%' THEN blocked := blocked + 1; ELSE leaks := leaks || to_jsonb(rel || ': ' || SQLSTATE); END IF;
                WHEN OTHERS THEN leaks := leaks || to_jsonb(rel || ': ' || split_part(x, ' ', 1) || ' -> ' || SQLSTATE);
      END;
    END LOOP;
  END LOOP;
  res := res || jsonb_build_object('s02_anon_view_reads_and_writes_blocked_of_' || (2 * cardinality(vw_locked || vw_signed)), blocked, 's02_anon_view_leaks', leaks);
  blocked := 0; leaks := '[]'::jsonb;
  FOREACH f IN ARRAY calls_locked || calls_signed LOOP
    BEGIN
      EXECUTE 'select public.' || f;
      leaks := leaks || to_jsonb(f);
    EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM LIKE 'permission denied for function %' THEN blocked := blocked + 1; ELSE leaks := leaks || to_jsonb(f || ' -> ran: ' || SQLERRM); END IF;
      WHEN OTHERS THEN leaks := leaks || to_jsonb(f || ' -> ran: ' || SQLSTATE);
    END;
  END LOOP;
  res := res || jsonb_build_object('s02_anon_function_calls_blocked_of_' || cardinality(calls_locked || calls_signed), blocked, 's02_anon_function_leaks', leaks);
  -- the gate word no longer opens the operator functions for the public key
  BEGIN
    x := public.operator_outreach_templates('clientops', 'risedtc')->>'ok';
  EXCEPTION WHEN insufficient_privilege THEN x := 'blocked';
  END;
  res := res || jsonb_build_object('s02_anon_operator_templates_with_the_gate_word', x);
  RESET ROLE;

  -- 3. Blocked, as a signed-in user: the service-only and no-caller objects.
  SET LOCAL ROLE authenticated;
  blocked := 0; leaks := '[]'::jsonb;
  FOREACH rel IN ARRAY vw_locked LOOP
    BEGIN
      EXECUTE format('select 1 from public.%I limit 1', rel);
      leaks := leaks || to_jsonb(rel);
    EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1;
              WHEN OTHERS THEN leaks := leaks || to_jsonb(rel || ' -> ' || SQLSTATE);
    END;
  END LOOP;
  res := res || jsonb_build_object('s03_signed_in_view_reads_blocked_of_56', blocked, 's03_signed_in_view_leaks', leaks);
  blocked := 0; leaks := '[]'::jsonb;
  FOREACH f IN ARRAY calls_locked LOOP
    BEGIN
      EXECUTE 'select public.' || f;
      leaks := leaks || to_jsonb(f);
    EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM LIKE 'permission denied for function %' THEN blocked := blocked + 1; ELSE leaks := leaks || to_jsonb(f || ' -> ran: ' || SQLERRM); END IF;
      WHEN OTHERS THEN leaks := leaks || to_jsonb(f || ' -> ran: ' || SQLSTATE);
    END;
  END LOOP;
  res := res || jsonb_build_object('s03_signed_in_function_calls_blocked_of_37', blocked, 's03_signed_in_function_leaks', leaks);

  -- 4. Still working, as the signed-in app user (still role authenticated): what the inbox app and the operator panel call.
  SELECT count(*) INTO n FROM public.inbox_governor();
  res := res || jsonb_build_object('s04_app_inbox_governor_rows', n);
  SELECT count(*) INTO n FROM public.prospect_store_numbers(pid);
  res := res || jsonb_build_object('s04_app_prospect_store_numbers_runs', n >= 0,
    's04_app_inbox_schedule_snapshot', public.inbox_schedule_snapshot(pid) IS NOT NULL,
    's04_app_phone_lanes_governor_error', public.inbox_phone_lanes_pick_r3(ARRAY['gov'])->'gov'->'error',
    's04_panel_operator_templates_ok', public.operator_outreach_templates('clientops', 'risedtc')->>'ok',
    's04_panel_operator_email_lane_status_ok', public.operator_email_lane_status('clientops')->>'ok',
    's04_panel_operator_post_stats_runs', public.operator_client_post_stats('clientops', 'risedtc') IS NOT NULL);
  blocked := 0; leaks := '[]'::jsonb;
  FOREACH rel IN ARRAY ARRAY['inbox_filter_spec_v', 'inbox_scan_opens_v', 'inbox_replacement_v', 'inbox_accept_v2', 'inbox_day_ledger_v', 'inbox_inbound_daily_v',
      'scheduled_ops_status', 'engine_counter_day_v', 'signal_events', 'client_instances_safe', 'kyle_steal_box', 'pageviews_daily', 'own_posts_scored',
      'inbox_pipeline_v', 'claude_usage_daily', 'inbox_arch_copy_route_v'] LOOP
    BEGIN
      EXECUTE format('select 1 from public.%I limit 1', rel);
      blocked := blocked + 1;
    EXCEPTION WHEN OTHERS THEN leaks := leaks || to_jsonb(rel || ' -> ' || SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
  res := res || jsonb_build_object('s04_app_view_reads_ok_of_16', blocked, 's04_app_view_read_failures', leaks);
  -- the prospect edit: fires the owner-rights triggers whose functions lost their grants, and needs the new grant
  BEGIN
    UPDATE public.outreach_prospects SET name = name || ' zz' WHERE id = pid;
    GET DIAGNOSTICS n = ROW_COUNT; e1 := 'ok rows=' || n;
  EXCEPTION WHEN OTHERS THEN e1 := SQLSTATE || ' ' || SQLERRM;
  END;
  res := res || jsonb_build_object('s04_app_prospect_name_edit_after', e1);
  BEGIN
    UPDATE public.carousel_drafts SET updated_at = updated_at WHERE id = did;
    GET DIAGNOSTICS n = ROW_COUNT; e1 := 'ok rows=' || n;
  EXCEPTION WHEN OTHERS THEN e1 := SQLSTATE || ' ' || SQLERRM;
  END;
  res := res || jsonb_build_object('s04_app_draft_update_fires_locked_triggers', e1);
  RESET ROLE;

  -- 5. Still working, as the service role: read-only functions and the views n8n, Railway and the edge functions read.
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO n FROM public.reply_exemplar_pairs('ivan', 2);
  SELECT count(*) INTO m FROM public.recent_fingerprints(2, 'ivan');
  -- PERFORM, so the planner cannot drop the call: each function body really runs.
  PERFORM public.swishdm_exclusion_hit(null, 'example.invalid', null, 'swishdm');
  PERFORM public.rise_storeleads_band('example.invalid');
  PERFORM public.rise_storeleads_spend_pts('example.invalid');
  PERFORM public.swishdm_rise_bigstore_open('swishdm', 'example.invalid');
  PERFORM * FROM public.own_engager_identity_matches('zz-none', null);
  PERFORM public._risedtc_outreach_log();
  PERFORM public._swishdm_outreach_status();
  PERFORM public.idea_source_policy_get();
  res := res || jsonb_build_object('s05_service_reply_exemplar_pairs', n, 's05_service_recent_fingerprints', m, 's05_service_eight_function_bodies_ran', true);
  blocked := 0; leaks := '[]'::jsonb;
  FOREACH rel IN ARRAY ARRAY['outreach_owed_threads', 'outreach_invite_outcomes_v', 'outreach_stratum_rates_v', 'outreach_anchor_protect_v', 'topic_query_outcomes_v',
      'topic_author_outcomes_v', 'harvest_source_gpp', 'harvest_source_yield', 'client_post_engager_stats_v', 'scheduled_checks_due_for_notify', 'lm_performance',
      'audn_repeatable_competitor_classification_v', 'ivan_cold_signal_measure', 'experiments_latest', 'inbox_sends_v', 'inbox_messages_v', 'own_posts_scored'] LOOP
    BEGIN
      EXECUTE format('select 1 from public.%I limit 1', rel);
      blocked := blocked + 1;
    EXCEPTION WHEN OTHERS THEN leaks := leaks || to_jsonb(rel || ' -> ' || SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
  res := res || jsonb_build_object('s05_service_view_reads_ok_of_17', blocked, 's05_service_view_read_failures', leaks);
  RESET ROLE;

  -- 6. Still working, as the public key: what the public pages call. Bad tokens on purpose, so nothing is read or written.
  SET LOCAL ROLE anon;
  j := '{}'::jsonb;
  FOREACH x IN ARRAY ARRAY[
      'engine_metrics|(public.public_engine_metrics() is not null)::text',
      'recent_own_posts|(select count(*)::text from public.recent_own_posts(1))',
      'board_brand_unknown_board|public.client_board_public_brand(''zz-no-such-board'')->>''ok''',
      'board_wrong_token_gives_nothing|(public.get_client_board(''zz-no-such-board'', ''zz'') is null)::text',
      'board_report_wrong_session|coalesce(public.client_board_report_v2(''zz-no-such-board'', ''zz'')->>''error'', ''answered'')',
      'board_audience_wrong_session|coalesce(public.client_board_audience_v2(''zz-no-such-board'', ''zz'')->>''error'', ''answered'')',
      'plan_review_bad_link|public.client_plan_review_load(''zz'')->>''error''',
      'outside_health_wrong_key|public.outside_health(''zz'')->>''ok''',
      'drip_page_bad_token|(public.ios_drip_page(''zz'', ''zz'') is null)::text',
      'scan_link_wrong_key|public.rise_scan_link_list(''zz'')->>''error''',
      'recording_bad_token|(public.recording_view_by_token(''zz'') is null)::text',
      'plugin_snapshot_wrong_gate|public.cb35_plugin_snapshot_v1(''zz'', ''pooled'', 7)::text'] LOOP
    BEGIN
      EXECUTE 'select ' || split_part(x, '|', 2) INTO e1;
      j := j || jsonb_build_object(split_part(x, '|', 1), coalesce(e1, 'null'));
    EXCEPTION WHEN OTHERS THEN j := j || jsonb_build_object(split_part(x, '|', 1), 'raised: ' || SQLERRM);
    END;
  END LOOP;
  res := res || jsonb_build_object('s06_public_pages_as_anon', j);
  RESET ROLE;

  -- The client boards' real calls with a real board link, as the public key (token variants; the token never leaves
  -- the database). These reach the helpers that lose their grants: get_client_board -> board_with_lm_stats, outreach
  -- status/log/usage -> _risedtc_* / _swishdm_*, hide_draft -> _client_board_hide_apply (unknown draft: no write).
  bc1 := '{}'::jsonb;
  FOR brd IN SELECT cb.slug, cb.token FROM public.client_boards cb WHERE cb.slug IN ('risedtc-com', 'swishdm-live', 'arch-agency') AND cb.token IS NOT NULL ORDER BY cb.slug LOOP
    SET LOCAL ROLE anon;
    FOREACH x IN ARRAY ARRAY['get_client_board($1, $2)', 'client_board_outreach_status($1, $2)', 'client_board_outreach_log($1, $2)', 'client_board_outreach_usage($1, $2)',
        'client_board_report($1, $2)', 'client_board_schedule($1, $2)', 'client_board_hide_draft($1, $2, ''00000000-0000-0000-0000-000000000000''::uuid)'] LOOP
      BEGIN
        EXECUTE 'select public.' || x USING brd.slug, brd.token INTO j;
        bc1 := bc1 || jsonb_build_object(brd.slug || ' ' || split_part(x, '(', 1),
          CASE WHEN x LIKE 'get_client_board%' THEN (j IS NOT NULL)::text ELSE coalesce(j->>'ok', 'null') || coalesce(' ' || (j->>'error'), '') END || ' ' || md5(j::text));
      EXCEPTION WHEN OTHERS THEN bc1 := bc1 || jsonb_build_object(brd.slug || ' ' || split_part(x, '(', 1), 'raised ' || SQLSTATE || ' ' || SQLERRM);
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
  res := res || jsonb_build_object('s06_board_real_link_calls_checked', (SELECT count(*) FROM jsonb_object_keys(bc1)),
    's06_board_real_link_calls_same_as_before', bc1 = bc0,
    's06_board_real_link_calls_that_differ', (SELECT coalesce(jsonb_object_agg(a.key, jsonb_build_array(a.value, bc1->a.key)), '{}'::jsonb) FROM jsonb_each(bc0) a WHERE a.value IS DISTINCT FROM bc1->a.key),
    's06_board_real_link_calls_refused_or_raised', (SELECT count(*) FROM jsonb_each_text(bc1) a WHERE a.value ~ '^(raised|false|null)' AND a.key NOT LIKE '% client_board_hide_draft'),
    's06_board_hide_draft_reaches_helper', (SELECT jsonb_agg(DISTINCT split_part(a.value, ' ', 2)) FROM jsonb_each_text(bc1) a WHERE a.key LIKE '% client_board_hide_draft'));
  SET LOCAL ROLE anon;
  res := res || jsonb_build_object('s06_after_invite_by_a_non_admin_member', public.invite_board_member('risedtc-com', 'zz-locktest-member', 'zz')->>'error',
    's06_after_invite_by_a_board_admin_passes_the_role_check', CASE WHEN adm IS NULL THEN 'no owner email on the board' ELSE public.invite_board_member('risedtc-com', 'zz-locktest-admin', 'zz')->>'error' END,
    's06_after_invite_without_a_session', public.invite_board_member('risedtc-com', 'zz-no-session', 'zz')->>'error');
  RESET ROLE;

  -- 7. Rollback files give the old state back exactly.
  EXECUTE $rb$ __RB_O__ $rb$;
  EXECUTE $rb$ __RB_N__ $rb$;
  EXECUTE $rb$ __RB_M__ $rb$;
  EXECUTE $rb$ __RB_L__ $rb$;
  EXECUTE $rb$ __RB_K__ $rb$;
  EXECUTE $rb$ __RB_J__ $rb$;
  EXECUTE $rb$ __RB_I__ $rb$;
  EXECUTE $rb$ __RB_H__ $rb$;
  SELECT jsonb_object_agg(p.oid::regprocedure::text, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a)) INTO fn2
    FROM pg_proc p WHERE p.oid = ANY (SELECT ('public.' || q)::regprocedure::oid FROM unnest(fn_all) q);
  SELECT jsonb_object_agg(c.relname, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a)) INTO vw2
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (vw_all);
  res := res || jsonb_build_object('s07_rollback_restores_functions', fn2 = fn0, 's07_rollback_restores_views', vw2 = vw0,
    's07_state_changed_by_migration', fn1 <> fn0 AND vw1 <> vw0,
    's07_rollback_restores_invite_board_member_body', (SELECT md5(p.prosrc) = src0 FROM pg_proc p WHERE p.oid = 'public.invite_board_member(text, text, text)'::regprocedure),
    's07_public_functions_untouched_by_migration', (SELECT bool_and(fn1->k = fn0->k) FROM (SELECT ('public.' || q)::regprocedure::text k FROM unnest(fn_public) q) z));

  RAISE EXCEPTION 'RESULT %', res;
END $t$;
