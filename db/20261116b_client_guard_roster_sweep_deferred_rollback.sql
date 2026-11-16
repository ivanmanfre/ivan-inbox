-- Rollback of 20261116b: the trigger runs client_guard_sweep() inside the save again
-- (pg_get_functiondef md5 2a003633f8efee9527e33db4b0be9133) and cron 147 runs the plain sweep again.
-- API saves of the ARCH lists will time out again (33 s sweep vs 8 s limit).
--
-- Safe to rerun: phase 1 accepts a trigger that is already the original (a previous partial run) and only
-- (re)applies the cron state; phase 2 is idempotent. Refuses when the trigger is neither the 20261116b
-- version nor the original.
-- Keeps public.client_guard_sweep_requests (data is never dropped); it simply stops being written.
--
-- Phase 1: lock that conflicts with every integration_config writer (waits for in-flight saves, so their
--   request rows are committed), restore the trigger, stop the drain job, restore cron 147. Held only for
--   these quick statements.
-- Phase 2: with no new requests possible, take the shared advisory lock and then the booked-keys cache lock
--   (waits for any refresh in flight, blocks new ones), sweep every pending request, clear them, drop the
--   20261116b functions.

begin;
set local lock_timeout = '30s';

grant execute on function public.trg_client_guard_roster() to postgres;
do $guard$
declare got text;
begin
  got := md5(pg_get_functiondef('public.trg_client_guard_roster()'::regprocedure));
  if got not in ('9493fe007318704b9aea65f2015e3238', '2a003633f8efee9527e33db4b0be9133') then
    raise exception 'trg_client_guard_roster is neither the 20261116b version nor the original (md5 %): rollback refused', got;
  end if;
end $guard$;

lock table public.integration_config in share row exclusive mode;

CREATE OR REPLACE FUNCTION public.trg_client_guard_roster()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.key = 'rise_do_not_target' then perform client_guard_sweep('risedtc', null, null, false);
  elsif new.key in ('arch_company_exclusions','arch_person_exclusions') then perform client_guard_sweep('arch', null, null, false);
  end if;
  return null;
end $function$;

select cron.unschedule(jobid) from cron.job where jobname = 'client-guard-sweep-drain' and username = 'postgres';
select cron.unschedule(jobid) from cron.job where jobname = 'client-guard-cutover-heartbeat' and username = 'postgres';
select cron.alter_job(147, command := 'select public.client_guard_sweep(null, null, null, false)', active := true);

commit;

begin;
do $serve$
declare rec record;
begin
  perform pg_advisory_xact_lock(20261116002);
  if to_regclass('public.client_guard_booked_keys') is not null then
    lock table public.client_guard_booked_keys in share row exclusive mode;
  end if;
  if to_regclass('public.client_guard_sweep_requests') is not null then
    for rec in select client_id from public.client_guard_sweep_requests order by client_id loop
      perform public.client_guard_sweep(rec.client_id, null, null, false);
    end loop;
    delete from public.client_guard_sweep_requests;
  end if;
end $serve$;

drop function if exists public.client_guard_sweep_drain();
drop function if exists public.client_guard_sweep_all_serial();
commit;
