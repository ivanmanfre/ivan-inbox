-- Rolled-back test of 20261115p: apply, check, apply the rollback, check, then RAISE so nothing stays.
-- Run with the migration body (without its BEGIN;/COMMIT;) pasted at the two placeholders below.
-- Output: one jsonb in the exception message.
DO $t$
DECLARE res jsonb := '{}'::jsonb; r1 jsonb; r2 jsonb; r3 jsonb; h0 text; h1 text; mart text; mart_tid uuid;
BEGIN
  -- Every column that exists today, every row, hashed: must be identical after the job runs.
  SELECT md5(string_agg(md5(row(b.*)::text), '' ORDER BY b.meeting_id)) INTO h0 FROM public.booking_attributions b;

  EXECUTE $mig$
__MIGRATION__
  $mig$;

  res := res || jsonb_build_object('s01_columns', (SELECT jsonb_agg(attname ORDER BY attnum) FROM pg_attribute
            WHERE attrelid = 'public.booking_attributions'::regclass AND attname LIKE 'held%' AND NOT attisdropped),
    's01_all_null_before_run', (SELECT count(*) = 0 FROM public.booking_attributions WHERE held_basis IS NOT NULL OR held_by_transcript IS NOT NULL));

  -- 2. First run writes every judged RISE row; second run changes nothing.
  r1 := public.rise_booking_held_apply();
  r2 := public.rise_booking_held_apply();
  res := res || jsonb_build_object('s02_first_run', r1, 's02_second_run_changed', r2->'changed', 's02_second_run_cleared', r2->'cleared');

  -- 3. Nothing but held_* moved: hash of the original columns is unchanged (meeting_outcome, updated_at included).
  EXECUTE $q$SELECT md5(string_agg(md5(row(b.meeting_id, b.client_id, b.slug, b.meeting_title, b.booked_at, b.meeting_start,
      b.meeting_outcome, b.booker_email, b.booker_name, b.booker_website, b.verdict, b.evidence_type, b.evidence_value,
      b.prospect_id, b.campaign_id, b.opened_by, b.rationale, b.replayed, b.prospect_stamped, b.created_at, b.updated_at,
      b.evidence_strength)::text), '' ORDER BY b.meeting_id)) FROM public.booking_attributions b$q$ INTO h1;
  res := res || jsonb_build_object('s03_original_columns_unchanged', h0 = h1);

  -- 4. Tenant scope: no ARCH / Ivan row stamped; every stamped row is RISE.
  res := res || jsonb_build_object(
    's04_non_rise_stamped', (SELECT count(*) FROM public.booking_attributions WHERE client_id <> 'risedtc' AND (held_basis IS NOT NULL OR held_checked_at IS NOT NULL)),
    's04_rise_future_stamped', (SELECT count(*) FROM public.booking_attributions WHERE client_id = 'risedtc' AND meeting_start >= now() - interval '3 hours' AND held_basis IS NOT NULL),
    's04_by_basis', (SELECT jsonb_object_agg(coalesce(held_basis, 'unjudged'), n) FROM (SELECT held_basis, count(*) n FROM public.booking_attributions WHERE client_id = 'risedtc' GROUP BY 1) z));

  -- 5. Known cases from the hand check (live data 2026-11-15).
  res := res || jsonb_build_object('s05_cases', (SELECT jsonb_object_agg(b.booker_name || ' ' || to_char(b.meeting_start, 'MM-DD HH24:MI'),
            coalesce(b.held_basis, 'null') || '/' || coalesce(b.held_by_transcript::text, 'null') || coalesce(' -> ' || t.title, ''))
      FROM public.booking_attributions b LEFT JOIN public.transcripts t ON t.id = b.held_transcript_id
     WHERE b.client_id = 'risedtc' AND (b.booker_name, b.meeting_start::date) IN (
       ('Mart Heinsalu', '2026-11-13'), ('Gaelle Bou abdo', '2026-11-11'), ('Renei Kelt', '2026-11-10'),
       ('Tony Lecy-Siewert', '2026-08-31'), ('Michelle Kim', '2026-10-13'), ('Blair Peterson', '2026-07-07'),
       ('Lia Caskurlu', '2026-08-06'), ('Darrius Dickerson', '2026-11-13'), ('Xeba Zareie', '2026-11-03'),
       ('Tarek Deiab', '2026-09-02'), ('Ivan Manfredi', '2026-11-03'), ('Sophie Helfend', '2026-09-15'))));

  -- 6. A recording that disappears (or was never imported) turns held into not-held; when it lands, back to held.
  SELECT meeting_id, held_transcript_id INTO mart, mart_tid FROM public.booking_attributions
   WHERE client_id = 'risedtc' AND booker_email = 'mart@zobi.com' AND held_by_transcript;
  UPDATE public.transcripts SET source = 'fathom-risedtc-hidden' WHERE id = mart_tid;
  r3 := public.rise_booking_held_apply();
  res := res || jsonb_build_object('s06_without_recording', (SELECT held_basis || '/' || coalesce(held_by_transcript::text, 'null') FROM public.booking_attributions WHERE meeting_id = mart),
                                   's06_changed', r3->'changed');
  UPDATE public.transcripts SET source = 'fathom-risedtc' WHERE id = mart_tid;
  r3 := public.rise_booking_held_apply();
  res := res || jsonb_build_object('s06_recording_back', (SELECT held_basis || '/' || held_by_transcript::text FROM public.booking_attributions WHERE meeting_id = mart));

  -- 7. A booking moved back into the future loses its stamps.
  UPDATE public.booking_attributions SET meeting_start = now() + interval '2 days' WHERE meeting_id = mart;
  r3 := public.rise_booking_held_apply();
  res := res || jsonb_build_object('s07_cleared', r3->'cleared', 's07_row', (SELECT coalesce(held_basis, 'null') FROM public.booking_attributions WHERE meeting_id = mart));

  -- 8. Public key: no EXECUTE for anon / authenticated / PUBLIC, table still closed; daily job registered.
  res := res || jsonb_build_object(
    's08_anon_exec', (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN ('rise_booking_held_apply','rise_booking_held_compute','_rise_held_norm')),
    's08_auth_exec', (SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN ('rise_booking_held_apply','rise_booking_held_compute','_rise_held_norm')),
    's08_service_exec', (SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN ('rise_booking_held_apply','rise_booking_held_compute','_rise_held_norm')),
    's08_anon_select_table', has_table_privilege('anon', 'public.booking_attributions', 'SELECT'),
    's08_cron', (SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'rise-booking-held-daily'));

  -- 9. Rollback leaves nothing behind.
  EXECUTE $rb$
__ROLLBACK__
  $rb$;
  res := res || jsonb_build_object(
    's09_columns_left', (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.booking_attributions'::regclass AND attname LIKE 'held%' AND NOT attisdropped),
    's09_functions_left', (SELECT count(*) FROM pg_proc WHERE proname IN ('rise_booking_held_apply','rise_booking_held_compute','_rise_held_norm')),
    's09_cron_left', (SELECT count(*) FROM cron.job WHERE jobname = 'rise-booking-held-daily'));

  RAISE EXCEPTION 'TEST_RESULT %', res;
END
$t$;
