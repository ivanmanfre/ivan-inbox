-- Rollback of 20261116d: stops the daily archive. Safe to rerun. Ideas it already archived stay archived; the
-- optional restore below brings them back exactly (the job only archives rows whose archived_reason was null).

begin;
select cron.unschedule(jobid) from cron.job where jobname = 'ideas-stale-outside-archive' and username = 'postgres';
drop function if exists public.lm_ideas_archive_stale_outside();
commit;

-- Optional restore of everything the daily job archived:
-- update public.lm_idea_candidates set status = 'reviewing', archived_reason = null
--  where status = 'archived' and archived_reason like 'stale_30d_outside_source_daily%';
