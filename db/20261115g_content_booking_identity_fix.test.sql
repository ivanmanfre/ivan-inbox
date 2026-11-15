-- Rolled-back test of 20261115g on live data: rows before, a made-up cross-client booking under the old and the new
-- views, rows after, the rollback, then RAISE so nothing stays. The runner replaces the MIGRATION and ROLLBACK
-- placeholders (wrapped in double underscores) with each file's body, BEGIN; / COMMIT; lines removed.
DO $t$
DECLARE res jsonb := '{}'::jsonb; h0 jsonb; h1 jsonb; h2 jsonb; c0 jsonb; c1 jsonb; mid text; pid_old uuid; pid_arch uuid;
        em_old text; nm_old text; r_old text; r_new text;
BEGIN
  SELECT jsonb_build_object(
    'identity', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id, person_key)::text, '')) || ':' || count(*) FROM public.content_booking_identity_v v),
    'links', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id, post_key, person_key)::text, '')) || ':' || count(*) FROM public.cb37_booking_post_links_v v),
    'coverage', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id)::text, '')) || ':' || count(*) FROM public.cb37_booking_coverage_v v)) INTO h0;
  SELECT jsonb_agg(jsonb_build_object('v', c.relname, 'n', a.attnum, 'a', a.attname, 't', format_type(a.atttypid, a.atttypmod)) ORDER BY c.relname, a.attnum) INTO c0
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('content_booking_identity_v', 'cb37_booking_post_links_v', 'cb37_booking_coverage_v') AND a.attnum > 0;

  -- A made-up cross-client booking: one RISE booking that knows its booker by prospect id is pointed at an ARCH
  -- prospect, with an email and a name that match nobody.
  SELECT v.meeting_id INTO mid FROM public.cb37_booking_coverage_v v JOIN public.booking_attributions b USING (meeting_id)
   WHERE v.client_id = 'risedtc' AND b.prospect_id IS NOT NULL AND v.reason LIKE 'booker never engaged%' ORDER BY v.booked_at DESC LIMIT 1;
  SELECT b.prospect_id, b.booker_email, b.booker_name INTO pid_old, em_old, nm_old FROM public.booking_attributions b WHERE b.meeting_id = mid;
  SELECT p.id INTO pid_arch FROM public.outreach_prospects p JOIN public.outreach_campaigns c ON c.id = p.campaign_id
   WHERE c.client_id = 'arch' AND NULLIF(btrim(p.linkedin_profile_id), '') IS NOT NULL ORDER BY p.created_at DESC LIMIT 1;
  UPDATE public.booking_attributions SET prospect_id = pid_arch, booker_email = 'locktest@example.invalid', booker_name = 'Zz Locktest' WHERE meeting_id = mid;
  SELECT left(reason, 40) INTO r_old FROM public.cb37_booking_coverage_v WHERE meeting_id = mid;

  EXECUTE $mig$
__MIGRATION__
  $mig$;

  SELECT left(reason, 40) INTO r_new FROM public.cb37_booking_coverage_v WHERE meeting_id = mid;
  res := res || jsonb_build_object('s01_cross_client_booking_old_views', r_old, 's01_cross_client_booking_new_views', r_new,
    's01_cross_client_links_new_views', (SELECT count(*) FROM public.cb37_booking_post_links_v WHERE meeting_id = mid));
  UPDATE public.booking_attributions SET prospect_id = pid_old, booker_email = em_old, booker_name = nm_old WHERE meeting_id = mid;

  -- Real data: every row of the three views is the same as before, and so is every column.
  SELECT jsonb_build_object(
    'identity', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id, person_key)::text, '')) || ':' || count(*) FROM public.content_booking_identity_v v),
    'links', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id, post_key, person_key)::text, '')) || ':' || count(*) FROM public.cb37_booking_post_links_v v),
    'coverage', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id)::text, '')) || ':' || count(*) FROM public.cb37_booking_coverage_v v)) INTO h1;
  SELECT jsonb_agg(jsonb_build_object('v', c.relname, 'n', a.attnum, 'a', a.attname, 't', format_type(a.atttypid, a.atttypmod)) ORDER BY c.relname, a.attnum) INTO c1
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('content_booking_identity_v', 'cb37_booking_post_links_v', 'cb37_booking_coverage_v') AND a.attnum > 0;
  res := res || jsonb_build_object('s02_rows_before', (SELECT jsonb_object_agg(key, split_part(value #>> '{}', ':', 2)) FROM jsonb_each(h0)),
    's02_identity_rows_same', h1->'identity' = h0->'identity', 's02_links_rows_same', h1->'links' = h0->'links',
    's02_coverage_rows_same', h1->'coverage' = h0->'coverage', 's02_columns_same', c1 = c0);

  -- Headline cases on the live view's own pattern (taken from its definition).
  res := res || jsonb_build_object('s03_pattern_in_view', position('(?:\m\w\.|(?!\m(?:at|speak\w*|spoke|keynot\w*|panell?ists?|moderator|moderating|presenter|presenting|attending|attended|exhibiting|exhibitor|talking)\M|[.!?]\s)[^|•·@,/();\n\r]|\((?:\m\w\.|(?!\m(?:at|speak\w*|spoke|keynot\w*|panell?ists?|moderator|moderating|presenter|presenting|attending|attended|exhibiting|exhibitor|talking)\M|[.!?]\s)[^|•·@,/();\n\r])*\))*\mat\M' IN pg_get_viewdef('public.content_booking_identity_v'::regclass)) > 0);

  EXECUTE $rb$
__ROLLBACK__
  $rb$;
  SELECT jsonb_build_object(
    'identity', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id, person_key)::text, '')) || ':' || count(*) FROM public.content_booking_identity_v v),
    'links', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id, post_key, person_key)::text, '')) || ':' || count(*) FROM public.cb37_booking_post_links_v v),
    'coverage', (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY client_id, meeting_id)::text, '')) || ':' || count(*) FROM public.cb37_booking_coverage_v v)) INTO h2;
  res := res || jsonb_build_object('s04_rollback_rows_same', h2 = h0,
    's04_rollback_pattern_back', position('\M[^|•·@]*?\mat\M' IN pg_get_viewdef('public.content_booking_identity_v'::regclass)) > 0);
  RAISE EXCEPTION 'RESULT %', res;
END $t$;
