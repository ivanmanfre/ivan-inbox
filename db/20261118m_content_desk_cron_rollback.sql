-- Rollback: stop the Content Desk tick.
select cron.unschedule('content-desk-tick');
