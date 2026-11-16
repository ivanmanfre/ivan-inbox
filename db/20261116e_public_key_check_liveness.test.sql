-- Test for 20261116e. Run AFTER the migration, as postgres. Everything is rolled back.
--  T1 healthy now (today's 07:30 run succeeded): 'ok', no row
--  T2 job disabled: problem + exactly one row
--  T3 tomorrow 09:45 with no run yet for tomorrow's cycle (today's success is the latest): problem + one row.
--     This is the "yesterday succeeded late, today failed" case: a success from the previous cycle never counts.
--  T4 job missing: problem + one row
--  T5 not exposed; cron command, schedule and owner wired
--  T6 slot boundaries with fixture runs (see inline)
--  T7 daylight-saving boundary with the session in Europe/Warsaw

begin;

do $t$
declare r text; n0 int; n1 int; jid bigint; tomorrow_check timestamptz;
begin
  select jobid into jid from cron.job where jobname = 'public-key-surface-check' and username = 'postgres' and database = current_database();
  if jid is null then raise exception 'T0 SETUP: job not found'; end if;
  tomorrow_check := (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') + interval '1 day 9 hours 45 minutes';

  select count(*) into n0 from public.silent_failures where source = 'public-key-surface-check';
  r := public.public_key_check_liveness();
  if r is distinct from 'ok' then raise exception 'T1 FAIL: %', r; end if;
  select count(*) into n1 from public.silent_failures where source = 'public-key-surface-check';
  if n1 is distinct from n0 then raise exception 'T1 FAIL: wrote a row while healthy'; end if;

  perform cron.alter_job(jid, active := false);
  r := public.public_key_check_liveness();
  if r not like '%disabled%' then raise exception 'T2 FAIL: %', r; end if;
  select count(*) into n1 from public.silent_failures where source = 'public-key-surface-check';
  if n1 is distinct from n0 + 1 then raise exception 'T2 FAIL: expected one new row'; end if;
  perform cron.alter_job(jid, active := true);

  r := public.public_key_check_liveness(tomorrow_check);
  if r not like '%no succeeded run for the%' then raise exception 'T3 FAIL: %', r; end if;
  select count(*) into n0 from public.silent_failures where source = 'public-key-surface-check';
  if n0 is distinct from n1 + 1 then raise exception 'T3 FAIL: expected one new row'; end if;

  -- T6 boundaries with fixture runs in 2030 (no real runs there), job 363's own history:
  --   a  check 2030-01-10 09:45, only a run that started 00:15 that day         -> alert (+1 row)
  --   b  check 2030-01-10 09:45, a run that started exactly 07:30 that day      -> ok (no row)
  --   c  check 2030-01-11 07:29, run started 2030-01-10 07:30, ended 01-11 00:10 -> ok (yesterday's slot, still current)
  --   d  check 2030-01-12 07:29, only a run that started 2030-01-11 07:00       -> alert (+1 row)
  insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
  values (jid, 990000001, 'succeeded', '2030-01-10 00:15+00', '2030-01-10 00:16+00');
  select count(*) into n0 from public.silent_failures where source = 'public-key-surface-check';
  r := public.public_key_check_liveness('2030-01-10 09:45+00');
  if r not like '%no succeeded run for the 2030-01-10%' then raise exception 'T6a FAIL: %', r; end if;
  select count(*) into n1 from public.silent_failures where source = 'public-key-surface-check';
  if n1 is distinct from n0 + 1 then raise exception 'T6a FAIL: expected one new row'; end if;

  insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
  values (jid, 990000002, 'succeeded', '2030-01-10 07:30+00', '2030-01-10 07:31+00');
  r := public.public_key_check_liveness('2030-01-10 09:45+00');
  if r is distinct from 'ok' then raise exception 'T6b FAIL: %', r; end if;
  delete from cron.job_run_details where runid = 990000002;  -- T6c must pass on the late-finishing run alone
  insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
  values (jid, 990000004, 'succeeded', '2030-01-10 07:30:30+00', '2030-01-11 00:10+00');
  r := public.public_key_check_liveness('2030-01-11 07:29+00');
  if r is distinct from 'ok' then raise exception 'T6c FAIL: %', r; end if;
  select count(*) into n0 from public.silent_failures where source = 'public-key-surface-check';
  if n0 is distinct from n1 then raise exception 'T6b/c FAIL: wrote a row while ok'; end if;

  insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
  values (jid, 990000003, 'succeeded', '2030-01-11 07:00+00', '2030-01-11 07:01+00');
  r := public.public_key_check_liveness('2030-01-12 07:29+00');
  if r not like '%no succeeded run for the 2030-01-11%' then raise exception 'T6d FAIL: %', r; end if;
  select count(*) into n1 from public.silent_failures where source = 'public-key-surface-check';
  if n1 is distinct from n0 + 1 then raise exception 'T6d FAIL: expected one new row'; end if;
  n0 := n1;

  -- T7 daylight-saving boundary, session in Europe/Warsaw (clocks went back 2026-10-25): check at 2026-10-26 07:29Z,
  --    only a success that started 2026-10-25 07:00Z (before that day's 07:30Z slot) -> alert (+1 row)
  set local timezone = 'Europe/Warsaw';
  insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
  values (jid, 990000005, 'succeeded', '2026-10-25 07:00+00', '2026-10-25 07:01+00');
  r := public.public_key_check_liveness('2026-10-26 07:29+00');
  if r not like '%no succeeded run for the 2026-10-25%' then raise exception 'T7 FAIL: %', r; end if;
  select count(*) into n1 from public.silent_failures where source = 'public-key-surface-check';
  if n1 is distinct from n0 + 1 then raise exception 'T7 FAIL: expected one new row'; end if;
  n0 := n1;
  set local timezone = 'UTC';

  perform cron.unschedule(jid);
  r := public.public_key_check_liveness();
  if r not like '%missing%' then raise exception 'T4 FAIL: %', r; end if;
  select count(*) into n1 from public.silent_failures where source = 'public-key-surface-check';
  if n1 is distinct from n0 + 1 then raise exception 'T4 FAIL: expected one new row'; end if;

  if has_function_privilege('anon', 'public.public_key_check_liveness(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.public_key_check_liveness(timestamptz)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.public_key_check_liveness(timestamptz)', 'EXECUTE') then
    raise exception 'T5 FAIL: exposed';
  end if;
  if not exists (select 1 from cron.job where jobname = 'public-key-check-liveness' and username = 'postgres' and active
                   and schedule = '45 9 * * *' and command = 'select public.public_key_check_liveness()') then
    raise exception 'T5 FAIL: cron';
  end if;
  raise notice 'T1-T7 ok';
end $t$;

rollback;
