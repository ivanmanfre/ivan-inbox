-- Test for 20261116b. Run AFTER the migration, as postgres. Everything is rolled back.
-- Single-session checks:
--  T1 an API-role save of arch_person_exclusions finishes fast and records a request with a token
--  T2 the drain sweeps ARCH and clears the request
--  T3 a request whose token changed after it was read is NOT cleared (token predicate)
--  T4 nothing is callable or readable by anon / authenticated / service_role; cron jobs are wired
-- Overlap checks need two sessions; see 20261116b README section in the PR (live checks L1, L2).

begin;

-- statement_timeout is armed per client message, so in a one-message runner (Management API) the
-- SET below does not bind the UPDATE; the DO block times the save itself as well.
set local role service_role;
set local statement_timeout = '8s';
do $t1save$
declare t0 timestamptz := clock_timestamp(); ms numeric;
begin
  update public.integration_config set value = value where key = 'arch_person_exclusions';
  ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  if ms > 2000 then raise exception 'T1 FAIL: API-role save took % ms (limit 8000, budget 2000)', ms; end if;
  perform set_config('t.save_ms', ms::text, true);
end $t1save$;
reset role;
set local statement_timeout = '0';

do $t1$
begin
  if not exists (select 1 from public.client_guard_sweep_requests where client_id = 'arch' and request_token is not null) then
    raise exception 'T1 FAIL: save did not record an arch sweep request';
  end if;
  raise notice 'T1 ok: API save % ms, request recorded', current_setting('t.save_ms');
end $t1$;

-- 2. Drain sweeps and clears.
do $t2$
declare r jsonb;
begin
  r := public.client_guard_sweep_drain();
  if not (r ? 'arch') then raise exception 'T2 FAIL: drain did not sweep arch (%)', r; end if;
  if exists (select 1 from public.client_guard_sweep_requests where client_id = 'arch') then
    raise exception 'T2 FAIL: arch request not cleared';
  end if;
  raise notice 'T2 ok: drain swept arch, parked=%', r->'arch';
end $t2$;

-- 3. Token predicate: read a token, let a second save replace it, then run the drain's delete with
--    the old token. The newer request must survive.
do $t3$
declare old_tok uuid; new_tok uuid;
begin
  update public.integration_config set value = value where key = 'rise_do_not_target';
  select request_token into old_tok from public.client_guard_sweep_requests where client_id = 'risedtc';
  update public.integration_config set value = value where key = 'rise_do_not_target';
  select request_token into new_tok from public.client_guard_sweep_requests where client_id = 'risedtc';
  if old_tok is null or new_tok is null or old_tok = new_tok then
    raise exception 'T3 FAIL: second save did not issue a new token (% / %)', old_tok, new_tok;
  end if;
  delete from public.client_guard_sweep_requests r
   using jsonb_array_elements(jsonb_build_array(jsonb_build_object('c','risedtc','t',old_tok))) s
   where r.client_id = s->>'c' and r.request_token = (s->>'t')::uuid;
  if not exists (select 1 from public.client_guard_sweep_requests where client_id = 'risedtc' and request_token = new_tok) then
    raise exception 'T3 FAIL: newer request was cleared by an older token';
  end if;
  raise notice 'T3 ok: newer request kept';
end $t3$;

-- 4. Exposure and wiring.
do $t4$
declare r text; f text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    foreach f in array array['public.client_guard_sweep_drain()','public.client_guard_sweep_all_serial()'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception 'T4 FAIL: % can execute %', r, f; end if;
    end loop;
    if has_table_privilege(r, 'public.client_guard_sweep_requests', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'T4 FAIL: % has privileges on client_guard_sweep_requests', r;
    end if;
  end loop;
  if not exists (select 1 from cron.job where jobname = 'client-guard-sweep-drain' and active and schedule = '* * * * *') then
    raise exception 'T4 FAIL: drain cron job missing';
  end if;
  if not exists (select 1 from cron.job where jobid = 147 and active and command = 'select public.client_guard_sweep_all_serial()') then
    raise exception 'T4 FAIL: cron 147 not on the serial wrapper';
  end if;
  raise notice 'T4 ok: not exposed, cron jobs wired';
end $t4$;

rollback;
