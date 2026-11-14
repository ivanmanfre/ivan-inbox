-- Rolled-back test of 20261114g on live data: apply, check, apply the rollback, check, then RAISE so nothing stays.
DO $t$
DECLARE res jsonb := '{}'::jsonb; s text; links0 jsonb; links1 jsonb; links2 jsonb; cols0 jsonb; cols1 jsonb; cov0 jsonb; cov1 jsonb; r jsonb; x jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('c', client_id, 'm', meeting_id, 'p', post_key, 'k', person_key) ORDER BY client_id, meeting_id, post_key) INTO links0 FROM public.cb37_booking_post_links_v;
  SELECT jsonb_agg(jsonb_build_object('v', c.relname, 'n', a.attnum, 'a', a.attname, 't', format_type(a.atttypid, a.atttypmod)) ORDER BY c.relname, a.attnum) INTO cols0
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname IN ('cb37_booking_post_links_v', 'cb37_booking_coverage_v', 'cb37_booking_name_candidates_v', 'cb37_post_snapshots_v', 'cb37_post_base_v', 'cb37_engager_fit_v', 'cb37_post_engagers_v', 'cb37_draft_post_links_v', 'cb37_post_results_v') AND a.attnum > 0;
  SELECT jsonb_object_agg(k, n) INTO cov0 FROM (SELECT client_id || ':' || left(reason, 30) k, count(*) n FROM public.cb37_booking_coverage_v GROUP BY 1) z;
  EXECUTE $mig$
__MIGRATION__
  $mig$;
  -- 1. Booking links: every old link kept, new ones listed with their evidence.
  SELECT jsonb_agg(jsonb_build_object('c', client_id, 'm', meeting_id, 'p', post_key, 'k', person_key) ORDER BY client_id, meeting_id, post_key) INTO links1 FROM public.cb37_booking_post_links_v;
  res := res || jsonb_build_object('s01_links_before', jsonb_array_length(coalesce(links0, '[]')), 's01_links_after', jsonb_array_length(coalesce(links1, '[]')),
    's01_old_links_kept', (SELECT bool_and(links1 @> jsonb_build_array(e)) FROM jsonb_array_elements(coalesce(links0, '[]')) e),
    's01_bookings_linked_before', (SELECT count(DISTINCT e->>'m') FROM jsonb_array_elements(coalesce(links0, '[]')) e),
    's01_bookings_linked_after', (SELECT count(DISTINCT meeting_id) FROM public.cb37_booking_post_links_v),
    's01_new', (SELECT jsonb_agg(jsonb_build_object('m', l.meeting_id, 'who', b.booker_name, 'booked', l.booked_at::date, 'post', l.post_key, 'how', l.evidence #>> '{identity,how}', 'engaged', (l.evidence #>> '{engagement,first_seen}')::date))
                FROM public.cb37_booking_post_links_v l JOIN public.booking_attributions b USING (client_id, meeting_id)
               WHERE NOT links0 @> jsonb_build_array(jsonb_build_object('c', l.client_id, 'm', l.meeting_id, 'p', l.post_key, 'k', l.person_key))),
    's01_engaged_before_booking', (SELECT bool_and((evidence #>> '{engagement,first_seen}')::timestamptz <= booked_at) FROM public.cb37_booking_post_links_v));
  SELECT jsonb_agg(jsonb_build_object('v', c.relname, 'n', a.attnum, 'a', a.attname, 't', format_type(a.atttypid, a.atttypmod)) ORDER BY c.relname, a.attnum) INTO cols1
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname IN ('cb37_booking_post_links_v', 'cb37_booking_coverage_v', 'cb37_booking_name_candidates_v', 'cb37_post_snapshots_v', 'cb37_post_base_v', 'cb37_engager_fit_v', 'cb37_post_engagers_v', 'cb37_draft_post_links_v', 'cb37_post_results_v') AND a.attnum > 0;
  SELECT jsonb_object_agg(k, n) INTO cov1 FROM (SELECT client_id || ':' || left(reason, 30) k, count(*) n FROM public.cb37_booking_coverage_v GROUP BY 1) z;
  res := res || jsonb_build_object('s02_columns_same', cols0 = cols1, 's02_coverage_before', cov0, 's02_coverage_after', cov1,
    's02_identity_ambiguous', (SELECT count(*) FROM (SELECT meeting_id FROM public.content_booking_identity_v GROUP BY client_id, meeting_id HAVING count(DISTINCT person_key) > 1) z),
    's02_name_candidates', (SELECT count(*) FROM public.cb37_booking_name_candidates_v));
  -- 2. Source kinds on known labels.
  res := res || jsonb_build_object('s03_kinds', jsonb_build_object(
    'x', public.content_source_kind('normal', 'x_tracked_outlier', 'X outlier by @thekevinjon', '{"writer":"x-outlier-adapter-v2"}'),
    'own', public.content_source_kind('normal', 'Repurposed from your 16 Sep post (3,366 views)', null, '{"origin":"rework"}'),
    'curtis', public.content_source_kind('normal', 'Repurposed from Curtis Howland (DTC paid-social)', null, null),
    'kyle', public.content_source_kind('normal', 'Kyle call', null, null),
    'meet', public.content_source_kind('normal', 'client-arch', 'CLs weekly Meet · 1 Sep 2026', null),
    'pass', public.content_source_kind('normal', 'personal-pass-2026-09-29', 'From your calls', null),
    'manual', public.content_source_kind('normal', 'manual', 'manual', null),
    'lm', public.content_source_kind('normal', 'lead-magnet', 'Lead magnet · Claude Paid Ads System', null),
    'planner', public.content_source_kind('normal', 'client-risedtc', 'From RISE DTC''s portfolio', '{"structure_used":"STORY"}'),
    'mirror_rev', public.content_source_kind('normal', 'client-arch', 'Illustrative repricing calculation', '{"structure_used":"MIRROR REVERSAL"}'),
    'brain', public.content_source_kind('brain', 'content-brain', 'Content brain', null),
    'none', public.content_source_kind('no_draft', null, null, null)));
  -- 3. The read.
  SET LOCAL timezone = 'Europe/Warsaw';
  res := res || jsonb_build_object('s09_off_sequence', public.content_outcome_read('2026-11-07 00:00:00+00', 'test'));
  r := public.content_outcome_read('2026-11-06 00:00:00+00', 'test');
  res := res || jsonb_build_object('s10_read', r);
  res := res || jsonb_build_object('s11_rows', (SELECT jsonb_agg(jsonb_build_object('c', client_id, 'd', dimension, 'g', grp, 'n', posts, 'imp', imp_median, 'bpp', buyer_per_post, 'b', array[buyer_lo, buyer_hi], 'w', wrote_sum, 'cov', coverage) ORDER BY client_id, dimension, grp)
                                                FROM public.content_outcome_read_rows WHERE read_id = r->>'read_id'));
  res := res || jsonb_build_object('s12_posts_all_mature', (SELECT bool_and(published_at < now() - interval '8 days') FROM public.content_outcome_read_posts WHERE read_id = r->>'read_id'),
    's12_unclassified_other', (SELECT jsonb_agg(source_evidence) FROM public.content_outcome_read_posts WHERE read_id = r->>'read_id' AND source_kind = 'other'));
  res := res || jsonb_build_object('s15_by_client', (SELECT jsonb_object_agg(client_id, n) FROM (SELECT client_id, count(*) n FROM public.content_outcome_read_posts WHERE read_id = r->>'read_id' GROUP BY 1) z),
    's15_swishdm_view', (SELECT jsonb_build_object('posts', count(*), 'with_imp_d7', count(imp_d7), 'cov', jsonb_agg(DISTINCT engager_coverage_d7), 'buyer_nonnull', count(buyer_engagers_d7), 'kinds', jsonb_agg(DISTINCT source_kind)) FROM public.content_post_outcome_d7_v WHERE client_id = 'swishdm'),
    's15_deleted_in_view', (SELECT count(*) FROM public.content_post_outcome_d7_v WHERE deleted),
    's15_deleted_with_numbers', (SELECT count(*) FROM public.content_post_outcome_d7_v WHERE deleted AND (imp_d7 IS NOT NULL OR engagers_d7 IS NOT NULL)));
  res := res || jsonb_build_object('s13_rerun', public.content_outcome_read('2026-11-06 00:00:00+00', 'test'), 's13_due', public.content_outcome_read_due());
  x := public.content_outcome_latest('ivan');
  res := res || jsonb_build_object('s14_latest_ivan_rows', jsonb_array_length(x #> '{read,rows}'), 's14_latest_bad_client', public.content_outcome_latest('nobody') IS NULL,
    's14_latest_bytes', length(x::text), 's14_cron', (SELECT schedule FROM cron.job WHERE jobname = 'content-outcome-read'));
  -- 4. Roles.
  BEGIN SET LOCAL ROLE authenticated; x := public.content_outcome_latest('risedtc'); RESET ROLE; res := res || jsonb_build_object('s20_auth_latest', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s20_auth_latest', s); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE anon; x := public.content_outcome_latest('risedtc'); RESET ROLE; res := res || jsonb_build_object('s21_anon_latest', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s21_anon_latest', s); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE authenticated; PERFORM 1 FROM public.content_outcome_reads; RESET ROLE; res := res || jsonb_build_object('s22_auth_table', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s22_auth_table', s); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE authenticated; PERFORM public.content_outcome_read('2026-11-06 00:00:00+00', 'x'); RESET ROLE; res := res || jsonb_build_object('s23_auth_run', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s23_auth_run', s); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE anon; PERFORM 1 FROM public.content_booking_identity_v; RESET ROLE; res := res || jsonb_build_object('s24_anon_identity', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s24_anon_identity', s); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
    x := public.content_outcome_latest('risedtc'); PERFORM set_config('request.jwt.claims', '', true); RESET ROLE; res := res || jsonb_build_object('s25_unentitled_latest', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s25_unentitled_latest', s); END;
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;
  -- 5. The rollback restores the old links exactly.
  EXECUTE $rb$
__ROLLBACK__
  $rb$;
  SELECT jsonb_agg(jsonb_build_object('c', client_id, 'm', meeting_id, 'p', post_key, 'k', person_key) ORDER BY client_id, meeting_id, post_key) INTO links2 FROM public.cb37_booking_post_links_v;
  res := res || jsonb_build_object('s30_rollback_links_same', links2 IS NOT DISTINCT FROM links0,
    's30_rollback_identity_gone', to_regclass('public.content_booking_identity_v') IS NULL,
    's30_rollback_cron_gone', NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-outcome-read'),
    's30_rollback_fn_gone', to_regprocedure('public.content_outcome_latest(text)') IS NULL);
  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
