-- Rolled-back test of 20261118b_inbox_place_visits.sql against the live database. Nothing is committed: the block
-- always ends in an exception whose message is the result (PASS or a FAIL list).
DO $t$
DECLARE uid uuid; n int; fails text[] := '{}'; got uuid; cnt int; other uuid := gen_random_uuid();
  -- a place no real visit has, so live visit rows never change the count below
  probe text := '__test_' || gen_random_uuid();
BEGIN
  SELECT u.id INTO uid FROM auth.users u ORDER BY u.created_at LIMIT 1;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);

  -- 1. authenticated: the RPC inserts one row with this user's id
  SET LOCAL ROLE authenticated;
  PERFORM public.inbox_log_visit(probe, null, 'web');
  SELECT count(*), min(user_id::text)::uuid INTO cnt, got FROM public.inbox_place_visits WHERE place = probe;
  RESET ROLE;
  IF cnt <> 1 OR got IS DISTINCT FROM uid THEN fails := fails || format('1 insert: rows=%s user_ok=%s', cnt, got = uid); END IF;

  -- 2. anon: permission error on the RPC and on the table
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.inbox_log_visit('home', null, 'web'); fails := fails || '2a anon rpc allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN fails := fails || ('2a anon rpc ' || SQLSTATE); END;
  BEGIN PERFORM 1 FROM public.inbox_place_visits LIMIT 1; fails := fails || '2b anon select allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN fails := fails || ('2b anon select ' || SQLSTATE); END;
  RESET ROLE;

  -- 3. surface 'tv' is rejected by the check constraint
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.inbox_log_visit('home', null, 'tv'); fails := fails || '3 tv accepted';
  EXCEPTION WHEN check_violation THEN NULL; WHEN OTHERS THEN fails := fails || ('3 tv ' || SQLSTATE); END;

  -- 4. a row for another user is refused by the policy, and a foreign row is not readable
  BEGIN INSERT INTO public.inbox_place_visits (user_id, place, surface) VALUES (other, 'x', 'web'); fails := fails || '4a foreign insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN fails := fails || ('4a ' || SQLSTATE); END;
  RESET ROLE;
  INSERT INTO public.inbox_place_visits (user_id, place, surface) VALUES (other, 'seen-by-nobody', 'web');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.inbox_place_visits WHERE place = 'seen-by-nobody';
  RESET ROLE;
  IF cnt <> 0 THEN fails := fails || '4b foreign row readable'; END IF;

  -- 5. the daily public-key check still passes
  SELECT count(*) INTO n FROM public.public_key_surface_check() WHERE NOT ok;
  IF n <> 0 THEN fails := fails || format('5 public_key_surface_check off rows=%s', n); END IF;

  RAISE EXCEPTION '%', CASE WHEN cardinality(fails) = 0 THEN 'TEST RESULT: PASS (5 groups)' ELSE 'TEST RESULT: FAIL ' || array_to_string(fails, '; ') END;
END $t$;
