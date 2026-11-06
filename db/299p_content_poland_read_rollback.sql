-- Rollback of db/299p. Removes the job, the functions and the reads table (the reads are a cache: nothing else uses them).
select cron.unschedule('content-poland-read') where exists (select 1 from cron.job where jobname = 'content-poland-read');
drop function if exists public.content_poland_of(uuid[]);
drop function if exists public.content_poland_save(uuid, text, boolean, text, text);
drop function if exists public.content_poland_due(int);
drop function if exists public.content_poland_brain_vote(jsonb);
drop table if exists public.content_poland_reads;
