-- 20261116b0: preflight for 20261116b. Run and COMMIT this first, then wait until the heartbeat has run (1-2 minutes)
-- before 20261116b.
-- 1. Pauses cron 147 so pg_cron stops launching the old unlocked hourly sweep.
-- 2. Removes any heartbeat left from an earlier attempt and schedules a FRESH one (new job id) in the same transaction.
--    A run of that new job proves the pg_cron launcher reloaded its job list after the pause (Sol r4/r5: a launcher
--    working from cached metadata could otherwise still launch the old command; an old heartbeat's past runs prove nothing).
--    20261116b refuses until the heartbeat has a succeeded run, then removes it.
-- Undo without applying 20261116b (in a fresh session; after a failed 20261116b, first end that transaction):
--   ROLLBACK;
--   BEGIN;
--   select cron.alter_job(147, active := true);
--   select cron.unschedule(jobid) from cron.job where jobname = 'client-guard-cutover-heartbeat' and username = 'postgres';
--   COMMIT;
begin;
select cron.alter_job(147, active := false);
select cron.unschedule(jobid) from cron.job where jobname = 'client-guard-cutover-heartbeat' and username = 'postgres';
select cron.schedule('client-guard-cutover-heartbeat', '* * * * *', 'select 1');
commit;
