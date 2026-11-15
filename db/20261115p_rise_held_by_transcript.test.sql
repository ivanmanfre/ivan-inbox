-- ISOLATED DATABASE ONLY. NEVER RUN ON LIVE: it runs the migration inside one transaction and holds an ACCESS
-- EXCLUSIVE lock on booking_attributions for the whole test. For live use 20261115p_rise_held_by_transcript.postdeploy.sql.
--
-- Rolled-back test of 20261115p on a scratch copy (all live booking_attributions rows + fathom-risedtc/fireflies-arch
-- transcripts loaded into a throwaway Postgres 17): apply the migration, add adversarial fixtures (dates in March
-- 2025, where no real row exists), assert, apply the rollback, assert, then RAISE so nothing stays.
-- Build: the migration body (without BEGIN;/COMMIT;) replaces the first placeholder line inside the DO block, the
-- rollback body the second (tests/build_test.py in the review packet does this).
-- Result: the exception message starts with TEST_PASS or TEST_FAIL and carries every check as jsonb.
DO $t$
DECLARE
  res jsonb := '{}'::jsonb; fails text[] := '{}'; r1 jsonb; r2 jsonb; h0 text; h1 text;
  pnow constant timestamptz := '2026-11-15 21:30+00';
  d0 int; g0 int := 0; ok boolean; v text; k record;
BEGIN
  SELECT md5(string_agg(md5(row(b.*)::text), '' ORDER BY b.meeting_id)) INTO h0 FROM public.booking_attributions b;

  EXECUTE $mig$
__MIGRATION__
  $mig$;

  -- Fixture helpers (session temp functions, dropped with the transaction).
  EXECUTE $h$
    create function pg_temp.fx_lines(dn text, em text, n int) returns jsonb language sql as
      $x$ select coalesce(jsonb_agg(jsonb_build_object('text', 'line', 'timestamp', '00:00:00',
             'speaker', jsonb_build_object('display_name', dn, 'matched_calendar_invitee_email', em))), '[]'::jsonb)
          from generate_series(1, n) $x$;
    create function pg_temp.fx_inv(nm text, em text, ext boolean default true, mdn text default null) returns jsonb language sql as
      $x$ select jsonb_build_object('name', nm, 'email', em, 'is_external', ext, 'matched_speaker_display_name', mdn) $x$;
    create function pg_temp.fx_tr(tid text, st timestamptz, invs jsonb, lines jsonb) returns void language sql as
      $x$ insert into public.transcripts (id, title, source, created_at, date, duration_minutes, transcript_json)
          values (md5(tid)::uuid, 'FX ' || tid, 'fathom-risedtc', st + interval '1 day', st + interval '30 minutes', 30,
                  jsonb_build_object('recording_id', 'fx-' || tid, 'recorded_by', jsonb_build_object('email', 'mattan@risedtc.com'),
                    'scheduled_start_time', st, 'recording_start_time', st + interval '1 minute',
                    'calendar_invitees', invs || jsonb_build_array(pg_temp.fx_inv('Mattan Danino', 'mattan@risedtc.com', false, 'Mattan Danino')),
                    'transcript', pg_temp.fx_lines('Mattan Danino', 'mattan@risedtc.com', 20) || lines)) $x$;
    create function pg_temp.fx_bk(mid text, st timestamptz, nm text, em text, slug text, outcome text default 'SCHEDULED') returns void language sql as
      $x$ insert into public.booking_attributions (meeting_id, client_id, slug, meeting_title, booked_at, meeting_start, meeting_outcome, booker_email, booker_name, verdict)
          values (mid, 'risedtc', slug, case when slug is null then null else 'FX ' || mid end, st - interval '3 days', st, outcome, em, nm, 'unattributed') $x$;
  $h$;

  -- F1 Alice booked; Bob (her colleague, on the invite) spoke, Alice never did -> not held.
  PERFORM pg_temp.fx_bk('fx01', '2025-03-03 18:00+00', 'Alice Archer', 'alice@fa-one.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t01', '2025-03-03 18:00+00', jsonb_build_array(pg_temp.fx_inv('Alice Archer', 'alice@fa-one.com'), pg_temp.fx_inv('Bob Bell', 'bob@fa-one.com')),
                        pg_temp.fx_lines('Bob Bell', 'bob@fa-one.com', 30));
  -- F2a John Smith (john@a) booked; a "John Smith" with no matched email spoke, but the invite holds John Smith at john@b -> not held.
  PERFORM pg_temp.fx_bk('fx02a', '2025-03-04 18:00+00', 'John Smith', 'john@fx-a.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t02a', '2025-03-04 18:00+00', jsonb_build_array(pg_temp.fx_inv('John Smith', 'john@fx-b.com')), pg_temp.fx_lines('John Smith', null, 30));
  -- F2b same booker; the speaking John Smith is matched to john@b -> not held.
  PERFORM pg_temp.fx_bk('fx02b', '2025-03-05 18:00+00', 'John Smith', 'john@fx-a.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t02b', '2025-03-05 18:00+00', jsonb_build_array(pg_temp.fx_inv('John Smith', 'john@fx-b.com')), pg_temp.fx_lines('John Smith', 'john@fx-b.com', 30));
  -- F3 domain only: carol@c booked, dave@c spoke -> not held.
  PERFORM pg_temp.fx_bk('fx03', '2025-03-06 18:00+00', 'Carol Cruz', 'carol@fx-c.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t03', '2025-03-06 18:00+00', jsonb_build_array(pg_temp.fx_inv('Dave Dunn', 'dave@fx-c.com')), pg_temp.fx_lines('Dave Dunn', 'dave@fx-c.com', 30));
  -- F4 a CANCELED row (sorts first) and the live row share email + slot; the live row must get the recording.
  PERFORM pg_temp.fx_bk('fx04a', '2025-03-07 18:00+00', 'Erin Eve', 'erin@fx-e.com', 'mattan5/fx', 'CANCELED');
  PERFORM pg_temp.fx_bk('fx04b', '2025-03-07 18:00+00', 'Erin Eve', 'erin@fx-e.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t04', '2025-03-07 18:00+00', jsonb_build_array(pg_temp.fx_inv('Erin Eve', 'erin@fx-e.com')), pg_temp.fx_lines('Erin Eve', 'erin@fx-e.com', 30));
  -- F5 an external booker named like a RISE team member (Matt Moore) with his own email -> held.
  PERFORM pg_temp.fx_bk('fx05', '2025-03-08 18:00+00', 'Matt Moore', 'matt@fx-ext.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t05', '2025-03-08 18:00+00', jsonb_build_array(pg_temp.fx_inv('Matt Moore', 'matt@fx-ext.com'), pg_temp.fx_inv('Matt Moore', 'matt@risedtc.com', false)),
                        pg_temp.fx_lines('Matt Moore', 'matt@fx-ext.com', 30));
  -- F6 a slot on Matt's calendar with no recording, then a held rebooking on Mattan's -> the Matt slot is unknown, never false.
  PERFORM pg_temp.fx_bk('fx06a', '2025-03-09 18:00+00', 'Gail Gray', 'gail@fx-g.com', 'matt3368/30min');
  PERFORM pg_temp.fx_bk('fx06b', '2025-03-10 18:00+00', 'Gail Gray', 'gail@fx-g.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t06', '2025-03-10 18:00+00', jsonb_build_array(pg_temp.fx_inv('Gail Gray', 'gail@fx-g.com')), pg_temp.fx_lines('Gail Gray', 'gail@fx-g.com', 30));
  -- F7 NULL slug and title, recorder ran the same session, no recording of the booker -> unknown (host unproven).
  PERFORM pg_temp.fx_bk('fx07', '2025-03-11 18:00+00', 'Hal Hart', 'hal@fx-h.com', null);
  PERFORM pg_temp.fx_tr('t07', '2025-03-11 16:00+00', jsonb_build_array(pg_temp.fx_inv('Other Person', 'other@fx-o.com')), pg_temp.fx_lines('Other Person', 'other@fx-o.com', 30));
  -- F8 judged 18 h after the slot; an unrelated later recording exists -> still pending (full 48 h grace).
  PERFORM pg_temp.fx_bk('fx08', '2025-03-12 18:00+00', 'Ian Ink', 'ian@fx-i.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t08', '2025-03-12 21:00+00', jsonb_build_array(pg_temp.fx_inv('Other Person', 'other2@fx-o.com')), pg_temp.fx_lines('Other Person', 'other2@fx-o.com', 30));
  -- F9 moved call: the booker spoke the next day; same session had another recording -> met_other_time (unknown).
  PERFORM pg_temp.fx_bk('fx09', '2025-03-14 18:00+00', 'Jade Jones', 'jade@fx-j.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t09a', '2025-03-14 17:00+00', jsonb_build_array(pg_temp.fx_inv('Other Person', 'other3@fx-o.com')), pg_temp.fx_lines('Other Person', 'other3@fx-o.com', 30));
  PERFORM pg_temp.fx_tr('t09b', '2025-03-15 18:00+00', jsonb_build_array(pg_temp.fx_inv('Jade Jones', 'jade@fx-j.com')), pg_temp.fx_lines('Jade Jones', 'jade@fx-j.com', 30));
  -- F10 Mattan waited alone on the booker's own recording -> no-show (false).
  PERFORM pg_temp.fx_bk('fx10', '2025-03-17 18:00+00', 'Kim Kerr', 'kim@fx-k.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t10', '2025-03-17 18:00+00', jsonb_build_array(pg_temp.fx_inv('Kim Kerr', 'kim@fx-k.com')), '[]'::jsonb);
  -- F11 no recording at all that day -> recorder_off (unknown).
  PERFORM pg_temp.fx_bk('fx11', '2025-03-19 18:00+00', 'Lou Lane', 'lou@fx-l.com', 'mattan5/fx');
  -- F12 full name, speaker has no email, nobody contradicts -> held by name.
  PERFORM pg_temp.fx_bk('fx12', '2025-03-21 18:00+00', 'Kara Lee', 'kara@fx-kl.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t12', '2025-03-21 18:05+00', '[]'::jsonb, pg_temp.fx_lines('Kara Lee', null, 30));
  -- F13 first name only ("Kara") -> not held.
  PERFORM pg_temp.fx_bk('fx13', '2025-03-24 18:00+00', 'Kara Lane', 'karal@fx-kl2.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t13', '2025-03-24 18:00+00', '[]'::jsonb, pg_temp.fx_lines('Kara', null, 30));
  -- F14 Fathom linked the booker's invite entry to a speaker whose display name is a nickname -> held by email.
  PERFORM pg_temp.fx_bk('fx14', '2025-03-26 18:00+00', 'Nikola Rose', 'support@fx-n.com', 'mattan5/fx');
  PERFORM pg_temp.fx_tr('t14', '2025-03-26 18:00+00', jsonb_build_array(pg_temp.fx_inv('Nikola Rose', 'support@fx-n.com', true, 'nikki r')), pg_temp.fx_lines('nikki r', null, 30));

  IF to_regclass('public.guard_calls') IS NOT NULL THEN EXECUTE 'select count(*) from public.guard_calls' INTO g0; END IF;

  -- 1. Runs: first writes every judged row, second changes nothing (fingerprint matches unchanged rows).
  r1 := public.rise_booking_held_apply(pnow);
  r2 := public.rise_booking_held_apply(pnow);
  res := res || jsonb_build_object('first_run', r1, 'second_run', r2);
  IF (r1->>'changed')::int <> (r1->>'judged')::int THEN fails := fails || 'first run did not stamp every judged row'::text; END IF;
  IF (r2->>'changed')::int <> 0 OR (r2->>'cleared')::int <> 0 THEN fails := fails || 'second run not idempotent'::text; END IF;

  -- 2. Only held_* changed on real rows.
  SELECT md5(string_agg(md5(row(b.meeting_id, b.client_id, b.slug, b.meeting_title, b.booked_at, b.meeting_start,
      b.meeting_outcome, b.booker_email, b.booker_name, b.booker_website, b.verdict, b.evidence_type, b.evidence_value,
      b.prospect_id, b.campaign_id, b.opened_by, b.rationale, b.replayed, b.prospect_stamped, b.created_at, b.updated_at,
      b.evidence_strength)::text), '' ORDER BY b.meeting_id)) INTO h1 FROM public.booking_attributions b WHERE b.meeting_id NOT LIKE 'fx%';
  IF h0 IS DISTINCT FROM h1 THEN fails := fails || 'original columns changed'::text; END IF;

  -- 3. Tenant and invariants.
  SELECT count(*) INTO d0 FROM public.booking_attributions WHERE client_id <> 'risedtc' AND (held_basis IS NOT NULL OR held_checked_at IS NOT NULL);
  IF d0 <> 0 THEN fails := fails || ('non-RISE rows stamped: ' || d0); END IF;
  IF EXISTS (SELECT 1 FROM public.booking_attributions WHERE held_by_transcript IS FALSE AND (slug LIKE 'mattan5%') IS NOT TRUE) THEN fails := fails || 'no-show off Mattan''s page'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_attributions WHERE held_basis IS NOT NULL AND meeting_start >= pnow - interval '3 hours') THEN fails := fails || 'future row stamped'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_attributions WHERE held_by_transcript AND held_transcript_id IS NULL) THEN fails := fails || 'held without transcript'::text; END IF;
  res := res || jsonb_build_object('by_basis_real', (SELECT jsonb_object_agg(coalesce(held_basis, 'unjudged'), n) FROM
            (SELECT held_basis, count(*) n FROM public.booking_attributions WHERE client_id = 'risedtc' AND meeting_id NOT LIKE 'fx%' GROUP BY 1) z));

  -- 4. Fixtures and known real cases: every expected row must exist and match.
  FOR k IN SELECT * FROM (VALUES
      ('fx01', 'unverified_speaker'), ('fx02a', 'unverified_speaker'), ('fx02b', 'unverified_speaker'), ('fx03', 'unverified_speaker'),
      ('fx04a', 'rescheduled'), ('fx04b', 'email'), ('fx05', 'email'), ('fx06a', 'met_other_time'), ('fx06b', 'email'),
      ('fx07', 'host_not_recorded'), ('fx09', 'met_other_time'), ('fx10', 'no_transcript'), ('fx11', 'recorder_off'),
      ('fx12', 'name'), ('fx13', 'unverified_speaker'), ('fx14', 'email')) e(mid, want)
  LOOP
    SELECT held_basis INTO v FROM public.booking_attributions WHERE meeting_id = k.mid;
    IF NOT FOUND OR v IS DISTINCT FROM k.want THEN fails := fails || (k.mid || ' got ' || coalesce(v, 'NULL') || ' want ' || k.want); END IF;
  END LOOP;
  SELECT c.held_basis INTO v FROM public.rise_booking_held_compute('2025-03-13 12:00+00') c WHERE c.meeting_id = 'fx08';
  IF v IS DISTINCT FROM 'pending_ingest' THEN fails := fails || ('fx08 got ' || coalesce(v, 'NULL') || ' want pending_ingest'); END IF;

  FOR k IN SELECT * FROM (VALUES
      ('mart@zobi.com', '2026-11-13', 'email'), ('gaelle@buysixseven.com', '2026-11-11', 'email'), ('hello@bhonebeauty.com', '2026-11-10', 'email'),
      ('tony@apostleman.com', '2026-08-31', 'name'), ('lia@peppertux.com', '2026-08-07', 'name'), ('lia@peppertux.com', '2026-08-06', 'met_other_time'),
      ('info@warntees.com', '2026-11-13', 'no_transcript'), ('xeba@premefoods.com', '2026-11-03', 'met_other_time'),
      ('deiab@henschelhats.com', '2026-09-02', 'met_other_time'), ('im@ivanmanfredi.com', '2026-11-03', 'internal_booker'),
      ('sophie@theartofbroth.com', '2026-09-15', 'host_not_recorded'), ('james.magras@cmgpc.us', '2026-10-05', 'unverified_speaker'),
      ('kelly@afternoonfoods.com', '2026-10-02', 'met_other_time')) e(em, day, want)
  LOOP
    SELECT count(*), string_agg(coalesce(held_basis, 'NULL'), ',') INTO d0, v FROM public.booking_attributions
     WHERE client_id = 'risedtc' AND booker_email = k.em AND meeting_start::date = k.day::date;
    IF d0 <> 1 OR v IS DISTINCT FROM k.want THEN fails := fails || (k.em || ' ' || k.day || ' got ' || coalesce(v, 'missing') || ' want ' || k.want); END IF;
  END LOOP;

  -- 5. A row moved back into the future is cleared; the CHECK refuses a held row without basis.
  UPDATE public.booking_attributions SET meeting_start = pnow + interval '2 days' WHERE meeting_id = 'fx05';
  r2 := public.rise_booking_held_apply(pnow);
  IF (r2->>'cleared')::int <> 1 OR (SELECT held_basis FROM public.booking_attributions WHERE meeting_id = 'fx05') IS NOT NULL THEN fails := fails || 'future move not cleared'::text; END IF;
  BEGIN
    UPDATE public.booking_attributions SET held_basis = NULL WHERE meeting_id = 'fx04b';
    fails := fails || 'CHECK accepted held without basis'::text;
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 6. Triggers: the client guard never fired on the job's updates (isolated stub table counts calls).
  IF to_regclass('public.guard_calls') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.guard_calls where meeting_id not like ''fx%''' INTO d0;
    IF d0 <> 0 THEN fails := fails || ('client guard fired ' || d0 || ' times on real rows'); END IF;
  END IF;
  res := res || jsonb_build_object('board_truth_marks', (SELECT max(n) FROM public.board_truth_dirty WHERE client_id = 'risedtc'));

  -- 7. Roles: anon and authenticated cannot run any of the three functions; service_role can; table stays closed.
  FOREACH v IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ok := false;
    BEGIN
      EXECUTE format('set local role %I', v);
      PERFORM public.rise_booking_held_compute(pnow);
    EXCEPTION WHEN insufficient_privilege THEN ok := true;
    END;
    RESET ROLE;
    IF NOT ok THEN fails := fails || (v || ' can run rise_booking_held_compute'); END IF;
    IF has_function_privilege(v, 'public.rise_booking_held_apply(timestamptz)', 'EXECUTE')
       OR has_function_privilege(v, 'public._rise_held_norm(text)', 'EXECUTE') THEN fails := fails || (v || ' has EXECUTE'); END IF;
    IF has_table_privilege(v, 'public.booking_attributions', 'SELECT') THEN fails := fails || (v || ' can read the table'); END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.rise_booking_held_apply(timestamptz)', 'EXECUTE') THEN fails := fails || 'service_role lacks EXECUTE'::text; END IF;
  res := res || jsonb_build_object('cron', (SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'rise-booking-held-daily'));
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rise-booking-held-daily') THEN fails := fails || 'cron missing'::text; END IF;

  -- 8. Rollback leaves nothing behind.
  EXECUTE $rb$
__ROLLBACK__
  $rb$;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.booking_attributions'::regclass AND attname LIKE 'held%' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('rise_booking_held_apply','rise_booking_held_compute','_rise_held_norm'))
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rise-booking-held-daily') THEN fails := fails || 'rollback left objects'::text; END IF;

  res := res || jsonb_build_object('fails', to_jsonb(fails));
  RAISE EXCEPTION '% %', CASE WHEN cardinality(fails) = 0 THEN 'TEST_PASS' ELSE 'TEST_FAIL' END, res;
END
$t$;
