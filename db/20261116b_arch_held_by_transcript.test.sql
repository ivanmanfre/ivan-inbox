-- Rolled-back test of 20261116b. Safe to run on live: one transaction, no table DDL (the held_* columns and their
-- CHECKs already exist from 20261115p), and the DO block always ends in RAISE EXCEPTION, so nothing it does stays
-- (functions, cron row, fixture rows, stamps, trigger side tables). It holds row locks on ARCH booking rows and the
-- ARCH client_guard_booked_keys for its few seconds; run it with statement_timeout 60s.
--
-- Build: the migration body (without BEGIN;/COMMIT;) replaces the first placeholder line inside the DO block, the rollback body the second
-- (tests/build_test.py in the review packet). Run as: BEGIN; <built file>; ROLLBACK;
-- Result: the exception message starts with TEST_PASS or TEST_FAIL and carries every check as jsonb.
DO $t$
DECLARE
  res jsonb := '{}'::jsonb; fails text[] := '{}'; r1 jsonb; r2 jsonb;
  h_other0 text; h_other1 text; h_arch0 text; h_arch1 text; h_rise_fn0 text; h_rise_fn1 text; bt0 text; bt1 text;
  pnow constant timestamptz := '2026-11-16 12:00+00';
  d0 int; ok boolean; v text; k record;
  held_cols constant text[] := '{held_by_transcript,held_transcript_id,held_basis,held_call_start,held_checked_at}';
BEGIN
  -- Every non-ARCH row, all columns (RISE stamps included); ARCH rows without the held_* columns; RISE functions + job.
  SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY b.meeting_id)) INTO h_other0 FROM public.booking_attributions b WHERE b.client_id <> 'arch';
  SELECT md5(string_agg((to_jsonb(b) - held_cols)::text, '' ORDER BY b.meeting_id)) INTO h_arch0 FROM public.booking_attributions b WHERE b.client_id = 'arch';
  SELECT md5(string_agg(p.proname || pg_get_functiondef(p.oid), '' ORDER BY p.proname)) || coalesce((SELECT schedule || command FROM cron.job WHERE jobname = 'rise-booking-held-daily'), 'nojob')
    INTO h_rise_fn0 FROM pg_proc p WHERE p.proname IN ('rise_booking_held_compute','rise_booking_held_apply','_rise_held_norm');
  SELECT coalesce(string_agg(client_id || ':' || dirty_at || ':' || coalesce(last_reason, ''), ','), '') INTO bt0 FROM public.board_truth_dirty WHERE client_id <> 'arch';

  EXECUTE $mig$
__MIGRATION__
  $mig$;

  -- Fixture helpers (session temp functions, dropped with the transaction). Dates in March 2025: no real row there.
  EXECUTE $h$
    create function pg_temp.fx_lines(nm text, n int) returns text language sql as
      $x$ select string_agg(nm || ': line ' || g, E'\n') from generate_series(1, n) g $x$;
    create function pg_temp.fx_tr(tid text, st timestamptz, parts text[], txt text, reliable boolean default true,
                                  src text default 'fireflies-arch', dav_invited boolean default true, dav_lines int default 20) returns void language sql as
      $x$ insert into public.transcripts (id, title, source, created_at, date, duration_minutes, participants, transcript_text, diarization, transcript_json)
          values (md5(tid)::uuid, 'FX ' || tid, src, st + interval '1 day', st, 30,
                  case when dav_invited then array['davorinsmit@arch.agency'] else '{}'::text[] end || parts,
                  nullif(concat_ws(E'\n', case when dav_lines > 0 then pg_temp.fx_lines('Davorin Smit', dav_lines) end, txt), ''),
                  jsonb_build_object('labels_reliable', reliable),
                  jsonb_build_object('recording_id', 'fx-' || tid, 'date', st)) $x$;
    create function pg_temp.fx_bk(mid text, st timestamptz, nm text, em text, slug text, title text, outcome text default 'SCHEDULED') returns void language sql as
      $x$ insert into public.booking_attributions (meeting_id, client_id, slug, meeting_title, booked_at, meeting_start, meeting_outcome, booker_email, booker_name, verdict)
          values (mid, 'arch', slug, title, st - interval '3 days', st, outcome, em, nm, 'unattributed') $x$;
  $h$;

  -- A01 booker spoke 30 lines under full name, invited, labels reliable -> held (name).
  PERFORM pg_temp.fx_bk('fxa01', '2025-03-03 12:00+00', 'Basil Mass', 'basil@fxa-01.test', null, 'Basil Mass and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta01', '2025-03-03 12:00+00', array['basil@fxa-01.test'], pg_temp.fx_lines('Basil Mass', 30));
  -- A02 a colleague spoke, the booker never did -> unknown (unverified_speaker), never a no-show.
  PERFORM pg_temp.fx_bk('fxa02', '2025-03-04 12:00+00', 'Alice Archer', 'alice@fxa-02.test', null, 'Alice Archer and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta02', '2025-03-04 12:00+00', array['alice@fxa-02.test', 'bob@fxa-02.test'], pg_temp.fx_lines('Bob Bell', 30));
  -- A03 nickname only ("Liza" for Elizaveta Savenkova) -> not held.
  PERFORM pg_temp.fx_bk('fxa03', '2025-03-05 12:00+00', 'Elizaveta Savenkova', 'liza@fxa-03.test', null, 'Elizaveta Savenkova and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta03', '2025-03-05 12:00+00', array['liza@fxa-03.test'], pg_temp.fx_lines('Liza', 30));
  -- A04 booker's full name on 30 lines, but the ingestor marked labels unreliable -> not held.
  PERFORM pg_temp.fx_bk('fxa04', '2025-03-06 12:00+00', 'Cara Cole', 'cara@fxa-04.test', null, 'Cara Cole and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta04', '2025-03-06 12:00+00', array['cara@fxa-04.test'], pg_temp.fx_lines('Cara Cole', 30), false);
  -- A05 booker's full name spoke, but the booker email is not on that recording's invite -> not held.
  PERFORM pg_temp.fx_bk('fxa05', '2025-03-07 12:00+00', 'Dan Dorr', 'dan@fxa-05.test', null, 'Dan Dorr and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta05', '2025-03-07 12:00+00', array['someone@fxa-05x.test'], pg_temp.fx_lines('Dan Dorr', 30));
  -- A06 booker spoke 4 lines -> not held (unknown).
  PERFORM pg_temp.fx_bk('fxa06', '2025-03-10 12:00+00', 'Max Mohr', 'max@fxa-06.test', null, 'Max Mohr and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta06', '2025-03-10 12:00+00', array['max@fxa-06.test'], pg_temp.fx_lines('Max Mohr', 4));
  -- A07 moved call: booker spoke 3 days later -> met_other_time (unknown), and the later recording is not held for the slot.
  PERFORM pg_temp.fx_bk('fxa07', '2025-03-11 12:00+00', 'Jade Jones', 'jade@fxa-07.test', null, 'Jade Jones and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta07', '2025-03-14 12:00+00', array['jade@fxa-07.test'], pg_temp.fx_lines('Jade Jones', 30));
  -- A08 the slot's own recording is empty (Fireflies bot alone, 0 lines) -> unknown, never a no-show.
  PERFORM pg_temp.fx_bk('fxa08', '2025-03-17 12:15+00', 'Matt Stone', 'matt@fxa-08.test', 'davorin-smit/30-minute-sales-call', 'Let''s work together (30 minutes meeting)');
  PERFORM pg_temp.fx_tr('ta08', '2025-03-17 12:15+00', array['matt@fxa-08.test'], null, false, 'fireflies-arch', true, 0);
  -- A09 no recording of the slot, though the bot recorded another call 2 h earlier the same day -> unknown (recorder_off).
  PERFORM pg_temp.fx_bk('fxa09', '2025-03-18 14:15+00', 'Alex Corn', 'alex@fxa-09.test', 'davorin-smit/30-minute-sales-call', 'Let''s work together (30 minutes meeting)');
  PERFORM pg_temp.fx_tr('ta09', '2025-03-18 12:15+00', array['other@fxa-09x.test'], pg_temp.fx_lines('Other Person', 30));
  -- A10 the slot's own recording, booker invited, only Davorin spoke -> no-show (false).
  PERFORM pg_temp.fx_bk('fxa10', '2025-03-19 12:00+00', 'Kim Kerr', 'kim@fxa-10.test', null, 'Kim Kerr and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta10', '2025-03-19 12:00+00', array['kim@fxa-10.test'], null, false);
  -- A11 a Davorin-only recording at the slot time, but the booker is not on its invite -> unknown (recorder_off).
  PERFORM pg_temp.fx_bk('fxa11', '2025-03-20 12:00+00', 'Lou Lane', 'lou@fxa-11.test', null, 'Lou Lane and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta11', '2025-03-20 12:00+00', '{}'::text[], null, false);
  -- A12 another host's calendar (marko-jovic), no recording -> host_not_recorded.
  PERFORM pg_temp.fx_bk('fxa12', '2025-03-21 10:00+00', 'Ivo Ivic', 'ivo@fxa-12.test', 'marko-jovic/screening-interview', 'Screening Interview');
  -- A13 staff booker -> internal_booker.
  PERFORM pg_temp.fx_bk('fxa13', '2025-03-21 12:00+00', 'Tin Test', 'tintest@arch.agency', null, 'Tin Test and Davorin Smit');
  -- A14 a CANCELED row and the live row share email + slot; the live row gets the recording.
  PERFORM pg_temp.fx_bk('fxa14a', '2025-03-24 12:00+00', 'Erin Eve', 'erin@fxa-14.test', null, 'Canceled: Erin Eve and Davorin Smit', 'CANCELED');
  PERFORM pg_temp.fx_bk('fxa14b', '2025-03-24 12:00+00', 'Erin Eve', 'erin@fxa-14.test', null, 'Erin Eve and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta14', '2025-03-24 12:00+00', array['erin@fxa-14.test'], pg_temp.fx_lines('Erin Eve', 30));
  -- A15 the Funcell shape: two bookings 08:00 and 12:45 the same day, one recording at 08:00 -> held + met_other_time.
  PERFORM pg_temp.fx_bk('fxa15a', '2025-03-25 08:00+00', 'Abe Malp', 'abe@fxa-15.test', null, 'Abe Malp and Davorin Smit');
  PERFORM pg_temp.fx_bk('fxa15b', '2025-03-25 12:45+00', 'Abe Malp', 'abe@fxa-15.test', null, 'Abe Malp and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta15', '2025-03-25 08:00+00', array['abe@fxa-15.test'], pg_temp.fx_lines('Abe Malp', 30));
  -- A16 booking with no email, full name spoke on a reliable recording -> held (name).
  PERFORM pg_temp.fx_bk('fxa16', '2025-03-26 14:30+00', 'Gene Kaku', null, null, 'ARCH intro: Davorin x Gene Kaku (Curex)');
  PERFORM pg_temp.fx_tr('ta16', '2025-03-26 14:30+00', '{}'::text[], pg_temp.fx_lines('Gene Kaku', 30));
  -- A17 booker invited to a recording 2 days later (no readable speech of theirs) -> met_other_time, never a no-show.
  PERFORM pg_temp.fx_bk('fxa17', '2025-03-27 08:15+00', 'Mia Dig', 'mia@fxa-17.test', null, 'Mia Dig and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta17', '2025-03-29 08:15+00', array['mia@fxa-17.test'], null, false, 'fireflies-arch', true, 0);
  -- A18 the booker spoke only on a recording Davorin's bot was not on, or on a Fathom (RISE) recording -> ignored.
  PERFORM pg_temp.fx_bk('fxa18', '2025-03-31 12:00+00', 'Nina Noor', 'nina@fxa-18.test', null, 'Nina Noor and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta18a', '2025-03-31 12:00+00', array['nina@fxa-18.test'], pg_temp.fx_lines('Nina Noor', 30), true, 'fireflies-arch', false);
  PERFORM pg_temp.fx_tr('ta18b', '2025-03-31 12:05+00', array['nina@fxa-18.test'], pg_temp.fx_lines('Nina Noor', 30), true, 'fathom-risedtc', true);
  -- A19 word boundary: booker "John Smith", speaker "Johnny Smithson" -> not the booker.
  PERFORM pg_temp.fx_bk('fxa19', '2025-04-01 12:00+00', 'John Smith', 'john@fxa-19.test', null, 'John Smith and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta19', '2025-04-01 12:00+00', array['john@fxa-19.test'], pg_temp.fx_lines('Johnny Smithson', 30));
  -- A20 judged 50 h after a slot with no recording -> pending_ingest (96 h grace). Checked at its own p_now below.
  PERFORM pg_temp.fx_bk('fxa20', '2025-04-02 12:00+00', 'Pat Park', 'pat@fxa-20.test', null, 'Pat Park and Davorin Smit');
  -- A21 Croatian accents: booker "Vjeran Belošević", label "Vjeran Belosevic" -> held (name).
  PERFORM pg_temp.fx_bk('fxa21', '2025-04-03 12:00+00', 'Vjeran Belošević', 'vjeran@fxa-21.test', null, 'Vjeran Belošević and Davorin Smit');
  PERFORM pg_temp.fx_tr('ta21', '2025-04-03 12:00+00', array['vjeran@fxa-21.test'], pg_temp.fx_lines('Vjeran Belosevic', 30));

  -- 1. Runs: first writes every judged ARCH row, second changes nothing.
  r1 := public.arch_booking_held_apply(pnow);
  r2 := public.arch_booking_held_apply(pnow);
  res := res || jsonb_build_object('first_run', r1, 'second_run', r2);
  IF (r1->>'changed')::int <> (r1->>'judged')::int THEN fails := fails || 'first run did not stamp every judged row'::text; END IF;
  IF (r2->>'changed')::int <> 0 OR (r2->>'cleared')::int <> 0 THEN fails := fails || 'second run not idempotent'::text; END IF;

  -- 2. Tenant isolation: every non-ARCH row byte-identical (RISE stamps included); ARCH rows changed only in held_*;
  --    the RISE functions and job 360 untouched; RISE board truth not marked.
  SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY b.meeting_id)) INTO h_other1 FROM public.booking_attributions b WHERE b.client_id <> 'arch';
  IF h_other0 IS DISTINCT FROM h_other1 THEN fails := fails || 'a non-ARCH row changed'::text; END IF;
  SELECT md5(string_agg((to_jsonb(b) - held_cols)::text, '' ORDER BY b.meeting_id)) INTO h_arch1 FROM public.booking_attributions b WHERE b.client_id = 'arch' AND b.meeting_id NOT LIKE 'fxa%';
  IF h_arch0 IS DISTINCT FROM h_arch1 THEN fails := fails || 'an ARCH column other than held_* changed'::text; END IF;
  SELECT md5(string_agg(p.proname || pg_get_functiondef(p.oid), '' ORDER BY p.proname)) || coalesce((SELECT schedule || command FROM cron.job WHERE jobname = 'rise-booking-held-daily'), 'nojob')
    INTO h_rise_fn1 FROM pg_proc p WHERE p.proname IN ('rise_booking_held_compute','rise_booking_held_apply','_rise_held_norm');
  IF h_rise_fn0 IS DISTINCT FROM h_rise_fn1 THEN fails := fails || 'RISE functions or job changed'::text; END IF;
  SELECT coalesce(string_agg(client_id || ':' || dirty_at || ':' || coalesce(last_reason, ''), ','), '') INTO bt1 FROM public.board_truth_dirty WHERE client_id <> 'arch';
  IF bt0 IS DISTINCT FROM bt1 THEN fails := fails || 'non-ARCH board truth marked'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_attributions WHERE client_id = 'arch' AND held_by_transcript IS FALSE AND booker_email IS NULL) THEN fails := fails || 'no-show without a booker email'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_attributions WHERE client_id = 'arch' AND held_basis IS NOT NULL AND meeting_start >= pnow - interval '3 hours') THEN fails := fails || 'future row stamped'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_attributions b LEFT JOIN public.transcripts t ON t.id = b.held_transcript_id
             WHERE b.client_id = 'arch' AND b.held_by_transcript AND (t.id IS NULL OR t.source <> 'fireflies-arch')) THEN fails := fails || 'held row not on a fireflies-arch recording'::text; END IF;
  res := res || jsonb_build_object('by_basis_real', (SELECT jsonb_object_agg(coalesce(held_basis, 'unjudged'), n) FROM
            (SELECT held_basis, count(*) n FROM public.booking_attributions WHERE client_id = 'arch' AND meeting_id NOT LIKE 'fxa%' GROUP BY 1) z));

  -- 3. Fixtures: every expected row must exist and match.
  FOR k IN SELECT * FROM (VALUES
      ('fxa01', 'name'), ('fxa02', 'unverified_speaker'), ('fxa03', 'unverified_speaker'), ('fxa04', 'unverified_speaker'),
      ('fxa05', 'unverified_speaker'), ('fxa06', 'unverified_speaker'), ('fxa07', 'met_other_time'), ('fxa08', 'unverified_speaker'),
      ('fxa09', 'recorder_off'), ('fxa10', 'no_transcript'), ('fxa11', 'recorder_off'), ('fxa12', 'host_not_recorded'),
      ('fxa13', 'internal_booker'), ('fxa14a', 'rescheduled'), ('fxa14b', 'name'), ('fxa15a', 'name'), ('fxa15b', 'met_other_time'),
      ('fxa16', 'name'), ('fxa17', 'met_other_time'), ('fxa18', 'recorder_off'), ('fxa19', 'unverified_speaker'),
      ('fxa20', 'recorder_off'), ('fxa21', 'name')) e(mid, want)
  LOOP
    SELECT held_basis INTO v FROM public.booking_attributions WHERE meeting_id = k.mid;
    IF NOT FOUND OR v IS DISTINCT FROM k.want THEN fails := fails || (k.mid || ' got ' || coalesce(v, 'NULL') || ' want ' || k.want); END IF;
  END LOOP;
  SELECT c.held_basis INTO v FROM public.arch_booking_held_compute('2025-04-04 14:00+00') c WHERE c.meeting_id = 'fxa20';
  IF v IS DISTINCT FROM 'pending_ingest' THEN fails := fails || ('fxa20 at +50h got ' || coalesce(v, 'NULL') || ' want pending_ingest'); END IF;
  SELECT b.held_transcript_id::text INTO v FROM public.booking_attributions b WHERE b.meeting_id = 'fxa15a';
  IF v IS DISTINCT FROM md5('ta15')::uuid::text THEN fails := fails || 'fxa15a not on ta15'::text; END IF;

  -- 4. Real ARCH rows (live data 2026-11-16): the expected verdicts.
  FOR k IN SELECT * FROM (VALUES
      ('basile@legendsofthepast.gg', '2026-09-23 12:00+00', 'name'), ('gpastucha@pixelfederation.com', '2026-09-28 14:15+00', 'name'),
      ('ofir.b@doktorabc.com', '2026-10-05 12:00+00', 'name'), ('ab@funcellgames.com', '2026-11-10 08:00+00', 'name'),
      ('ab@funcellgames.com', '2026-11-10 12:45+00', 'met_other_time'), ('elizaveta.savenkova@zimad.com', '2026-11-02 12:45+00', 'met_other_time'),
      ('miad@fitness22.com', '2026-11-11 08:15+00', 'met_other_time'), ('volga@globalwork.ai', '2026-10-28 15:30+00', 'recorder_off'),
      ('mstojic@poliklinika-mazalin.hr', '2026-09-21 12:15+00', 'unverified_speaker')) e(em, st, want)
  LOOP
    SELECT count(*), string_agg(coalesce(held_basis, 'NULL'), ',') INTO d0, v FROM public.booking_attributions
     WHERE client_id = 'arch' AND booker_email = k.em AND meeting_start = k.st::timestamptz;
    IF d0 <> 1 OR v IS DISTINCT FROM k.want THEN fails := fails || (k.em || ' ' || k.st || ' got ' || coalesce(v, 'missing') || ' want ' || k.want); END IF;
  END LOOP;
  SELECT string_agg(coalesce(held_basis, 'NULL'), ',' ORDER BY meeting_id) INTO v FROM public.booking_attributions
   WHERE client_id = 'arch' AND booker_email = 'david.kahana@plus500.com';
  IF v IS DISTINCT FROM 'met_other_time,met_other_time' THEN fails := fails || ('plus500 got ' || coalesce(v, 'missing')); END IF;
  SELECT held_basis INTO v FROM public.booking_attributions WHERE client_id = 'arch' AND booker_name = 'Gene Kakaulin';
  IF v IS DISTINCT FROM 'recorder_off' THEN fails := fails || ('Gene Kakaulin got ' || coalesce(v, 'missing')); END IF;

  -- 5. A row moved back into the future is cleared; the CHECK refuses a held row without basis.
  UPDATE public.booking_attributions SET meeting_start = pnow + interval '2 days' WHERE meeting_id = 'fxa01';
  r2 := public.arch_booking_held_apply(pnow);
  IF (r2->>'cleared')::int <> 1 OR (SELECT held_basis FROM public.booking_attributions WHERE meeting_id = 'fxa01') IS NOT NULL THEN fails := fails || 'future move not cleared'::text; END IF;
  BEGIN
    UPDATE public.booking_attributions SET held_basis = NULL WHERE meeting_id = 'fxa14b';
    fails := fails || 'CHECK accepted held without basis'::text;
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 6. Roles: anon and authenticated cannot run any of the three functions; service_role can.
  FOREACH v IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ok := false;
    BEGIN
      EXECUTE format('set local role %I', v);
      PERFORM public.arch_booking_held_compute(pnow);
    EXCEPTION WHEN insufficient_privilege THEN ok := true;
    END;
    RESET ROLE;
    IF NOT ok THEN fails := fails || (v || ' can run arch_booking_held_compute'); END IF;
    IF has_function_privilege(v, 'public.arch_booking_held_apply(timestamptz)', 'EXECUTE')
       OR has_function_privilege(v, 'public._arch_held_norm(text)', 'EXECUTE') THEN fails := fails || (v || ' has EXECUTE'); END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.arch_booking_held_apply(timestamptz)', 'EXECUTE') THEN fails := fails || 'service_role lacks EXECUTE'::text; END IF;
  res := res || jsonb_build_object('cron', (SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'arch-booking-held-daily'));
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'arch-booking-held-daily') THEN fails := fails || 'cron missing'::text; END IF;

  -- 7. Rollback: ARCH objects gone, ARCH stamps cleared, RISE (functions, job, stamps) untouched.
  EXECUTE $rb$
__ROLLBACK__
  $rb$;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('arch_booking_held_apply','arch_booking_held_compute','_arch_held_norm'))
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'arch-booking-held-daily')
     OR EXISTS (SELECT 1 FROM public.booking_attributions WHERE client_id = 'arch' AND (held_basis IS NOT NULL OR held_checked_at IS NOT NULL)) THEN
    fails := fails || 'rollback left ARCH objects or stamps'::text; END IF;
  SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY b.meeting_id)) INTO h_other1 FROM public.booking_attributions b WHERE b.client_id <> 'arch';
  SELECT md5(string_agg(p.proname || pg_get_functiondef(p.oid), '' ORDER BY p.proname)) || coalesce((SELECT schedule || command FROM cron.job WHERE jobname = 'rise-booking-held-daily'), 'nojob')
    INTO h_rise_fn1 FROM pg_proc p WHERE p.proname IN ('rise_booking_held_compute','rise_booking_held_apply','_rise_held_norm');
  IF h_other0 IS DISTINCT FROM h_other1 OR h_rise_fn0 IS DISTINCT FROM h_rise_fn1 THEN fails := fails || 'rollback touched RISE'::text; END IF;

  res := res || jsonb_build_object('fails', to_jsonb(fails));
  RAISE EXCEPTION '% %', CASE WHEN cardinality(fails) = 0 THEN 'TEST_PASS' ELSE 'TEST_FAIL' END, res;
END
$t$;
