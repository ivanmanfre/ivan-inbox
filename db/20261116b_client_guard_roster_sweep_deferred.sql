-- 20261116b: saves to the client exclusion lists stop timing out.
--
-- Problem (found 2026-11-16): the AFTER trigger trg_client_guard_roster on integration_config runs
-- client_guard_sweep() inside the save. For ARCH that is a 33 s loop over ~7,750 prospects
-- (timed dry-run 11-16). The API roles have statement_timeout 8s, so every API save of
-- arch_person_exclusions / arch_company_exclusions / rise_do_not_target is cancelled and rolled back.
-- "Outreach - ARCH DNT Chat Sync (Davorin inbox)" (n8n SLQCjgy1xS5tLi4v) has failed every Monday
-- since 2026-10-05 for this reason; arch_person_exclusions was last saved 2026-09-25.
--
-- Fix: the trigger only records "sweep requested" for that client, with a fresh token per save.
-- A pg_cron job runs every minute (as postgres, no 8 s limit), sweeps every requested client, and
-- only then clears the requests whose token is still the one it served.
-- The hourly full sweep (cron 147) and the drain share one transaction advisory lock, so they never
-- run client_guard_booked_refresh / client_guard_sweep at the same time. The drain skips a minute
-- (requests kept) while the hourly sweep holds the lock; the hourly sweep waits for a running drain.
--
-- Contact safety: the sweep only parks rows that are already in the queue. The send-time checks
-- (trg_client_guard on outreach_prospects, client_guard_reason, and the ARCH senders' own list gate)
-- read the lists live, so they see a saved list at once. The sweep now lands within ~1-2 minutes
-- of the save instead of never.
--
-- Readers (who-reads 11-16): client_guard_sweep_requests is new (0 readers);
-- trg_client_guard_roster is used only as the trigger on integration_config. CREATE OR REPLACE keeps
-- the 20261115h revokes.
--
-- Sol round 1 (11-16) fixes: deletes happen after all sweeps (no row lock held across a sweep);
-- per-save token instead of a transaction timestamp; shared advisory lock with cron 147;
-- rollback waits for in-flight saves.
-- Sol round 2 fixes: final delete skips locked rows; refuse while a sweep is running (cutover);
-- rollback locks the booked-keys cache in phase 2 and can be rerun after a partial run.
--
-- Apply order: 20261116b0 (pause cron 147 + heartbeat, commit), wait for one heartbeat run, then this file.
-- Rollback: 20261116b_client_guard_roster_sweep_deferred_rollback.sql

begin;
set local lock_timeout = '10s';

-- Hold the trigger function's catalog row, then check it is the version this migration expects.
grant execute on function public.trg_client_guard_roster() to postgres;
do $guard$
declare got text;
begin
  got := md5(pg_get_functiondef('public.trg_client_guard_roster()'::regprocedure));
  if got is distinct from '2a003633f8efee9527e33db4b0be9133' then
    raise exception 'trg_client_guard_roster is not the expected live version (md5 %): migration refused', got;
  end if;
  if exists (select 1 from cron.job where jobname = 'client-guard-sweep-drain') then
    raise exception 'cron job client-guard-sweep-drain already exists: migration refused';
  end if;
  if not exists (select 1 from cron.job where jobid = 147 and schedule = '41 * * * *'
                   and command = 'select public.client_guard_sweep(null, null, null, false)') then
    raise exception 'cron 147 is not the expected hourly sweep: migration refused';
  end if;
  -- Cutover (Sol r3): 20261116b0 must have paused job 147 in its own committed transaction, so pg_cron cannot launch
  -- the old unlocked command (even a delayed launch) before this commits. Then refuse while any run is still live.
  if exists (select 1 from cron.job where jobid = 147 and active) then
    raise exception 'run 20261116b0 first (cron 147 must be paused): migration refused';
  end if;
  -- The launcher must have reloaded its job list since the pause: the heartbeat job created with the pause has run.
  if not exists (select 1 from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                  where j.jobname = 'client-guard-cutover-heartbeat' and j.username = 'postgres' and d.status = 'succeeded') then
    raise exception 'the cutover heartbeat has not run yet (pg_cron has not reloaded since the pause): retry in a minute';
  end if;
  if exists (select 1 from cron.job_run_details where jobid = 147 and status in ('starting', 'running', 'connecting', 'sending'))
     or exists (select 1 from pg_stat_activity where pid <> pg_backend_pid() and state <> 'idle'
                  and query ilike '%client_guard_sweep(%') then
    raise exception 'a client_guard_sweep run is still live: migration refused, retry in a minute';
  end if;
end $guard$;

create table public.client_guard_sweep_requests (
  client_id     text primary key check (client_id in ('arch', 'risedtc')),
  request_token uuid not null default gen_random_uuid(),
  requested_at  timestamptz not null default clock_timestamp()
);
comment on table public.client_guard_sweep_requests is
  '20261116b: one row per client whose exclusion list was saved and still needs client_guard_sweep(). Written by trg_client_guard_roster (new token per save), cleared by client_guard_sweep_drain() (cron, every minute) only when the token is the one it served.';
alter table public.client_guard_sweep_requests enable row level security;
revoke all on table public.client_guard_sweep_requests from public, anon, authenticated, service_role;

create or replace function public.trg_client_guard_roster()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c text;
begin
  -- 20261116b: record the request only. The sweep takes ~33 s for ARCH and would be cancelled by the
  -- API's 8 s statement timeout, rolling back the save itself. client_guard_sweep_drain() runs it.
  if new.key = 'rise_do_not_target' then c := 'risedtc';
  elsif new.key in ('arch_company_exclusions', 'arch_person_exclusions') then c := 'arch';
  end if;
  if c is not null then
    insert into public.client_guard_sweep_requests (client_id, request_token, requested_at)
    values (c, gen_random_uuid(), clock_timestamp())
    on conflict (client_id) do update
      set request_token = excluded.request_token, requested_at = excluded.requested_at;
  end if;
  return null;
end $function$;

-- One lock key shared by the hourly sweep and the drain.
create function public.client_guard_sweep_all_serial()
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(20261116002);
  return public.client_guard_sweep(null, null, null, false);
end $function$;
revoke all on function public.client_guard_sweep_all_serial() from public, anon, authenticated, service_role;

create function public.client_guard_sweep_drain()
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare rec record; res jsonb; out jsonb := '{}'::jsonb; served jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(20261116002) then
    return jsonb_build_object('skipped', 'locked');   -- hourly sweep running; requests kept for next minute
  end if;
  -- Plain SELECT (no row lock): a save during the sweeps never waits on this job.
  for rec in select client_id, request_token from public.client_guard_sweep_requests order by client_id loop
    res := public.client_guard_sweep(rec.client_id, null, null, false);
    served := served || jsonb_build_object('c', rec.client_id, 't', rec.request_token);
    out := out || jsonb_build_object(rec.client_id, coalesce(res->'parked', 'null'::jsonb));
  end loop;
  -- Short final phase: clear only requests whose token is still the one served. A save that landed
  -- during the sweeps has a new token and stays for the next minute.
  -- SKIP LOCKED: a request row that a save is updating right now is left for the next minute, so this
  -- statement never waits on (or makes a save wait behind) another request's row lock.
  delete from public.client_guard_sweep_requests r
   where r.ctid in (
     select q.ctid from public.client_guard_sweep_requests q
       join jsonb_array_elements(served) s on q.client_id = s->>'c' and q.request_token = (s->>'t')::uuid
      for update of q skip locked);
  return out;
end $function$;
revoke all on function public.client_guard_sweep_drain() from public, anon, authenticated, service_role;

select cron.alter_job(147, command := 'select public.client_guard_sweep_all_serial()', active := true);
select cron.schedule('client-guard-sweep-drain', '* * * * *', 'select public.client_guard_sweep_drain()');
select cron.unschedule(jobid) from cron.job where jobname = 'client-guard-cutover-heartbeat' and username = 'postgres';

commit;
