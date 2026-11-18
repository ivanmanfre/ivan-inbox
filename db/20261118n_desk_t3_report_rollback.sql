-- Rollback for 20261118n_desk_t3_report.sql (new function, nothing else reads it).
drop function if exists public.desk_t3_report(uuid, text, text, text, text, text);
drop trigger if exists desk_t3_jobs_launch_id_once on public.desk_t3_jobs;
drop function if exists public.desk_t3_jobs_launch_id_once();
alter table public.desk_t3_jobs drop column if exists poller_seen_at;
alter table public.desk_t3_jobs drop column if exists launch_id;
