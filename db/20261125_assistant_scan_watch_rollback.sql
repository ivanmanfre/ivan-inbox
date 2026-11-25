-- Keep the journal so a future rollout can still identify delivered turns.
begin;
select cron.unschedule(jobid) from cron.job where jobname='assistant-rise-scan-watch';
update public.integration_config set value='off' where key='assistant_scan_watch_mode';
commit;
