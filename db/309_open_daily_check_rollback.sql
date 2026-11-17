-- Rollback 309.
select cron.unschedule('open-tracking-daily-check');
drop function if exists public.open_tracking_daily_check();
