-- Rollback of 20261116e. silent_failures rows it wrote are kept. Safe to rerun.
begin;
select cron.unschedule(jobid) from cron.job where jobname = 'public-key-check-liveness' and username = 'postgres';
drop function if exists public.public_key_check_liveness(timestamptz);
commit;
