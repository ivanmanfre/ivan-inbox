-- Rollback 309.
select cron.unschedule(j.jobname) from cron.job j where j.jobname = 'open-tracking-daily-check';
drop function if exists public.open_tracking_daily_check();
