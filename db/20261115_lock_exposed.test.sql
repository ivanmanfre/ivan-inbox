-- Rolled-back test of 20261115a..f on live data: apply all six batches, check both ways, apply the six rollbacks,
-- check the old state is back, then RAISE so nothing stays. The runner replaces each MIG / RB placeholder (letters A
-- to F, wrapped in double underscores) with that file's body, BEGIN; / COMMIT; lines removed. The result is the RAISE text.
-- The test holds the tables' locks while it runs, so it only does fast checks (about 5 seconds). The slow callers
-- (client_guard_sweep 67 s, booking_rejoin_late_prospects 7 s, lane_chain_weekly 3 s, the cb37 views) are checked
-- under their real roles after each batch is applied, where no lock is held.
DO $t$
DECLARE
  res jsonb := '{}'::jsonb; st0 jsonb; st1 jsonb; st2 jsonb; fn0 jsonb; fn2 jsonb;
  rel text; rol text; f text; n int; m int; uid uuid; pid uuid; did uuid;
  blocked int; leaks jsonb; fblocked int; fleaks jsonb; x text; e0 text; e1 text;
  rels text[] := ARRAY['_bak_arch_anchors_20260921','_bak_arch_copyvert_20260921','_bak_arch_expansion_geo_20260922',
    '_bak_arch_promote_20260921','_bak_arch_reviewjob_20260922','_bak_x422_messages_20260921','_bak_x422_prospects_20260921',
    '_bak_x422_rise_messages_20260921','_bak_x422_rise_prospects_20260921','_void_post_engagers_ivan_rubric_20260812',
    'content_prompts_bak_arch_facts_20260914','ivan_openprofile_route_backfill_20261020','outreach_templates_backup_20260831',
    'swishdm_harvest_seen_backfill_20261028','swishdm_harvest_seen_geo_requeue_20261020','cb44_spoken_voice',
    'transcript_chunks_quarantine','board_truth_dirty','booking_sync_log','client_guard_booked_keys','draft_deletions',
    'client_generator_config','outreach_enrich_rejects','audn_post_collection_coverage','audn_post_metric_snapshots',
    'booking_attributions',
    'cb37_booking_coverage_v','cb37_booking_name_candidates_v','cb37_booking_post_links_v','cb37_brain_draft_versions_v',
    'cb37_brain_fates_v','cb37_draft_fates_v','cb37_draft_post_links_v','cb37_engager_fit_v','cb37_engager_journey_v',
    'cb37_post_base_v','cb37_post_engagers_v','cb37_post_results_v','cb37_post_snapshots_v','cb44_house_numbers_arch_v',
    'cb44_house_numbers_ivan_v','cb44_house_numbers_risedtc_v','ivan_post_outcome_spine'];
  fns text[] := ARRAY['_bk_cancel_row(text, text)','_client_guard_booked_doms(text, uuid, text)',
    '_client_guard_colleague(text, uuid, text, text, text, text)','_client_guard_core(text, uuid, text, text, text, text, text)',
    '_client_guard_core8(text, uuid, text, text, text, text, text, text)','_client_guard_sweep_company(text, uuid, text, text)',
    'board_truth_mark_dirty(text, text)','client_guard_booked_refresh(text)','client_guard_colleague_warm(text)',
    'client_guard_reason(uuid)','cold_send_guard(uuid)','lane_chain_weekly(text, date)'];
  calls text[] := ARRAY['_bk_cancel_row(null, null)','_client_guard_booked_doms(null, null, null)',
    '_client_guard_colleague(null, null, null, null, null, null)','_client_guard_core(null, null, null, null, null, null, null)',
    '_client_guard_core8(null, null, null, null, null, null, null, null)','_client_guard_sweep_company(null, null, null, null)',
    'board_truth_mark_dirty(null, null)','client_guard_booked_refresh(null)','client_guard_colleague_warm(null)',
    'client_guard_reason(null)','cold_send_guard(null)','lane_chain_weekly(null, null)'];
BEGIN
  -- State before: row level security flag and the sorted grant list of every object.
  SELECT jsonb_object_agg(c.relname, jsonb_build_object('rls', c.relrowsecurity,
           'acl', (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a))) INTO st0
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (rels);
  SELECT jsonb_object_agg(p.oid::regprocedure::text, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a)) INTO fn0
    FROM pg_proc p WHERE p.oid = ANY (SELECT ('public.' || q)::regprocedure::oid FROM unnest(fns) q);
  res := res || jsonb_build_object('s00_objects_found', (SELECT count(*) FROM jsonb_object_keys(st0)), 's00_functions_found', (SELECT count(*) FROM jsonb_object_keys(fn0)));

  -- Baseline for check 5: a signed-in user's prospect edit today. It runs the client-guard trigger first, then stops on
  -- an older, unrelated fault (authenticated cannot execute detector_name_key, used by an index on name). The same edit
  -- must end the same way after the lock; a different error would mean the guard trigger broke.
  SELECT p.id INTO pid FROM public.outreach_prospects p ORDER BY p.created_at DESC LIMIT 1;
  SELECT u.id INTO uid FROM auth.users u ORDER BY u.created_at LIMIT 1;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.outreach_prospects SET company = company WHERE id = pid;
    GET DIAGNOSTICS n = ROW_COUNT; e0 := 'ok rows=' || n;
  EXCEPTION WHEN OTHERS THEN e0 := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;

  EXECUTE $mig$ __MIG_A__ $mig$;
  EXECUTE $mig$ __MIG_B__ $mig$;
  EXECUTE $mig$ __MIG_C__ $mig$;
  EXECUTE $mig$ __MIG_D__ $mig$;
  EXECUTE $mig$ __MIG_E__ $mig$;
  EXECUTE $mig$ __MIG_F__ $mig$;

  SELECT jsonb_object_agg(c.relname, jsonb_build_object('rls', c.relrowsecurity,
           'acl', (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a))) INTO st1
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (rels);
  res := res || jsonb_build_object(
    's01_tables_rls_on', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (rels) AND c.relkind = 'r' AND c.relrowsecurity),
    's01_objects_with_anon_or_auth_grant', (SELECT count(*) FROM jsonb_each(st1) e WHERE e.value->>'acl' ~ '(anon|authenticated)='),
    's01_service_role_grant_kept', (SELECT count(*) FROM jsonb_each(st1) e WHERE e.value->>'acl' ~ 'service_role=arwdDxtm'),
    's01_public_tables_still_open', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT')));

  -- 1. Blocked: the public key (anon) and a signed-in user (authenticated) on every object, every verb.
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    blocked := 0; leaks := '[]'::jsonb; fblocked := 0; fleaks := '[]'::jsonb;
    EXECUTE 'set local role ' || rol;
    FOREACH rel IN ARRAY rels LOOP
      -- tables: read, delete, insert, truncate (104 checks). views: read (17 checks).
      FOREACH x IN ARRAY CASE WHEN rel = ANY (rels[1:26])
          THEN ARRAY['select 1 from public.%I limit 1', 'delete from public.%I where false', 'insert into public.%I default values', 'truncate public.%I']
          ELSE ARRAY['select 1 from public.%I limit 1'] END LOOP
        BEGIN
          EXECUTE format(x, rel);
          leaks := leaks || to_jsonb(rel || ': ' || split_part(x, ' ', 1));
        EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1;
                  WHEN OTHERS THEN leaks := leaks || to_jsonb(rel || ': ' || split_part(x, ' ', 1) || ' -> ' || SQLSTATE);
        END;
      END LOOP;
    END LOOP;
    FOREACH f IN ARRAY calls LOOP
      BEGIN
        EXECUTE 'select public.' || f;
        fleaks := fleaks || to_jsonb(f);
      EXCEPTION WHEN insufficient_privilege THEN fblocked := fblocked + 1;
                WHEN OTHERS THEN fleaks := fleaks || to_jsonb(f || ' -> ' || SQLSTATE);
      END;
    END LOOP;
    -- the invoker-rights functions over the locked objects answer "permission denied" too
    FOREACH f IN ARRAY ARRAY['rise_month_numbers(now() - interval ''7 days'', now())', 'cb37_weekly(''ivan'')', 'booking_rejoin_late_prospects(true)'] LOOP
      BEGIN
        EXECUTE 'select public.' || f;
        fleaks := fleaks || to_jsonb(f);
      EXCEPTION WHEN insufficient_privilege THEN fblocked := fblocked + 1;
                WHEN OTHERS THEN fleaks := fleaks || to_jsonb(f || ' -> ' || SQLSTATE);
      END;
    END LOOP;
    RESET ROLE;
    res := res || jsonb_build_object('s02_' || rol || '_blocked_of_121', blocked, 's02_' || rol || '_leaks', leaks,
                                     's02_' || rol || '_functions_blocked_of_15', fblocked, 's02_' || rol || '_function_leaks', fleaks);
  END LOOP;

  -- 2. Still working: the service role with each real read shape (the filters the callers send).
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO n FROM (SELECT meeting_id, client_id, prospect_id, booker_email FROM public.booking_attributions WHERE client_id = 'risedtc' ORDER BY booked_at DESC LIMIT 5) z;
  res := res || jsonb_build_object('s03_read_booking_attributions', n);
  SELECT count(*) INTO n FROM (SELECT linkedin_profile_id FROM public.outreach_enrich_rejects WHERE client_id = 'risedtc' ORDER BY linkedin_profile_id LIMIT 5) z;
  res := res || jsonb_build_object('s03_read_outreach_enrich_rejects', n);
  SELECT count(*) INTO n FROM (SELECT lane, client_id, version FROM public.client_generator_config WHERE is_active LIMIT 5) z;
  res := res || jsonb_build_object('s03_read_client_generator_config', n);
  SELECT count(*) INTO n FROM (SELECT post_social_id FROM public.audn_post_collection_coverage WHERE client_id = 'arch' LIMIT 5) z;
  res := res || jsonb_build_object('s03_read_audn_coverage', n);
  SELECT count(*) INTO n FROM (SELECT id FROM public.audn_post_metric_snapshots WHERE client_id = 'risedtc' LIMIT 5) z;
  res := res || jsonb_build_object('s03_read_audn_snapshots', n);
  SELECT count(*) INTO n FROM (SELECT 1 FROM public.booking_sync_log LIMIT 3) a, (SELECT 1 FROM public.draft_deletions LIMIT 1) b,
                              (SELECT 1 FROM public.client_guard_booked_keys LIMIT 1) c, (SELECT 1 FROM public.board_truth_dirty LIMIT 1) d;
  res := res || jsonb_build_object('s03_read_internal_tables', n);
  SELECT count(*) INTO n FROM (SELECT 1 FROM public._bak_x422_prospects_20260921 LIMIT 3) z;
  res := res || jsonb_build_object('s03_read_backup_table', n);

  -- 3. Still working: the service role with each real write shape. Every row is a test row and is rolled back.
  --    booking upsert (the three trackers: POST ?on_conflict=meeting_id) fires the board and guard triggers.
  INSERT INTO public.booking_attributions
  SELECT (jsonb_populate_record(NULL::public.booking_attributions, to_jsonb(b) || jsonb_build_object(
            'meeting_id', '__locktest__', 'prospect_id', NULL, 'booker_email', 'locktest@example.invalid', 'booker_name', 'Lock Test',
            'booker_website', NULL, 'prospect_stamped', false, 'verdict', 'unattributed', 'evidence_type', NULL, 'evidence_value', NULL,
            'evidence_strength', NULL, 'campaign_id', NULL, 'opened_by', NULL, 'meeting_title', 'lock test', 'rationale', 'lock test'))).*
    FROM public.booking_attributions b WHERE b.client_id = 'arch' ORDER BY b.booked_at DESC LIMIT 1
  ON CONFLICT (meeting_id) DO UPDATE SET updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.booking_attributions SET meeting_outcome = 'SCHEDULED' WHERE meeting_id = '__locktest__';
  GET DIAGNOSTICS m = ROW_COUNT;
  res := res || jsonb_build_object('s04_write_booking_insert', n, 's04_write_booking_update', m,
    's04_booking_trigger_marked_board', (SELECT dirty_at = now() FROM public.board_truth_dirty WHERE client_id = 'arch'));
  INSERT INTO public.outreach_enrich_rejects (client_id, linkedin_profile_id, skip_reason, rejected_at)
  VALUES ('arch', '__locktest__', 'locktest', now())
  ON CONFLICT (client_id, linkedin_profile_id) DO UPDATE SET skip_reason = excluded.skip_reason, rejected_at = excluded.rejected_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.audn_post_collection_coverage (client_id, post_social_id, last_visited_at, visits, status)
  SELECT 'arch', '__locktest__', now(), 1, c.status FROM public.audn_post_collection_coverage c WHERE c.client_id = 'arch' LIMIT 1
  ON CONFLICT (client_id, post_social_id) DO UPDATE SET visits = excluded.visits;
  GET DIAGNOSTICS m = ROW_COUNT;
  res := res || jsonb_build_object('s04_write_enrich_rejects', n, 's04_write_audn_coverage', m);
  INSERT INTO public.audn_post_metric_snapshots (client_id, post_social_id, cycle_id, captured_at, target_age_days, actual_age_days, impressions, reactions, comments, shares, source, coverage)
  SELECT s.client_id, s.post_social_id, '__locktest__', now(), s.target_age_days, s.actual_age_days, s.impressions, s.reactions, s.comments, s.shares, s.source, s.coverage
    FROM public.audn_post_metric_snapshots s WHERE s.client_id = 'arch' ORDER BY s.captured_at DESC LIMIT 1
  ON CONFLICT (client_id, post_social_id, cycle_id) DO UPDATE SET impressions = excluded.impressions;
  GET DIAGNOSTICS n = ROW_COUNT;
  res := res || jsonb_build_object('s04_write_audn_snapshot', n);

  -- 4. Still working: the guard function n8n calls before every cold send (1,810 calls in 7 days).
  res := res || jsonb_build_object('s05_cold_send_guard', public.cold_send_guard(pid) IS NOT NULL);
  RESET ROLE;

  -- 5. Still working: a signed-in app user. Their own writes fire owner-rights triggers that use the locked
  --    functions and tables (prospect edit -> client guard; draft delete -> draft_deletions).
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.outreach_prospects SET company = company WHERE id = pid;
    GET DIAGNOSTICS n = ROW_COUNT; e1 := 'ok rows=' || n;
  EXCEPTION WHEN OTHERS THEN e1 := SQLSTATE || ' ' || SQLERRM;
  END;
  res := res || jsonb_build_object('s07_app_user_prospect_edit_same_as_before', e1 = e0, 's07_app_user_prospect_edit_result', e1,
    's07_app_outcome_read', public.content_outcome_latest('ivan') IS NOT NULL);
  SELECT d.id INTO did FROM public.carousel_drafts d ORDER BY d.created_at LIMIT 1;
  DELETE FROM public.carousel_drafts WHERE id = did;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  res := res || jsonb_build_object('s07_app_user_draft_delete', n,
    's07_draft_deletion_logged', (SELECT count(*) FROM public.draft_deletions WHERE draft_id = did AND deleted_at = now()));

  -- 6. Rollback files give the old state back exactly.
  EXECUTE $rb$ __RB_F__ $rb$;
  EXECUTE $rb$ __RB_E__ $rb$;
  EXECUTE $rb$ __RB_D__ $rb$;
  EXECUTE $rb$ __RB_C__ $rb$;
  EXECUTE $rb$ __RB_B__ $rb$;
  EXECUTE $rb$ __RB_A__ $rb$;
  SELECT jsonb_object_agg(c.relname, jsonb_build_object('rls', c.relrowsecurity,
           'acl', (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a))) INTO st2
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (rels);
  SELECT jsonb_object_agg(p.oid::regprocedure::text, (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a)) INTO fn2
    FROM pg_proc p WHERE p.oid = ANY (SELECT ('public.' || q)::regprocedure::oid FROM unnest(fns) q);
  res := res || jsonb_build_object('s08_rollback_restores_tables_and_views', st2 = st0, 's08_rollback_restores_functions', fn2 = fn0,
    's08_state_changed_by_migration', st1 <> st0);

  RAISE EXCEPTION 'RESULT %', res;
END $t$;
