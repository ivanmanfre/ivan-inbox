-- 20261116e: an alert when the daily public-key check stops running.
--
-- The 11-15 lock added cron job 'public-key-surface-check' (07:30 UTC) which writes silent_failures when the
-- public (anon) key can reach more than the agreed list. Nothing noticed if that job itself was disabled,
-- deleted, or failing. This adds a second, independent daily job (09:45 UTC) that writes a silent_failures row
-- (same source 'public-key-surface-check') when the job is missing, inactive, or has no succeeded run in the current
-- daily cycle (the run that started at or after that day's 07:30 UTC slot).
-- Read-only apart from that one insert. Runs at 09:45 UTC, 2 h 15 min after the 07:30 slot.
--
-- Readers (who-reads 11-16): public_key_check_liveness is new (0 readers). silent_failures already receives
-- rows from public_key_surface_check_alert with this source.
--
-- Rollback: 20261116e_public_key_check_liveness_rollback.sql

begin;

do $guard$
begin
  if exists (select 1 from cron.job where jobname = 'public-key-check-liveness' and username = 'postgres') then
    raise exception 'cron job public-key-check-liveness already exists: refused';
  end if;
end $guard$;

create function public.public_key_check_liveness(p_now timestamptz default now())
 returns text
 language plpgsql
 set search_path to 'public'
 set timezone to 'UTC'
as $function$
declare j record; last_ok timestamptz; problem text; day0 timestamptz; cycle timestamptz;
begin
  -- jobname is unique per owner, so scope to the expected owner and database (Sol r1).
  select jobid, active into j from cron.job
   where jobname = 'public-key-surface-check' and username = 'postgres' and database = current_database();
  if not found then
    problem := 'cron job public-key-surface-check is missing';
  elsif not j.active then
    problem := 'cron job public-key-surface-check is disabled';
  else
    -- Require a succeeded run that STARTED at or after the current cycle's 07:30 UTC slot (Sol r2, r3): today's
    -- 07:30 once it is past 07:30 UTC, else yesterday's. A run that started before the slot never counts.
    -- UTC throughout (function timezone + '24 hours'), so a daylight-saving change cannot shift the slot (Sol r4).
    day0 := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';
    cycle := case when p_now >= day0 + interval '7 hours 30 minutes' then day0 else day0 - interval '24 hours' end
             + interval '7 hours 30 minutes';
    select max(end_time) into last_ok from cron.job_run_details
     where jobid = j.jobid and status = 'succeeded' and start_time >= cycle and start_time <= p_now;
    if last_ok is null then
      problem := format('cron job public-key-surface-check has no succeeded run for the %s UTC cycle (last success %s)',
                        to_char(cycle at time zone 'UTC', 'YYYY-MM-DD'),
                        coalesce((select max(end_time)::text from cron.job_run_details where jobid = j.jobid and status = 'succeeded'), 'never'));
    end if;
  end if;
  if problem is not null then
    insert into public.silent_failures (source, detail)
    values ('public-key-surface-check', jsonb_build_object(
      'message', problem,
      'what_to_do', 'The daily check that the public key reaches nothing new is not running. Re-enable or fix cron job public-key-surface-check (select public.public_key_surface_check_alert()).'));
  end if;
  return coalesce(problem, 'ok');
end $function$;
revoke all on function public.public_key_check_liveness(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('public-key-check-liveness', '45 9 * * *', 'select public.public_key_check_liveness()');

commit;
